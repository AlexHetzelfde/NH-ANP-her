// De AI als hulp bij het indelen van losse stukken in verhalen (prioriteit/verhaal-ai.js): de AI geeft
// alleen een nummer; de code controleert het, bewaart het en telt zelf.
const test = require("node:test");
const assert = require("node:assert/strict");
const { maakAiVerhaal, leesAntwoorden, bouwVerhaalPrompt } = require("../signalering/prioriteit/verhaal-ai");

const losse = [
  { k: "b:1", titel: "Vuur aan de Hoogstraat", bron: "rodi-zaanstad", datum: "2026-11-18T10:00:00Z", kern: "" },
  { k: "b:2", titel: "Boze buurt na schandaal", bron: "zaanstad-nieuws", datum: "2026-11-18T11:00:00Z", kern: "" },
  { k: "b:3", titel: "Nog een bericht", bron: "zaanstad-nieuws", datum: "2026-11-18T11:30:00Z", kern: "" },
];
const lopende = [{ id: "n:brand", titel: "Brand in loods", stukken: [{ titel: "Brand in loods Krommenie", bron: "veiligheidsregio-nieuws", datum: "2026-11-18T08:00:00Z" }] }];
const stil = { log() {}, warn() {}, error() {} };

test("de prompt noemt alle losse stukken en lopende verhalen en vraagt om zekerheid", () => {
  const p = bouwVerhaalPrompt({ losse, lopende });
  assert.ok(p.includes("V1:") && p.includes("L3:") && p.includes("Twijfel je, antwoord dan null"));
});

test("leesAntwoorden: alleen bestaande nummers tellen, een stuk kan niet bij zichzelf horen", () => {
  const m = leesAntwoorden({ antwoorden: [{ nr: 1, bij: "V1" }, { nr: 2, bij: "V9" }, { nr: 3, bij: "L3" }, { nr: 9, bij: "V1" }, { nr: 1, bij: null }] }, 3, 1);
  assert.equal(m.get(1), "V1");
  assert.equal(m.get(2), null, "V9 bestaat niet");
  assert.equal(m.get(3), null, "L3 is het stuk zelf");
  assert.equal(m.has(9), false);
});

test("aiVerhaal geeft de verwijzingen terug als echte sleutels, ook 'nee' (zodat het niet opnieuw wordt gevraagd)", async () => {
  const roep = async () => ({ data: { antwoorden: [{ nr: 1, bij: "V1" }, { nr: 2, bij: "L1" }, { nr: 3, bij: null }] }, verzoeken: 1 });
  let geteld = 0;
  const f = maakAiVerhaal({ roep, apiKey: "k", ruimte: 5, telVerzoeken: (n) => (geteld += n), log: stil });
  const uit = await f({ losse, lopende }, { maxVerzoeken: 2, perVerzoek: 12 });
  assert.deepEqual(uit.get("b:1"), { met: "n:brand" });
  assert.deepEqual(uit.get("b:2"), { met: "b:1" });
  assert.deepEqual(uit.get("b:3"), { met: null });
  assert.equal(geteld, 1);
});

test("een stuk zonder antwoord komt niet in de uitkomst (een volgende run vraagt opnieuw)", async () => {
  const roep = async () => ({ data: { antwoorden: [{ nr: 1, bij: "V1" }] }, verzoeken: 1 });
  const uit = await maakAiVerhaal({ roep, apiKey: "k", ruimte: 5, log: stil })({ losse, lopende });
  assert.equal(uit.has("b:2"), false);
});

test("quotum: bij een 429 stopt het en blijft het stil; zonder ruimte gebeurt er niets", async () => {
  let quotum = null;
  const fout = Object.assign(new Error("quota"), { status: 429, verzoeken: 0 });
  const uit = await maakAiVerhaal({ roep: async () => { throw fout; }, apiKey: "k", ruimte: 5, bijQuotum: (t) => (quotum = t), log: stil })({ losse, lopende });
  assert.equal(uit.size, 0);
  assert.equal(quotum, "quota");
  let aangeroepen = 0;
  await maakAiVerhaal({ roep: async () => { aangeroepen++; return { data: {}, verzoeken: 1 }; }, apiKey: "k", ruimte: 0, log: stil })({ losse, lopende });
  assert.equal(aangeroepen, 0);
});

test("een AI-fout laat de stukken los en gooit niets", async () => {
  const uit = await maakAiVerhaal({ roep: async () => { throw new Error("kapot"); }, apiKey: "k", ruimte: 5, log: stil })({ losse, lopende });
  assert.equal(uit.size, 0);
});
