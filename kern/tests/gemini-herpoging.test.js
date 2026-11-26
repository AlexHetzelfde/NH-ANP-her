// Tests voor de herpogingen bij tijdelijke Google-fouten (19 nov 2026):
//  - HTTP 500/502/503/504 wordt tot twee keer opnieuw geprobeerd, met een pauze
//  - een 429, een 400 en een netwerkfout worden NIET opnieuw geprobeerd
//  - een mislukte poging telt niet mee voor het dagquotum
//  - blijft Google overbelast, dan starten er in die run geen nieuwe verzoeken meer
// Geen echt netwerk: fetch wordt vervangen.
process.env.ZANP_AI_PAUZE_MS = "0"; // geen echte pauzes in de tests
process.env.ZANP_MODELLEN_LICHT = "gemini-flash-lite-latest"; // deze tests gaan over één model; de reeks met reserves wordt getest in gemini-ketens.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { geminiAntwoord } = require("./helpers");
const g = require("../ai/gemini");

const origineleFetch = global.fetch;
test.afterEach(() => {
  global.fetch = origineleFetch;
  process.env.ZANP_AI_PAUZE_MS = "0";
  g.resetModelStaat(); // de teller en wachttijd per model horen bij één run
});

const fout = (status, bericht = "The model is overloaded.") => ({
  ok: false,
  status,
  json: async () => ({ error: { message: bericht } }),
});
const maak = (n, modus = "volledig") =>
  Array.from({ length: n }, (_, i) => ({ id: `${modus}${i}`, modus, titel: `Titel ${i}`, tekst: "x".repeat(100), bronNaam: "B", gepubliceerdOp: "2026-10-29" }));
const goed = { kop: "kop", prio: 3, tag: "GEM", checklist: { gevaar: false }, agendapunten: [] };
function antwoordVoorBatch(_url, opties) {
  const prompt = JSON.parse(opties.body).contents[0].parts[0].text;
  const n = (prompt.match(/^BRON \d+:/gm) || []).length;
  return geminiAntwoord({ resultaten: Array.from({ length: n }, (_, i) => ({ nr: i + 1, ...goed })) });
}

test("de statussen en aantallen staan vast", () => {
  assert.deepEqual([...g.HERPOGING_STATUSSEN], [500, 502, 503, 504]);
  assert.equal(g.HERPOGINGEN, 2);
  assert.equal(g.OVERBELAST_STOP, 2);
  assert.equal(g.isTijdelijkeFout({ status: 503 }), true);
  assert.equal(g.isTijdelijkeFout({ status: 429 }), false);
  assert.equal(g.isTijdelijkeFout({ status: 400 }), false);
  assert.equal(g.isTijdelijkeFout(new Error("fetch failed")), false);
});

test("een 503 gevolgd door een goed antwoord lukt bij de tweede poging", async () => {
  let aanroepen = 0;
  global.fetch = async () => (++aanroepen === 1 ? fout(503) : geminiAntwoord({ ok: true }));
  const r = await g.roepGeminiWire("prompt", "sleutel");
  assert.equal(aanroepen, 2);
  assert.deepEqual(r.data, { ok: true });
  assert.equal(r.verzoeken, 1, "alleen het beantwoorde verzoek telt voor het quotum");
});

test("twee keer een 503 en dan goed: derde poging", async () => {
  let aanroepen = 0;
  global.fetch = async () => (++aanroepen <= 2 ? fout(503) : geminiAntwoord({ ok: true }));
  const r = await g.roepGeminiWire("prompt", "sleutel");
  assert.equal(aanroepen, 3);
  assert.equal(r.verzoeken, 1);
});

test("blijft het een 503: drie aanroepen, dan een fout met dezelfde melding en zonder verzoeken", async () => {
  let aanroepen = 0;
  global.fetch = async () => { aanroepen++; return fout(503); };
  await assert.rejects(
    () => g.roepGeminiWire("prompt", "sleutel"),
    (f) => {
      assert.equal(f.status, 503);
      assert.equal(f.tijdelijk, true);
      assert.equal(f.verzoeken, 0, "een HTTP-fout telt niet voor het quotum");
      assert.match(f.message, /^HTTP 503: The model is overloaded/);
      return true;
    }
  );
  assert.equal(aanroepen, 3);
});

test("ook 500, 502 en 504 worden opnieuw geprobeerd", async () => {
  for (const status of [500, 502, 504]) {
    let aanroepen = 0;
    global.fetch = async () => (++aanroepen === 1 ? fout(status, "storing") : geminiAntwoord({ ok: true }));
    const r = await g.roepGeminiWire("prompt", "sleutel");
    assert.equal(aanroepen, 2, `status ${status}`);
    assert.equal(r.verzoeken, 1);
  }
});

test("een 429 wordt niet opnieuw geprobeerd", async () => {
  let aanroepen = 0;
  global.fetch = async () => { aanroepen++; return fout(429, "quota per day"); };
  await assert.rejects(
    () => g.roepGeminiWire("prompt", "sleutel"),
    (f) => f.status === 429 && !f.tijdelijk
  );
  assert.equal(aanroepen, 1);
});

