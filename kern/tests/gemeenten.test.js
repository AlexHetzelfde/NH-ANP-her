// De gemeentenstructuur: gemeenten/<id>/ en gemeenten/_regio/ (basis/gemeenten.js) en het
// wegschrijven van bronnen (gereedschap/bronnen-schrijver.js).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const echt = require("../basis/gemeenten");

// Laadt de loader en de schrijver opnieuw met een eigen gemeenten-map (de map wordt bij het laden gelezen).
function metMap(dir) {
  const oud = process.env.ZANP_GEMEENTEN_DIR;
  process.env.ZANP_GEMEENTEN_DIR = dir;
  for (const m of ["../basis/gemeenten", "../gereedschap/bronnen-schrijver", "../gereedschap/valideer-bronnen"]) delete require.cache[require.resolve(m)];
  const uit = { gemeenten: require("../basis/gemeenten"), schrijver: require("../gereedschap/bronnen-schrijver") };
  if (oud === undefined) delete process.env.ZANP_GEMEENTEN_DIR;
  else process.env.ZANP_GEMEENTEN_DIR = oud;
  return uit;
}
function kopie() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gemeenten-"));
  fs.cpSync(path.join(REPO, "gemeenten"), dir, { recursive: true });
  return dir;
}

test("Zaanstad is de standaardgemeente en _regio telt niet als gemeente", () => {
  assert.equal(echt.STANDAARD_GEMEENTE, "zaanstad");
  assert.ok(echt.gemeenteIds().includes("zaanstad"));
  assert.ok(!echt.gemeenteIds().includes("_regio"));
});

test("elke bron heeft een uniek id en een bekend type", () => {
  const lijst = echt.bronnenVoor();
  const ids = lijst.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "dubbel bron-id");
  const { scraperVoorType } = require("../scrapers/scraper-register");
  for (const b of lijst) assert.ok(scraperVoorType(b.type), `${b.id}: geen scraper voor type ${b.type}`);
});

test("bronvolgorde noemt alleen bronnen die bestaan, en de lijst volgt die volgorde", () => {
  const volgorde = echt.gemeente().bronvolgorde;
  const ids = echt.bronnenVoor().map((b) => b.id);
  for (const id of volgorde) assert.ok(ids.includes(id), `bronvolgorde noemt "${id}", maar die bron bestaat niet`);
  assert.deepEqual(ids.filter((id) => volgorde.includes(id)), volgorde);
});

test("velden met een underscore (toelichting) komen niet in de bronnen terecht", () => {
  for (const b of [...echt.bronnenVoor(), ...echt.bewijsBronnen()]) {
    assert.deepEqual(Object.keys(b).filter((k) => k.startsWith("_")), [], b.id);
  }
});

test("bewijsbronnen zijn geen gewone bronnen, en bronnen met een eigen scraper worden niet hersteld", () => {
  const bewijs = echt.bewijsBronnen().map((b) => b.id);
  assert.deepEqual(bewijs, ["rodi-zaanstad", "zaanstad-nieuws"]);
  const gewoon = echt.gewoneBronnen().map((b) => b.id);
  for (const id of bewijs) assert.ok(!gewoon.includes(id));
  for (const id of ["zaanstad-moties", "zaanstad-camera", "stroomstoringkaart", "vervoerregio-overzichten"]) assert.ok(!gewoon.includes(id), id);
  assert.ok(gewoon.includes("DeOrkaan") && gewoon.includes("nh-actueel"));
});

test("gemeente.json: plaatsen en iBabs-adres zijn ingevuld", () => {
  const g = echt.gemeente();
  assert.equal(g.id, "zaanstad");
  assert.match(g.ibabs, /^https:\/\/zaanstad\.bestuurlijkeinformatie\.nl$/);
  assert.ok(g.plaatsen.includes("zaandam") && g.plaatsen.includes("purmerend"));
  assert.equal(g._uitleg, undefined);
});

test("dataMap: data/<gemeente>/, en ZANP_DATA_DIR wint (alleen voor tests en proefruns)", () => {
  const oud = process.env.ZANP_DATA_DIR;
  delete process.env.ZANP_DATA_DIR;
  assert.equal(echt.dataMap("zaanstad"), path.join(REPO, "data", "zaanstad"));
  assert.equal(echt.dataMap("purmerend"), path.join(REPO, "data", "purmerend"));
  process.env.ZANP_DATA_DIR = "/tmp/ergens";
  assert.equal(echt.dataMap("zaanstad"), "/tmp/ergens");
  if (oud === undefined) delete process.env.ZANP_DATA_DIR;
  else process.env.ZANP_DATA_DIR = oud;
});

