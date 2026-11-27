const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  leesInstelling,
  leegPiek,
  haaltDrempel,
  aantallenUitScrape,
  werkPiekBij,
  pasStroomErnstToe,
  verwijderOpgelost,
} = require("../signalering/stroom-ernst");
const { leesHuishoudens } = require("../scrapers/stroomstoringen");

const NU = new Date("2026-11-27T12:00:00.000Z");
const bronPerId = {
  storing: { id: "storing", stroomErnst: { drempel: 0.8, label: "stroomstoring", reden: "Stroomstoring" } },
  gewoon: { id: "gewoon" },
};
const OPGELOST = fs.readFileSync(path.join(__dirname, "fixtures", "stroomstoring-detail.html"), "utf-8");
const ACTIEF = OPGELOST.replace(/is opgelost/gi, "duurt nog").replace(/duurde/gi, "duurt");

const url = (n) => `https://www.stroomstoringkaart.nl/storing/2026/plaats-${n}`;
const rec = (n, extra = {}) => ({
  bronId: "storing",
  url: url(n),
  kop: `Stroomstoring ${n}`,
  versie: 1,
  eerstGezienOp: "2026-11-27T10:00:00.000Z",
  ...extra,
});
const aantallen = (...paren) => new Map(paren.map(([n, aantal]) => [url(n), { aantal, titel: `Storing ${n}` }]));

test("huishoudens uit de tekst: ook met punt of spatie als duizendtal", () => {
  assert.equal(leesHuishoudens("Ongeveer 100 huishoudens, al 52 minuten."), 100);
  assert.equal(leesHuishoudens("Ongeveer 20.000 huishoudens"), 20000);
  assert.equal(leesHuishoudens("1 000 huishoudens"), 1000);
  assert.equal(leesHuishoudens("geen getal"), null);
  assert.equal(leesHuishoudens(null), null);
});

test("de drempel is inclusief: 80 van 100 is rood, 79 niet", () => {
  assert.equal(haaltDrempel(80, 100, 0.8), true);
  assert.equal(haaltDrempel(79, 100, 0.8), false);
  assert.equal(haaltDrempel(100, 100, 0.8), true);
  assert.equal(haaltDrempel(70, 100, 0.7), true); // geen drijvende-komma-fout
});

test("de instelling: drempel standaard 0.8, ongeldige waarden vallen terug", () => {
  assert.equal(leesInstelling(bronPerId.gewoon), null);
  assert.equal(leesInstelling({ stroomErnst: true }).drempel, 0.8);
  assert.equal(leesInstelling({ stroomErnst: { drempel: 5 } }).drempel, 0.8);
  assert.equal(leesInstelling({ stroomErnst: { drempel: 0.5 } }).drempel, 0.5);
});

test("de piek begint bij 0: de eerste storing van 100 huishoudens is de piek en rood", () => {
  const r = pasStroomErnstToe({ records: [rec(1)], bronPerId, aantallen: aantallen([1, 100]), piekStaat: leegPiek(), nu: NU });
  assert.equal(r.piekStaat.piek, 100);
  assert.equal(r.piekGewijzigd, true);
  assert.equal(r.records[0].rood.label, "stroomstoring");
  assert.equal(r.records[0].rood.route, "stroom-ernst");
  assert.equal(r.records[0].ernst.percentage, 100);
  assert.equal(r.records[0].huishoudens, 100);
});

test("na een piek van 100: 80 is rood, 79 niet, en de piek blijft 100", () => {
  const piekStaat = { piek: 100, sinds: "x", url: url(1), titel: "t" };
  const r = pasStroomErnstToe({
    records: [rec(2), rec(3)],
    bronPerId,
    aantallen: aantallen([2, 80], [3, 79]),
    piekStaat,
    nu: NU,
  });
  assert.ok(r.records[0].rood, "80 van 100 hoort rood");
  assert.equal(r.records[1].rood, undefined, "79 van 100 hoort niet rood");
  assert.equal(r.records[1].ernst.percentage, 79);
  assert.equal(r.piekStaat.piek, 100);
  assert.equal(r.piekGewijzigd, false);
});

