// Bewijsbronnen (bewijs.js, signalering.json): Rodi en Zaanstad.nieuws als aandachtsbewijs.
// De fixtures zijn ingekorte kopieën van de echte pagina's (2026-11-18). Geen netwerk.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const b = require("../signalering/bewijs");
const BRONNEN = require("../basis/gemeenten").bewijsBronnen();
const normale = require("../basis/gemeenten").gewoneBronnen();

const fx = (n) => fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8");
const nu = new Date("2026-11-18T12:00:00Z");
const stil = { log() {}, warn() {}, error() {} };

test("de bewijsbronnen staan NIET tussen de gewone bronnen: ze worden nooit nieuws of agenda", () => {
  for (const bron of BRONNEN) {
    assert.equal(normale.some((x) => x.id === bron.id), false, bron.id);
    assert.ok(bron.host && bron.lijstUrl);
  }
  assert.deepEqual(BRONNEN.map((x) => x.id), ["rodi-zaanstad", "zaanstad-nieuws"]);
});

test("Rodi: de lijstpagina geeft kop, datum en rubriek; alleen Zaanse artikelen", () => {
  const items = b.parseRodiLijst(fx("rodi-lijst.html"), nu);
  assert.equal(items.length, 5);
  assert.ok(items.every((i) => /^https:\/\/www\.rodi\.nl\/zaanstad\/nieuws\/\d+\//.test(i.url)));
  const hond = items.find((i) => /hondenbrokjes/.test(i.titel));
  assert.equal(hond.datum, "2026-11-17T13:30:00.000Z"); // 14:30 Nederlandse tijd
  assert.equal(hond.rubriek, "Nieuws");
});

test("Rodi: een artikel geeft titel, datum en tekst", () => {
  const a = b.parseRodiArtikel(fx("rodi-artikel.html"));
  assert.match(a.titel, /Het Plein Is Van Ons/);
  assert.equal(a.datum, "2026-11-18T10:50:00.000Z");
  assert.ok(a.tekst.length > 200);
});

test("Zaanstad.nieuws: de ingebedde gegevens geven alleen artikelen van de eigen site, met rubriek uit de url", () => {
  const items = b.parseNewsifierLijst(fx("newsifier-lijst.html"));
  assert.equal(items.length, 3);
  assert.ok(items.every((i) => i.url.startsWith("https://zaanstad.nieuws.nl/")), "geen landelijk nieuws");
  assert.ok(items.some((i) => i.rubriek === "112"));
  assert.ok(items.every((i) => i.datum && i.datum.endsWith("Z")));
});

test("Zaanstad.nieuws: een artikel geeft titel, datum en tekst", () => {
  const a = b.parseNewsifierArtikel(fx("newsifier-artikel.html"));
  assert.match(a.titel, /stakingen/);
  assert.ok(a.tekst.length > 100);
});

test("nieuws-sitemap: alleen eigen host, met titel en datum", () => {
  const xml = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
    <url><loc>https://zaanstad.nieuws.nl/politie/abc-1/</loc><news:news><news:publication_date>2026-11-17T12:00:00Z</news:publication_date><news:title>Brand in Zaandam</news:title></news:news></url>
    <url><loc>https://ander.nl/x</loc></url></urlset>`;
  const items = b.parseNieuwsSitemap(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].titel, "Brand in Zaandam");
});

function nepHaal(pagina) {
  const aangeroepen = [];
  const haal = async (url) => {
    aangeroepen.push(url);
    if (url in pagina) {
      if (pagina[url] instanceof Error) throw pagina[url];
      return pagina[url];
    }
    throw new Error("404");
  };
  haal.aangeroepen = aangeroepen;
  return haal;
}

test("haalBewijs: alles bij elkaar; een kapotte bron stopt de rest niet; elk artikel hooguit twee pogingen", async () => {
  const lijstRodi = fx("rodi-lijst.html");
  const rodiLijstUrl = "https://www.rodi.nl/zaanstad";
  const haal = nepHaal({
    [rodiLijstUrl]: lijstRodi,
    "https://www.rodi.nl/rss": new Error("rss kapot"),
    "https://zaanstad.nieuws.nl/": new Error("site kapot"),
  });
  const r = await b.haalBewijs({ staat: null, nu, haal, parseerRss: async () => [], log: stil, pauzeMs: 0 });
  assert.equal(r.items.length, 5, "alleen Rodi leverde iets");
  assert.ok(r.items.every((i) => i.key === `b:${i.url}` && i.bron === "rodi-zaanstad"));
  assert.match(r.staat.bronnen["zaanstad-nieuws"].fout, /site kapot/);
  assert.equal(r.staat.bronnen["rodi-zaanstad"].fout, null);
  // de artikelen konden niet opgehaald worden (404): geen tekst, wel een poging genoteerd
  assert.ok(r.items.every((i) => i.tekst === undefined));
  const tweede = await b.haalBewijs({ staat: r.staat, nu, haal, parseerRss: async () => [], log: stil, pauzeMs: 0 });
  const derde = await b.haalBewijs({ staat: tweede.staat, nu, haal, parseerRss: async () => [], log: stil, pauzeMs: 0 });
  const pogingen = Object.values(derde.staat.items).map((i) => i.pogingen);
  assert.ok(pogingen.every((p) => p <= 2), `pogingen: ${pogingen}`);
});

test("haalBewijs: een opgehaald artikel geeft tekst voor deze run, en de staat bewaart die niet", async () => {
  const lijst = fx("rodi-lijst.html");
  const eerste = b.parseRodiLijst(lijst, nu).find((i) => /hondenbrokjes/.test(i.titel) || true);
  const haal = nepHaal({ "https://www.rodi.nl/zaanstad": lijst, [eerste.url]: fx("rodi-artikel.html") });
  const r = await b.haalBewijs({ staat: null, nu, haal, parseerRss: async () => [], log: stil, pauzeMs: 0 });
  const metTekst = r.items.find((i) => i.url === eerste.url);
  assert.ok(metTekst.tekst && metTekst.tekst.length > 200);
  assert.equal(JSON.stringify(r.staat).includes(metTekst.tekst.slice(0, 80)), false, "geen volledige tekst in bewijs.json");
});

test("haalBewijs: stukken ouder dan 30 dagen worden vergeten", async () => {
  const oud = { url: "https://www.rodi.nl/zaanstad/nieuws/1/x", bron: "rodi-zaanstad", titel: "Oud", teaser: "", datum: "2026-09-01T00:00:00.000Z", gezienOp: "2026-09-01T00:00:00.000Z", pogingen: 0 };
  const staat = { versie: 1, bronnen: {}, items: { "b:https://www.rodi.nl/zaanstad/nieuws/1/x": oud } };
  const r = await b.haalBewijs({ staat, nu, haal: nepHaal({}), parseerRss: async () => [], log: stil, pauzeMs: 0 });
  assert.equal(Object.keys(r.staat.items).length, 0);
});

test("bewijs.json wordt alleen geschreven als er iets veranderd is", async () => {
  const map = fs.mkdtempSync(path.join(os.tmpdir(), "bewijs-"));
  const { staat, voor } = await b.leesBewijsStaat(map);
  staat.items["b:https://x"] = { url: "https://x", bron: "rodi-zaanstad", titel: "T", datum: nu.toISOString() };
  assert.equal(await b.schrijfBewijsStaat(map, staat, voor), true);
  const l2 = await b.leesBewijsStaat(map);
  l2.staat.bijgewerkt = "2026-11-19T00:00:00.000Z"; // alleen de tijdstempel
  assert.equal(await b.schrijfBewijsStaat(map, l2.staat, l2.voor), false);
});
