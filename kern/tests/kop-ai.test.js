// Elk nieuwsbericht krijgt een AI-kop (2026-11-19): modus "kop" voor berichten die nooit langs de AI
// gingen (moties, schriftelijke vragen, aanbestedingen), plus het soort bericht met een bewijszin.
const test = require("node:test");
const assert = require("node:assert/strict");
const { geminiAntwoord } = require("./helpers");
const g = require("../ai/gemini");
const wire = require("../ai/wire");
const spelling = require("../ai/spelling");

const nu = new Date();
test.beforeEach(() => spelling.zetWoordenboek(null));
const origineleFetch = global.fetch;
test.afterEach(() => { global.fetch = origineleFetch; });

const MOTIE =
  "Motie: extra geld voor onderhoud van de Zaanse bruggen. De raad vraagt het college om 500.000 euro vrij te maken voor onderhoud van de bruggen.";
const bron = (extra = {}) => ({
  bronId: "zaanstad-moties",
  bronNaam: "Zaanstad moties",
  url: "https://voorbeeld.nl/motie-1",
  titel: "Motie bruggen",
  samenvatting: MOTIE,
  gepubliceerdOp: nu.toISOString(),
  geenAi: true,
  ...extra,
});

test("een motie (geenAi) krijgt de modus kop", () => {
  const { nieuwe } = wire.planBerichten({ vensterBerichten: [bron()], nu });
  assert.equal(nieuwe[0].invoer.modus, "kop");
});

test("de stroomstoringkaart en cameratoezicht krijgen geen AI-kop", () => {
  for (const extra of [{ bronId: "stroomstoringkaart" }, { bronId: "zaanstad-camera", camera: { reeks: "x" } }, { camera: { reeks: "x" } }]) {
    const { nieuwe } = wire.planBerichten({ vensterBerichten: [bron({ url: "https://voorbeeld.nl/" + Math.random(), ...extra })], nu });
    assert.equal(nieuwe[0].invoer, null, JSON.stringify(extra));
  }
});

test("bronnen die al een AI-kop kregen blijven in modus volledig; De Orkaan blijft analyse", () => {
  const vol = wire.planBerichten({ vensterBerichten: [bron({ bronId: "bekendmakingen", geenAi: false, url: "https://v.nl/1" })], nu }).nieuwe[0];
  assert.equal(vol.invoer.modus, "volledig");
  const ork = wire.planBerichten({ vensterBerichten: [bron({ bronId: "DeOrkaan", geenAi: false, url: "https://v.nl/2" })], nu }).nieuwe[0];
  assert.equal(ork.invoer.modus, "analyse");
});

test("de prompt in modus kop vraagt alleen om kop en soort", () => {
  const p = g.bouwMeldingBatchPrompt([{ id: "a", modus: "kop", titel: "T", tekst: MOTIE, bronNaam: "B" }], "kop", []);
  assert.ok(p.includes('"soort"') && p.includes('"soortZin"'));
  assert.ok(!p.includes('"checklist"') && !p.includes('"prio"'));
  assert.ok(g.bouwMeldingBatchPrompt([{ id: "a", modus: "volledig", titel: "T", tekst: MOTIE, bronNaam: "B" }], "volledig", []).includes("SOORTZIN"));
});

test("valideerMelding: modus kop geeft kop en soort; een onbekend soort geeft geen soort", () => {
  assert.deepEqual(g.valideerMelding({ kop: "Kop", soort: "Incident", soortZin: "zin" }, "kop"), { kop: "Kop", type: { soort: "incident", zin: "zin" } });
  assert.equal(g.valideerMelding({ kop: "Kop", soort: "ramp" }, "kop").type, null);
  assert.equal(g.valideerMelding({ soort: "overig" }, "kop"), null);
});

test("batches: kop heeft een eigen batch naast volledig en analyse", () => {
  const items = [{ id: "a", modus: "kop" }, { id: "b", modus: "volledig" }, { id: "c", modus: "kop" }, { id: "d", modus: "analyse" }];
  const b = g.maakBatches(items, 6);
  assert.deepEqual(b.map((x) => [x.modus, x.items.length]), [["kop", 2], ["volledig", 1], ["analyse", 1]]);
});