test("een grotere storing wordt de nieuwe piek en is rood; de oude storing van 100 is dan niet meer rood", () => {
  const piekStaat = { piek: 100, sinds: "x", url: url(1), titel: "t" };
  const eerst = pasStroomErnstToe({ records: [rec(1)], bronPerId, aantallen: aantallen([1, 100]), piekStaat, nu: NU });
  assert.ok(eerst.records[0].rood);

  const dan = pasStroomErnstToe({
    records: eerst.records.concat(rec(2)),
    bronPerId,
    aantallen: aantallen([1, 100], [2, 500]),
    piekStaat: eerst.piekStaat,
    nu: NU,
  });
  assert.equal(dan.piekStaat.piek, 500);
  assert.equal(dan.piekStaat.url, url(2));
  assert.equal(dan.records[1].rood.score, 1);
  assert.match(dan.records[1].rood.reden, /grootste storing tot nu toe/);
  assert.equal(dan.records[0].rood, undefined, "100 van 500 is 20%: niet meer rood");
  assert.equal(dan.records[0].ernst.percentage, 20);
});

test("de piek gaat nooit omlaag, ook niet als de grootste storing weg is", () => {
  const piekStaat = { piek: 500, sinds: "x", url: url(2), titel: "t" };
  const r = pasStroomErnstToe({ records: [rec(3)], bronPerId, aantallen: aantallen([3, 50]), piekStaat, nu: NU });
  assert.equal(r.piekStaat.piek, 500);
  assert.equal(r.records[0].rood, undefined);
});

test("rood sinds blijft gelijk bij een volgende run", () => {
  const eerst = pasStroomErnstToe({ records: [rec(1)], bronPerId, aantallen: aantallen([1, 100]), piekStaat: leegPiek(), nu: NU });
  const sinds = eerst.records[0].rood.sinds;
  const later = pasStroomErnstToe({
    records: eerst.records,
    bronPerId,
    aantallen: aantallen([1, 100]),
    piekStaat: eerst.piekStaat,
    nu: new Date(NU.getTime() + 900_000),
  });
  assert.equal(later.records[0].rood.sinds, sinds);
});

test("zonder nieuwe scrape geldt het bewaarde aantal op het record", () => {
  const piekStaat = { piek: 100, sinds: "x", url: url(1), titel: "t" };
  const r = pasStroomErnstToe({
    records: [rec(2, { huishoudens: 90 }), rec(3, { huishoudens: 10 })],
    bronPerId,
    aantallen: new Map(),
    piekStaat,
    nu: NU,
  });
  assert.ok(r.records[0].rood);
  assert.equal(r.records[1].rood, undefined);
});

test("een onbekend aantal huishoudens blijft rood (voorzichtig)", () => {
  const r = pasStroomErnstToe({ records: [rec(1)], bronPerId, aantallen: aantallen([1, null]), piekStaat: leegPiek(), nu: NU });
  assert.ok(r.records[0].rood);
  assert.equal(r.stats.onbekend, 1);
  assert.equal(r.piekStaat.piek, 0, "een onbekend aantal verandert de piek niet");
});

test("rood van een andere regel blijft ongemoeid; andere bronnen ook", () => {
  const eigen = { sinds: "x", score: 3, route: "prioriteit", reden: "eigen reden", label: "eigen" };
  const piekStaat = { piek: 1000, sinds: "x", url: url(9), titel: "t" };
  const r = pasStroomErnstToe({
    records: [rec(1, { rood: eigen }), { bronId: "gewoon", url: "x", kop: "k" }],
    bronPerId,
    aantallen: aantallen([1, 5]),
    piekStaat,
    nu: NU,
  });
  assert.equal(r.records[0].rood, eigen);
  assert.equal(r.records[1].rood, undefined);
  assert.equal(r.records[1].ernst, undefined);
});

test("oud rood van de vorige altijdRood-regel (route regel) wordt opnieuw beoordeeld", () => {
  const oud = { sinds: "x", score: 1, route: "regel", reden: "Stroomstoring", label: "stroomstoring" };
  const piekStaat = { piek: 1000, sinds: "x", url: url(9), titel: "t" };
  const r = pasStroomErnstToe({ records: [rec(1, { rood: oud })], bronPerId, aantallen: aantallen([1, 10]), piekStaat, nu: NU });
  assert.equal(r.records[0].rood, undefined);
});

