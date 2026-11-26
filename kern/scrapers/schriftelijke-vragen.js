// scrapers/schriftelijke-vragen.js
//
// Schriftelijke vragen (artikel 51 en andere raadsvragen) van de gemeenteraad
// van Zaanstad, uit het iBabs-rapport "Schriftelijke vragen". Twee momenten
// zijn nieuws, en elk krijgt een bericht:
//
//   1. PUBLICATIE   de vragen staan in iBabs        -> status "gesteld"
//   2. BEANTWOORDING het college heeft geantwoord   -> status "beantwoord"
//
// Het antwoord komt onder DEZELFDE url als de vraag (/Reports/Item/<id>) maar
// met een andere kop ("Antwoord op schriftelijke vragen: ..."). wire.js ziet
// een andere kop als nieuwe versie van het bericht: de vraag blijft versie 1,
// het antwoord wordt versie 2 en krijgt als tijd het moment waarop wij het zagen.
// Zo hangt het antwoord niet af van hoeveel tekst de antwoordbrief toevoegt.
// prioriteit/regels.js maakt de beantwoording rood.
//
// OUDE VRAGEN OPNIEUW BEKIJKEN
// De lijst staat gesorteerd op datum van de vraag en bevat per vraag de
// kolommen "Afgedaan" en "Datum antwoord". Elke run lezen we die lijst (tot
// MAX_PAGINAS pagina's), dus een antwoord op een vraag van maanden geleden
// valt meteen op, zonder dat we de detailpagina van elke open vraag moeten
// ophalen. De detailpagina halen we alleen op voor een vraag die we willen
// publiceren. data/berichten.json is het geheugen:
//
//   - vraag nog niet in berichten.json en niet beantwoord:
//       publiceren als de vraag hoogstens VRAAG_VENSTER_DAGEN oud is
//   - vraag beantwoord volgens de lijst:
//       publiceren als antwoord als we de vraag al kennen (als gesteld), of
//       als het antwoord hoogstens ANTWOORD_VENSTER_DAGEN geleden is (ook als
//       de vraag zelf niet meer in berichten.json staat)
//   - vraag die al als "beantwoord" in berichten.json staat: overslaan
//
// Een uitstelbrief ("het antwoord duurt langer") is geen eigen bericht. Staat
// hij er al bij de eerste keer, dan komt hij in de tekst van de vraag.
//
// Het bericht gaat niet langs de AI (geenAi): de tekst is de metadata van de
// vraag plus de tekst van de pdf-bijlagen, in een vaste opbouw.
//
// De opmaak van de detailpagina is gecontroleerd op een echte pagina (vraag
// 1024, DZ, huisbezoeken). De JSON van de lijst (GetReportData) is dat niet:
// de scraper leest de kolommen daarom tolerant en logt de eerste rijen ruw.

"use strict";

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const { bouwLijstBody, parseerNlDatum } = require("./ibabs");
const { parseerDetail, leesPdfTekst } = require("./ibabs-dashboard");
const { oorzaakTekst, vandaagAmsterdam, dagVerschil, kalenderdagAmsterdam } = require("../basis/hulpmiddelen");

let pdfParse;
try {
  pdfParse = require("pdf-parse");
} catch {
  pdfParse = null;
}

// Zelfde map als gedeeld.js (hier niet geïmporteerd: gedeeld.js laadt het register, dat deze scraper).
const DATA_MAP = require("../basis/gemeenten").dataMap();

const PAGE_SIZE = 100;
const MAX_PAGINAS = 3;
const VRAAG_VENSTER_DAGEN = 7; // een nieuwe vraag tellen we mee tot 7 dagen na de vraagdatum
const ANTWOORD_VENSTER_DAGEN = 7; // een antwoord tellen we mee tot 7 dagen na de antwoorddatum
const REQUEST_TIMEOUT_MS = 12_000;
const START_BUDGET_MS = 24_000; // daarna geen nieuwe vraag meer beginnen (ZANP breekt een bron af na 45 s)
const PARALLEL = 3;
const MAX_TEKST_LENGTE = 15000;
const MAX_RUWE_LOGS = 2;

const GEBRUIKERSAGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