test("verwerkMelding (kop): de kop komt van de AI, de rest van het bericht blijft, het soort wordt gecontroleerd", () => {
  const plan = wire.planBerichten({ vensterBerichten: [bron()], nu }).nieuwe[0];
  assert.equal(plan.record.controle, "geen-ai");
  const klaar = wire.verwerkMelding(plan, {
    melding: { kop: "Raad wil geld voor onderhoud van bruggen", type: { soort: "uitkomst", zin: "De raad vraagt het college om 500.000 euro vrij te maken" } },
  });
  assert.equal(klaar.kop, "Raad wil geld voor onderhoud van bruggen");
  assert.equal(klaar.ai, true);
  assert.equal(klaar.controle, "cijfers-ok");
  assert.deepEqual(klaar.persType.soort, "uitkomst");
  assert.equal(klaar.prio, plan.record.prio, "prio blijft zoals de scraper zette");
  assert.equal(klaar.rubriek, plan.record.rubriek);
  assert.equal(klaar.bronTitel, plan.record.bronTitel);
});

test("een bewijszin die niet in de bron staat maakt er overig van; overig heeft geen zin nodig", () => {
  assert.deepEqual(wire.controleerType({ soort: "incident", zin: "Er was een enorme explosie in de haven" }, MOTIE), { soort: "overig", afgekeurd: "incident" });
  assert.deepEqual(wire.controleerType({ soort: "incident", zin: "" }, MOTIE), { soort: "overig", afgekeurd: "incident" });
  assert.deepEqual(wire.controleerType({ soort: "overig", zin: "" }, MOTIE), { soort: "overig" });
  assert.equal(wire.controleerType(null, MOTIE), null);
  assert.equal(wire.controleerType({ soort: "geheim", zin: "De raad vraagt het college" }, MOTIE), null);
  const ok = wire.controleerType({ soort: "gepland", zin: "De raad vraagt het college om 500.000 euro vrij te maken" }, MOTIE);
  assert.equal(ok.soort, "gepland");
});

test("een getal in de kop dat niet in de bron staat wordt afgekeurd (ook in modus kop)", () => {
  const plan = wire.planBerichten({ vensterBerichten: [bron()], nu }).nieuwe[0];
  const klaar = wire.verwerkMelding(plan, { melding: { kop: "Raad wil 900.000 euro voor bruggen", type: null } });
  assert.equal(klaar.controle, "cijfers-afgekeurd");
  assert.equal(klaar.kop, plan.record.kop);
  assert.equal(klaar.persType, undefined);
});

test("volledig: het soort komt op het record; een AI-fout laat geen soort achter", () => {
  const plan = wire.planBerichten({ vensterBerichten: [bron({ bronId: "bekendmakingen", geenAi: false, url: "https://v.nl/3" })], nu }).nieuwe[0];
  const klaar = wire.verwerkMelding(plan, {
    melding: { kop: "Raad wil geld voor bruggen", prio: 3, tag: "GEM", checklist: { gevaar: false }, agendapunten: [], type: { soort: "gepland", zin: "De raad vraagt het college om 500.000 euro vrij te maken" } },
  });
  assert.equal(klaar.persType.soort, "gepland");
  assert.equal(wire.verwerkMelding(plan, { fout: "kapot" }).persType, undefined);
});

test("een bestaand bericht zonder AI (geen-ai) komt alsnog in aanmerking voor een kop; een bericht met kop niet", () => {
  const plan = wire.planBerichten({ vensterBerichten: [bron()], nu }).nieuwe[0];
  const bestaand = [plan.record];
  const weer = wire.planBerichten({ vensterBerichten: [bron()], bestaand, nu });
  assert.equal(weer.nieuwe.length, 1, "opnieuw in de wachtrij voor de AI");
  assert.equal(weer.nieuwe[0].invoer.modus, "kop");
  const klaar = wire.verwerkMelding(plan, { melding: { kop: "Raad wil geld voor bruggen", type: null } });
  const daarna = wire.planBerichten({ vensterBerichten: [bron()], bestaand: [klaar], nu });
  assert.equal(daarna.nieuwe.length, 0);
});

test("schrijfMeldingen (kop) maakt een kop en soort via een nepverzoek", async () => {
  global.fetch = async () =>
    geminiAntwoord({ resultaten: [{ nr: 1, kop: "Raad wil geld voor bruggen", soort: "overig", soortZin: "" }] });
  const res = await g.schrijfMeldingen([{ id: "x", modus: "kop", titel: "Motie", tekst: MOTIE, bronNaam: "B", gepubliceerdOp: "2026-11-19" }], "sleutel", 1);
  assert.equal(res.get("x").melding.kop, "Raad wil geld voor bruggen");
  assert.deepEqual(res.get("x").melding.type, { soort: "overig", zin: "" });
});
