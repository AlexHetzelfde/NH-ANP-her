// verwerking/agenda-poort.js
//
// ZANP: de poort voor de agenda-signalering (functies/agenda-signalering.js).
//
// WAT
// Code leest van elk nieuwsbericht de kop en de VOLLEDIGE tekst (geen tekenlimiet) en zegt:
// staat er een datum in die op of na de dag van de run valt? Zo ja, dan gaat het hele bericht
// naar de AI, die er de agendapunten uit haalt. Zo nee, dan gaat er geen verzoek naartoe.
//
// WAAROM BREED
// De poort beslist niet WAT een agendapunt is, alleen OF de AI ernaar moet kijken. Hij is dus
// ruim: elke datum, elke weekdag, "morgen", "komend weekend", "volgende week donderdag".
// Een poort die strenger is dan de AI laat precies de gevallen vallen waarvoor de AI er is.
// Te veel doorlaten kost een verzoek; te weinig doorlaten kost een evenement.
//
// WAT VALT AF (de afspraak van 2026-11-27)
//   - een datum vóór de dag van de run ("op 4 januari" bij een run op 5 januari)
//   - een weekdag na "vorige", "afgelopen", "gisteren" ("afgelopen zaterdag")
//   - een datum die niet klopt (weekdag past niet bij de datum) of te ver weg ligt
// Relatieve aanduidingen ("morgen", "donderdag") rekent de poort uit vanaf de PUBLICATIEDAG van
// het bericht; het resultaat wordt daarna aan de RUNDAG getoetst.
//
// De poort gebruikt dezelfde datumfunctie als de controle op de AI-uitvoer (datumUitTekst in
// agenda-regels.js), zodat wat de poort doorlaat ook door die controle kan komen.

"use strict";

const {
  datumUitTekst,
  dagPlus,
  dagNaarDate,
  MAAND_PATROON,
  WEEKDAG_PATROON,
  WEEKDAGEN,
} = require("./agenda-regels");

const MAX_REDENEN = 8;
// Hoeveel woorden vóór een weekdag we bekijken op "vorige", "afgelopen" en dergelijke.
const WOORDEN_TERUG = 3;
const VERLEDEN_WOORDEN = new Set([
  "vorige", "vorig", "afgelopen", "gisteren", "eergisteren", "verleden", "jongstleden", "eerder", "destijds",
]);
const VERLEDEN_NA = /^\s*(?:jongstleden|j\.l\.|jl\b)/i;

const ABSOLUUT = new RegExp(
  `(?:(${WEEKDAG_PATROON})\\s+)?\\b(\\d{1,2})\\s+(${MAAND_PATROON})\\b\\.?(?:\\s+(\\d{4}))?`,
  "gi"
);
const NUMERIEK = /(?<![\d.,/-])(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?![\d])/g;
const DAG_RELATIEF =
  /\b(vandaag|vanavond|vanmiddag|morgen|morgenochtend|morgenmiddag|morgenavond|overmorgen)\b/gi;
const WEEKEND = /(?<![\p{L}])(?:dit|komend|komende|aankomend|aankomende|aanstaand|aanstaande)\s+week(?:end|einde)(?![\p{L}])/giu;
const WEEK = new RegExp(
  `(?<![\\p{L}])(volgende|komende|aanstaande|aankomende)\\s+week(?:\\s+(?:op\\s+)?(${WEEKDAG_PATROON}))?(?![\\p{L}])`,
  "giu"
);
// Een weekdag die direct door een datum wordt gevolgd ("zaterdag 5 december") is al als datum
// beoordeeld; als losse weekdag zou een verlopen datum alsnog een signaal geven.
const DATUM_NA_WEEKDAG = new RegExp(`^\\s+(?:\\d{1,2}\\s+(?:${MAAND_PATROON})\\b|\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{4})`, "i");
const WEEKDAG = new RegExp(
  `(?<![\\p{L}\\d])(${WEEKDAG_PATROON})(?:avond|middag|ochtend|nacht)?(?![\\p{L}\\d])`,
  "giu"
);

const DAG_PLUS = {
  vandaag: 0, vanavond: 0, vanmiddag: 0,
  morgen: 1, morgenochtend: 1, morgenmiddag: 1, morgenavond: 1,
  overmorgen: 2,
};

function weekdagVan(dag) {
  return dagNaarDate(dag).getUTCDay(); // 0 = zondag
}

function maandagVan(dag) {
  return dagPlus(dag, -((weekdagVan(dag) + 6) % 7));
}

function opnieuw(regex) {
  regex.lastIndex = 0;
  return regex;
}

function woordenVoor(hooi, index) {
  return hooi
    .slice(Math.max(0, index - 60), index)
    .toLowerCase()
    .split(/[^\p{L}.]+/u)
    .filter(Boolean)
    .slice(-WOORDEN_TERUG);
}

