// De kern van een stuk (het begin van de tekst, voor de AI-controle en het indelen van
// verhalen) was één zin tot 200 tekens; nu de eerste zinnen tot 500 tekens, afgekapt na een
// volledige zin (22 nov 2026). De berekening gebruikt de kern niet.
const test = require("node:test");
const assert = require("node:assert/strict");
const { analyseer } = require("../signalering/prioriteit/taal");

const zin = (n) => `Dit is zin nummer ${n} over de brand aan de Hoogstraat in Zaandam waarbij veel mensen zijn geëvacueerd.`;

test("de kern bevat meerdere zinnen en blijft onder 500 tekens, afgekapt na een volledige zin", () => {
  const tekst = Array.from({ length: 12 }, (_, i) => zin(i + 1)).join(" ");
  const { kern } = analyseer({ kop: "Brand", tekst });
  assert.ok(kern.length > 200 && kern.length <= 500, `lengte ${kern.length}`);
  assert.ok(kern.endsWith("."), "eindigt op een volledige zin");
  assert.ok(kern.includes("zin nummer 2"), "meer dan alleen de eerste zin");
});

test("een korte tekst geeft de hele tekst als kern", () => {
  const { kern } = analyseer({ kop: "Brand", tekst: zin(1) });
  assert.equal(kern, zin(1));
});

test("zonder zin van 40 tekens of meer is de kern leeg", () => {
  assert.equal(analyseer({ kop: "Brand", tekst: "Kort. Ook kort." }).kern, "");
});

test("de kern verandert de berekening niet: dezelfde tellingen als bij een korte tekst met dezelfde woorden", () => {
  const tekst = Array.from({ length: 6 }, (_, i) => zin(i + 1)).join(" ");
  const a = analyseer({ kop: "Brand", tekst });
  assert.equal(a.woorden, tekst.split(/\s+/).length);
});
