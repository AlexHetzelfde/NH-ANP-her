// functies/agenda-signalering.js
//
// ZANP (2026-11-27): agendapunten uit het nieuws, als aparte stap NA de koppen.
//
// Werking
//   1. De berichten staan in de nieuwsdienst: kop, tag en checklist zijn klaar (ZANP 5).
//   2. De POORT (verwerking/agenda-poort.js) leest van elk nieuw bericht de kop en de
//      volledige tekst, zonder tekenlimiet. Staat er een datum in die op of na de dag van de
//      run valt, dan gaat het bericht naar de AI; anders niet.
//   3. De AI (ai/agenda-ai.js) leest de volledige tekst en geeft de agendapunten.
//   4. De CODE controleert elk punt tegen de bron (verifieerAgendapunten in wire.js: de datum
//      staat in de tekst, de weekdag klopt, tijd en plaats staan in de tekst) en laat elk punt
//      vallen waarvan de dag vóór de rundag ligt. De uitkomst komt op het bericht
//      (agendapunten, agendapuntenBron "ai"); bouwAgenda zet ze daarna in de agenda.
//
// Bronnen zonder artikel (moties, vragen, aanbestedingen, camera, stroomstoringen) doen niet
// mee; De Orkaan (alleenAgenda) wel, want zijn berichten leveren juist agendapunten op.
//
// VOORTGANG. Alles staat per bericht in data/<gemeente>/zanp-agenda-voortgang.json:
//   geen-signaal    de poort zag geen toekomstige datum: klaar
//   in-afwachting   de poort zag een datum, de AI is er nog niet doorheen
//   klaar           de AI heeft het bericht gelezen (punten = aantal agendapunten)
//   mislukt         MAX_POGINGEN keer een fout van de AI: opgegeven
//   geen-tekst      de volledige tekst stond niet meer in het tekstarchief: opgegeven
// Bij elke run gaat de stap EERST de berichten "in afwachting" af (oudste eerst), dan pas de
// nieuwe. Is de AI niet beschikbaar (geen sleutel, quotum, overbelast), dan blijft alles staan
// en gaat het door zodra de AI weer werkt. Voor het hervatten bewaart de stap de volledige
// tekst van elk bericht met een signaal in het tekstarchief (zanp-teksten, 14 dagen).
//
// Een bericht met een nieuwe versie (andere kop of merkbaar andere tekst) is een nieuw id en
// gaat dus opnieuw door de poort. Het agendapunt blijft bij de nieuwste versie hangen; staat
// die nog in afwachting, dan ontbreekt het punt in de agenda tot de AI het heeft gelezen.

"use strict";

const { zoekDatumSignalen } = require("../verwerking/agenda-poort");
const { dagPlus } = require("../verwerking/agenda-regels");
const { kalenderdagAmsterdam } = require("../basis/hulpmiddelen");
const wire = require("../ai/wire");

const BEWAAR_DAGEN = 14; // gelijk aan het tekstarchief en de bewaartijd van de berichten
const MAX_POGINGEN = 6;
const KOP_MAX = 100;

function leegVoortgang() {
  return { versie: 1, bijgewerkt: null, items: {} };
}

/** Leest een voortgangsbestand dat kapot of leeg kan zijn. */
function leesVoortgang(ruw) {
  const uit = leegVoortgang();
  if (ruw && typeof ruw === "object" && ruw.items && typeof ruw.items === "object") {
    for (const [id, e] of Object.entries(ruw.items)) {
      if (e && typeof e === "object" && typeof e.status === "string") uit.items[id] = { ...e };
    }
    uit.bijgewerkt = ruw.bijgewerkt || null;
  }
  return uit;
}

// Een afgerond bericht hoeft alleen nog te weten dat het klaar is; zo blijft het bestand klein.
function inkorten(entry) {
  if (entry.status === "geen-signaal" || entry.status === "klaar") {
    const kort = { status: entry.status, publicatieDag: entry.publicatieDag, laatsteOp: entry.laatsteOp };
    if (entry.status === "klaar") kort.punten = entry.punten || 0;
    return kort;
  }
  return entry;
}

