// ai/agenda-ai.js
//
// ZANP: de AI-kant van de agenda-signalering (functies/agenda-signalering.js).
//
// De AI krijgt alleen berichten waarvoor de poort (verwerking/agenda-poort.js) een toekomstige
// datum zag, en leest de VOLLEDIGE tekst: niets wordt afgekapt. Eén verzoek bevat hooguit
// MAX_BERICHTEN_PER_VERZOEK berichten en hooguit MAX_TEKENS_PER_VERZOEK tekens; een bericht dat
// daar alleen al overheen gaat, krijgt een eigen verzoek.
//
// De AI geeft per bericht een lijst agendapunten terug in dezelfde vorm als vroeger
// (titel, datumTekst, tijd, eindtijd, plaats). De controle tegen de bron (datum staat in de
// tekst, weekdag klopt, tijd en plaats staan in de tekst, datum niet vóór de rundag) gebeurt
// daarna in functies/agenda-signalering.js met verifieerAgendapunten uit wire.js.
//
// MODELLEN. Het verzoek gaat naar de lichte keten van gemini.js (Flash-Lite, met twee
// reserves); roepGeminiWire pakt zelf het volgende model als er een vol of kapot is, en
// probeert een tijdelijke Google-fout na 3 en 9 seconden opnieuw. Lukt dat niet, dan wacht
// dit bestand WACHT_MS en probeert de hele keten nog één keer. Pas daarna blijft een bericht
// "in afwachting" staan voor de volgende run. Een quotummelding (429) wacht niet: die komt
// terug bij de volgende quotumdag, zie zanp.js.

"use strict";

const { roepGeminiWire } = require("./gemini");

const PROMPT_VERSIE_AGENDA = "2026-11-27-agenda-los-volledige-tekst";
const MAX_BERICHTEN_PER_VERZOEK = 5;
const MAX_TEKENS_PER_VERZOEK = 150_000;
const MAX_UITVOER_TOKENS = 8192;
const MAX_PUNTEN_PER_BERICHT = 8;
const RONDES = 2; // de keten, wachten, de keten nog een keer
const WACHT_STANDAARD_MS = 30_000;

const WEEKDAGEN_NL = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];

const wacht = (ms) => (ms > 0 ? new Promise((klaar) => setTimeout(klaar, ms)) : Promise.resolve());

function weekdagNaam(dag) {
  return WEEKDAGEN_NL[new Date(`${dag}T12:00:00Z`).getUTCDay()];
}

function wachtTijd(opties) {
  if (typeof opties.wachtMs === "number" && opties.wachtMs >= 0) return opties.wachtMs;
  if (process.env.ZANP_AI_PAUZE_MS === "0") return 0; // tests: nergens op wachten
  return WACHT_STANDAARD_MS;
}

function bronBlok(item, nr) {
  const hints = Array.isArray(item.signalen) && item.signalen.length ? item.signalen.join("; ") : "";
  return `BRON ${nr}:
Titel: ${item.titel || ""}
Bron: ${item.bronNaam || ""}
Gepubliceerd op: ${item.publicatieDag || item.gepubliceerdOp || ""}${hints ? `\nDatumaanwijzingen die de code zag (kunnen ook verleden tijd zijn): ${hints}` : ""}
Tekst:
${(item.tekst || "").trim() || "(geen tekst beschikbaar)"}`;
}

/**
 * De prompt voor een groep berichten. Het voorbeeld is bewust verzonnen, zodat het model het
 * niet overneemt.
 */
function bouwAgendaPrompt(items, { rundag }) {
  const n = items.length;
  return `Je haalt agendapunten uit nieuwsberichten voor een regionale nieuwsdienst voor Zaanstreek-Waterland. Vandaag is ${weekdagNaam(rundag)} ${rundag}. Hieronder staan ${n} bron(nen). Lees van elke bron de HELE tekst en geef alle agendapunten die erin staan. Behandel elke bron los van de andere.

AGENDAPUNT: een bijeenkomst, zitting, hoorzitting, inloopavond, opening, markt, voorstelling, wedstrijd, optreden, herdenking of ander evenement dat op een bepaalde dag plaatsvindt of begint, en waar inwoners heen kunnen of waarover een journalist kan berichten.

REGELS:
- Alleen een agendapunt met een concrete dag die in de tekst staat, op of na vandaag (${rundag}). Geen gebeurtenissen uit het verleden, ook niet als de bron er verleden tijd bij gebruikt. Geen deadlines of inspraaktermijnen (die haalt de code zelf eruit).
- Gebruik alleen wat in de bron staat. Verzin geen datums, tijden of plaatsen. Staat er geen dag bij, laat het punt dan weg. Een evenement dat alleen "in december" of "binnenkort" plaatsvindt, is geen agendapunt.
- Is een evenement al begonnen en loopt het door (een tentoonstelling, een markt van meerdere dagen), geef dan de eerste dag die nog niet voorbij is en in de tekst staat.
- Hooguit ${MAX_PUNTEN_PER_BERICHT} agendapunten per bron. Staat er niets in, geef dan een lege lijst.

Per agendapunt:
  "titel": maximaal 12 woorden, feitelijk
  "datumTekst": de dag EXACT zoals in de bron geschreven, bijvoorbeeld "dinsdag 3 november", "12 december 2026" of "morgen". Neem het stukje letterlijk over; reken niets om.
  "tijd": de begintijd exact zoals in de bron ("19.30 uur"), of null
  "eindtijd": de eindtijd exact zoals in de bron, of null
  "plaats": de plaats of locatie exact zoals in de bron, of null

Geef ALLEEN geldige JSON terug, geen markdown-fences en geen andere tekst. Precies één object per bron, met het nummer van die bron, in dezelfde volgorde:
{
  "resultaten": [
    { "nr": 1, "agendapunten": [
      { "titel": "Inloopavond over het nieuwe fietspad", "datumTekst": "dinsdag 3 maart", "tijd": "19.30 uur", "eindtijd": null, "plaats": "Wijkcentrum De Brug" }
    ] },
    { "nr": 2, "agendapunten": [] }
  ]
}

${items.map((item, i) => bronBlok(item, i + 1)).join("\n\n")}`;
}

