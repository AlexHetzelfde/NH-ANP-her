const test = require("node:test");
const assert = require("node:assert/strict");
const { tijdelijkeDataMap } = require("./helpers");
tijdelijkeDataMap(); // vóór het laden van zanp.js
const { pasBronRoodToe, leesInstelling } = require("../signalering/bron-rood");
const z = require("../zanp");

const stilLog = { regels: [], regel(n, t) { this.regels.push(t); }, tel() {}, voorbeeld() {} };

const bronPerId = {
  storing: { id: "storing", altijdRood: { label: "stroomstoring", reden: "Stroomstoring in de regio" } },
  gewoon: { id: "gewoon" },
  eenvoudig: { id: "eenvoudig", altijdRood: true },
};
const rec = (extra) => ({ kop: "Kop", eerstGezienOp: "2026-11-16T09:00:00.000Z", ...extra });

test("elk bericht van een altijdRood-bron wordt rood, andere bronnen blijven ongemoeid", () => {
  const { records, stats } = pasBronRoodToe({
    records: [rec({ bronId: "storing" }), rec({ bronId: "gewoon" })],
    bronPerId,
    log: stilLog,
  });
  assert.equal(records[0].rood.label, "stroomstoring");
  assert.equal(records[0].rood.reden, "Stroomstoring in de regio");
  assert.equal(records[0].rood.route, "regel");
  assert.equal(records[0].rood.sinds, "2026-11-16T09:00:00.000Z");
  assert.equal(records[1].rood, undefined);
  assert.equal(stats.rood, 1);
});

test("altijdRood: true geeft een standaardlabel", () => {
  assert.ok(leesInstelling(bronPerId.eenvoudig).label);
  assert.equal(leesInstelling(bronPerId.gewoon), null);
});

test("een bericht dat al rood is houdt zijn eigen reden", () => {
  const eigen = { sinds: "x", score: 3, route: "prioriteit", reden: "eigen reden", label: "eigen" };
  const { records, stats } = pasBronRoodToe({ records: [rec({ bronId: "storing", rood: eigen })], bronPerId, log: stilLog });
  assert.equal(records[0].rood, eigen);
  assert.equal(stats.alRood, 1);
  assert.equal(stats.rood, 0);
});

test("onbekende bron of lege invoer geeft geen fout", () => {
  assert.deepEqual(pasBronRoodToe({ records: [rec({ bronId: "onbekend" })], bronPerId, log: stilLog }).stats, { rood: 0, alRood: 0 });
  assert.deepEqual(pasBronRoodToe({ records: [], bronPerId: {}, log: stilLog }).records, []);
});

test("door een hele ZANP-run: een stroomstoring wordt een rood 112-bericht zonder AI", async () => {
  const nu = new Date();
  const storing = {
    bronId: "stroomstoringkaart",
    bronNaam: "Stroomstoringkaart",
    categorie: "lokaal",
    url: "https://www.stroomstoringkaart.nl/storing/2026/assendelft-2026-11-15-24add6",
    titel: "Stroomstoring in Assendelft en Westzaan",
    samenvatting: "Stroomstoring in Assendelft en Westzaan. De storing begon op 15 november 2026 om 22:51. Ongeveer 600 huishoudens zijn zonder stroom. Netbeheerder: Liander.",
    gepubliceerdOp: nu.toISOString(),
    vasteRubriek: "112",
    geenAi: true,
  };
  const gewoon = {
    bronId: "testbron",
    bronNaam: "Bron",
    url: "https://voorbeeld.nl/gewoon",
    titel: "Gemeenteraad praat over parkeren",
    samenvatting: "De gemeenteraad van Zaanstad praat donderdag over de parkeertarieven in het centrum van Zaandam.",
    gepubliceerdOp: nu.toISOString(),
  };
  const r = await z.draai({ nu, apiKey: null, env: {}, scrape: async () => [storing, gewoon], haalTekst: async () => {} });
  const b = Object.fromEntries(r.records.map((x) => [x.bronId, x]));
  const s = b.stroomstoringkaart;
  assert.ok(s, "de stroomstoring ontbreekt in de records");
  assert.equal(s.rubriek, "112");
  assert.ok(s.rood, "de stroomstoring is niet rood");
  assert.equal(s.rood.label, "stroomstoring");
  assert.equal(s.kop, "Stroomstoring in Assendelft en Westzaan");
  assert.equal(b.testbron.rood, undefined);
});
