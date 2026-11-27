// Tests voor de AI-kant van de agenda-stap (ai/agenda-ai.js): batches op tekenbudget zonder
// afkappen, de prompt, en het wachten en de terugval bij een storing. Geen echt netwerk.
process.env.ZANP_AI_PAUZE_MS = "0"; // geen echte pauzes in de tests
process.env.ZANP_MODELLEN_LICHT = "gemini-flash-lite-latest"; // één model; de reeks met reserves staat in gemini-ketens.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { geminiAntwoord } = require("./helpers");
const g = require("../ai/gemini");
const a = require("../ai/agenda-ai");

const origineleFetch = global.fetch;
test.afterEach(() => {
  global.fetch = origineleFetch;
  g.resetModelStaat();
});

const fout = (status, bericht = "The model is overloaded.") => ({ ok: false, status, json: async () => ({ error: { message: bericht } }) });
const maak = (n, tekens = 50) => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, titel: `Titel ${i}`, tekst: "x".repeat(tekens), bronNaam: "Bron", publicatieDag: "2027-01-05" }));
const aantalBronnen = (opties) => (JSON.parse(opties.body).contents[0].parts[0].text.match(/^BRON \d+:/gm) || []).length;
const punt = { titel: "Open dag", datumTekst: "zaterdag 9 januari", tijd: null, eindtijd: null, plaats: null };

test("batches: hooguit vijf berichten per verzoek", () => {
  assert.deepEqual(a.maakAgendaBatches(maak(7)).map((b) => b.length), [5, 2]);
});

test("batches: een bericht dat het tekenbudget overschrijdt krijgt een eigen verzoek en wordt niet afgekapt", () => {
  const items = [maak(1, 100)[0], { ...maak(1)[0], id: "groot", tekst: "y".repeat(200000) }, { ...maak(1)[0], id: "klein", tekst: "z" }];
  const batches = a.maakAgendaBatches(items);
  assert.deepEqual(batches.map((b) => b.map((i) => i.id)), [["b0"], ["groot"], ["klein"]]);
  assert.equal(batches[1][0].tekst.length, 200000);
});

test("de prompt bevat de volledige tekst, de rundag met weekdag en de aanwijzingen van de code", () => {
  const lang = "z".repeat(50000);
  const prompt = a.bouwAgendaPrompt(
    [{ titel: "Open dag", tekst: `${lang} EINDE-VAN-DE-TEKST`, bronNaam: "Bron", publicatieDag: "2027-01-05", signalen: ["zaterdag 9 januari"] }],
    { rundag: "2027-01-05" }
  );
  assert.ok(prompt.includes("EINDE-VAN-DE-TEKST"), "niets wordt afgekapt");
  assert.ok(prompt.includes("dinsdag 2027-01-05"));
  assert.ok(prompt.includes("zaterdag 9 januari"));
  assert.match(prompt, /^BRON 1:/m);
});

test("de AI-uitvoer wordt per bericht teruggegeven en het verzoek telt", async () => {
  global.fetch = async (_u, o) =>
    geminiAntwoord({ resultaten: Array.from({ length: aantalBronnen(o) }, (_, i) => ({ nr: i + 1, agendapunten: i === 0 ? [punt] : [] })) });
  const uit = await a.signaleerAgendapunten(maak(3), "sleutel", 5, { rundag: "2027-01-05", wachtMs: 0 });
  assert.equal(uit.verzoeken, 1);
  assert.equal(uit.quotum, false);
  assert.equal(uit.get("b0").agendapunten.length, 1);
  assert.deepEqual(uit.get("b1").agendapunten, []);
  assert.deepEqual(uit.get("b2").agendapunten, []);
});

test("een ontbrekend of onvolledig antwoord voor één bericht is een fout voor alleen dat bericht", async () => {
  global.fetch = async () => geminiAntwoord({ resultaten: [{ nr: 1, agendapunten: [punt] }, { nr: 3 }] });
  const uit = await a.signaleerAgendapunten(maak(3), "sleutel", 5, { rundag: "2027-01-05", wachtMs: 0 });
  assert.equal(uit.get("b0").agendapunten.length, 1);
  assert.match(uit.get("b1").fout, /ontbreekt/);
  assert.match(uit.get("b2").fout, /onvolledig/);
});

test("bij een storing wacht de stap en probeert de hele keten nog een keer", async () => {
  let aanroepen = 0;
  global.fetch = async (_u, o) => {
    aanroepen++;
    if (aanroepen <= 3) return fout(503); // de eerste ronde: drie pogingen
    return geminiAntwoord({ resultaten: [{ nr: 1, agendapunten: [punt] }] });
  };
  const uit = await a.signaleerAgendapunten(maak(1), "sleutel", 5, { rundag: "2027-01-05", wachtMs: 0 });
  assert.equal(aanroepen, 4);
  assert.equal(uit.get("b0").agendapunten.length, 1);
});

test("blijft het kapot, dan krijgt het bericht een fout en gaan er geen nieuwe verzoeken meer uit", async () => {
  let aanroepen = 0;
  global.fetch = async () => { aanroepen++; return fout(503); };
  const uit = await a.signaleerAgendapunten(maak(7), "sleutel", 5, { rundag: "2027-01-05", wachtMs: 0 });
  assert.equal(aanroepen, 6, "twee rondes van drie pogingen, voor de eerste batch alleen");
  assert.match(uit.get("b0").fout, /503/);
  assert.match(uit.get("b6").fout, /^overgeslagen/, "de tweede batch is niet eens gestart");
});

test("een 429 wacht niet, meldt het quotum en laat de rest staan", async () => {
  let aanroepen = 0;
  global.fetch = async () => { aanroepen++; return fout(429, "Quota exceeded for the free tier, limit 500, per day."); };
  const uit = await a.signaleerAgendapunten(maak(2), "sleutel", 5, { rundag: "2027-01-05", wachtMs: 0 });
  assert.equal(aanroepen, 1);
  assert.equal(uit.quotum, true);
  assert.match(uit.quotumTekst, /429/);
  assert.equal(uit.get("b0").status, 429);
});

test("de cap begrenst het aantal verzoeken; de rest blijft staan zonder poging", async () => {
  global.fetch = async (_u, o) => geminiAntwoord({ resultaten: Array.from({ length: aantalBronnen(o) }, (_, i) => ({ nr: i + 1, agendapunten: [] })) });
  const uit = await a.signaleerAgendapunten(maak(6), "sleutel", 1, { rundag: "2027-01-05", wachtMs: 0 });
  assert.equal(uit.verzoeken, 1);
  assert.deepEqual(uit.get("b4").agendapunten, []);
  assert.match(uit.get("b5").fout, /^overgeslagen/);
});
