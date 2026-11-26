// signalering/prioriteit/regels.js
//
// Rood op grond van een VASTE REGEL in plaats van de formule. Twee regels:
//   - cameratoezicht (camera-reeks.js): de eerste aanwijzing op een plek en het
//     5e besluit in de reeks zijn rood, de rest niet.
//   - schriftelijke vragen (scrapers/schriftelijke-vragen.js): de BEANTWOORDING
//     is rood, VRAAG_ROOD_UREN lang vanaf het moment dat wij het antwoord zagen.
//     De publicatie van de vragen zelf valt gewoon onder de formule.
//
// Waarom een regel? Een camerabesluit lijkt voor de formule op een gewoon
// bekendmakingsstuk: veel soortgelijke stukken van dezelfde bron, weinig
// bijzonders per stuk. Of zo'n besluit nieuws is, hangt aan de plaats in de
// reeks (nieuw, of voor de vijfde keer), en dat kent de formule niet.
//
// Er wordt niets bewaard: elke run wordt de regel opnieuw op de berichten
// toegepast. Een besluit dat later toch een ander volgnummer blijkt te hebben
// (omdat er een eerder besluit bijkwam), krijgt dus vanzelf de juiste kleur.
// Net als het rood van de formule wordt het alleen in modus "aan" getoond.

"use strict";

const { vindBesluit, roodReden } = require("../../verwerking/camera-reeks");

/**
 * @param {object}   o
 * @param {Array}    o.records         de berichten (alle versies)
 * @param {Array}    o.cameraReeksen   de reeksen uit data/zanp-camera/reeksen.json
 * @returns {Map<string, {sinds, score, route, reden, kop}>} sleutel "n:<url>" -> rood
 */
function cameraRood({ records, cameraReeksen }) {
  const uit = new Map();
  if (!Array.isArray(cameraReeksen) || !cameraReeksen.length) return uit;
  for (const r of records) {
    if (!r || !r.camera || !r.url) continue;
    const gevonden = vindBesluit(cameraReeksen, r.url);
    if (!gevonden) continue;
    const reden = roodReden(gevonden.reeks, gevonden.besluit);
    if (!reden) continue;
    uit.set(`n:${r.url}`, {
      sinds: r.eerstGezienOp || null,
      score: 1,
      route: "regel",
      reden,
      kop: r.kop || "",
    });
  }
  return uit;
}

// Hoe lang een beantwoording rood blijft, gerekend vanaf het moment dat wij hem zagen.
const VRAAG_ROOD_UREN = 24;

/**
 * Rood voor een beantwoorde schriftelijke vraag. Het antwoord is de nieuwste
 * versie van het bericht (zelfde url als de vraag), met record.vraag.status
 * "beantwoord". Net als cameraRood wordt niets bewaard: elke run opnieuw bepaald.
 *
 * @param {object}   o
 * @param {Array}    o.records  de berichten (alle versies)
 * @param {Date}     [o.nu]
 * @returns {Map<string, {sinds, score, route, reden, kop}>} sleutel "n:<url>" -> rood
 */
function vraagRood({ records, nu = new Date() }) {
  const uit = new Map();
  for (const r of records) {
    if (!r || !r.vraag || r.vraag.status !== "beantwoord" || !r.url || r.seed) continue;
    const sinds = Date.parse(r.eerstGezienOp);
    if (!Number.isFinite(sinds)) continue;
    if (nu.getTime() - sinds > VRAAG_ROOD_UREN * 3600 * 1000) continue;
    uit.set(`n:${r.url}`, {
      sinds: r.eerstGezienOp,
      score: 1,
      route: "regel",
      reden: "Antwoord op schriftelijke vragen",
      kop: r.kop || "",
    });
  }
  return uit;
}

module.exports = { cameraRood, vraagRood, VRAAG_ROOD_UREN };
