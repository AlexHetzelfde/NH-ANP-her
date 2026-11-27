// signalering/stroom-ernst.js — ernst en rood van stroomstoringen, en opgeloste storingen weghalen
//
// Twee regels voor bronnen met `stroomErnst` in het bronbestand (nu: stroomstoringkaart):
//
// 1. ERNST. Het aantal huishoudens zonder stroom wordt vergeleken met de grootste storing
//    tot nu toe (de "piek"). Een storing is rood vanaf `drempel` (standaard 80%) van die piek.
//    Een storing die de piek overtreft is zelf de nieuwe piek (100%) en dus rood. De piek
//    gaat alleen omhoog en wordt bewaard in zanp-stroom-piek.json. Hij begint bij 0: de
//    eerste storing is dus meteen de piek. Storingen onder de drempel blijven als gewoon
//    bericht staan, zonder rood. Is het aantal onbekend, dan blijft de storing rood.
//
//      stroomErnst: { drempel: 0.8, label: "stroomstoring", reden: "Stroomstoring in de regio" }
//
// 2. OPGELOST. Een storing die niet meer op de lijst van de actuele storingen staat, wordt
//    pas uit de stroom gehaald als de detailpagina zegt dat hij is opgelost (zo wist een
//    haperende lijstpagina niets). Is die pagina niet te lezen en is de storing ouder dan
//    72 uur, terwijl de bron deze run wel storingen gaf, dan gaat hij er ook uit.
//
// Het rood wordt elke run opnieuw bepaald. Rood van een andere regel (jubileum, prioriteit)
// blijft ongemoeid; alleen rood met ons eigen label (en route "stroom-ernst", of "regel" van
// de oude altijdRood-regel) wordt bijgesteld.

"use strict";

const { isOpgelost, leesHuishoudens } = require("../scrapers/stroomstoringen");

const STANDAARD_DREMPEL = 0.8;
const STANDAARD_LABEL = "stroomstoring";
const STANDAARD_REDEN = "Stroomstoring";
const ROUTE = "stroom-ernst";
const PIEK_BESTAND = "zanp-stroom-piek.json";
const MAX_CONTROLES = 25; // detailpagina's per run
const PARALLEL = 4;
const BUDGET_MS = 30_000;
const OUD_UREN = 72;
const UUR_MS = 3600 * 1000;

function leesInstelling(bron) {
  const s = bron && bron.stroomErnst;
  if (!s) return null;
  const o = typeof s === "object" ? s : {};
  const d = Number(o.drempel);
  return {
    drempel: Number.isFinite(d) && d > 0 && d <= 1 ? d : STANDAARD_DREMPEL,
    label: o.label || STANDAARD_LABEL,
    reden: o.reden || STANDAARD_REDEN,
  };
}

function leegPiek() {
  return { piek: 0, sinds: null, url: null, titel: null };
}

/** Is `aantal` minstens `drempel` van de piek? Met gehele getallen, zonder drijvende-komma-fouten. */
function haaltDrempel(aantal, piek, drempel) {
  return aantal * 1000 >= Math.round(drempel * 1000) * piek;
}

/**
 * De aantallen uit de scrape van deze run: Map url -> aantal (of null als onbekend), alleen
 * voor bronnen met stroomErnst.
 */
function aantallenUitScrape(ruwe, bronPerId) {
  const kaart = new Map();
  for (const b of ruwe || []) {
    if (!leesInstelling((bronPerId || {})[b.bronId])) continue;
    const aantal = Number.isFinite(b.huishoudensAantal) ? b.huishoudensAantal : leesHuishoudens(b.samenvatting);
    kaart.set(b.url, { aantal: aantal ?? null, titel: b.titel || null });
  }
  return kaart;
}

/** De piek bijwerken met de aantallen van deze run. Geeft { staat, gewijzigd }. */
function werkPiekBij(staat, aantallen, nu) {
  let nieuw = { ...leegPiek(), ...(staat || {}) };
  let gewijzigd = false;
  for (const [url, { aantal, titel }] of aantallen) {
    if (aantal != null && aantal > nieuw.piek) {
      nieuw = { piek: aantal, sinds: nu.toISOString(), url, titel };
      gewijzigd = true;
    }
  }
  return { staat: nieuw, gewijzigd };
}

function isEigenRood(rood, instelling) {
  return Boolean(rood) && rood.label === instelling.label && (rood.route === ROUTE || rood.route === "regel");
}

/**
 * Berekent per stroomstoring de ernst en zet rood aan of uit.
 * @param {{records: Array, bronPerId: object, aantallen: Map, piekStaat: object, nu?: Date}} invoer
 * @returns {{records: Array, piekStaat: object, piekGewijzigd: boolean, stats: object}}
 */