/**
 * Draait de agenda-stap voor deze run.
 *
 * @param {object}   o
 * @param {object[]} o.nieuwe      uitkomst van wire.planBerichten: { record, invoer, agenda }
 * @param {object[]} o.records     alle berichten (zoals na voegBerichtenSamen)
 * @param {object}   o.voortgang   het gelezen voortgangsbestand (leesVoortgang)
 * @param {Date}     o.nu
 * @param {string}   [o.aiReden]   gevuld als de AI nu niet mag (bijvoorbeeld "geen-sleutel", "quotum", "dagcap")
 * @param {number}   [o.cap]       hoogstens zoveel AI-verzoeken
 * @param {number}   [o.wachtMs]   wachttijd tussen twee rondes bij een AI-fout
 * @param {Function} o.signaleer   async (items, { cap, rundag, wachtMs }) => Map (zie ai/agenda-ai.js)
 * @param {Function} [o.haalArchiefTekst]  async (entry) => string | null: de volledige tekst uit het archief
 * @param {Function} [o.bewaarTeksten]     async (regels) => void: zet teksten in het archief
 * @param {Console}  [o.log]
 * @returns {Promise<{records: object[], voortgang: object, stats: object, verzoeken: number, quotum: boolean, quotumTekst: string}>}
 */