function isVerleden(hooi, begin, eind) {
  if (woordenVoor(hooi, begin).some((w) => VERLEDEN_WOORDEN.has(w))) return true;
  return VERLEDEN_NA.test(hooi.slice(eind, eind + 16));
}

/**
 * Zoekt in kop en volledige tekst naar aanwijzingen voor een toekomstige datum.
 *
 * @param {string} kop
 * @param {string} tekst            de volledige tekst, niet afgekapt
 * @param {object} opties
 * @param {string} opties.publicatieDag  JJJJ-MM-DD (Amsterdam) waarop het bericht verscheen
 * @param {string} opties.rundag         JJJJ-MM-DD (Amsterdam) van de run: eerdere datums vallen af
 * @returns {{signaal: boolean, aantal: number, afgevallen: number, redenen: {soort: string, tekst: string, dag: string}[]}}
 *   "dag" is bij een globale aanduiding ("komende week", "dit weekend") de LAATSTE dag van de
 *   periode: één dag in die periode op of na de rundag is genoeg voor een signaal.
 */
function zoekDatumSignalen(kop, tekst, { publicatieDag, rundag }) {
  const hooi = `${kop || ""}\n${tekst || ""}`;
  const pubDag = publicatieDag || rundag;
  const gezien = new Set();
  const redenen = [];
  let afgevallen = 0;

  function neem(soort, gevonden, dag) {
    if (!dag || dag < rundag) {
      afgevallen++;
      return;
    }
    const sleutel = `${soort}|${gevonden.toLowerCase()}`;
    if (gezien.has(sleutel)) return;
    gezien.add(sleutel);
    redenen.push({ soort, tekst: gevonden.slice(0, 60), dag });
  }

  // 1. Een datum met een maandnaam: "dinsdag 3 november", "12 dec", "5 januari 2027".
  for (const m of hooi.matchAll(opnieuw(ABSOLUUT))) {
    const gevonden = m[0].trim();
    const uit = datumUitTekst(gevonden, pubDag);
    neem("datum", gevonden, uit && uit.dag);
  }

  // 2. Een numerieke datum met jaartal: "12-12-2026".
  for (const m of hooi.matchAll(opnieuw(NUMERIEK))) {
    const uit = datumUitTekst(m[0], pubDag);
    neem("datum-numeriek", m[0], uit && uit.dag);
  }

  // 3. Vandaag, morgen, vanavond, overmorgen.
  for (const m of hooi.matchAll(opnieuw(DAG_RELATIEF))) {
    neem("dag-relatief", m[0], dagPlus(pubDag, DAG_PLUS[m[1].toLowerCase()]));
  }

  // 4. Dit weekend, komend weekend: de zondag van dat weekend telt als einde.
  for (const m of hooi.matchAll(opnieuw(WEEKEND))) {
    if (isVerleden(hooi, m.index, m.index + m[0].length)) continue;
    const wd = weekdagVan(pubDag);
    const zondag = wd === 0 ? pubDag : dagPlus(pubDag, 7 - wd);
    neem("weekend", m[0], zondag);
  }

  // 5. Volgende week, komende week, volgende week donderdag.
  const weekdagInWeek = new Set(); // beginplaatsen van weekdagen die hier al zijn meegenomen
  for (const m of hooi.matchAll(opnieuw(WEEK))) {
    const volgende = m[1].toLowerCase() !== "komende" && m[1].toLowerCase() !== "aankomende";
    const ma = dagPlus(maandagVan(pubDag), 7);
    if (m[2]) {
      weekdagInWeek.add(m.index + m[0].length - m[2].length);
      const doel = (WEEKDAGEN[m[2].toLowerCase()] + 6) % 7;
      neem("week", m[0], dagPlus(ma, doel));
    } else {
      neem("week", m[0], volgende ? dagPlus(ma, 6) : dagPlus(pubDag, 7));
    }
  }

  // 6. Een losse weekdag ("zaterdag", "donderdagavond"): de eerste keer dat die dag
  //    aanbreekt vanaf de publicatiedag, tenzij er "afgelopen" of "vorige" voor staat.
  for (const m of hooi.matchAll(opnieuw(WEEKDAG))) {
    if (weekdagInWeek.has(m.index)) continue;
    if (DATUM_NA_WEEKDAG.test(hooi.slice(m.index + m[0].length, m.index + m[0].length + 24))) continue;
    if (isVerleden(hooi, m.index, m.index + m[0].length)) {
      afgevallen++;
      continue;
    }
    const doel = WEEKDAGEN[m[1].toLowerCase()];
    const plus = (doel - weekdagVan(pubDag) + 7) % 7;
    neem("weekdag", m[0], dagPlus(pubDag, plus));
  }

  return {
    signaal: redenen.length > 0,
    aantal: redenen.length,
    afgevallen,
    redenen: redenen.slice(0, MAX_REDENEN),
  };
}

module.exports = { zoekDatumSignalen, MAX_REDENEN };