test("een tweede gemeente wordt opgepikt, samen met _regio, zonder dat Zaanstad verandert", () => {
  const dir = kopie();
  fs.mkdirSync(path.join(dir, "purmerend"));
  fs.writeFileSync(path.join(dir, "purmerend", "gemeente.json"), JSON.stringify({ id: "purmerend", naam: "Purmerend", plaatsen: ["purmerend"], ibabs: "https://x.nl", bronvolgorde: [] }));
  fs.writeFileSync(path.join(dir, "purmerend", "nieuws.json"), JSON.stringify({ bronnen: [{ id: "purmerend-test", naam: "Test", categorie: "lokaal", type: "rss", url: "https://p.nl/rss" }] }));
  const { gemeenten } = metMap(dir);
  assert.deepEqual(gemeenten.gemeenteIds(), ["purmerend", "zaanstad"]);
  const p = gemeenten.bronnenVoor("purmerend").map((b) => b.id);
  assert.equal(p[0], "purmerend-test");
  assert.ok(p.includes("nh-actueel"), "_regio hoort bij elke gemeente");
  assert.ok(!p.includes("zaanstad-moties"), "bronnen van Zaanstad horen niet bij Purmerend");
  assert.deepEqual(gemeenten.bronnenVoor("zaanstad").map((b) => b.id), echt.bronnenVoor("zaanstad").map((b) => b.id));
});

test("schrijver: een nieuwe bron komt achteraan nieuws.json, een agendabron in agenda.json", async () => {
  const dir = kopie();
  const { gemeenten, schrijver } = metMap(dir);
  const nieuw = { id: "test-nieuws", naam: "Test nieuws", categorie: "lokaal", type: "rss", url: "https://t.nl/rss" };
  const r = await schrijver.schrijfBron(nieuw, "zaanstad");
  assert.equal(r.actie, "toegevoegd");
  assert.equal(r.bestand, "gemeenten/zaanstad/nieuws.json");
  const doc = JSON.parse(fs.readFileSync(path.join(dir, "zaanstad", "nieuws.json"), "utf-8"));
  assert.equal(doc.bronnen[doc.bronnen.length - 1].id, "test-nieuws");
  assert.ok(doc._uitleg, "de toelichting blijft staan");
  assert.ok(doc.bronnen.some((b) => b._opmerking), "de opmerkingen bij andere bronnen blijven staan");

  const ag = await schrijver.schrijfBron({ ...nieuw, id: "test-agenda", soort: "agenda", url: "https://t.nl/agenda-rss" }, "zaanstad");
  assert.equal(ag.bestand, "gemeenten/zaanstad/agenda.json");
  assert.ok(gemeenten.bronnenVoor("zaanstad").some((b) => b.id === "test-agenda"));
});

test("schrijver: een bestaande bron wordt op dezelfde plek vervangen, ook in _regio", async () => {
  const dir = kopie();
  const { schrijver } = metMap(dir);
  const voor = JSON.parse(fs.readFileSync(path.join(dir, "_regio", "nieuws.json"), "utf-8"));
  const index = voor.bronnen.findIndex((b) => b.id === "nh-actueel");
  const oud = voor.bronnen[index];
  const r = await schrijver.schrijfBron({ ...oud, naam: "NH aangepast" }, "zaanstad");
  assert.equal(r.actie, "vervangen");
  assert.equal(r.bestand, "gemeenten/_regio/nieuws.json");
  const na = JSON.parse(fs.readFileSync(path.join(dir, "_regio", "nieuws.json"), "utf-8"));
  assert.equal(na.bronnen.length, voor.bronnen.length);
  assert.equal(na.bronnen[index].naam, "NH aangepast");
  assert.equal(na.bronnen[index].id, "nh-actueel");
});

test("schrijver: een bron met een eigen scraper wordt nooit overschreven", async () => {
  const dir = kopie();
  const { schrijver } = metMap(dir);
  const voor = fs.readFileSync(path.join(dir, "zaanstad", "nieuws.json"), "utf-8");
  await assert.rejects(() => schrijver.schrijfBron({ id: "zaanstad-moties", naam: "x", categorie: "lokaal", type: "rss", url: "https://x.nl/rss" }, "zaanstad"), /eigen scraper/);
  assert.equal(fs.readFileSync(path.join(dir, "zaanstad", "nieuws.json"), "utf-8"), voor);
});

test("schrijver: een ongeldige bron wordt teruggedraaid", async () => {
  const dir = kopie();
  const { schrijver } = metMap(dir);
  const { valideerBronnen } = require("../gereedschap/valideer-bronnen");
  const kapot = { id: "kapot", naam: "Kapot", categorie: "lokaal", type: "rss" };
  assert.ok(valideerBronnen([kapot]).length > 0, "voorwaarde: de validatie keurt deze bron af");
  const voor = fs.readFileSync(path.join(dir, "zaanstad", "nieuws.json"), "utf-8");
  await assert.rejects(() => schrijver.schrijfBron(kapot, "zaanstad"), /teruggezet/);
  assert.equal(fs.readFileSync(path.join(dir, "zaanstad", "nieuws.json"), "utf-8"), voor);
});