// Kolommen van het rapport, in de volgorde van de rapportpagina (data-columns).
const KOLOMMEN = [
  { data: "registrationdate" },
  { data: "title", searchable: false },
  { data: "raadsledenselectie" },
  { data: "steunfractielidselectie" },
  { data: "partijselectie" },
  { data: "afgedaan" },
  { data: "datumantwoord" },
];
const LIJST_CONFIG = { kolommen: KOLOMMEN, sorteerKolom: "registrationdate", sorteerRichting: "desc" };

const PREFIX_GESTELD = "Schriftelijke vragen: ";
const PREFIX_BEANTWOORD = "Antwoord op schriftelijke vragen: ";

// ---------------------------------------------------------------------------
// Kleine hulpfuncties
// ---------------------------------------------------------------------------

function schoon(tekst) {
  return String(tekst ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Celwaarde uit de lijst-JSON: eventuele HTML eruit, spaties opruimen. */
function celTekst(waarde) {
  if (waarde === null || waarde === undefined) return "";
  if (typeof waarde === "boolean") return waarde ? "true" : "false";
  return schoon(String(waarde).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " "));
}

/** "Afgedaan" kan als true/"True"/"Ja" komen, of als een vinkje-icoon in HTML. */
function isAfgedaan(waarde) {
  if (waarde === true) return true;
  const s = String(waarde ?? "");
  if (/fa-check-square|fa-check\b|checked/i.test(s)) return true;
  if (/niet afgedaan|fa-square|^\s*(false|nee|0)\s*$/i.test(s)) return false;
  return /^\s*(true|ja|yes|1)\s*$/i.test(celTekst(s));
}

function dagenGeleden(isoDatum, vandaag = vandaagAmsterdam()) {
  if (!isoDatum) return null;
  const dag = kalenderdagAmsterdam(isoDatum);
  return dag ? dagVerschil(dag, vandaag) : null;
}

function isoDag(isoDatum) {
  return isoDatum ? kalenderdagAmsterdam(isoDatum) || null : null;
}

function mooieDatum(isoDatum) {
  const dag = isoDag(isoDatum);
  if (!dag) return "";
  const [j, m, d] = dag.split("-");
  return `${d}-${m}-${j}`;
}

/** Zet een gelezen veld om naar een lijst (voor raadsleden, partijen, portefeuillehouders). */
function lijstVan(waarde) {
  if (Array.isArray(waarde)) return waarde;
  return waarde ? [waarde] : [];
}

function basisUrlVan(bron) {
  return new URL(bron.url).origin;
}

async function haalOp(url, opties = {}, lezer = "text") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...opties, signal: controller.signal });
    if (!response.ok && opties.negeerStatus !== true) throw new Error(`HTTP ${response.status} bij ${url}`);
    if (lezer === "json") return await response.json();
    if (lezer === "buffer") return { response, buffer: Buffer.from(await response.arrayBuffer()) };
    return { response, tekst: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

function verzamelCookies(response) {
  const ruw =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  return ruw.map((c) => c.split(";")[0]).join("; ");
}

// ---------------------------------------------------------------------------
// Lijst
// ---------------------------------------------------------------------------

/** Eén rij uit GetReportData naar een vraag-object (zonder detail). */
function parseRij(rij, basisUrl) {
  const id = rij.DT_RowId ? String(rij.DT_RowId).replace(/^row_/, "") : null;
  const datumAntwoord = parseerNlDatum(celTekst(rij.datumantwoord));
  return {
    id,
    url: id ? `${basisUrl}/Reports/Item/${id}` : null,
    onderwerp: celTekst(rij.title),
    datumVraag: parseerNlDatum(celTekst(rij.registrationdate)),
    datumAntwoord,
    afgedaan: isAfgedaan(rij.afgedaan),
  };
}

/** Beantwoord volgens de lijst: vinkje "Afgedaan", of een antwoorddatum die niet in de toekomst ligt. */
function isBeantwoord(vraag, vandaag = vandaagAmsterdam()) {
  if (vraag.afgedaan) return true;
  if (!vraag.datumAntwoord) return false;
  const d = dagenGeleden(vraag.datumAntwoord, vandaag);
  return d !== null && d >= 0;
}

async function haalLijst(bron, cookie, basisUrl) {
  const guid = (bron.url.match(/Reports\/Details\/([a-f0-9-]{36})/i) || [])[1];
  if (!guid) throw new Error(`Geen rapport-GUID in de url: ${bron.url}`);
  const dataUrl = `${basisUrl}/Reports/GetReportData/${guid}`;

  const rijen = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const data = await haalOp(
      dataUrl,
      {
        method: "POST",
        headers: {
          "User-Agent": GEBRUIKERSAGENT,
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          Origin: basisUrl,
          Referer: bron.url,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: bouwLijstBody(pagina * PAGE_SIZE, pagina + 1, LIJST_CONFIG),
      },
      "json"
    );
    const deze = Array.isArray(data && data.data) ? data.data : [];
    rijen.push(...deze);
    if (deze.length < PAGE_SIZE) break;
  }
  return rijen;
}

// ---------------------------------------------------------------------------
// Geheugen: wat staat al in berichten.json?
// ---------------------------------------------------------------------------

/** url -> status van de nieuwste versie ("gesteld" | "beantwoord" | "onbekend"). */
function bekendeVragen(berichtenPad) {
  const bekend = new Map();
  try {
    const data = JSON.parse(fs.readFileSync(berichtenPad, "utf8"));
    const nieuwste = new Map();
    for (const r of Array.isArray(data.berichten) ? data.berichten : []) {
      if (!r || !r.url || !r.vraag) continue;
      const vorige = nieuwste.get(r.url);
      if (!vorige || (r.versie || 1) > (vorige.versie || 1)) nieuwste.set(r.url, r);
    }
    for (const [url, r] of nieuwste) bekend.set(url, (r.vraag && r.vraag.status) || "onbekend");
  } catch {
    // geen bestand of kapot: dan is niets bekend
  }
  return bekend;
}

/**
 * Beslist per vraag of hij dit uur gepubliceerd wordt, en als wat.
 * Geeft { actie: "overslaan" | "publiceer", status, reden }.
 */
function beslis(vraag, bekendeStatus, vandaag = vandaagAmsterdam()) {
  if (bekendeStatus === "beantwoord") return { actie: "overslaan", reden: "bekend" };

  if (isBeantwoord(vraag, vandaag)) {
    if (bekendeStatus) return { actie: "publiceer", status: "beantwoord", reden: "antwoord op bekende vraag" };
    const d = dagenGeleden(vraag.datumAntwoord, vandaag);
    if (d !== null && d <= ANTWOORD_VENSTER_DAGEN) {
      return { actie: "publiceer", status: "beantwoord", reden: "recent antwoord" };
    }
    return { actie: "overslaan", reden: "antwoord buiten venster" };
  }

  if (bekendeStatus) return { actie: "overslaan", reden: "bekend" };
  const d = dagenGeleden(vraag.datumVraag, vandaag);
  if (d !== null && d >= -1 && d <= VRAAG_VENSTER_DAGEN) {
    return { actie: "publiceer", status: "gesteld", reden: "nieuwe vraag" };
  }
  return { actie: "overslaan", reden: "buiten venster" };
}

// ---------------------------------------------------------------------------
// Detailpagina
// ---------------------------------------------------------------------------

/**
 * Leest de velden van /Reports/Item/<id>. Een veld met een lijst (<ul><li>)
 * wordt een array, zodat meerdere raadsleden niet aan elkaar plakken.
 * Geeft { velden: { "datum vraag": "...", "raadsleden": [...] }, bijlagen }.
 */
function parseerVraagDetail(html, basisUrl) {
  const $ = cheerio.load(html);
  const velden = {};
  $("dl dt").each((_, dt) => {
    const label = schoon($(dt).text()).toLowerCase();
    if (!label) return;
    const dd = $(dt).next("dd");
    const items = dd
      .find("li")
      .map((__, li) => schoon($(li).text()))
      .get()
      .filter(Boolean);
    const waarde = items.length ? items : schoon(dd.text());
    if (Array.isArray(waarde) ? waarde.length : waarde) velden[label] = waarde;
  });
  const { bijlagen } = parseerDetail(html, basisUrl);
  return { velden, bijlagen: ontdubbelBijlagen(bijlagen) };
}

function documentIdVan(url) {
  return (String(url).match(/documentId=([0-9a-f-]{36})/i) || [])[1] || String(url);
}

function ontdubbelBijlagen(bijlagen) {
  const gezien = new Set();
  return bijlagen.filter((b) => {
    const sleutel = documentIdVan(b.url);
    if (gezien.has(sleutel)) return false;
    gezien.add(sleutel);
    return true;
  });
}

/** vraag | antwoord | uitstel, op de naam van de bijlage. */
function soortBijlage(naam) {
  const n = String(naam).toLowerCase();
  if (/uitstel/.test(n)) return "uitstel";
  if (/antwoord|beantwoording|reactie college/.test(n)) return "antwoord";
  return "vraag";
}

/** Probeert de pdf met sessie-cookie (zoals scrapers/ibabs.js), daarna de adressen en het viewer-script van de dashboard-scraper. */
async function leesBijlage(bijlage, cookie, bronId, referer) {
  if (!pdfParse) return null;
  try {
    const { response, buffer } = await haalOp(
      bijlage.url,
      {
        headers: {
          "User-Agent": GEBRUIKERSAGENT,
          Accept: "application/pdf,*/*",
          Referer: referer,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        negeerStatus: true,
      },
      "buffer"
    );
    if (response.ok && buffer.subarray(0, 4).toString("latin1") === "%PDF") {
      const resultaat = await pdfParse(buffer);
      const tekst = schoon(resultaat && resultaat.text);
      if (tekst) return tekst;
    }
  } catch (fout) {
    console.warn(`[${bronId}] Bijlage "${bijlage.naam}" met cookie lezen mislukt: ${fout.message}${oorzaakTekst(fout)}`);
  }
  try {
    return await leesPdfTekst(bijlage, bronId);
  } catch (fout) {
    console.warn(`[${bronId}] Bijlage "${bijlage.naam}" lezen mislukt: ${fout.message}${oorzaakTekst(fout)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tekst en kop
// ---------------------------------------------------------------------------

function bouwKop(onderwerp, status) {
  return (status === "beantwoord" ? PREFIX_BEANTWOORD : PREFIX_GESTELD) + schoon(onderwerp);
}

function veld(velden, ...namen) {
  for (const n of namen) if (velden[n] !== undefined) return velden[n];
  return null;
}

function tekstVan(waarde) {
  return Array.isArray(waarde) ? waarde.join(", ") : waarde || "";
}

/**
 * Het object dat op het berichtrecord komt (record.vraag). prioriteit/regels.js
 * en de latere versie van het bericht lezen hieruit; wijzig de veldnamen dus niet.
 */
function bouwVraagObject(vraag, velden, status) {
  return {
    status,
    nummer: tekstVan(veld(velden, "id")) || null,
    onderwerp: vraag.onderwerp,
    datumVraag: isoDag(vraag.datumVraag),
    datumAntwoord: isoDag(vraag.datumAntwoord),
    verwachteAfdoening: (() => {
      const v = tekstVan(veld(velden, "verwachte datum afdoening"));
      return isoDag(parseerNlDatum(v));
    })(),
    raadsleden: lijstVan(veld(velden, "raadsleden")),
    steunfractieleden: lijstVan(veld(velden, "steunfractielid", "steunfractieleden")),
    partijen: lijstVan(veld(velden, "partij", "partijen")),
    portefeuillehouders: lijstVan(veld(velden, "portefeuillehouder", "portefeuillehouders")),
  };
}

function bouwSamenvatting(vraag, vraagObject, teksten, velden) {
  const delen = [];
  const wie = [tekstVan(vraagObject.raadsleden), tekstVan(vraagObject.partijen) && `(${tekstVan(vraagObject.partijen)})`]
    .filter(Boolean)
    .join(" ");
  if (vraagObject.status === "beantwoord") {
    delen.push(
      `Het college heeft geantwoord op schriftelijke vragen${wie ? ` van ${wie}` : ""}` +
        `${vraagObject.datumAntwoord ? `, antwoord van ${mooieDatum(vraagObject.datumAntwoord)}` : ""}.`
    );
  } else {
    delen.push(`Schriftelijke vragen${wie ? ` van ${wie}` : ""} aan het college.`);
  }
  delen.push(`Onderwerp: ${vraag.onderwerp}.`);
  if (vraagObject.nummer) delen.push(`Nummer: ${vraagObject.nummer}.`);
  if (vraagObject.datumVraag) delen.push(`Datum vraag: ${mooieDatum(vraagObject.datumVraag)}.`);
  if (vraagObject.portefeuillehouders.length) delen.push(`Portefeuillehouder: ${tekstVan(vraagObject.portefeuillehouders)}.`);
  if (vraagObject.status !== "beantwoord" && vraagObject.verwachteAfdoening) {
    delen.push(`Verwachte datum afdoening: ${mooieDatum(vraagObject.verwachteAfdoening)}.`);
  }
  const toelichting = tekstVan(veld(velden, "toelichting"));
  if (toelichting) delen.push(`Toelichting: ${toelichting}`);

  let tekst = delen.join(" ");
  // Bij een antwoord eerst het antwoord, daarna de vragen; bij een vraag de vragen, daarna een eventuele uitstelbrief.
  const volgorde = vraagObject.status === "beantwoord" ? ["antwoord", "vraag", "uitstel"] : ["vraag", "uitstel", "antwoord"];
  for (const soort of volgorde) {
    for (const { naam, tekst: inhoud } of teksten.filter((t) => t.soort === soort)) {
      const ruimte = MAX_TEKST_LENGTE - tekst.length - 120;
      if (ruimte <= 0) break;
      tekst += `\n\nBijlage "${naam}": ${inhoud.slice(0, ruimte)}`;
    }
  }
  return tekst.slice(0, MAX_TEKST_LENGTE);
}

// ---------------------------------------------------------------------------
// Hoofdfunctie
// ---------------------------------------------------------------------------

async function scrapeSchriftelijkeVragen(bron) {
  const start = Date.now();
  const nu = new Date();
  const vandaag = vandaagAmsterdam();
  const basisUrl = basisUrlVan(bron);

  let cookie = "";
  try {
    const { response } = await haalOp(bron.url, { headers: { "User-Agent": GEBRUIKERSAGENT } });
    cookie = verzamelCookies(response);
  } catch (fout) {
    console.warn(`[${bron.id}] Sessie ophalen mislukt (${fout.message}${oorzaakTekst(fout)}), doorgaan zonder cookie.`);
  }

  let ruweRijen;
  try {
    ruweRijen = await haalLijst(bron, cookie, basisUrl);
  } catch (fout) {
    console.error(`[${bron.id}] Lijst ophalen mislukt: ${fout.message}${oorzaakTekst(fout)}`);
    return [];
  }

  for (const rij of ruweRijen.slice(0, MAX_RUWE_LOGS)) {
    console.log(`[${bron.id}] RUW ${JSON.stringify(rij).slice(0, 400)}`);
  }

  const vragen = ruweRijen.map((rij) => parseRij(rij, basisUrl)).filter((v) => v.id && v.onderwerp);
  const stats = { lijst: vragen.length, bekend: 0, buitenVenster: 0, nieuw: 0, antwoord: 0, mislukt: 0 };

  const zonderDatum = vragen.filter((v) => !v.datumVraag).length;
  if (zonderDatum) console.warn(`[${bron.id}] ${zonderDatum} vraag/vragen zonder leesbare vraagdatum (kolom "registrationdate").`);

  const bekend = bekendeVragen(path.join(DATA_MAP, "berichten.json"));
  const teDoen = [];
  for (const vraag of vragen) {
    const besluit = beslis(vraag, bekend.get(vraag.url), vandaag);
    if (besluit.actie !== "publiceer") {
      if (besluit.reden === "bekend") stats.bekend++;
      else stats.buitenVenster++;
      continue;
    }
    teDoen.push({ vraag, status: besluit.status, reden: besluit.reden });
  }
  // Antwoorden eerst: die zijn het meest tijdgevoelig.
  teDoen.sort((a, b) => (a.status === b.status ? 0 : a.status === "beantwoord" ? -1 : 1));

  const resultaat = [];
  let volgende = 0;

  async function verwerk({ vraag, status }) {
    let velden = {};
    let teksten = [];
    try {
      const { tekst: html } = await haalOp(vraag.url, {
        headers: { "User-Agent": GEBRUIKERSAGENT, Accept: "text/html", ...(cookie ? { Cookie: cookie } : {}) },
      });
      const detail = parseerVraagDetail(html, vraag.url);
      velden = detail.velden;

      // De vraag zelf kan op de pagina als beantwoord staan terwijl de lijst dat nog niet liet zien (of andersom).
      const antwoordOpPagina = tekstVan(veld(velden, "datum antwoord"));
      if (status === "gesteld" && antwoordOpPagina) {
        const d = dagenGeleden(parseerNlDatum(antwoordOpPagina), vandaag);
        if (d !== null && d >= 0) {
          status = "beantwoord";
          vraag = { ...vraag, datumAntwoord: parseerNlDatum(antwoordOpPagina) };
        }
      }

      // Bijlagen lezen: de antwoorden eerst, dan de vraag, dan een uitstelbrief; hooguit 3 pdf's.
      const rang = { antwoord: 0, vraag: 1, uitstel: 2 };
      const gesorteerd = [...detail.bijlagen]
        .map((b) => ({ ...b, soort: soortBijlage(b.naam) }))
        .sort((a, b) => rang[a.soort] - rang[b.soort]);
      for (const bijlage of gesorteerd.slice(0, 3)) {
        const inhoud = await leesBijlage(bijlage, cookie, bron.id, vraag.url);
        if (inhoud) teksten.push({ naam: bijlage.naam, soort: bijlage.soort, tekst: inhoud });
      }
    } catch (fout) {
      console.warn(`[${bron.id}] Detailpagina van "${vraag.onderwerp}" ophalen mislukt: ${fout.message}${oorzaakTekst(fout)}`);
      stats.mislukt++;
      // Zonder detail wel publiceren: de kop en de lijstgegevens zijn al nieuws. Bij een
      // antwoord is dat wat we willen; de volgende run vult de tekst niet meer aan
      // (de vraag is dan bekend), dus de tekst blijft kort.
    }

    const vraagObject = bouwVraagObject(vraag, velden, status);
    if (status === "beantwoord") stats.antwoord++;
    else stats.nieuw++;
    resultaat.push({
      bronId: bron.id,
      bronNaam: bron.naam,
      categorie: bron.categorie,
      titel: bouwKop(vraag.onderwerp, status),
      itemId: vraag.id,
      url: vraag.url,
      samenvatting: bouwSamenvatting(vraag, vraagObject, teksten, velden),
      // Het moment waarop ZANP de publicatie of het antwoord zag.
      gepubliceerdOp: nu.toISOString(),
      opgehaaldOp: nu.toISOString(),
      documentInhoudOpgehaald: teksten.length > 0,
      tekstBron: "artikel",
      vraag: vraagObject,
      vasteRubriek: "GEM",
      geenAi: true,
    });
  }

  async function werker() {
    while (volgende < teDoen.length) {
      if (Date.now() - start > START_BUDGET_MS) return;
      await verwerk(teDoen[volgende++]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, teDoen.length) }, werker));

  const overgeslagenDoorBudget = teDoen.length - volgende;
  console.log(
    `[${bron.id}] ${stats.lijst} vraag/vragen in de lijst: ${stats.nieuw} nieuw, ${stats.antwoord} beantwoord, ` +
      `${stats.bekend} al bekend, ${stats.buitenVenster} buiten het venster, ${stats.mislukt} zonder detailpagina` +
      `${overgeslagenDoorBudget > 0 ? `, ${overgeslagenDoorBudget} voor de volgende run (tijdbudget)` : ""}.`
  );
  return resultaat;
}

module.exports = {
  scrapeSchriftelijkeVragen,
  parseRij,
  isAfgedaan,
  isBeantwoord,
  beslis,
  parseerVraagDetail,
  soortBijlage,
  bouwKop,
  bouwVraagObject,
  bouwSamenvatting,
  bekendeVragen,
  PREFIX_GESTELD,
  PREFIX_BEANTWOORD,
};
