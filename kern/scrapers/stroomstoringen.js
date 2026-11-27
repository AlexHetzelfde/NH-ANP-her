// scrapers/stroomstoringen.js
//
// Stroomstoringen van stroomstoringkaart.nl (gegevens van de netbeheerders), alleen
// voor de plaatsen die in bron.plaatsen staan (de dorpen en steden van
// Zaanstreek-Waterland). De provinciepagina toont alle actuele storingen in
// Noord-Holland; wat buiten de regio valt, gaat er hier uit.
//
// Werkwijze:
//  1. De provinciepagina lezen (bron.url): per storing een plaats en een link.
//  2. Per storing de detailpagina lezen. Daar staan alle plaatsen (de lijst toont
//     er maar een), het begin van de storing, het aantal huishoudens, de oorzaak,
//     de postcodes en de straten.
//  3. Een storing is regionaal als minstens een van zijn plaatsen in bron.plaatsen
//     staat. Dan wordt het een bericht.
//
// Het bericht gaat niet langs de AI (geenAi): kop en tekst komen uit de gegevens,
// de tag is vast (bron.vasteRubriek, standaard 112). Rood is geen werk van deze
// scraper maar van signalering/stroom-ernst.js (bron.stroomErnst): rood hangt af van het
// aantal huishoudens ten opzichte van de grootste storing tot nu toe. De scraper levert
// daarvoor het getal (huishoudensAantal) en leest op verzoek of een storing is opgelost.
//
// DE KOP EN DE TEKST MOETEN STABIEL BLIJVEN. ZANP maakt een nieuwe versie van een
// bericht zodra de kop verandert of de tekst veel langer of korter wordt. Daarom
// staat er in de kop en tekst geen looptijd ("al 2 uur") en geen status ("monteur
// onderweg"): die veranderen elke run.
//
// Faalt de detailpagina van een storing, dan gaat het bericht door met de gegevens
// uit de lijst (alleen de eerste plaats; het begin wordt geschat uit de looptijd).

"use strict";

const cheerio = require("cheerio");
const { haalOp, oorzaakTekst } = require("../basis/hulpmiddelen");

const MAX_DETAILS = 25; // detailpagina's per run
const DETAIL_PARALLEL = 4;
const DETAIL_BUDGET_MS = 30_000; // daarna houden de rest de lijstgegevens

function normaliseerPlaats(tekst) {
  return String(tekst ?? "")
    .normalize("NFC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function maakPlaatsenSet(plaatsen) {
  return new Set((Array.isArray(plaatsen) ? plaatsen : []).map(normaliseerPlaats).filter(Boolean));
}

function schoon(tekst) {
  return String(tekst ?? "").replace(/\s+/g, " ").trim();
}

// "al 1 uur en 17 minuten", "7 dagen en 2 uur" -> minuten, of null.
function looptijdInMinuten(tekst) {
  const t = String(tekst ?? "").toLowerCase();
  const dagen = t.match(/(\d+)\s*dag/);
  const uren = t.match(/(\d+)\s*uur/);
  const minuten = t.match(/(\d+)\s*minu/);
  if (!dagen && !uren && !minuten) return null;
  return (dagen ? Number(dagen[1]) * 1440 : 0) + (uren ? Number(uren[1]) * 60 : 0) + (minuten ? Number(minuten[1]) : 0);
}

// De lijst "Storingen op dit moment" op de provinciepagina.
function leesLijst(html, paginaUrl) {
  const $ = cheerio.load(html);
  const items = [];
  const gezien = new Set();
  $("ul.storingen li").each((_, li) => {
    const link = $(li).find(".kaartje-kop a[href], a[href]").first();
    const href = link.attr("href");
    if (!href || !/\/storing\//.test(href)) return;
    const url = new URL(href, paginaUrl).toString();
    if (gezien.has(url)) return;
    gezien.add(url);
    items.push({
      url,
      plaats: schoon(link.text()),
      status: schoon($(li).find(".merk").first().text()),
      meta: schoon($(li).find("p").first().text()),
    });
  });
  return items;
}

// "Assendelft en Westzaan" -> ["Assendelft", "Westzaan"]. Alleen als noodgreep,
// als de tabel op de detailpagina geen plaatsen geeft.
function splitsPlaatsen(tekst) {
  return schoon(tekst)
    .split(/\s*,\s*|\s+en\s+/i)
    .map(schoon)
    .filter(Boolean);
}

// Leest een detailpagina. Geeft null als er niets bruikbaars in staat.
function leesDetail(html) {
  const $ = cheerio.load(html);

  // Machineleesbare gegevens: de pagina is een SpecialAnnouncement.
  let ld = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (ld) return;
    try {
      const data = JSON.parse($(el).contents().text());
      const lijst = Array.isArray(data) ? data : [data];
      ld = lijst.find((d) => d && d["@type"] === "SpecialAnnouncement") || null;
    } catch {
      // een kapotte ld+json-blok slaan we over
    }
  });

  const rij = {};
  $("table tr").each((_, tr) => {
    const kop = schoon($(tr).find("th").first().text()).toLowerCase();
    const cel = $(tr).find("td").first();
    if (kop) rij[kop] = { tekst: schoon(cel.text()), links: cel.find("a").map((__, a) => schoon($(a).text())).get().filter(Boolean) };
  });

  let plaatsen = (rij.plaatsen || rij.plaats || { links: [] }).links;
  if (!plaatsen.length) {
    plaatsen = $("p")
      .filter((_, p) => /^Deze melding gaat over/i.test(schoon($(p).text())))
      .first()
      .find("a")
      .map((_, a) => schoon($(a).text()))
      .get()
      .filter(Boolean);
  }
  if (!plaatsen.length && ld && ld.spatialCoverage && ld.spatialCoverage.name) {
    plaatsen = splitsPlaatsen(ld.spatialCoverage.name);
  }
  if (!plaatsen.length && rij.plaatsen) plaatsen = splitsPlaatsen(rij.plaatsen.tekst);

  const straten = schoon(
    $("p")
      .filter((_, p) => /^Het gaat om /i.test(schoon($(p).text())))
      .first()
      .text()
  );

  const begonIso = ld && ld.datePosted && !isNaN(new Date(ld.datePosted).getTime()) ? new Date(ld.datePosted).toISOString() : null;

  const detail = {
    plaatsen,
    begonIso,
    begonTekst: (rij.begon && rij.begon.tekst) || "",
    netbeheerder: (rij.netbeheerder && rij.netbeheerder.tekst) || (ld && ld.provider && ld.provider.name) || "",
    huishoudens: (rij.huishoudens && rij.huishoudens.tekst) || "",
    soort: (rij.soort && rij.soort.tekst) || "",
    oorzaak: (rij.oorzaak && rij.oorzaak.tekst) || "",
    postcodes: (rij.postcodes && rij.postcodes.tekst) || "",
    straten,
  };
  if (!detail.plaatsen.length) return null;
  return detail;
}

