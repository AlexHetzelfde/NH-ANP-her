// De Orkaan staat als bron in signalering.json met alleenAgenda: de artikelen worden opgehaald en
// geanalyseerd, maar zijn nooit nieuws. Ze leveren alleen agendapunten en termijnen op.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const cheerio = require("cheerio");
const { tijdelijkeDataMap, leesData } = require("./helpers");
const map = tijdelijkeDataMap(); // vóór het laden van zanp.js
const z = require("../zanp");
const bronnen = require("../basis/gemeenten").gewoneBronnen();

const nu = new Date();
const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
function overDagen(n) {
  const d = new Date(nu.getTime() + n * 86400000);
  return { tekst: `${d.getDate()} ${MAANDEN[d.getMonth()]} ${d.getFullYear()}`, dag: d.toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" }) };
}
const geenTekst = async () => {};

test("signalering.json: DeOrkaan staat erin met alleenAgenda en geldige selectors", () => {
  const b = bronnen.find((x) => x.id === "DeOrkaan");
  assert.ok(b, "DeOrkaan ontbreekt in de bronbestanden");
  assert.equal(b.alleenAgenda, true);
  assert.equal(b.type, "gemini-recept");
  assert.match(b.paginering.patroon, /\/page\/\{n\}\/$/);
});

test("selectors: lijst van de homepage en tekst van een artikel (structuur van deorkaan.nl)", () => {
  const b = bronnen.find((x) => x.id === "DeOrkaan");
  const lijst = cheerio.load(`
    <div class="home-article-grid flex flex-row flex-wrap -mx-3">
      <div class="px-3 w-full"><div class="overview-item-wrapper">
        <a href="https://www.deorkaan.nl/een/" class="overview-item"><img class="post-thumb" src="https://www.deorkaan.nl/een.jpg"/></a>
        <span class="text-gray-500 text-sm font-light">16 november 2026</span>
        <h3 class="text-lg"><a href="https://www.deorkaan.nl/een/" class="overview-post-title">Eerste kop</a></h3>
        <p class="text-sm mt-1">Inleiding een&hellip;</p></div></div>
      <div class="px-3 w-full"><div class="overview-item-wrapper">
        <span class="text-gray-500 text-sm font-light">15 november 2026</span>
        <h3 class="text-lg"><a href="https://www.deorkaan.nl/twee/">Tweede kop</a></h3>
        <p class="text-sm mt-1">Inleiding twee</p></div></div>
    </div>`);
  const items = lijst(b.selectors.itemSelector);
  assert.equal(items.length, 2);
  const eerste = items.first();
  assert.equal(eerste.find(b.selectors.titelSelector).first().text(), "Eerste kop");
  assert.equal(eerste.find(b.selectors.linkSelector).first().attr("href"), "https://www.deorkaan.nl/een/");
  assert.equal(eerste.find(b.selectors.datumSelector).first().text(), "16 november 2026");
  assert.equal(eerste.find(b.selectors.fotoSelector).first().attr("src"), "https://www.deorkaan.nl/een.jpg");
  const artikel = cheerio.load('<h2 class="section-title">Kop</h2><div class="post-content"><p>Tekst van het artikel.</p></div><div class="comments-area">reacties</div>');
  assert.equal(artikel(b.detailSelector).text().trim(), "Tekst van het artikel.");
});

test("een Orkaan-artikel geeft een agendapunt, maar blijft verborgen nieuws (geen cluster, geen alert)", async () => {
  fs.rmSync(map, { recursive: true, force: true }); fs.mkdirSync(map);
  const d = overDagen(6);
  const tekstBrand = "Bij een uitslaande brand aan de Annemoonstraat 30 in Zaandam zijn 3 gewonden gevallen en zijn 12 bewoners geëvacueerd, meldt de brandweer vanochtend.";
  const orkaan = {
    bronId: "DeOrkaan", bronNaam: "De Orkaan", gepubliceerdOp: nu.toISOString(),
    url: "https://www.deorkaan.nl/inloopavond-fietsbrug/",
    titel: "Zaandammers kunnen meepraten over de nieuwe fietsbrug",
    samenvatting: `De gemeente houdt een inloopavond over de nieuwe fietsbrug op ${d.tekst} om 19.30 uur in het stadhuis. ${tekstBrand}`,
  };
  const echt = {
    bronId: "bekendmakingen", bronNaam: "Bekendmakingen", gepubliceerdOp: nu.toISOString(),
    url: "https://voorbeeld.nl/brand", titel: "Uitslaande brand aan de Annemoonstraat 30", samenvatting: tekstBrand,
  };
  const r = await z.draai({ nu, apiKey: null, env: {}, scrape: async () => [orkaan, echt], haalTekst: geenTekst });

  const o = r.records.find((x) => x.bronId === "DeOrkaan");
  assert.ok(o, "het Orkaan-record moet bestaan (voor de agendapunten)");
  assert.equal(o.alleenAgenda, true);
  assert.ok(!o.alert && !o.alertKandidaat, "Orkaan mag nooit een alert geven");
  assert.ok(!o.clusterId, "Orkaan zit nooit in een cluster (dubbel nieuws)");
  const e = r.records.find((x) => x.bronId === "bekendmakingen");
  assert.ok(e && !e.alleenAgenda);
  assert.ok(!e.clusterId, "een nieuwsbericht krijgt geen cluster met een Orkaan-artikel");
  assert.ok(!(e.ookGemeld && e.ookGemeld.length));

  const agenda = leesData(map, "agenda.json").items.filter((i) => i.bronId === "DeOrkaan");
  assert.equal(agenda.length, 1, "één agendapunt uit het Orkaan-artikel");
  assert.equal(agenda[0].afkomst, "bericht");
  assert.equal(agenda[0].startDag, d.dag);
  assert.equal(agenda[0].url, orkaan.url);

  // Het bestand bevat de vlag, zodat de site het record kan weglaten.
  const opgeslagen = leesData(map, "berichten.json").berichten.find((x) => x.bronId === "DeOrkaan");
  assert.equal(opgeslagen.alleenAgenda, true);
});

test("de vlag blijft op het record staan, ook als de bron later niet meer in de lijst staat", async () => {
  const eerder = leesData(map, "berichten.json");
  const r = await z.draai({ nu, apiKey: null, env: {}, scrape: async () => [], haalTekst: geenTekst });
  assert.equal(r.records.find((x) => x.bronId === "DeOrkaan").alleenAgenda, true);
  assert.equal(eerder.berichten.length, r.records.length);
});
