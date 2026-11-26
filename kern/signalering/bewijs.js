// signalering/bewijs.js
//
// Haalt de stukken op van de bewijsbronnen (signalering.json, onderdeel bewijs: Rodi en
// Zaanstad.nieuws) en bewaart ze in data/zanp-prioriteit/bewijs.json. Dat zijn GEEN
// nieuwsberichten en GEEN agendapunten: prioriteit/index.js maakt er alleen een
// vingerafdruk van, zodat de routes naar rood (prioriteit/routes.js) kunnen tellen
// hoeveel media over een onderwerp schrijven.
//
// Per bron, in volgorde (elk onderdeel mag falen zonder de rest te stoppen):
//   1. Rodi: de RSS-feed en de lijstpagina. Zaanstad.nieuws: de lijstpagina (kop,
//      inleiding, url en datum zitten in de ingebedde gegevens) en de nieuws-sitemap.
//   2. Per nieuw stuk (hooguit maxArtikelenPerRun per bron per run): de artikelpagina
//      voor de volledige tekst, zodat het woordtal en de vingerafdruk kloppen. Lukt
//      dat niet, dan telt de inleiding.
//
// De volledige tekst wordt niet bewaard: alleen titel, inleiding, datum en rubriek.
// Een fout bij één bron stopt de run nooit; hij komt in de staat en in het logboek.

"use strict";

const fs = require("fs/promises");
const path = require("path");
const cheerio = require("cheerio");

const BRONNEN = require("../basis/gemeenten").bewijsBronnen();

const DAG_MS = 24 * 3600 * 1000;
const BEWAAR_DAGEN = 30;
const MAX_POGINGEN_ARTIKEL = 2;
const MAX_ARTIKEL_TEKENS = 12000;
const MAANDEN = { jan: 1, feb: 2, mrt: 3, apr: 4, mei: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 };

function leegStaat() {
  return { versie: 1, bronnen: {}, items: {} };
}

function object(x) {
  return x && typeof x === "object" && !Array.isArray(x) ? x : {};
}