// "Ongeveer 600 huishoudens", "20.000 huishoudens", "1 000 huishoudens" -> aantal, of null.
// Een los getal ("600") telt ook. Bij een bereik ("100 tot 500 huishoudens") het hoogste.
function leesHuishoudens(tekst) {
  const t = String(tekst ?? "");
  let m = t.match(/(\d[\d.\s\u00a0]*)\s*huishoud/i);
  if (!m) m = t.match(/^[^\d]*(\d[\d.\s\u00a0]*)[^\d]*$/);
  if (!m) return null;
  const cijfers = m[1].replace(/\D/g, "");
  if (!cijfers) return null;
  const n = Number(cijfers);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Staat op de detailpagina dat de storing is opgelost? ("Deze stroomstoring in X is
// opgelost. Hij duurde ...", of in de gegevens van de pagina een verleden tijd "duurde").
function isOpgelost(html) {
  const $ = cheerio.load(html);
  const teksten = [];
  $("p").each((_, p) => teksten.push(schoon($(p).text())));
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text());
      for (const d of Array.isArray(data) ? data : [data]) {
        if (d && d["@type"] === "SpecialAnnouncement" && d.text) teksten.push(schoon(d.text));
      }
    } catch {
      // een kapot ld+json-blok slaan we over
    }
  });
  return teksten.some((t) => /\bis opgelost\b|\bduurde\b/i.test(t));
}

function opsomming(namen) {
  if (namen.length <= 1) return namen.join("");
  return `${namen.slice(0, -1).join(", ")} en ${namen[namen.length - 1]}`;
}

function bouwTitel(plaatsen) {
  return `Stroomstoring in ${opsomming(plaatsen)}`;
}

