// Test voor de nieuwsbron van de Rekenkamer Amsterdam-Zaanstad: de gewone
// generieke-lijst-scraper moet op deze site (Next.js, <article class="nieuwsitem">)
// koppen, links en datums vinden, en de tekst van een bericht uit ".c-wysiwyg" halen.
// Zonder netwerk; de pagina's zijn verkleinde nabootsingen van de echte opmaak.

const test = require("node:test");
const assert = require("node:assert/strict");

const { scrapeGeneriekeLijst } = require("../scrapers/generieke-lijst");
const { haalArtikelTekst } = require("../basis/hulpmiddelen");
const bronnen = require("../basis/gemeenten").gewoneBronnen();

const LIJST = `<!DOCTYPE html><html lang="nl"><head><title>Nieuws</title></head><body>
<header class="c-header"><ul class="c-navigation-menu"><li><a href="/nieuws/">Nieuws</a></li></ul></header>
<main id="main-content"><div class="c-nieuws"><div class="wrapper grid-container"><div class="c-listings-general nieuws-list"><h1>Nieuws</h1>
<div class="c-nieuwsitems-list gap"><div class="c-nieuwsitems-list__year-group"><h3 class="c-nieuwsitems-list__year">2026</h3>
<article class="nieuwsitem"><div class="nieuwsitem__date"><time dateTime="2026-09-16T10:19:45">16 september 2026</time></div><h2 class="h3 nieuwsitem__title"><a href="/nieuws/brief-naar-gemeente-zaanstad-over-inzichten-gebiedsontwikkeling-amsterdam/">Brief naar gemeente Zaanstad over inzichten gebiedsontwikkeling Amsterdam</a></h2></article>
<article class="nieuwsitem"><div class="nieuwsitem__date"><time dateTime="2026-06-25T00:01:11">25 juni 2026</time></div><h2 class="h3 nieuwsitem__title"><a href="/nieuws/19510/">Toegankelijkheid van tram- en bushaltes is gepubliceerd</a></h2></article>
<article class="nieuwsitem"><div class="nieuwsitem__date"><time dateTime="2026-06-04T00:02:56">4 juni 2026</time></div><h2 class="h3 nieuwsitem__title"><a href="/nieuws/het-onderzoek-buurthubs-voor-deelmobiliteit-is-gepubliceerd/">Het onderzoek Buurthubs voor deelmobiliteit is gepubliceerd</a></h2></article>
<article class="nieuwsitem"><div class="nieuwsitem__date"><time dateTime="2026-03-03T09:00:29">3 maart 2026</time></div><h2 class="h3 nieuwsitem__title"><a href="/nieuws/we-gaan-onderzoek-doen-naar-regelingen-voor-oudere-minima/">We gaan onderzoek doen naar regelingen voor oudere minima</a></h2></article>
</div></div></div></div></div></main></body></html>`;

const DETAIL = `<!DOCTYPE html><html lang="nl"><head><title>Brief naar gemeente Zaanstad - Rekenkamer</title></head><body>
<header class="c-header"><a href="/">Rekenkamer Amsterdam-Zaanstad</a></header>
<main id="main-content"><div class="wrapper wrapper--medium grid-container"><article class="c-nieuws-details nieuws-details"><h1>Brief naar gemeente Zaanstad over inzichten gebiedsontwikkeling Amsterdam</h1><time dateTime="2026-09-16T10:19:45">16 september 2026</time>
<div class="c-wysiwyg"><p>Meerdere fracties uit de Zaanse raad wilden meer weten over ons onderzoek naar gebiedsontwikkeling in Amsterdam: <a href="/onderzoek/gebiedsontwikkeling-en-betaalbare-woningen/">Bouwen aan de complete stad</a> (april 2025). Daarom hebben we een brief aan de Zaanse raad gestuurd met daarin 7 inzichten die, hoewel Amsterdam niet volledig vergelijkbaar is met Zaanstad, raken aan verschillende vraagstukken.</p>
<p>Lees <a href="https://admin.rekenkamer-amsterdam.nl/content/uploads/2026/09/brief.pdf">de brief hier</a>.</p></div></article></div></main>
<footer class="c-footer"><address>Weesperstraat 105a, 1018 VN Amsterdam</address></footer></body></html>`;

function nepFetch(paginas) {
  const echt = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    const body = paginas[u];
    const status = body === undefined ? 404 : 200;
    return {
      ok: status === 200,
      status,
      headers: { get: () => null, getSetCookie: () => [] },
      text: async () => body || "",
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  };
  return () => (global.fetch = echt);
}

const BRON = bronnen.find((b) => b.id === "rekenkamer-amsterdam-zaanstad");

test("bron staat in de bronbestanden met de juiste instellingen", () => {
  assert.ok(BRON, "bron rekenkamer-amsterdam-zaanstad ontbreekt");
  assert.equal(BRON.type, "generieke-lijst");
  assert.equal(BRON.url, "https://www.rekenkamer.amsterdam.nl/nieuws/");
  assert.equal(BRON.detailSelector, ".c-wysiwyg");
});

test("de lijst geeft koppen, absolute links en datums", async () => {
  const herstel = nepFetch({ "https://www.rekenkamer.amsterdam.nl/nieuws/": LIJST });
  const log = console.log;
  console.log = () => {};
  let uit;
  try {
    uit = await scrapeGeneriekeLijst(BRON);
  } finally {
    console.log = log;
    herstel();
  }
  assert.equal(uit.length, 4);
  assert.equal(uit[0].titel, "Brief naar gemeente Zaanstad over inzichten gebiedsontwikkeling Amsterdam");
  assert.equal(
    uit[0].url,
    "https://www.rekenkamer.amsterdam.nl/nieuws/brief-naar-gemeente-zaanstad-over-inzichten-gebiedsontwikkeling-amsterdam/"
  );
  assert.ok(uit[0].gepubliceerdOp, "datum uit <time datetime> gelezen");
  assert.match(uit[0].gepubliceerdOp, /^2026-09-1[56]/);
  assert.ok(uit.every((b) => b.gepubliceerdOp), "elk bericht heeft een datum");
  assert.equal(new Set(uit.map((b) => b.url)).size, 4);
});

test("de tekst komt uit .c-wysiwyg en niet uit menu of voettekst", async () => {
  const url = "https://www.rekenkamer.amsterdam.nl/nieuws/brief-naar-gemeente-zaanstad-over-inzichten-gebiedsontwikkeling-amsterdam/";
  const herstel = nepFetch({ [url]: DETAIL });
  const log = console.log;
  console.log = () => {};
  let uit;
  try {
    uit = await haalArtikelTekst(url, { titel: "Brief naar gemeente Zaanstad", detailSelector: BRON.detailSelector });
  } finally {
    console.log = log;
    herstel();
  }
  assert.ok(uit && uit.tekst, "tekst gevonden");
  assert.match(uit.tekst, /7 inzichten/);
  assert.doesNotMatch(uit.tekst, /Weesperstraat/);
});
