// signalering/bron-rood.js — berichten van bepaalde bronnen zijn altijd rood
//
// Een vaste regel per bron, los van de prioriteitsmodule (scraper/prioriteit/) en los
// van de alertregels. Zet in het bronbestand (nieuws.json of agenda.json) bij een bron:
//
//   altijdRood: { label: "stroomstoring", reden: "Stroomstoring in de regio" },
//
// Elk bericht van die bron krijgt dan het veld `rood`, in dezelfde vorm als het rood
// van jubileum.js. Voor het label en de reden gelden de standaardwaarden hieronder
// als je ze weglaat; `altijdRood: true` is dus ook goed.
//
// De regel wordt elke run opnieuw bepaald en niet bewaard. Een bericht dat al rood
// is (prioriteitsmodule, jubileum) houdt zijn eigen reden. Agenda-items doen niet
// mee: deze regel is voor nieuwsbronnen.

"use strict";

const runlog = require("../basis/runlog");

const STANDAARD_LABEL = "altijd rood";
const STANDAARD_REDEN = "Deze bron wordt altijd rood getoond";

function leesInstelling(bron) {
  const a = bron && bron.altijdRood;
  if (!a) return null;
  if (a === true) return { label: STANDAARD_LABEL, reden: STANDAARD_REDEN };
  if (typeof a === "object") {
    return { label: a.label || STANDAARD_LABEL, reden: a.reden || STANDAARD_REDEN };
  }
  return null;
}

/**
 * Zet rood op de berichten van bronnen met `altijdRood`.
 * @param {{records: Array, bronPerId: object, nu?: Date, log?: object}} invoer
 * @returns {{records: Array, stats: {rood: number, alRood: number}}}
 */
function pasBronRoodToe({ records, bronPerId, nu = null, log = runlog.huidig() }) {
  const stats = { rood: 0, alRood: 0 };

  const nieuweRecords = (records || []).map((r) => {
    const instelling = leesInstelling((bronPerId || {})[r.bronId]);
    if (!instelling) return r;
    if (r.rood) {
      stats.alRood++;
      return r;
    }
    stats.rood++;
    const nieuw = !nu || (r.eerstGezienOp && nu.getTime() - Date.parse(r.eerstGezienOp) <= 2 * 3600 * 1000);
    if (nieuw) log.regel("bronRood", `ROOD (${r.bronId}): ${String(r.kop || "").slice(0, 80)} (${instelling.reden})`);
    return {
      ...r,
      rood: {
        sinds: r.eerstGezienOp || null,
        score: 1,
        route: "regel",
        reden: instelling.reden,
        label: instelling.label,
      },
    };
  });

  log.tel("bronRood", "rood", stats.rood);
  log.tel("bronRood", "alRood", stats.alRood);
  return { records: nieuweRecords, stats };
}

module.exports = { pasBronRoodToe, leesInstelling };