function formatBegin(iso) {
  try {
    const delen = new Intl.DateTimeFormat("nl-NL", {
      timeZone: "Europe/Amsterdam",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(iso));
    const g = (type) => (delen.find((d) => d.type === type) || {}).value;
    return `${g("day")} ${g("month")} ${g("year")} om ${g("hour")}:${g("minute")}`;
  } catch {
    return "";
  }
}

function eindig(zin) {
  const z = schoon(zin);
  return /[.!?]$/.test(z) ? z : `${z}.`;
}

// De tekst van het bericht: alleen feiten van de pagina, in een vaste volgorde.
function bouwSamenvatting({ titel, detail, lijst }) {
  const delen = [`${titel}.`];
  const begin = detail && (detail.begonTekst || (detail.begonIso && formatBegin(detail.begonIso)));
  if (begin) delen.push(`De storing begon op ${begin}.`);
  const huishoudens = (detail && detail.huishoudens) || "";
  if (huishoudens) {
    delen.push(/huishoud/i.test(huishoudens) ? `${huishoudens} zijn zonder stroom.` : `Aantal huishoudens zonder stroom: ${huishoudens}.`);
  } else if (lijst && /huishoud/i.test(lijst.meta)) {
    // "Ongeveer 600 huishoudens, al 1 uur en 17 minuten." Alleen het eerste deel: de looptijd verandert elke run.
    delen.push(`${schoon(lijst.meta.split(",")[0])} zijn zonder stroom.`);
  }
  if (detail && detail.netbeheerder) delen.push(`Netbeheerder: ${detail.netbeheerder}.`);
  if (detail && detail.soort) delen.push(`Soort: ${detail.soort}.`);
  if (detail && detail.oorzaak) delen.push(`Oorzaak: ${detail.oorzaak}.`);
  if (detail && detail.postcodes) delen.push(`Postcodes: ${detail.postcodes}.`);
  if (detail && detail.straten) delen.push(eindig(detail.straten));
  delen.push("Bron: Stroomstoringkaart, met gegevens van de netbeheerder.");
  return delen.join(" ");
}

async function haalDetails(items, haal, budgetMs) {
  const resultaat = new Map();
  const wachtrij = items.slice(0, MAX_DETAILS);
  const einde = Date.now() + budgetMs;
  async function werker() {
    while (wachtrij.length > 0) {
      const item = wachtrij.shift();
      if (Date.now() > einde) {
        resultaat.set(item.url, null);
        continue;
      }
      try {
        const html = await haal(item.url, 2, { stil: true });
        resultaat.set(item.url, leesDetail(html));
      } catch (fout) {
        console.log(`[stroomstoringen] Detailpagina ${item.url} mislukt: ${fout.message}${oorzaakTekst(fout)}`);
        resultaat.set(item.url, null);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(DETAIL_PARALLEL, Math.max(1, wachtrij.length)) }, werker));
  return resultaat;
}

async function scrapeStroomstoringen(bron, deps = {}) {
  const haal = deps.haal || haalOp;
  const nu = deps.nu || new Date();
  const budgetMs = deps.detailBudgetMs ?? DETAIL_BUDGET_MS;

  const regio = maakPlaatsenSet(bron.plaatsen);
  if (regio.size === 0) {
    // Zonder plaatsenlijst zou de hele provincie binnenkomen. Liever niets.
    console.error(`[${bron.id}] Geen "plaatsen" in de bronconfiguratie: bron overgeslagen (anders komt heel Noord-Holland binnen).`);
    return [];
  }

  const html = await haal(bron.url);
  const lijst = leesLijst(html, bron.url);
  if (lijst.length === 0) {
    console.log(`[${bron.id}] Geen storingen op de provinciepagina.`);
    return [];
  }

  const details = await haalDetails(lijst, haal, budgetMs);
  const berichten = [];
  let buitenRegio = 0;
  let zonderDetail = 0;

  for (const item of lijst) {
    const detail = details.get(item.url) || null;
    if (!detail) zonderDetail++;
    const plaatsen = detail && detail.plaatsen.length ? detail.plaatsen : item.plaats ? [item.plaats] : [];
    if (!plaatsen.some((p) => regio.has(normaliseerPlaats(p)))) {
      buitenRegio++;
      continue;
    }

    const titel = bouwTitel(plaatsen);
    let gepubliceerdOp = detail && detail.begonIso;
    if (!gepubliceerdOp) {
      const minuten = looptijdInMinuten(item.meta);
      gepubliceerdOp = new Date(nu.getTime() - (minuten ?? 0) * 60 * 1000).toISOString();
    }

    berichten.push({
      bronId: bron.id,
      bronNaam: bron.naam,
      categorie: bron.categorie,
      titel,
      url: item.url,
      samenvatting: bouwSamenvatting({ titel, detail, lijst: item }),
      gepubliceerdOp,
      opgehaaldOp: nu.toISOString(),
      vasteRubriek: bron.vasteRubriek || "112",
      // Het aantal huishoudens als getal (null als onbekend); stroom-ernst.js rekent ermee.
      huishoudensAantal: leesHuishoudens(detail && detail.huishoudens) ?? leesHuishoudens(item.meta),
      geenAi: true,
    });
  }

  console.log(
    `[${bron.id}] ${lijst.length} storing(en) op de pagina, ${berichten.length} in de regio, ${buitenRegio} daarbuiten` +
      `${zonderDetail ? `, ${zonderDetail} zonder detailpagina (lijstgegevens gebruikt)` : ""}` +
      `${lijst.length > MAX_DETAILS ? `, alleen de eerste ${MAX_DETAILS} detailpagina's gelezen` : ""}.`
  );
  return berichten;
}

module.exports = {
  scrapeStroomstoringen,
  // voor tests
  leesLijst,
  leesDetail,
  looptijdInMinuten,
  leesHuishoudens,
  isOpgelost,
  bouwTitel,
  bouwSamenvatting,
  normaliseerPlaats,
  maakPlaatsenSet,
};
