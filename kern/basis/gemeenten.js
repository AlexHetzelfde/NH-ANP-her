// kern/basis/gemeenten.js
//
// De ENIGE plek die weet hoe de map gemeenten/ in elkaar zit en waar de data van een
// gemeente staat. Alle andere code vraagt het hier.
//
//   gemeenten/<id>/gemeente.json    naam, plaatsen, iBabs-adres, bronvolgorde
//   gemeenten/<id>/nieuws.json      nieuwsbronnen   { bronnen: [...] }
//   gemeenten/<id>/agenda.json      kalenderbronnen { bronnen: [...] }
//   gemeenten/<id>/signalering.json { scrapers: [...], bewijs: [...] }
//   gemeenten/<id>/rubrieken.json   de ZANP-instellingen per bron
//   gemeenten/_regio/               bronnen die voor meerdere gemeenten gelden; zelfde
//                                   bestanden, zonder gemeente.json
//   data/<id>/                      wat de run voor die gemeente schrijft
//
// Een run draait voor EEN gemeente: de bronnen van die gemeente plus die van _regio.
// Een map die met een underscore begint telt niet als gemeente. Velden die met een
// underscore beginnen (_uitleg, _opmerking) zijn toelichting voor mensen en worden bij
// het inlezen weggelaten.

"use strict";

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const GEMEENTEN_MAP = process.env.ZANP_GEMEENTEN_DIR || path.join(REPO, "gemeenten");
const DATA_ROOT = path.join(REPO, "data");
const REGIO = "_regio";

// Voor welke gemeente een run draait en waarop "Bron toevoegen/herstellen" werken.
const STANDAARD_GEMEENTE = process.env.ZANP_GEMEENTE || "zaanstad";

// Bronnen met een eigen scraper of eigen verwerking. "Bron herstellen" en de bronvalidatie
// laten deze met rust: die zijn geen standaard recept dat een AI kan verbeteren.
const EIGEN_SCRAPER_TYPES = new Set(["ibabs-dashboard", "moties", "schriftelijke-vragen", "camera", "stroomstoringen", "ted", "tenderned"]);

function gemeenteIds() {
  if (!fs.existsSync(GEMEENTEN_MAP)) return [];
  return fs
    .readdirSync(GEMEENTEN_MAP, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
}

const pad = (id, bestand) => path.join(GEMEENTEN_MAP, id, bestand);

// Leest een JSON-bestand van een gemeente (of van _regio). Bestaat het niet: null.
function leesJson(id, bestand) {
  const p = pad(id, bestand);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (fout) {
    throw new Error(`gemeenten/${id}/${bestand} is geen geldig JSON: ${fout.message}`);
  }
}

function schoon(bron) {
  const uit = {};
  for (const [k, v] of Object.entries(bron)) if (!k.startsWith("_")) uit[k] = v;
  return uit;
}
const lijst = (doc, sleutel) => (doc && Array.isArray(doc[sleutel]) ? doc[sleutel].map(schoon) : []);

// gemeente.json van een gemeente, zonder de toelichting.
function gemeente(id = STANDAARD_GEMEENTE) {
  const doc = leesJson(id, "gemeente.json");
  if (!doc) throw new Error(`gemeenten/${id}/gemeente.json ontbreekt`);
  return schoon(doc);
}

// De map waar de run van deze gemeente zijn gegevens schrijft. ZANP_DATA_DIR bestaat voor
// de tests en voor proefruns en wijst dan rechtstreeks naar die map.
function dataMap(id = STANDAARD_GEMEENTE) {
  return process.env.ZANP_DATA_DIR || path.join(DATA_ROOT, id);
}

// De mappen waaruit een run van deze gemeente zijn bronnen haalt: de gemeente zelf en _regio.
function bronMappen(id) {
  return [id, REGIO].filter((m, i) => i === 0 || (m !== id && fs.existsSync(path.join(GEMEENTEN_MAP, m))));
}

// Alles wat ZANP voor deze gemeente scrapet: nieuws, agenda en de signaleringsbronnen die als
// gewone bron worden opgehaald, van de gemeente en van _regio. De volgorde komt uit
// bronvolgorde in gemeente.json; bronnen die daar niet staan komen daarna. Bij dezelfde url
// wint namelijk de bron die eerder in de lijst staat.
function bronnenVoor(id = STANDAARD_GEMEENTE) {
  const verzameld = [];
  for (const m of bronMappen(id)) {
    verzameld.push(...lijst(leesJson(m, "nieuws.json"), "bronnen"));
    verzameld.push(...lijst(leesJson(m, "agenda.json"), "bronnen"));
    verzameld.push(...lijst(leesJson(m, "signalering.json"), "scrapers"));
  }
  const volgorde = gemeente(id).bronvolgorde || [];
  const plek = (b) => {
    const i = volgorde.indexOf(b.id);
    return i === -1 ? volgorde.length : i;
  };
  return verzameld.map((b, i) => ({ b, i })).sort((x, y) => plek(x.b) - plek(y.b) || x.i - y.i).map((x) => x.b);
}

// De bronnen waar "Bron herstellen" en de bronvalidatie op werken: alles behalve de bronnen
// met een eigen scraper.
const gewoneBronnen = (id = STANDAARD_GEMEENTE) => bronnenVoor(id).filter((b) => !EIGEN_SCRAPER_TYPES.has(b.type));

// Media die alleen als bewijs van aandacht tellen (signalering/bewijs.js).
function bewijsBronnen(id = STANDAARD_GEMEENTE) {
  return bronMappen(id).flatMap((m) => lijst(leesJson(m, "signalering.json"), "bewijs"));
}

// Bestanden met bronnen die "Bron toevoegen" en "Bron herstellen" mogen schrijven, met de
// sleutel waaronder de lijst staat. Eerst de gemeente, dan _regio.
function schrijfbareBestanden(id = STANDAARD_GEMEENTE) {
  const uit = [];
  for (const m of bronMappen(id)) {
    uit.push({ map: m, bestand: "nieuws.json", sleutel: "bronnen" });
    uit.push({ map: m, bestand: "agenda.json", sleutel: "bronnen" });
    uit.push({ map: m, bestand: "signalering.json", sleutel: "scrapers" });
  }
  return uit;
}

module.exports = {
  GEMEENTEN_MAP,
  REGIO,
  STANDAARD_GEMEENTE,
  EIGEN_SCRAPER_TYPES,
  gemeenteIds,
  pad,
  leesJson,
  gemeente,
  dataMap,
  bronMappen,
  bronnenVoor,
  gewoneBronnen,
  bewijsBronnen,
  schrijfbareBestanden,
};
