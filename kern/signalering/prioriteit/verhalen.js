// signalering/prioriteit/verhalen.js
//
// Van losse stukken naar verhalen: groepen stukken die over hetzelfde onderwerp
// gaan. Een verhaal is de eenheid waarover de routes naar rood (routes.js)
// beslissen; de code telt, de AI mag alleen helpen bij het indelen (verhaal-ai.js).
//
// Hoe stukken bij elkaar komen:
//   1. Voor elk stuk bepaalt analyse.js zoekwoorden en ankers (zeldzame eigen
//      woorden, zoals "Westerwateringtunnel"). De stukken die die ankers bevatten
//      zijn aan elkaar gekoppeld, als het anker in hun kop of eerste alinea staat
//      (genoeg dekking) of in hun kop staat.
//   2. Stukken van dezelfde bron met bijna dezelfde kop (een reeks) koppelen niet, en bij
//      overheids- en hulpdienstbronnen koppelen stukken van dezelfde bron helemaal niet: een
//      reeks bekendmakingen, moties of stroomstoringen is geen verhaal. (Bij media kan een
//      verhaal wel meerdere stukken van dezelfde bron hebben: een vervolgbericht.)
//      Een koppeling op één enkel woord is zwak: er zijn minstens twee gedeelde eigen
//      woorden nodig, tenzij het stuk er voor een groot deel in terugkomt.
//   3. Banden die de AI eerder heeft vastgelegd (geheugen.aiBanden) tellen mee.
//   4. De samenhangende groepen zijn de verhalen. Een groep die te groot wordt
//      (een algemeen woord dat alles aan elkaar rijgt) wordt opnieuw gesneden
//      met strengere eisen, en blijft die te groot, dan doet hij niet mee.
//
// Per stuk telt ook wat voor soort bron het is (laag): media, hulpdienst of
// overheid, en welke bronnen hetzelfde stuk spiegelen (bekendmakingen en
// wetenregelgeving publiceren dezelfde besluiten: samen één bron).

"use strict";

const { analyseUitVingerafdruk, bouwZoekvraag, zoekEvidentie } = require("./analyse");

const DAG_MS = 24 * 3600 * 1000;

function laagVan(bron, R) {
  if (R.mediaBronnen.includes(bron)) return "media";
  if (R.hulpdienstBronnen.includes(bron)) return "hulpdienst";
  return "overheid";
}

// Bronnen die dezelfde stukken spiegelen tellen als één onafhankelijke bron.
function onafhankelijkeBron(bron, R) {
  for (const groep of R.spiegelGroepen) if (groep.includes(bron)) return `spiegel:${groep[0]}`;
  return bron;
}

function titelGelijkenisSets(a, b) {
  if (!a.size || !b.size) return 0;
  let gemeen = 0;
  for (const t of a) if (b.has(t)) gemeen++;
  return gemeen / (a.size + b.size - gemeen);
}

// Het soort stuk: de AI-type van een nieuwsbericht, of een incident omdat de bron
// het zelf onder 112 zet. Geen woordenlijst: alleen wat de bron of de AI zegt.
function typeVan(fp) {
  if (fp.type && typeof fp.type === "object" && fp.type.soort) return fp.type.soort;
  if (typeof fp.type === "string" && fp.type) return fp.type;
  if (fp.rubriek === "112") return "incident";
  return null;
}

function maakStuk(fp, R) {
  const tijd = Date.parse(fp.datum);
  return {
    fp,
    k: fp.k,
    tijd: Number.isFinite(tijd) ? tijd : null,
    bron: fp.bron,
    laag: laagVan(fp.bron, R),
    onafhankelijk: onafhankelijkeBron(fp.bron, R),
    type: typeVan(fp),
    agenda: fp.soort === "agenda" || String(fp.k).startsWith("a:"),
    kopSet: new Set(fp.kop || []),
  };
}

class UnionFind {
  constructor() {
    this.ouder = new Map();
  }
  vind(x) {
    if (!this.ouder.has(x)) this.ouder.set(x, x);
    let w = x;
    while (this.ouder.get(w) !== w) w = this.ouder.get(w);
    let y = x;
    while (this.ouder.get(y) !== w) {
      const volgende = this.ouder.get(y);
      this.ouder.set(y, w);
      y = volgende;
    }
    return w;
  }
  voeg(a, b) {
    const ra = this.vind(a);
    const rb = this.vind(b);
    if (ra !== rb) this.ouder.set(ra, rb);
  }
}

function groepen(uf, sleutels) {
  const m = new Map();
  for (const k of sleutels) {
    const r = uf.vind(k);
    if (!m.has(r)) m.set(r, []);
    m.get(r).push(k);
  }
  return [...m.values()];
}

/**
 * Berekent de koppelingen tussen stukken: voor elk stuk de stukken waarin zijn
 * ankers voorkomen, met centraliteit en dekking.
 *
 * @returns {Map<string, {naar: string, c: number, dekking: number}[]>}
 */
