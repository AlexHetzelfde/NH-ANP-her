const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { tijdelijkeDataMap, leesData } = require("./helpers");
const map = tijdelijkeDataMap(); // vóór het laden van zanp.js
const z = require("../zanp");

const OPGELOST = fs.readFileSync(path.join(__dirname, "fixtures", "stroomstoring-detail.html"), "utf-8");

const storing = (naam, aantal, nu) => ({
  bronId: "stroomstoringkaart",
  bronNaam: "Stroomstoringkaart",
  categorie: "lokaal",
  url: `https://www.stroomstoringkaart.nl/storing/2026/${naam}-2026-11-27-abc123`,
  titel: `Stroomstoring in ${naam}`,
  samenvatting: `Stroomstoring in ${naam}. De storing begon op 27 november 2026 om 11:00. Ongeveer ${aantal} huishoudens zijn zonder stroom. Netbeheerder: Liander.`,
  huishoudensAantal: aantal,
  gepubliceerdOp: nu.toISOString(),
  vasteRubriek: "112",
  geenAi: true,
});

test("door twee ZANP-runs: piek bewaard, rood naar 80% van de piek, opgeloste storing weg", async () => {
  const nu1 = new Date();
  const A = storing("assendelft", 600, nu1);
  const r1 = await z.draai({ nu: nu1, apiKey: null, env: {}, scrape: async () => [A], haalTekst: async () => {} });
  const a1 = r1.records.find((x) => x.url === A.url);
  assert.ok(a1.rood, "de eerste storing is de piek en rood");
  assert.equal(leesData(map, "zanp-stroom-piek.json").piek, 600);

  // Run 2: A is van de lijst verdwenen en opgelost; er zijn een kleine (100) en een grote (500) storing.
  const nu2 = new Date(nu1.getTime() + 2 * 3600_000);
  const B = storing("zaandam", 100, nu2);
  const C = storing("purmerend", 500, nu2);
  const r2 = await z.draai({
    nu: nu2,
    apiKey: null,
    env: {},
    scrape: async () => [B, C],
    haalTekst: async () => {},
    haalStoring: async () => OPGELOST,
  });
  assert.equal(r2.records.find((x) => x.url === A.url), undefined, "de opgeloste storing moet weg zijn");
  const b = r2.records.find((x) => x.url === B.url);
  const c = r2.records.find((x) => x.url === C.url);
  assert.equal(b.rood, undefined, "100 van 600 (17%) is niet rood");
  assert.equal(b.ernst.percentage, 17);
  assert.ok(c.rood, "500 van 600 (83%) is rood");
  assert.equal(leesData(map, "zanp-stroom-piek.json").piek, 600, "de piek blijft staan");

  // Run 3: een storing van 900 wordt de nieuwe piek; 500 is dan geen 80% meer.
  const nu3 = new Date(nu2.getTime() + 2 * 3600_000);
  const D = storing("krommenie", 900, nu3);
  const r3 = await z.draai({ nu: nu3, apiKey: null, env: {}, scrape: async () => [C, D], haalTekst: async () => {}, haalStoring: async () => OPGELOST });
  assert.equal(leesData(map, "zanp-stroom-piek.json").piek, 900);
  assert.ok(r3.records.find((x) => x.url === D.url).rood);
  assert.equal(r3.records.find((x) => x.url === C.url).rood, undefined, "500 van 900 (56%) is niet meer rood");
});