test("een 400 en een netwerkfout worden niet opnieuw geprobeerd", async () => {
  let aanroepen = 0;
  global.fetch = async () => { aanroepen++; return fout(400, "ongeldig verzoek"); };
  await assert.rejects(() => g.roepGeminiWire("prompt", "sleutel"), (f) => f.status === 400 && !f.tijdelijk);
  assert.equal(aanroepen, 1);

  aanroepen = 0;
  global.fetch = async () => { aanroepen++; throw new Error("fetch failed"); };
  await assert.rejects(() => g.roepGeminiWire("prompt", "sleutel"), (f) => /fetch failed/.test(f.message) && !f.tijdelijk);
  assert.equal(aanroepen, 1);
});

test("een leeg antwoord of ongeldige JSON wordt niet opnieuw geprobeerd", async () => {
  let aanroepen = 0;
  global.fetch = async () => { aanroepen++; return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [] }, finishReason: "STOP" }] }) }; };
  await assert.rejects(() => g.roepGeminiWire("prompt", "sleutel"), /leeg antwoord/);
  assert.equal(aanroepen, 1);
});

test("de pauze loopt op: 3 x de basis bij de tweede herpoging", async () => {
  process.env.ZANP_AI_PAUZE_MS = "20"; // pauzes van 20 en 60 ms
  global.fetch = async () => fout(503);
  const begin = Date.now();
  await assert.rejects(() => g.roepGeminiWire("prompt", "sleutel"), (f) => f.tijdelijk === true);
  const duur = Date.now() - begin;
  assert.ok(duur >= 70, `er hoort minstens 80 ms pauze in te zitten, het duurde ${duur} ms`);
});

test("schrijfMeldingen: één mislukte batch herstelt zich, alle berichten krijgen een melding", async () => {
  let aanroepen = 0;
  global.fetch = async (u, o) => (++aanroepen === 1 ? fout(503) : antwoordVoorBatch(u, o));
  const r = await g.schrijfMeldingen(maak(12), "sleutel", 10);
  assert.equal([...r.values()].filter((x) => x.melding).length, 12);
  assert.equal(r.verzoeken, 2, "twee batches, de mislukte poging telt niet");
});

test("schrijfMeldingen: blijft Google overbelast, dan stoppen de nieuwe verzoeken na twee mislukte batches", async () => {
  let aanroepen = 0;
  global.fetch = async () => { aanroepen++; return fout(503); };
  const r = await g.schrijfMeldingen(maak(60), "sleutel", 20); // 10 batches van 6
  // Eerste ronde: 3 batches tegelijk x 3 aanroepen. Daarna geen nieuwe ronde meer.
  assert.equal(aanroepen, 9, `er waren ${aanroepen} aanroepen`);
  assert.equal(r.verzoeken, 0);
  const waarden = [...r.values()];
  assert.equal(waarden.length, 60);
  assert.equal(waarden.filter((x) => x.status === 503).length, 18, "18 berichten kregen de echte 503-fout");
  const overgeslagen = waarden.filter((x) => /^overgeslagen \(Gemini overbelast/.test(x.fout || ""));
  assert.equal(overgeslagen.length, 42, "de rest is overgeslagen en komt bij de volgende run opnieuw");
});

test("schrijfMeldingen: een mislukte batch tussen geslaagde batches stopt de run niet", async () => {
  // 6 batches: de eerste (Titel 0) en de vierde (Titel 18) mislukken, de rest lukt.
  // Er zit steeds een geslaagde batch tussen, dus er zijn nooit twee mislukkingen achter elkaar.
  global.fetch = async (u, o) => {
    const prompt = JSON.parse(o.body).contents[0].parts[0].text;
    return /Titel (0|18)\b/.test(prompt) ? fout(503) : antwoordVoorBatch(u, o);
  };
  const r = await g.schrijfMeldingen(maak(36), "sleutel", 20);
  const waarden = [...r.values()];
  assert.equal(waarden.filter((x) => x.melding).length, 24, "vier batches slagen");
  assert.equal(waarden.filter((x) => x.status === 503).length, 12, "twee batches kregen de 503");
  assert.equal(waarden.filter((x) => /overbelast/.test(x.fout || "")).length, 0, "er is niets als 'overbelast' overgeslagen");
  assert.equal(r.verzoeken, 4);
});

test("dubbel nieuws: bij aanhoudende overbelasting stopt het na twee mislukte groepen en blijft het null", async () => {
  let aanroepen = 0;
  global.fetch = async () => { aanroepen++; return fout(503); };
  const paren = Array.from({ length: 100 }, (_, i) => ({ sleutel: `s${i}`, a: { titel: "a" }, b: { titel: "b" } }));
  const z = await g.beslisZelfdeNieuwsfeit(paren, "sleutel", 10); // 10 groepen van 10
  assert.equal(aanroepen, 9, `er waren ${aanroepen} aanroepen`);
  assert.equal(z.verzoeken, 0);
  assert.equal([...z.values()].filter((v) => v === null).length, 100);
  assert.equal(z.quotum, false, "overbelasting is geen quotum");
});