function berekenBanden(stukken, ctx, F) {
  const fps = stukken.map((s) => s.fp);
  const bijK = new Map(stukken.map((s) => [s.k, s]));
  const banden = new Map();
  for (const s of stukken) {
    const a = analyseUitVingerafdruk(s.fp);
    const vraag = bouwZoekvraag(a, ctx, F);
    if (!vraag.ankers.length) continue;
    const ruw = zoekEvidentie(vraag, fps, (e) => e.k === s.k, F);
    const lijst = [];
    for (const e of ruw) {
      const ander = bijK.get(e.k);
      if (!ander) continue;
      if (s.bron === ander.bron) {
        // een reeks van dezelfde bron is geen verhaal; bij overheid en hulpdienst telt dezelfde bron nooit
        if (s.laag !== "media") continue;
        if (titelGelijkenisSets(s.kopSet, ander.kopSet) >= F.reeksJaccard) continue;
      }
      lijst.push({ naar: e.k, c: e.c, dekking: e.dekking, treffers: (e.treffers || []).length });
    }
    if (lijst.length) banden.set(s.k, lijst);
  }
  return banden;
}

function bandOk(b, eis) {
  // één gedeeld woord is genoeg als het stuk er voor een groot deel in terugkomt
  const genoegWoorden = b.treffers >= eis.minTreffers || b.dekking >= eis.ontheffingDekking;
  if (!genoegWoorden) return false;
  return (b.c >= eis.sterkC && b.dekking >= eis.sterkDekking) || (b.c >= eis.randC && b.dekking >= eis.randDekking);
}

function knip(sleutels, banden, aiBanden, eis, bijK) {
  const uf = new UnionFind();
  const aanwezig = new Set(sleutels);
  for (const k of sleutels) uf.vind(k);
  for (const k of sleutels) {
    for (const b of banden.get(k) || []) {
      if (aanwezig.has(b.naar) && bandOk(b, eis)) uf.voeg(k, b.naar);
    }
  }
  for (const [k, v] of Object.entries(aiBanden || {})) {
    if (v && v.met && aanwezig.has(k) && aanwezig.has(v.met) && bijK.has(k) && bijK.has(v.met)) uf.voeg(k, v.met);
  }
  return groepen(uf, sleutels);
}

/**
 * @param {object} o
 * @param {object[]} o.stukken   vingerafdrukken (geheugen.docs)
 * @param {object}   o.ctx       bouwContext(...)
 * @param {object}   o.F         FORMULE
 * @param {object}   o.R         ROUTES (instellingen.js)
 * @param {Date}     o.nu
 * @param {object}   [o.aiBanden] geheugen.aiBanden
 * @param {Map}      [o.bandenCache] resultaat van berekenBanden, als de aanroeper het al heeft
 * @returns {{ verhalen: object[], stukken: Map, banden: Map, stats: object }}
 *   verhaal = { id, leden: [stuk], teGroot }
 */
function bouwVerhalen({ stukken: fps, ctx, F, R, nu, aiBanden = {}, bandenCache = null }) {
  const grens = nu.getTime() - R.vensterDagen * DAG_MS;
  const stukken = [];
  for (const fp of fps) {
    if (!fp || !fp.k || fp.afgelast) continue;
    const s = maakStuk(fp, R);
    if (s.tijd !== null && s.tijd < grens) continue;
    stukken.push(s);
  }
  const bijK = new Map(stukken.map((s) => [s.k, s]));
  const banden = bandenCache || berekenBanden(stukken, ctx, F);
  const alle = stukken.map((s) => s.k);
  const stats = { stukken: stukken.length, verhalen: 0, metMeerStukken: 0, bijgesneden: 0, teGroot: 0 };

  const eerste = knip(alle, banden, aiBanden, R.band, bijK);
  const uit = [];
  for (const lid of eerste) {
    let delen = [lid];
    let teGroot = false;
    if (lid.length > R.maxVerhaalGrootte) {
      stats.bijgesneden++;
      delen = knip(lid, banden, aiBanden, R.bandStreng, bijK);
      if (delen.some((d) => d.length > R.maxVerhaalGrootte)) teGroot = true;
    }
    for (const d of delen) {
      const leden = d.map((k) => bijK.get(k)).sort((x, y) => (x.tijd || 0) - (y.tijd || 0) || String(x.k).localeCompare(String(y.k)));
      const grootGenoeg = d.length <= R.maxVerhaalGrootte;
      if (!grootGenoeg) stats.teGroot++;
      uit.push({ id: leden[0].k, leden, teGroot: !grootGenoeg || teGroot });
    }
  }
  stats.verhalen = uit.length;
  stats.metMeerStukken = uit.filter((v) => v.leden.length > 1).length;
  return { verhalen: uit, stukken: bijK, banden, stats };
}

module.exports = {
  laagVan,
  onafhankelijkeBron,
  typeVan,
  maakStuk,
  berekenBanden,
  bouwVerhalen,
  titelGelijkenisSets,
};
