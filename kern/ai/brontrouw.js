// ai/brontrouw.js
//
// Gedeelde controle op wat een AI schreef, tegen de brontekst: staat elk getal, elke maand of
// weekdag en elke eigennaam letterlijk in de bron? Gebruikt door samengesteld.js (samengesteld
// nieuws) en besluitenlijst.js. Geen AI = geen bericht: een tekst die hier faalt, wordt niet gebruikt.

"use strict";

const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const WEEKDAGEN = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];

function spatie(t) {
  return String(t == null ? "" : t).replace(/\s+/g, " ").trim();
}

// "Zaandammers" mag staan als de bron "Zaandammer" heeft: vergelijk op de stam.
function woordMetStam(w) {
  return w.toLowerCase().slice(0, Math.max(4, w.length - 2));
}

/**
 * @param {string} uitTekst  de tekst van de AI
 * @param {string} bronTekst alle bronnen waaruit de AI mocht putten
 * @returns {{ ok: boolean, reden?: string }}
 */
function controleerBrontrouw(uitTekst, bronTekst) {
  const { cijfersKloppen } = require("./wire");
  const uit = String(uitTekst || "");
  const bron = spatie(bronTekst);
  const bronKlein = bron.toLowerCase();

  if (!cijfersKloppen(uit, bron)) return { ok: false, reden: "getal-niet-in-bron" };

  const kleineUit = uit.toLowerCase();
  for (const woord of [...MAANDEN, ...WEEKDAGEN]) {
    if (new RegExp(`\\b${woord}\\b`).test(kleineUit) && !bronKlein.includes(woord)) {
      return { ok: false, reden: `datum-niet-in-bron:${woord}` };
    }
  }

  // Eigennamen: een hoofdletterwoord midden in een zin moet in de bron staan.
  for (const zin of uit.split(/(?<=[.!?])\s+|\n+/)) {
    const woorden = zin.match(/[\p{L}\d][\p{L}\d'’-]*/gu) || [];
    for (let i = 1; i < woorden.length; i++) {
      const w = woorden[i];
      if (!/^\p{Lu}[\p{L}'’-]{2,}$/u.test(w)) continue;
      if (!bronKlein.includes(woordMetStam(w))) return { ok: false, reden: `naam-niet-in-bron:${w}` };
    }
  }
  return { ok: true };
}

module.exports = { controleerBrontrouw, MAANDEN, WEEKDAGEN, woordMetStam };
