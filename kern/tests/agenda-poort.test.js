// Tests voor de poort van de agenda-stap (verwerking/agenda-poort.js): code beslist of de AI
// naar een bericht moet kijken. Vaste datums: 5 januari 2027 is een dinsdag.
const test = require("node:test");
const assert = require("node:assert/strict");
const { zoekDatumSignalen } = require("../verwerking/agenda-poort");

const PUB = "2027-01-05";
const rundag = PUB;
const zoek = (tekst, extra = {}, kop = "") => zoekDatumSignalen(kop, tekst, { publicatieDag: PUB, rundag, ...extra });

test("een datum met maandnaam in de toekomst is een signaal", () => {
  const r = zoek("Er is een inloopavond op zaterdag 9 januari om 14.00 uur in het buurthuis.");
  assert.equal(r.signaal, true);
  assert.equal(r.redenen[0].soort, "datum");
  assert.equal(r.redenen[0].dag, "2027-01-09");
});

test("een datum vóór de rundag valt af: 'op 4 januari' bij een run op 5 januari", () => {
  const r = zoek("Op 4 januari was de opening van het nieuwe buurthuis.", { publicatieDag: "2027-01-04" });
  assert.equal(r.signaal, false);
  assert.ok(r.afgevallen >= 1);
  // dezelfde datum is op 4 januari zelf nog wel een signaal
  assert.equal(zoek("Op 4 januari is de opening van het nieuwe buurthuis.", { publicatieDag: "2027-01-04", rundag: "2027-01-04" }).signaal, true);
});

test("afgelopen zaterdag en vorige week zijn verleden, geen signaal", () => {
  assert.equal(zoek("Dat gebeurde afgelopen zaterdag in Zaandam.").signaal, false);
  assert.equal(zoek("De brand woedde vorige week zaterdag urenlang.").signaal, false);
  assert.equal(zoek("Gisteren was het druk op de markt.").signaal, false);
});

test("volgende week donderdag wordt uitgerekend vanaf de publicatiedag", () => {
  const r = zoek("De gemeenteraad vergadert volgende week donderdag over de begroting.");
  assert.equal(r.signaal, true);
  assert.equal(r.redenen[0].soort, "week");
  assert.equal(r.redenen[0].dag, "2027-01-14");
});

test("morgen, overmorgen en vanavond zijn relatief aan de publicatiedag", () => {
  assert.equal(zoek("Morgen opent de nieuwe markt.").redenen[0].dag, "2027-01-06");
  assert.equal(zoek("Overmorgen is er een hoorzitting.").redenen[0].dag, "2027-01-07");
  assert.equal(zoek("Vanavond is de raadsvergadering.").redenen[0].dag, PUB);
});

test("relatief wordt aan de rundag getoetst: 'morgen' in een bericht van gisteren is voorbij", () => {
  const r = zoek("Morgen opent de nieuwe markt.", { publicatieDag: "2027-01-03" });
  assert.equal(r.signaal, false);
});

test("dit weekend loopt tot en met de zondag", () => {
  const r = zoek("Dit weekend is er een Kerstmarkt in Zaandijk.");
  assert.equal(r.signaal, true);
  assert.equal(r.redenen[0].dag, "2027-01-10");
});

test("een losse weekdag telt, behalve na 'afgelopen' of direct voor een datum", () => {
  const r = zoek("Donderdag opent de markt op het plein.");
  assert.equal(r.signaal, true);
  assert.equal(r.redenen[0].soort, "weekdag");
  assert.equal(r.redenen[0].dag, "2027-01-07");
  assert.equal(zoek("Donderdagavond is het concert.").signaal, true);
  assert.equal(zoek("Zaterdag 3 januari 2026 was de opening.").signaal, false);
});

test("een weekdag die niet bij de datum past, geeft geen signaal", () => {
  // 12 januari 2027 is een dinsdag
  assert.equal(zoek("Maandag 12 januari is er een inloopavond.").signaal, false);
  assert.equal(zoek("Dinsdag 12 januari is er een inloopavond.").signaal, true);
});

test("een numerieke datum met jaartal is een signaal, een bedrag niet", () => {
  assert.equal(zoek("De vergadering is op 12-01-2027 in het stadhuis.").redenen[0].dag, "2027-01-12");
  assert.equal(zoek("De gemeente reserveert 1.200.000 euro voor het project.").signaal, false);
});

test("een datum over de jaargrens wordt naar het volgende jaar gerekend", () => {
  const r = zoekDatumSignalen("", "De nieuwjaarsreceptie is op 3 januari.", { publicatieDag: "2026-12-30", rundag: "2026-12-30" });
  assert.equal(r.signaal, true);
  assert.equal(r.redenen[0].dag, "2027-01-03");
});

test("een datum in het verleden met jaartal valt af", () => {
  assert.equal(zoek("De fietsbrug werd geopend op 12 maart 2025.").signaal, false);
});

test("de poort leest de hele tekst: een datum helemaal aan het eind van een lang stuk telt", () => {
  const lang = "Dit is een lang stuk nieuws over de plannen van de gemeente. ".repeat(400);
  assert.ok(lang.length > 20000);
  assert.equal(zoek(lang).signaal, false);
  assert.equal(zoek(`${lang} Op zaterdag 9 januari is er een open dag.`).signaal, true);
});

test("ook een datum in de kop is een signaal", () => {
  assert.equal(zoek("Meer informatie volgt.", {}, "Open dag op zaterdag 9 januari").signaal, true);
});

test("zonder datum of weekdag geen signaal, en nooit een fout bij lege invoer", () => {
  assert.equal(zoek("De raad praat over de begroting en de plannen voor het nieuwe jaar.").signaal, false);
  assert.equal(zoek("").signaal, false);
  assert.equal(zoekDatumSignalen(null, undefined, { publicatieDag: PUB, rundag }).signaal, false);
});

test("hetzelfde stukje datum telt één keer en er worden hooguit acht redenen bewaard", () => {
  const veel = Array.from({ length: 12 }, (_, i) => `Op ${10 + i} januari is er iets.`).join(" ");
  const r = zoek(`${veel} ${veel}`);
  assert.equal(r.aantal, 12);
  assert.equal(r.redenen.length, 8);
});