async function draaiAgendaSignalering(o) {
  const {
    nieuwe = [],
    voortgang = leegVoortgang(),
    nu = new Date(),
    aiReden = null,
    cap = 0,
    wachtMs,
    signaleer,
    haalArchiefTekst = async () => null,
    bewaarTeksten = async () => {},
    log = console,
  } = o;
  let { records = [] } = o;

  const rundag = kalenderdagAmsterdam(nu.toISOString());
  const nuIso = nu.toISOString();
  const staat = { versie: 1, bijgewerkt: nuIso, items: {} };
  for (const [id, e] of Object.entries(voortgang.items || {})) staat.items[id] = { ...e };

  const stats = {
    nieuw: 0,
    metSignaal: 0,
    zonderSignaal: 0,
    wachtendVooraf: 0,
    aanAI: 0,
    klaar: 0,
    punten: 0,
    verledenGefilterd: 0,
    teruggezet: 0,
    fouten: 0,
    mislukt: 0,
    geenTekst: 0,
    verlopen: 0,
    aiReden: aiReden || null,
  };

  // 0. Wat ouder is dan de bewaartijd verdwijnt uit het bestand.
  const grens = dagPlus(rundag, -BEWAAR_DAGEN);
  for (const [id, e] of Object.entries(staat.items)) {
    if (e.publicatieDag && e.publicatieDag < grens) {
      delete staat.items[id];
      stats.verlopen++;
    }
  }
  const eerderBekend = new Set(Object.keys(staat.items));

  // 1. De poort over alle nieuwe berichten.
  const dezeRun = new Map(); // id -> { titel, tekst, ... } met de volledige tekst van deze run
  const teBewaren = [];
  for (const n of nieuwe) {
    const rec = n.record;
    if (!n.agenda || !rec || rec.seed || staat.items[rec.id]) continue;
    const a = n.agenda;
    stats.nieuw++;
    const poort = zoekDatumSignalen(a.titel, a.tekst, { publicatieDag: a.publicatieDag, rundag });
    const basis = {
      url: rec.url,
      groepId: rec.groepId,
      versie: rec.versie,
      bronId: rec.bronId,
      kop: String(rec.kop || "").slice(0, KOP_MAX),
      publicatieDag: a.publicatieDag,
      eerstOp: nuIso,
      laatsteOp: nuIso,
      pogingen: 0,
    };
    if (!poort.signaal) {
      staat.items[rec.id] = { ...basis, status: "geen-signaal" };
      stats.zonderSignaal++;
      continue;
    }
    staat.items[rec.id] = { ...basis, status: "in-afwachting", signaal: poort.redenen.map((r) => r.tekst).slice(0, 5) };
    stats.metSignaal++;
    dezeRun.set(rec.id, a);
    teBewaren.push({
      k: `n:${rec.url}`,
      url: rec.url,
      bron: rec.bronNaam || null,
      versie: rec.versie || 1,
      methode: "agenda",
      kop: a.titel,
      datum: a.gepubliceerdOp || a.publicatieDag,
      tekst: a.tekst,
    });
  }
  if (teBewaren.length) {
    try {
      await bewaarTeksten(teBewaren);
    } catch (fout) {
      log.warn(`Agenda-stap: de teksten in het archief zetten mislukte (een hervatting kan dan geen tekst vinden): ${fout.message}`);
    }
  }

  // 2. De wachtrij: eerst wat van eerdere runs nog openstaat (oudste eerst), dan de nieuwe.
  const perId = new Map(records.map((r) => [r.id, r]));
  const open = Object.entries(staat.items)
    .filter(([, e]) => e.status === "in-afwachting")
    .sort(([ia, a], [ib, b]) => (a.eerstOp < b.eerstOp ? -1 : a.eerstOp > b.eerstOp ? 1 : ia < ib ? -1 : 1));
  stats.wachtendVooraf = open.filter(([id]) => eerderBekend.has(id)).length;

  const aanAI = [];
  for (const [id, entry] of open) {
    const rec = perId.get(id);
    if (!rec) {
      entry.status = "geen-signaal";
      entry.fout = "bericht staat niet meer in de stroom";
      stats.verlopen++;
      continue;
    }
    const uitRun = dezeRun.get(id);
    const tekst = uitRun ? uitRun.tekst : await haalArchiefTekst(entry);
    if (!tekst) {
      entry.status = "geen-tekst";
      entry.fout = "volledige tekst niet meer beschikbaar";
      entry.laatsteOp = nuIso;
      stats.geenTekst++;
      continue;
    }
    const titel = uitRun ? uitRun.titel : rec.bronTitel || rec.kop;
    // Een bericht dat al langer wacht: zijn de datums intussen verstreken, dan hoeft de AI er niet meer naar.
    const poort = zoekDatumSignalen(titel, tekst, { publicatieDag: entry.publicatieDag, rundag });
    if (!poort.signaal) {
      entry.status = "geen-signaal";
      entry.fout = "alle datums zijn verstreken";
      entry.laatsteOp = nuIso;
      stats.zonderSignaal++;
      continue;
    }
    entry.signaal = poort.redenen.map((r) => r.tekst).slice(0, 5);
    aanAI.push({
      id,
      titel,
      tekst,
      bronNaam: rec.bronNaam || "",
      publicatieDag: entry.publicatieDag,
      signalen: entry.signaal,
    });
  }
  stats.aanAI = aanAI.length;

  // 3. De AI, 4. de controle, en de uitkomst op het bericht.
  let verzoeken = 0;
  let quotum = false;
  let quotumTekst = "";
  const bijgewerkt = new Map();
  if (aanAI.length && aiReden) {
    log.log(`Agenda-stap: AI nu niet beschikbaar (${aiReden}); ${aanAI.length} bericht(en) blijven in afwachting.`);
  } else if (aanAI.length) {
    const uit = await signaleer(aanAI, { cap, rundag, wachtMs });
    verzoeken = uit.verzoeken || 0;
    quotum = Boolean(uit.quotum);
    quotumTekst = uit.quotumTekst || "";
    for (const item of aanAI) {
      const entry = staat.items[item.id];
      const r = uit.get(item.id);
      entry.laatsteOp = nuIso;
      if (!r || r.fout) {
        const tekst = String((r && r.fout) || "geen antwoord");
        // Een bericht waar geen verzoek meer voor was, heeft nog geen poging gehad.
        if (!/^overgeslagen/.test(tekst)) {
          entry.pogingen = (entry.pogingen || 0) + 1;
          stats.fouten++;
        }
        entry.fout = tekst.slice(0, 160);
        if (entry.pogingen >= MAX_POGINGEN) {
          entry.status = "mislukt";
          stats.mislukt++;
        }
        continue;
      }
      const bron = `${item.titel} ${item.tekst}`;
      const gecontroleerd = wire.verifieerAgendapunten(r.agendapunten, bron, item.publicatieDag);
      const vanaf = gecontroleerd.filter((p) => p.dag >= rundag).slice(0, wire.MAX_AGENDAPUNTEN_PER_BERICHT);
      stats.verledenGefilterd += gecontroleerd.length - vanaf.length;

      const rec = perId.get(item.id);
      const nieuw = { ...rec };
      if (vanaf.length) {
        nieuw.agendapunten = vanaf;
        nieuw.agendapuntenBron = "ai";
      } else {
        delete nieuw.agendapunten;
        delete nieuw.agendapuntenBron;
      }
      bijgewerkt.set(item.id, nieuw);

      entry.status = "klaar";
      entry.punten = vanaf.length;
      delete entry.fout;
      stats.klaar++;
      stats.punten += vanaf.length;
    }
  }
  if (bijgewerkt.size) records = records.map((r) => bijgewerkt.get(r.id) || r);

  for (const [id, e] of Object.entries(staat.items)) staat.items[id] = inkorten(e);

  const rest = Object.values(staat.items).filter((e) => e.status === "in-afwachting").length;
  stats.nogOpen = rest;
  log.log(
    `Agenda-stap: ${stats.nieuw} nieuw (${stats.metSignaal} met datum-signaal, ${stats.zonderSignaal} zonder); ` +
      `${stats.wachtendVooraf} wachtten al; ${stats.aanAI} naar de AI, ${stats.klaar} klaar met ${stats.punten} agendapunt(en), ` +
      `${stats.verledenGefilterd} verleden weggelaten, ${stats.fouten} fout(en), ${rest} nog open.`
  );
  return { records, voortgang: staat, stats, verzoeken, quotum, quotumTekst };
}

module.exports = {
  draaiAgendaSignalering,
  leesVoortgang,
  leegVoortgang,
  BEWAAR_DAGEN,
  MAX_POGINGEN,
};