/**
 * Verdeelt de berichten over verzoeken, in de volgorde van de lijst. Een verzoek bevat
 * hooguit maxBerichten berichten en hooguit maxTekens tekens; een bericht dat daar alleen al
 * overheen gaat, staat alleen in een verzoek. Er wordt nooit tekst afgekapt.
 */
function maakAgendaBatches(items, { maxBerichten = MAX_BERICHTEN_PER_VERZOEK, maxTekens = MAX_TEKENS_PER_VERZOEK } = {}) {
  const batches = [];
  let huidig = [];
  let tekens = 0;
  for (const item of items) {
    const lengte = (item.tekst || "").length;
    if (huidig.length && (huidig.length >= maxBerichten || tekens + lengte > maxTekens)) {
      batches.push(huidig);
      huidig = [];
      tekens = 0;
    }
    huidig.push(item);
    tekens += lengte;
  }
  if (huidig.length) batches.push(huidig);
  return batches;
}

// Eén verzoek met wachten en terugval: de keten van gemini.js, wachten, de keten nog een keer.
async function vraagMetHerhaling(prompt, apiKey, opties) {
  let verzoeken = 0;
  let laatsteFout;
  for (let ronde = 0; ronde < RONDES; ronde++) {
    try {
      const uit = await roepGeminiWire(prompt, apiKey, MAX_UITVOER_TOKENS, { klasse: "licht" });
      return { ...uit, verzoeken: verzoeken + (uit.verzoeken || 0) };
    } catch (fout) {
      laatsteFout = fout;
      verzoeken += fout.verzoeken || 0;
      if (fout.status === 429) break; // quotum: wachten helpt niet, zanp.js zet de wachttijd
      if (ronde < RONDES - 1) {
        const ms = wachtTijd(opties);
        console.warn(`  Agenda-AI: ${fout.message}; over ${Math.round(ms / 1000)} s nog een keer de hele modelketen.`);
        await wacht(ms);
      }
    }
  }
  laatsteFout.verzoeken = verzoeken;
  throw laatsteFout;
}

function lijstUitAntwoord(data, aantal) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.resultaten)) return data.resultaten;
  if (data && aantal === 1 && Array.isArray(data.agendapunten)) return [{ ...data, nr: 1 }]; // één los object
  return [];
}

/**
 * Laat de AI de agendapunten uit de berichten halen.
 *
 * @param {object[]} items   { id, titel, tekst, bronNaam, publicatieDag, signalen }
 * @param {string}   apiKey
 * @param {number}   cap     hoogstens zoveel VERZOEKEN
 * @param {object}   opties  { rundag, wachtMs }
 * @returns {Map} item.id naar { agendapunten: [...] } | { fout, status }. Op de Map staat ook
 *   "verzoeken" (de beantwoorde verzoeken, die tellen voor het dagquotum) en "quotum" (true als
 *   een verzoek op een 429 stuitte). Berichten waar geen verzoek meer voor was, krijgen
 *   { fout: "overgeslagen …" } en blijven voor de volgende run staan.
 */
async function signaleerAgendapunten(items, apiKey, cap, opties = {}) {
  const uit = new Map();
  uit.verzoeken = 0;
  uit.quotum = false;
  uit.quotumTekst = "";
  if (!Array.isArray(items) || items.length === 0) return uit;

  const batches = maakAgendaBatches(items);
  let gestopt = false;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    if (gestopt || i >= Math.max(0, cap)) break;
    let antwoord;
    try {
      antwoord = await vraagMetHerhaling(bouwAgendaPrompt(batch, { rundag: opties.rundag }), apiKey, opties);
    } catch (fout) {
      uit.verzoeken += fout.verzoeken || 0;
      for (const item of batch) uit.set(item.id, { fout: fout.message, status: fout.status });
      if (fout.status === 429) {
        uit.quotum = true;
        uit.quotumTekst = fout.message;
      }
      gestopt = true; // geen nieuwe verzoeken meer in deze run: de rest blijft in afwachting
      continue;
    }
    uit.verzoeken += antwoord.verzoeken || 0;

    const perNr = new Map();
    for (const r of lijstUitAntwoord(antwoord.data, batch.length)) {
      const nr = Number(r && r.nr);
      if (Number.isInteger(nr) && !perNr.has(nr)) perNr.set(nr, r);
    }
    batch.forEach((item, j) => {
      const r = perNr.get(j + 1);
      if (!r) uit.set(item.id, { fout: "ontbreekt in het antwoord" });
      else if (!Array.isArray(r.agendapunten)) uit.set(item.id, { fout: "onvolledig antwoord (agendapunten ontbreekt)" });
      else uit.set(item.id, { agendapunten: r.agendapunten, model: antwoord.model || null });
    });
  }

  for (const item of items) {
    if (!uit.has(item.id)) {
      uit.set(item.id, { fout: gestopt ? "overgeslagen (eerder verzoek mislukt)" : `overgeslagen (cap ${cap} verzoeken)` });
    }
  }
  return uit;
}

module.exports = {
  signaleerAgendapunten,
  bouwAgendaPrompt,
  maakAgendaBatches,
  PROMPT_VERSIE_AGENDA,
  MAX_BERICHTEN_PER_VERZOEK,
  MAX_TEKENS_PER_VERZOEK,
  MAX_PUNTEN_PER_BERICHT,
};