test("aantallenUitScrape telt alleen bronnen met stroomErnst en valt terug op de tekst", () => {
  const kaart = aantallenUitScrape(
    [
      { bronId: "storing", url: url(1), huishoudensAantal: 120 },
      { bronId: "storing", url: url(2), samenvatting: "Ongeveer 40 huishoudens zijn zonder stroom." },
      { bronId: "gewoon", url: "x", huishoudensAantal: 999 },
    ],
    bronPerId
  );
  assert.equal(kaart.get(url(1)).aantal, 120);
  assert.equal(kaart.get(url(2)).aantal, 40);
  assert.equal(kaart.has("x"), false);
  assert.equal(werkPiekBij(leegPiek(), kaart, NU).staat.piek, 120);
});

// ---- opgeloste storingen ----

test("een opgeloste storing die niet meer op de lijst staat gaat eruit, alle versies", async () => {
  const bestaand = [rec(1), rec(1, { versie: 2 }), rec(2), { bronId: "gewoon", url: "x", kop: "k" }];
  const opgehaald = [];
  const haal = async (u) => {
    opgehaald.push(u);
    return u === url(1) ? OPGELOST : ACTIEF;
  };
  const o = await verwijderOpgelost({ bestaand, ruwe: [{ bronId: "storing", url: url(3) }], bronPerId, haal, nu: NU });
  assert.deepEqual(o.records.map((r) => r.url), [url(2), "x"]);
  assert.deepEqual(o.verwijderd, [{ url: url(1), reden: "opgelost" }]);
  assert.equal(o.stats.opgelost, 1);
  assert.ok(!opgehaald.includes("x"), "andere bronnen worden niet gecontroleerd");
});

test("een storing die nog op de lijst staat wordt niet eens gecontroleerd", async () => {
  let aantal = 0;
  const haal = async () => {
    aantal++;
    return OPGELOST;
  };
  const o = await verwijderOpgelost({ bestaand: [rec(1)], ruwe: [{ bronId: "storing", url: url(1) }], bronPerId, haal, nu: NU });
  assert.equal(aantal, 0);
  assert.equal(o.records.length, 1);
});

test("een pagina die faalt of niet 'opgelost' zegt laat de storing staan", async () => {
  const kapot = async () => {
    throw new Error("503");
  };
  const a = await verwijderOpgelost({ bestaand: [rec(1)], ruwe: [], bronPerId, haal: kapot, nu: NU });
  assert.equal(a.records.length, 1);
  const b = await verwijderOpgelost({ bestaand: [rec(1)], ruwe: [], bronPerId, haal: async () => ACTIEF, nu: NU });
  assert.equal(b.records.length, 1);
  assert.equal(b.stats.onzeker, 1);
});

test("ouder dan 72 uur, weg van de lijst en pagina onleesbaar: dan toch eruit (als de bron deze run storingen gaf)", async () => {
  const oud = rec(1, { eerstGezienOp: "2026-11-20T10:00:00.000Z" });
  const kapot = async () => {
    throw new Error("404");
  };
  const metBron = await verwijderOpgelost({ bestaand: [oud], ruwe: [{ bronId: "storing", url: url(5) }], bronPerId, haal: kapot, nu: NU });
  assert.equal(metBron.records.length, 0);
  const zonderBron = await verwijderOpgelost({ bestaand: [oud], ruwe: [], bronPerId, haal: kapot, nu: NU });
  assert.equal(zonderBron.records.length, 1, "bron zonder resultaat deze run: niets wissen");
});

test("zonder haal-functie (tests, geen netwerk) gebeurt er niets", async () => {
  const o = await verwijderOpgelost({ bestaand: [rec(1)], ruwe: [], bronPerId, haal: null, nu: NU });
  assert.equal(o.records.length, 1);
});

test("bronnen die deze run niet zijn opgehaald worden overgeslagen", async () => {
  let aantal = 0;
  const haal = async () => {
    aantal++;
    return OPGELOST;
  };
  const o = await verwijderOpgelost({ bestaand: [rec(1)], ruwe: [], bronPerId, haal, nu: NU, gescraptBronnen: new Set(["andere"]) });
  assert.equal(aantal, 0);
  assert.equal(o.records.length, 1);
});