function spatie(t) {
  return String(t == null ? "" : t).replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

function zonderPunten(t) {
  return spatie(t).replace(/\.{2,}$/, "").replace(/…$/, "").trim();
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

// "17 nov, 14:30" (Rodi) of "wo 18 nov 2026, 11:50": Nederlandse tijd, jaar afgeleid
// als het ontbreekt (niet meer dan een dag in de toekomst). Relatieve teksten
// ("19 uur geleden", "gisteren") worden uit nu berekend.
function parseNlDatum(tekst, nu = new Date()) {
  const t = spatie(tekst).toLowerCase();
  if (!t) return null;
  const { amsterdamNaarIso } = require("../ai/wire");
  const { kalenderdagAmsterdam } = require("../basis/hulpmiddelen");

  let m = t.match(/(\d+)\s*(minuut|minuten|uur)\s+geleden/);
  if (m) {
    const ms = Number(m[1]) * (m[2] === "uur" ? 3600 * 1000 : 60 * 1000);
    return new Date(nu.getTime() - ms).toISOString();
  }
  if (/^zojuist|^net\b/.test(t)) return nu.toISOString();
  m = t.match(/(\d+)\s*dagen?\s+geleden/);
  if (m) return new Date(nu.getTime() - Number(m[1]) * DAG_MS).toISOString();
  if (/^gisteren/.test(t)) return new Date(nu.getTime() - DAG_MS).toISOString();

  m = t.match(/(\d{1,2})\s+(jan|feb|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?(?:,?\s+(\d{1,2})[:.](\d{2}))?/);
  if (!m) return null;
  const dagNr = Number(m[1]);
  const maand = MAANDEN[m[2]];
  const nuDag = kalenderdagAmsterdam(nu.toISOString());
  let jaar = m[3] ? Number(m[3]) : Number(nuDag.slice(0, 4));
  const uur = m[4] !== undefined ? Number(m[4]) : 12;
  const min = m[5] !== undefined ? Number(m[5]) : 0;
  let dag = `${jaar}-${pad2(maand)}-${pad2(dagNr)}`;
  if (!m[3] && dag > nuDag) {
    jaar -= 1;
    dag = `${jaar}-${pad2(maand)}-${pad2(dagNr)}`;
  }
  return amsterdamNaarIso(dag, uur, min);
}

// "2026-11-18T11:50:57.000" zonder zone is Nederlandse tijd (Rodi); met Z is het UTC.
function isoVanTijdstip(tekst) {
  const t = spatie(tekst);
  if (!t) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(t)) {
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  const m = t.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const { amsterdamNaarIso } = require("../ai/wire");
  return amsterdamNaarIso(m[1], Number(m[2]), Number(m[3]));
}

// ---------------------------------------------------------------------------
// Rodi
// ---------------------------------------------------------------------------

const RODI_HREF = /^(?:https?:\/\/(?:www\.)?rodi\.nl)?(\/zaanstad\/nieuws\/(\d+)\/[^\s?#"]*)/;

function parseRodiLijst(html, nu = new Date()) {
  const $ = cheerio.load(html);
  const perId = new Map();
  $("a[href]").each((_, a) => {
    const m = String($(a).attr("href") || "").match(RODI_HREF);
    if (!m) return;
    const el = $(a);
    let titel = spatie(el.find("h4").first().text());
    let afgekapt = false;
    if (!titel) titel = spatie(el.find("h3 span").first().text());
    if (!titel) titel = spatie(el.find("h3").first().text());
    if (!titel) titel = spatie(el.find("#feed-title").first().text());
    if (!titel) titel = spatie(el.find("h5").first().text());
    if (!titel) return;
    if (/\.{2}$/.test(titel)) {
      afgekapt = true;
      titel = zonderPunten(titel);
    }
    const teaserEl = el.find("p").first().clone();
    teaserEl.find("span").remove();
    const teaser = zonderPunten(teaserEl.text());
    const rubriek = spatie(el.find(".css-category").first().text());
    let datumTekst = "";
    el.find("span").each((__, s) => {
      const c = $(s).attr("class") || "";
      if (/text-gray-400/.test(c) && !datumTekst) datumTekst = spatie($(s).text());
    });
    const item = {
      id: m[2],
      url: `https://www.rodi.nl${m[1]}`,
      titel,
      teaser,
      rubriek,
      datum: datumTekst ? parseNlDatum(datumTekst, nu) : null,
      ...(afgekapt ? { afgekapt: true } : {}),
    };
    const oud = perId.get(m[2]);
    if (!oud) perId.set(m[2], item);
    else {
      // dezelfde kaart komt vaker voor (hero, lijst, meest gelezen): houd de rijkste
      for (const k of ["teaser", "rubriek", "datum"]) if (!oud[k] && item[k]) oud[k] = item[k];
      if (oud.afgekapt && !item.afgekapt) {
        oud.titel = item.titel;
        delete oud.afgekapt;
      }
    }
  });
  return [...perId.values()];
}

function parseRodiArtikel(html) {
  const $ = cheerio.load(html);
  const titel = spatie($("h1.article-headline, article h1").first().text());
  const datum = isoVanTijdstip($("article time[datetime], time[datetime]").first().attr("datetime"));
  const intro = spatie($(".article-intro").first().text());
  const delen = [];
  $(".articlediv p").each((_, p) => {
    const t = spatie($(p).text());
    if (t) delen.push(t);
  });
  const tekst = [intro, ...delen].filter(Boolean).join("\n\n").slice(0, MAX_ARTIKEL_TEKENS);
  return { titel, datum, tekst };
}

// ---------------------------------------------------------------------------
// Zaanstad.nieuws (Newsifier)
// ---------------------------------------------------------------------------

function jsonTekst(s) {
  try {
    return spatie(JSON.parse(`"${s}"`));
  } catch {
    return spatie(s);
  }
}

// De lijstpagina bevat per artikel een object met title, excerpt, url, published_at,
// ingebed in Next.js-gegevens (met dubbel ontsnapte aanhalingstekens).
function parseNewsifierLijst(html, host = "zaanstad.nieuws.nl") {
  const u = String(html).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  const delen = u.split('"article":{"id":').slice(1);
  const perUrl = new Map();
  const veld = (blok, naam) => {
    const m = blok.match(new RegExp(`"${naam}":"((?:[^"\\\\]|\\\\.)*)"`));
    return m ? jsonTekst(m[1]) : "";
  };
  for (const blok of delen) {
    const url = veld(blok, "url");
    const titel = veld(blok, "title");
    if (!url || !titel) continue;
    let h;
    try {
      h = new URL(url).hostname;
    } catch {
      continue;
    }
    if (h !== host) continue;
    if (perUrl.has(url)) continue;
    const pub = veld(blok, "published_at");
    const ms = Date.parse(pub);
    perUrl.set(url, {
      url,
      titel,
      teaser: zonderPunten(veld(blok, "excerpt")),
      rubriek: rubriekUitUrl(url),
      datum: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
    });
  }
  return [...perUrl.values()];
}

function rubriekUitUrl(url) {
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean)[0] || "";
    return seg;
  } catch {
    return "";
  }
}

// Een Google News-sitemap: <url><loc>..</loc><news:news><news:publication_date>..
// <news:title>..</news:title></news:news></url>. Tolerant voor naamruimten.
function parseNieuwsSitemap(xml, host = "zaanstad.nieuws.nl") {
  const uit = [];
  const blokken = String(xml).match(/<url>[\s\S]*?<\/url>/gi) || [];
  const tag = (blok, naam) => {
    const m = blok.match(new RegExp(`<(?:[a-z]+:)?${naam}[^>]*>([\\s\\S]*?)</(?:[a-z]+:)?${naam}>`, "i"));
    return m ? spatie(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")) : "";
  };
  for (const blok of blokken) {
    const url = tag(blok, "loc");
    const titel = tag(blok, "title");
    if (!url || !titel) continue;
    try {
      if (new URL(url).hostname !== host) continue;
    } catch {
      continue;
    }
    const ms = Date.parse(tag(blok, "publication_date"));
    uit.push({ url, titel, teaser: "", rubriek: rubriekUitUrl(url), datum: Number.isFinite(ms) ? new Date(ms).toISOString() : null });
  }
  return uit;
}

function parseNewsifierArtikel(html) {
  const $ = cheerio.load(html);
  const titel = spatie($('meta[property="og:title"]').attr("content") || $("title").first().text());
  const datum = isoVanTijdstip($('meta[name="article:published_time"]').attr("content") || "");
  const delen = [];
  $("#article-blocks .paragraph-content").each((_, p) => {
    const t = spatie($(p).text());
    if (t) delen.push(t);
  });
  return { titel, datum, tekst: delen.join("\n\n").slice(0, MAX_ARTIKEL_TEKENS) };
}

// ---------------------------------------------------------------------------
// Ophalen
// ---------------------------------------------------------------------------

function standaardHaal() {
  const { haalOp } = require("../basis/hulpmiddelen");
  return (url) => haalOp(url, 2);
}

function standaardParseerRss() {
  const { parseerRssTekst } = require("../basis/hulpmiddelen");
  return (xml, bron) => parseerRssTekst(xml, bron);
}

async function verzamelBron(bron, { haal, parseerRss, nu, log }) {
  const lijst = [];
  const fouten = [];
  const probeer = async (naam, f) => {
    try {
      const uit = await f();
      lijst.push(...uit);
      return uit.length;
    } catch (fout) {
      fouten.push(`${naam}: ${fout.message}`);
      return 0;
    }
  };

  if (bron.type === "rodi") {
    if (bron.feedUrl) {
      await probeer("rss", async () => {
        const items = await parseerRss(await haal(bron.feedUrl), { id: bron.id, naam: bron.naam, categorie: "lokaal" });
        return items
          .filter((i) => RODI_HREF.test(String(i.url || "")))
          .map((i) => ({
            url: i.url.replace(/^http:/, "https:").replace(/^https?:\/\/rodi\.nl/, "https://www.rodi.nl"),
            titel: spatie(i.titel),
            teaser: zonderPunten(i.samenvatting || ""),
            rubriek: "",
            datum: i.gepubliceerdOp ? new Date(i.gepubliceerdOp).toISOString() : null,
          }));
      });
    }
    if (bron.lijstUrl) {
      await probeer("lijst", async () => parseRodiLijst(await haal(bron.lijstUrl), nu));
    }
  } else if (bron.type === "newsifier") {
    if (bron.lijstUrl) {
      await probeer("lijst", async () => parseNewsifierLijst(await haal(bron.lijstUrl), bron.host));
    }
    if (bron.sitemapUrl) {
      await probeer("sitemap", async () => parseNieuwsSitemap(await haal(bron.sitemapUrl), bron.host));
    }
  }
  if (fouten.length) log.warn(`[bewijs] ${bron.id}: ${fouten.join("; ")}`);
  return { lijst, fouten };
}

function artikelParser(bron) {
  return bron.type === "rodi" ? parseRodiArtikel : parseNewsifierArtikel;
}

function sleutelVan(url) {
  return `b:${url}`;
}

function meerWaard(oud, nieuw) {
  return (nieuw && String(nieuw).length > String(oud || "").length) || (!oud && nieuw);
}

/**
 * Haalt alle bewijsbronnen op en werkt de staat bij.
 *
 * @returns {{ items: object[], staat: object, stats: object }}
 *   items: alle bekende stukken van de laatste 30 dagen als
 *   { key, url, bron, bronNaam, titel, teaser, datum, rubriek, tekst? }.
 *   `tekst` staat er alleen als het artikel deze run is opgehaald; de staat zelf
 *   bewaart geen volledige tekst.
 */
async function haalBewijs(opties = {}) {
  const {
    bronnen = BRONNEN,
    staat: staatIn = null,
    nu = new Date(),
    haal = standaardHaal(),
    parseerRss = standaardParseerRss(),
    log = console,
    pauzeMs = 400,
  } = opties;
  const staat = staatIn ? { ...leegStaat(), ...staatIn, bronnen: object(staatIn.bronnen), items: object(staatIn.items) } : leegStaat();
  const stats = { bronnen: {}, nieuw: 0, artikelen: 0, artikelFouten: 0 };
  const tekstDezeRun = new Map();
  const pauze = () => (pauzeMs > 0 ? new Promise((r) => setTimeout(r, pauzeMs)) : Promise.resolve());

  for (const bron of bronnen) {
    const s = { gevonden: 0, nieuw: 0, fouten: [] };
    stats.bronnen[bron.id] = s;
    let verzameld;
    try {
      verzameld = await verzamelBron(bron, { haal, parseerRss, nu, log });
    } catch (fout) {
      verzameld = { lijst: [], fouten: [fout.message] };
    }
    s.fouten = verzameld.fouten;
    s.gevonden = verzameld.lijst.length;

    for (const i of verzameld.lijst) {
      if (!i.url || !i.titel) continue;
      const key = sleutelVan(i.url);
      const oud = staat.items[key];
      if (!oud) {
        staat.items[key] = {
          url: i.url,
          bron: bron.id,
          titel: i.titel,
          teaser: i.teaser || "",
          rubriek: i.rubriek || "",
          datum: i.datum || null,
          gezienOp: nu.toISOString(),
          pogingen: 0,
          ...(i.afgekapt ? { afgekapt: true } : {}),
        };
        s.nieuw++;
        stats.nieuw++;
      } else {
        // Een latere bron in de lijst vult aan wat een eerdere niet had.
        if (i.datum && !oud.datum) oud.datum = i.datum;
        if (oud.afgekapt && !i.afgekapt) {
          oud.titel = i.titel;
          delete oud.afgekapt;
        }
        if (meerWaard(oud.teaser, i.teaser)) oud.teaser = i.teaser;
        if (!oud.rubriek && i.rubriek) oud.rubriek = i.rubriek;
      }
    }

    // Artikelteksten: nieuwste eerst, hooguit maxArtikelenPerRun per bron.
    const parse = artikelParser(bron);
    const grens = nu.getTime() - 14 * DAG_MS;
    const kandidaten = Object.entries(staat.items)
      .filter(([, it]) => it.bron === bron.id && !it.tekstOp && (it.pogingen || 0) < MAX_POGINGEN_ARTIKEL)
      .filter(([, it]) => {
        const t = Date.parse(it.datum);
        return !Number.isFinite(t) || t >= grens;
      })
      .sort((a, b) => (Date.parse(b[1].datum) || nu.getTime()) - (Date.parse(a[1].datum) || nu.getTime()))
      .slice(0, bron.maxArtikelenPerRun || 10);
    for (const [key, it] of kandidaten) {
      it.pogingen = (it.pogingen || 0) + 1;
      try {
        const a = parse(await haal(it.url));
        if (a.tekst && a.tekst.length >= 40) {
          tekstDezeRun.set(key, a.tekst);
          it.tekstOp = nu.toISOString();
          it.woorden = (a.tekst.match(/\S+/g) || []).length;
          stats.artikelen++;
        }
        if (a.titel && (it.afgekapt || !it.titel)) {
          it.titel = a.titel;
          delete it.afgekapt;
        }
        if (a.datum) it.datum = a.datum;
      } catch (fout) {
        stats.artikelFouten++;
        log.warn(`[bewijs] artikel ${it.url} niet opgehaald: ${fout.message}`);
      }
      await pauze();
    }
  }

  // Opruimen: stukken ouder dan BEWAAR_DAGEN vergeten.
  const weg = nu.getTime() - BEWAAR_DAGEN * DAG_MS;
  for (const [key, it] of Object.entries(staat.items)) {
    const t = Date.parse(it.datum || it.gezienOp);
    if (Number.isFinite(t) && t < weg) delete staat.items[key];
  }

  for (const bron of bronnen) {
    const s = stats.bronnen[bron.id];
    staat.bronnen[bron.id] = {
      laatsteOphaal: nu.toISOString(),
      gevonden: s.gevonden,
      fout: s.gevonden === 0 && s.fouten.length ? s.fouten.join("; ") : null,
    };
  }
  staat.bijgewerkt = nu.toISOString();

  const naam = Object.fromEntries(bronnen.map((b) => [b.id, b.naam]));
  const items = Object.entries(staat.items).map(([key, it]) => ({
    key,
    url: it.url,
    bron: it.bron,
    bronNaam: naam[it.bron] || it.bron,
    titel: it.titel,
    teaser: it.teaser || "",
    datum: it.datum || it.gezienOp,
    rubriek: it.rubriek || "",
    ...(tekstDezeRun.has(key) ? { tekst: tekstDezeRun.get(key) } : {}),
  }));
  return { items, staat, stats };
}

// ---------------------------------------------------------------------------
// Opslag
// ---------------------------------------------------------------------------

async function leesBewijsStaat(map) {
  try {
    const j = JSON.parse(await fs.readFile(path.join(map, "bewijs.json"), "utf-8"));
    const staat = { ...leegStaat(), ...object(j), bronnen: object(j.bronnen), items: object(j.items) };
    return { staat, voor: JSON.stringify(staat) };
  } catch {
    const staat = leegStaat();
    return { staat, voor: JSON.stringify(staat) };
  }
}

// Schrijft alleen als er iets veranderd is (de tijdstempel telt niet mee).
async function schrijfBewijsStaat(map, staat, voor) {
  const { bijgewerkt, ...rest } = staat;
  const voorRest = (() => {
    try {
      const { bijgewerkt: _b, ...r } = JSON.parse(voor);
      return JSON.stringify(r);
    } catch {
      return null;
    }
  })();
  if (JSON.stringify(rest) === voorRest) return false;
  await fs.mkdir(map, { recursive: true });
  await fs.writeFile(path.join(map, "bewijs.json"), JSON.stringify({ bijgewerkt, ...rest }), "utf-8");
  return true;
}

module.exports = {
  BEWAAR_DAGEN,
  haalBewijs,
  leesBewijsStaat,
  schrijfBewijsStaat,
  leegStaat,
  parseNlDatum,
  parseRodiLijst,
  parseRodiArtikel,
  parseNewsifierLijst,
  parseNewsifierArtikel,
  parseNieuwsSitemap,
  artikelParser,
  MAX_ARTIKEL_TEKENS,
};