function pasStroomErnstToe({ records, bronPerId, aantallen = new Map(), piekStaat, nu = new Date() }) {
  const { staat, gewijzigd } = werkPiekBij(piekStaat, aantallen, nu);
  const stats = { rood: 0, nietRood: 0, onbekend: 0, piek: staat.piek, nieuwePiek: gewijzigd };

  const nieuweRecords = (records || []).map((r) => {
    const instelling = leesInstelling((bronPerId || {})[r.bronId]);
    if (!instelling) return r;

    const vers = aantallen.get(r.url);
    const aantal = vers && vers.aantal != null ? vers.aantal : Number.isFinite(r.huishoudens) ? r.huishoudens : null;
    const { rood: oudRood, ...zonderRood } = r;
    const eigen = isEigenRood(oudRood, instelling);
    // Rood van een andere regel blijft staan.
    const behoud = oudRood && !eigen ? { rood: oudRood } : {};

    if (aantal == null) {
      // Onbekend aantal: voorzichtig, dus rood.
      stats.onbekend++;
      stats.rood++;
      return {
        ...zonderRood,
        ...(behoud.rood
          ? behoud
          : {
              rood: {
                sinds: (eigen && oudRood.sinds) || r.eerstGezienOp || null,
                score: 1,
                route: ROUTE,
                reden: `${instelling.reden}: aantal huishoudens onbekend`,
                label: instelling.label,
              },
            }),
      };
    }

    const piek = Math.max(staat.piek, aantal);
    const percentage = Math.round((aantal / piek) * 100);
    const isRood = haaltDrempel(aantal, piek, instelling.drempel);
    const ernst = { huishoudens: aantal, piek, percentage };
    const basis = { ...zonderRood, huishoudens: aantal, ernst };

    if (behoud.rood) {
      stats.rood++;
      return { ...basis, ...behoud };
    }
    if (!isRood) {
      stats.nietRood++;
      return basis;
    }
    stats.rood++;
    const reden =
      aantal >= staat.piek && staat.url === r.url
        ? `${instelling.reden}: ${aantal} huishoudens, de grootste storing tot nu toe`
        : `${instelling.reden}: ${aantal} huishoudens, ${percentage}% van de grootste storing (${piek})`;
    return {
      ...basis,
      rood: {
        sinds: (eigen && oudRood.sinds) || r.eerstGezienOp || null,
        score: Math.min(1, aantal / piek),
        route: ROUTE,
        reden,
        label: instelling.label,
      },
    };
  });

  return { records: nieuweRecords, piekStaat: staat, piekGewijzigd: gewijzigd, stats };
}

/**
 * Haalt opgeloste stroomstoringen uit de bestaande berichten (alle versies van een storing).
 * `haal(url)` leest een detailpagina; zonder `haal` gebeurt er niets. Met `gescraptBronnen` (Set
 * bron-id's) worden alleen bronnen bekeken die deze run echt zijn opgehaald.
 * @returns {Promise<{records: Array, verwijderd: Array<{url: string, reden: string}>, stats: object}>}
 */
async function verwijderOpgelost({ bestaand, ruwe, bronPerId, haal = null, nu = new Date(), budgetMs = BUDGET_MS, gescraptBronnen = null }) {
  const stats = { gecontroleerd: 0, opgelost: 0, teOud: 0, onzeker: 0 };
  if (!haal) return { records: bestaand, verwijderd: [], stats };

  const lijstUrls = new Set((ruwe || []).map((b) => b.url));
  const bronMetStoringen = new Set((ruwe || []).map((b) => b.bronId));

  // De laatste versie per url van de stroombronnen, die niet meer op de lijst staan.
  const kandidaten = new Map();
  for (const r of bestaand || []) {
    if (!leesInstelling((bronPerId || {})[r.bronId]) || lijstUrls.has(r.url)) continue;
    if (gescraptBronnen && !gescraptBronnen.has(r.bronId)) continue; // bron niet bekeken deze run
    const v = kandidaten.get(r.url);
    if (!v || (r.versie || 1) > (v.versie || 1)) kandidaten.set(r.url, r);
  }

  const weg = new Map(); // url -> reden
  const wachtrij = [...kandidaten.values()].slice(0, MAX_CONTROLES);
  const einde = Date.now() + budgetMs;

  async function werker() {
    while (wachtrij.length > 0) {
      const r = wachtrij.shift();
      const oud = nu.getTime() - Date.parse(r.eerstGezienOp || r.tijd || nu.toISOString()) > OUD_UREN * UUR_MS;
      const teOudEnBronOk = oud && bronMetStoringen.has(r.bronId);
      if (Date.now() > einde) {
        stats.onzeker++;
        if (teOudEnBronOk) {
          weg.set(r.url, "te oud en niet meer op de lijst");
          stats.teOud++;
        }
        continue;
      }
      stats.gecontroleerd++;
      try {
        const html = await haal(r.url);
        if (isOpgelost(html)) {
          weg.set(r.url, "opgelost");
          stats.opgelost++;
        } else {
          stats.onzeker++;
        }
      } catch {
        stats.onzeker++;
        if (teOudEnBronOk) {
          weg.set(r.url, "te oud en niet meer op de lijst");
          stats.teOud++;
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, Math.max(1, wachtrij.length)) }, werker));
  const records = (bestaand || []).filter((r) => !weg.has(r.url));
  return { records, verwijderd: [...weg].map(([url, reden]) => ({ url, reden })), stats };
}

module.exports = {
  PIEK_BESTAND,
  leesInstelling,
  leegPiek,
  haaltDrempel,
  aantallenUitScrape,
  werkPiekBij,
  pasStroomErnstToe,
  verwijderOpgelost,
};
