const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const { leesPagina } = require("../scrapers/gemini-recept");
const { haalTekstUitHtml } = require("../basis/hulpmiddelen");
const { valideerBronnen } = require("../gereedschap/valideer-bronnen");
const bronnen = require("../basis/gemeenten").gewoneBronnen();
const rubrieken = { bronnen: require("../basis/rubrieken").PROFIELEN };
const gemeenten = require("../../gemeenten.json");

const fixture = (naam) => fs.readFileSync(path.join(__dirname, "fixtures", naam), "utf-8");
const bron = bronnen.find((b) => b.id === "veiligheidsregio-nieuws");

test("de bron staat in de bronbestanden en doorstaat de bronnenvalidatie", () => {
  assert.ok(bron, "veiligheidsregio-nieuws staat niet in de bronbestanden");
  assert.equal(bron.type, "gemini-recept");
  assert.equal(bron.url, "https://www.veiligheidsregiozaanstreekwaterland.nl/nieuws");
  assert.deepEqual(valideerBronnen([bron]), []);
});

test("de lijst: vier berichten met kop, link, datum en foto", async () => {
  const $ = cheerio.load(fixture("vrzw-nieuws-lijst.html"));
  const items = await leesPagina($, bron, bron.url);
  assert.equal(items.length, 4);
  assert.equal(items[0].titel, "Brand en stroomstoring in Volendam: samen zorgen voor de veiligheid van bewoners");
  assert.equal(
    items[0].url,
    "https://www.veiligheidsregiozaanstreekwaterland.nl/nieuws/nieuwsbericht/artikel/brand-en-stroomstoring-in-volendam-samen-zorgen-voor-de-veiligheid-van-bewoners"
  );
  assert.match(items[0].gepubliceerdOp, /^2026-11-0[12]/); // 2 november 2026
  assert.match(items[0].foto, /^https:\/\/www\.veiligheidsregiozaanstreekwaterland\.nl\/fileadmin\/_processed_\//);
  assert.ok(items.every((i) => i.titel && i.url && i.gepubliceerdOp));
  // De menu-items en de paginering zijn geen berichten.
  assert.ok(items.every((i) => /\/nieuws\/nieuwsbericht\//.test(i.url)));
});

test("het artikel: intro en tekst zijn er, 'Terug naar overzicht' en 'Delen' niet", () => {
  const r = haalTekstUitHtml(fixture("vrzw-artikel.html"), { detailSelector: bron.detailSelector, titel: "Brand en stroomstoring in Volendam: samen zorgen voor de veiligheid van bewoners" });
  const tekst = typeof r === "string" ? r : r.tekst;
  assert.match(tekst, /In de nacht van 24 op 25 oktober ontstond brand in de meterkast/);
  assert.match(tekst, /Opvang en gezamenlijke hulpverlening/);
  assert.match(tekst, /GRIP 1/);
  assert.doesNotMatch(tekst, /Terug naar overzicht/);
  assert.doesNotMatch(tekst, /Deel dit artikel/);
  assert.doesNotMatch(tekst, /Linkedin|WhatsApp/);
});

test("profiel in rubrieken.json: tag 112, officiële bron", () => {
  const p = rubrieken.bronnen["veiligheidsregio-nieuws"];
  assert.equal(p.rubriek, "112");
  assert.equal(p.herkomst, "officieel");
});

test("gemeenten.json: de veiligheidsregio hoort bij de acht regiogemeenten", () => {
  const ids = new Set(gemeenten.gemeenten.map((g) => g.id));
  const gekoppeld = gemeenten.bronnen["veiligheidsregio-nieuws"];
  assert.deepEqual(
    [...gekoppeld].sort(),
    ["edam-volendam", "landsmeer", "oostzaan", "purmerend", "waterland", "wormerland", "zaanstad"]
  );
  for (const id of gekoppeld) assert.ok(ids.has(id), `${id} staat niet in gemeenten.json`);
});

test("gemeenten.json: stroomstoringkaart staat bij alle gemeenten (*) en heeft een profiel", () => {
  assert.equal(gemeenten.bronnen["stroomstoringkaart"], "*");
  const p = rubrieken.bronnen["stroomstoringkaart"];
  assert.equal(p.rubriek, "112");
  assert.equal(p.herschrijf, false);
});
