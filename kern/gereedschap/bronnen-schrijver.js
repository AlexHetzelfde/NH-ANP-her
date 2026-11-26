// gereedschap/bronnen-schrijver.js
//
// Schrijft een bron naar de bronbestanden van een gemeente: voegt 'm toe, of vervangt een
// bestaande bron met hetzelfde id (op dezelfde plek). Wordt gebruikt door voeg-bron-toe.js
// (nieuwe bron) en herstel-bronnen.js (een kapotte bron vervangen door een werkende).
//
// Een nieuwe bron komt in agenda.json als soort "agenda" is, anders in nieuws.json van de
// gemeente. Een bestaande bron wordt vervangen in het bestand waar hij al staat (ook in
// _regio). Bronnen met een eigen scraper (moties, camera, ...) worden nooit overschreven.
//
// detailSelector staat in de VOLGORDE tussen rustig en selectors, zodat het veld netjes
// wordt weggeschreven als een bron opnieuw wordt uitgezocht.

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const gemeenten = require("../basis/gemeenten");

const VOLGORDE = ["id", "naam", "categorie", "type", "url", "soort", "rustig", "detailSelector", "selectors", "paginering", "json"];

function ordenSleutels(bron) {
  const sleutels = [...VOLGORDE.filter((k) => bron[k] !== undefined), ...Object.keys(bron).filter((k) => !VOLGORDE.includes(k) && bron[k] !== undefined)];
  const uit = {};
  for (const k of sleutels) uit[k] = bron[k];
  return uit;
}

function isIdentifier(sleutel) {
  return /^[A-Za-z_$][\w$]*$/.test(sleutel);
}

function naarLiteral(waarde, inspringing) {
  if (waarde === null || typeof waarde !== "object") return JSON.stringify(waarde);
  const binnen = `${inspringing}  `;
  const regels = Object.entries(waarde)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${binnen}${isIdentifier(k) ? k : JSON.stringify(k)}: ${naarLiteral(v, binnen)},`);
  return `{\n${regels.join("\n")}\n${inspringing}}`;
}

function bronNaarTekst(bron) {
  const sleutels = [...VOLGORDE.filter((k) => bron[k] !== undefined), ...Object.keys(bron).filter((k) => !VOLGORDE.includes(k) && bron[k] !== undefined)];
  const regels = sleutels.map((k) => `    ${k}: ${naarLiteral(bron[k], "    ")},`);
  return `  {\n${regels.join("\n")}\n  },`;
}

// Zoekt het bestand waar een bron al in staat. Geeft null als hij nergens staat.
function vindBron(id, gemeenteId) {
  for (const b of gemeenten.schrijfbareBestanden(gemeenteId)) {
    const p = gemeenten.pad(b.map, b.bestand);
    if (!fs.existsSync(p)) continue;
    const doc = JSON.parse(fs.readFileSync(p, "utf-8"));
    const index = Array.isArray(doc[b.sleutel]) ? doc[b.sleutel].findIndex((x) => x.id === id) : -1;
    if (index !== -1) return { ...b, pad: p, doc, index };
  }
  return null;
}

async function schrijfBron(bron, gemeenteId = gemeenten.STANDAARD_GEMEENTE) {
  const bestaand = vindBron(bron.id, gemeenteId);
  if (bestaand && gemeenten.EIGEN_SCRAPER_TYPES.has(bestaand.doc[bestaand.sleutel][bestaand.index].type)) {
    throw new Error(`De bron "${bron.id}" heeft een eigen scraper en kan hier niet worden vervangen.`);
  }

  let pad, doc, sleutel, actie;
  if (bestaand) {
    ({ pad, doc, sleutel } = bestaand);
    actie = "vervangen";
  } else {
    sleutel = "bronnen";
    pad = gemeenten.pad(gemeenteId, bron.soort === "agenda" ? "agenda.json" : "nieuws.json");
    doc = fs.existsSync(pad) ? JSON.parse(fs.readFileSync(pad, "utf-8")) : { bronnen: [] };
    if (!Array.isArray(doc.bronnen)) doc.bronnen = [];
    actie = "toegevoegd";
  }

  const origineel = fs.existsSync(pad) ? await fsp.readFile(pad, "utf-8") : null;
  const schoon = ordenSleutels(bron);
  if (bestaand) doc[sleutel][bestaand.index] = schoon;
  else doc[sleutel].push(schoon);
  await fsp.mkdir(path.dirname(pad), { recursive: true });
  await fsp.writeFile(pad, `${JSON.stringify(doc, null, 2)}\n`, "utf-8");

  const bestandNaam = `gemeenten/${path.relative(gemeenten.GEMEENTEN_MAP, pad).split(path.sep).join("/")}`; // pad vanaf de hoofdmap van de repo
  try {
    const { valideerBronnen } = require("./valideer-bronnen");
    const fouten = valideerBronnen(gemeenten.gewoneBronnen(gemeenteId));
    if (!gemeenten.bronnenVoor(gemeenteId).some((b) => b.id === bron.id)) fouten.push(`de bron "${bron.id}" staat na het schrijven niet in ${bestandNaam}`);
    if (fouten.length) throw new Error(`${bestandNaam} is na het schrijven ongeldig: ${fouten.join("; ")}`);
  } catch (fout) {
    if (origineel === null) await fsp.rm(pad, { force: true });
    else await fsp.writeFile(pad, origineel, "utf-8");
    throw new Error(`${fout.message} (${bestandNaam} is teruggezet naar de vorige staat)`);
  }
  return { actie, bestand: bestandNaam };
}

module.exports = { schrijfBron, bronNaarTekst, vindBron };
