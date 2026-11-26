// Tests voor de modelketens van ZANP (22 nov 2026):
//  - elke klasse (licht, zwaar) heeft een eerste keus en reserves; is een model vol of kapot,
//    dan volgt het volgende
//  - de teller en de wachttijd gelden per model en blijven bewaard tussen runs
//  - een model dat Google niet kent, valt weg
//  - zijn alle modellen vol, dan komt er een 429 met een wachttijd die zanp.js kan lezen
//  - een aanroep wacht niet eeuwig
// Geen echt netwerk: fetch wordt vervangen.
process.env.ZANP_AI_PAUZE_MS = "0"; // geen echte pauzes
const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("../ai/gemini");
const { wachtTotNaQuotum } = require("../zanp");

const origineleFetch = global.fetch;
test.afterEach(() => {
  global.fetch = origineleFetch;
  delete process.env.ZANP_CAP_LICHT;
  delete process.env.ZANP_CAP_ZWAAR;
  delete process.env.ZANP_MODELLEN_LICHT;
  delete process.env.ZANP_MODELLEN_ZWAAR;
  delete process.env.ZANP_AI_TIMEOUT_MS;
  g.resetModelStaat();
});

const [LICHT1, LICHT2, LICHT3] = g.MODELLEN.licht;
const [ZWAAR1, ZWAAR2, ZWAAR3] = g.MODELLEN.zwaar;

const modelUit = (url) => String(url).match(/models\/([^:/]+):generateContent/)[1];
const goed = (obj = { ok: true }, modelVersion = "versie-1") => ({
  ok: true,
  status: 200,
  json: async () => ({ modelVersion, candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }),
});
const fout = (status, bericht) => ({ ok: false, status, json: async () => ({ error: { message: bericht } }) });

/** Een nep-Google: per model een functie of een vast antwoord. Houdt bij welke modellen gebeld zijn. */
function nepGoogle(perModel) {
  const gebeld = [];
  const bodies = [];
  global.fetch = async (url, opties) => {
    const model = modelUit(url);
    gebeld.push(model);
    bodies.push(JSON.parse(opties.body));
    const x = perModel[model];
    if (x === undefined) throw new Error(`onverwachte aanroep van ${model}`);
    return typeof x === "function" ? x() : x;
  };
  return { gebeld, bodies };
}

test("de lichte keten is de standaard en geeft het model en de modelversie terug", async () => {
  const google = nepGoogle({ [LICHT1]: goed({ a: 1 }, "3.5-flash-lite-001") });
  const r = await g.roepGeminiWire("prompt", "sleutel");
  assert.deepEqual(r.data, { a: 1 });
  assert.equal(r.model, LICHT1);
  assert.equal(r.modelVersie, "3.5-flash-lite-001");
  assert.equal(r.klasse, "licht");
  assert.equal(r.verzoeken, 1);
  assert.deepEqual(google.gebeld, [LICHT1]);
});

test("een 429 op het eerste model: het tweede antwoordt, en het eerste wordt daarna overgeslagen", async () => {
  const google = nepGoogle({
    [LICHT1]: fout(429, "You exceeded your current quota (per day). retry in 20s"),
    [LICHT2]: goed(),
  });
  const r = await g.roepGeminiWire("prompt", "sleutel");
  assert.equal(r.model, LICHT2);
  assert.equal(r.verzoeken, 1, "de 429 telt niet mee, het beantwoorde verzoek wel");
  assert.deepEqual(google.gebeld, [LICHT1, LICHT2]);

  const staat = g.geefModelStaat().modellen;
  assert.ok(staat[LICHT1].wachtTot, "het eerste model krijgt een wachttijd");
  assert.equal(staat[LICHT1].gebruikt, 0);
  assert.equal(staat[LICHT2].gebruikt, 1);

  await g.roepGeminiWire("nog een", "sleutel");
  assert.deepEqual(google.gebeld, [LICHT1, LICHT2, LICHT2], "het volgende verzoek begint meteen bij het tweede model");
});

test("een model dat de dagcap haalt, wordt overgeslagen", async () => {
  process.env.ZANP_CAP_LICHT = "1";
  const google = nepGoogle({ [LICHT1]: goed(), [LICHT2]: goed() });
  assert.equal((await g.roepGeminiWire("a", "sleutel")).model, LICHT1);
  assert.equal((await g.roepGeminiWire("b", "sleutel")).model, LICHT2, "het eerste model zit op de cap");
  assert.deepEqual(google.gebeld, [LICHT1, LICHT2]);
});

test("alle modellen vol: een 429 die zanp.js kan lezen, en daarna geen enkele aanroep meer", async () => {
  const google = nepGoogle({
    [LICHT1]: fout(429, "Quota exceeded. Please retry in 30s."),
    [LICHT2]: fout(429, "Quota exceeded. Please retry in 30s."),
    [LICHT3]: fout(429, "Quota exceeded. Please retry in 30s."),
  });
  await assert.rejects(g.roepGeminiWire("prompt", "sleutel"), (f) => {
    assert.equal(f.status, 429);
    assert.equal(f.verzoeken, 0);
    return true;
  });
  assert.equal(google.gebeld.length, 3);

  // Tweede poging: alle drie wachten nog. Er mag niets naar Google gaan.
  const nu = new Date();
  await assert.rejects(g.roepGeminiWire("prompt", "sleutel"), (f) => {
    assert.equal(f.status, 429);
    const tot = new Date(wachtTotNaQuotum(f.message, nu));
    assert.ok(tot > nu, `de wachttijd (${f.message}) moet in de toekomst liggen`);
    return true;
  });
  assert.equal(google.gebeld.length, 3, "geen nieuwe aanroepen");
});

test("klasse zwaar gebruikt de Flash-reeks en geeft het antwoord genoeg ruimte", async () => {
  const google = nepGoogle({ [ZWAAR1]: goed() });
  const r = await g.roepGeminiWire("prompt", "sleutel", 2048, { klasse: "zwaar" });
  assert.equal(r.model, ZWAAR1);
  assert.equal(r.klasse, "zwaar");
  assert.ok(google.bodies[0].generationConfig.maxOutputTokens >= 16384, "Flash denkt eerst, dus meer uitvoerruimte");
  assert.deepEqual(google.gebeld, [ZWAAR1]);
});

test("klasse licht houdt de gevraagde uitvoerlimiet", async () => {
  const google = nepGoogle({ [LICHT1]: goed() });
  await g.roepGeminiWire("prompt", "sleutel", 2048);
  assert.equal(google.bodies[0].generationConfig.maxOutputTokens, 2048);
});

test("zwaar: elke reserve volgt op de vorige", async () => {
  const google = nepGoogle({
    [ZWAAR1]: fout(429, "quota (per day)"),
    [ZWAAR2]: fout(429, "quota (per day)"),
    [ZWAAR3]: goed({ derde: true }),
  });
  const r = await g.roepGeminiWire("prompt", "sleutel", 2048, { klasse: "zwaar" });
  assert.equal(r.model, ZWAAR3);
  assert.deepEqual(google.gebeld, [ZWAAR1, ZWAAR2, ZWAAR3]);
});

test("terugval: is zwaar helemaal vol, dan antwoordt het lichte model", async () => {
  const google = nepGoogle({
    [ZWAAR1]: fout(429, "quota (per day)"),
    [ZWAAR2]: fout(429, "quota (per day)"),
    [ZWAAR3]: fout(429, "quota (per day)"),
    [LICHT1]: goed({ licht: true }),
  });
  const r = await g.roepGeminiWire("prompt", "sleutel", 2048, { klasse: "zwaar", terugval: "licht" });
  assert.equal(r.klasse, "licht");
  assert.equal(r.model, LICHT1);
  assert.deepEqual(google.gebeld, [ZWAAR1, ZWAAR2, ZWAAR3, LICHT1]);
});

test("zonder terugval komt zwaar nooit bij het lichte model", async () => {
  const google = nepGoogle({
    [ZWAAR1]: fout(429, "quota (per day)"),
    [ZWAAR2]: fout(429, "quota (per day)"),
    [ZWAAR3]: fout(429, "quota (per day)"),
  });
  await assert.rejects(g.roepGeminiWire("prompt", "sleutel", 2048, { klasse: "zwaar" }), (f) => f.status === 429);
  assert.ok(!google.gebeld.includes(LICHT1));
});

test("een aanhoudende 503 op het eerste model: het tweede model neemt het over", async () => {
  const google = nepGoogle({ [LICHT1]: fout(503, "The model is overloaded."), [LICHT2]: goed() });
  const r = await g.roepGeminiWire("prompt", "sleutel");
  assert.equal(r.model, LICHT2);
  assert.equal(google.gebeld.filter((m) => m === LICHT1).length, 3, "eerst drie pogingen op het eerste model");
});

test("een model dat niet binnen de tijdslimiet antwoordt, wordt overgeslagen", async () => {
  process.env.ZANP_AI_TIMEOUT_MS = "50";
  const google = nepGoogle({
    [LICHT1]: () => {
      const f = new Error("The operation was aborted due to timeout");
      f.name = "TimeoutError";
      throw f;
    },
    [LICHT2]: goed(),
  });
  const r = await g.roepGeminiWire("prompt", "sleutel");
  assert.equal(r.model, LICHT2);
  assert.deepEqual(google.gebeld, [LICHT1, LICHT2], "een time-out wordt niet opnieuw geprobeerd op hetzelfde model");
});

test("alle modellen falen zonder quotum: de fout is geen 429", async () => {
  nepGoogle({ [LICHT1]: fout(400, "ongeldig"), [LICHT2]: fout(400, "ongeldig"), [LICHT3]: fout(400, "ongeldig") });
  await assert.rejects(g.roepGeminiWire("prompt", "sleutel"), (f) => {
    assert.equal(f.status, 400);
    return true;
  });
});

test("ZANP_MODELLEN_LICHT en ZANP_MODELLEN_ZWAAR stellen de reeks in zonder code te wijzigen", async () => {
  process.env.ZANP_MODELLEN_ZWAAR = "mijn-model-a, mijn-model-b";
  const google = nepGoogle({ "mijn-model-a": fout(429, "quota (per day)"), "mijn-model-b": goed() });
  const r = await g.roepGeminiWire("prompt", "sleutel", 2048, { klasse: "zwaar" });
  assert.equal(r.model, "mijn-model-b");
  assert.deepEqual(google.gebeld, ["mijn-model-a", "mijn-model-b"]);
});

// ---------------------------------------------------------------------------
// Bewaren tussen runs
// ---------------------------------------------------------------------------

test("de staat per model blijft bewaard binnen een quotumdag", async () => {
  nepGoogle({ [LICHT1]: goed() });
  g.laadModelStaat(null, { dag: "2026-11-22" });
  await g.roepGeminiWire("a", "sleutel");
  await g.roepGeminiWire("b", "sleutel");
  const bewaard = g.geefModelStaat();
  assert.equal(bewaard.modellen[LICHT1].gebruikt, 2);

  g.laadModelStaat(bewaard, { dag: "2026-11-22" }); // volgende run, dezelfde dag
  assert.equal(g.geefModelStaat().modellen[LICHT1].gebruikt, 2);
});

test("een nieuwe quotumdag zet de tellers op nul, een lopende wachttijd blijft", () => {
  const nu = new Date("2026-11-23T10:00:00Z");
  const opgeslagen = {
    dag: "2026-11-22",
    modellen: {
      [LICHT1]: { gebruikt: 250, wachtTot: "2026-11-23T11:00:00Z" }, // loopt nog
      [LICHT2]: { gebruikt: 40, wachtTot: "2026-11-23T08:00:00Z" }, // verlopen
    },
  };
  g.laadModelStaat(opgeslagen, { dag: "2026-11-23", nu });
  const staat = g.geefModelStaat().modellen;
  assert.equal(staat[LICHT1].gebruikt, 0);
  assert.equal(staat[LICHT1].wachtTot, "2026-11-23T11:00:00Z");
  assert.equal(staat[LICHT2].gebruikt, 0);
  assert.equal(staat[LICHT2].wachtTot, null, "een verlopen wachttijd vervalt");
});

test("onleesbare opgeslagen staat geeft een lege staat, geen fout", () => {
  for (const kapot of [null, undefined, "tekst", 5, { modellen: "x" }, { modellen: { a: null } }]) {
    g.laadModelStaat(kapot, { dag: "2026-11-22" });
    assert.deepEqual(g.geefModelStaat().modellen, {});
  }
});

// ---------------------------------------------------------------------------
// Welke modellen bestaan er?
// ---------------------------------------------------------------------------

test("losOp: bestaande naam, versie-achtervoegsel, en niets gevonden", () => {
  const lijst = new Set(["gemini-flash-latest", "gemini-3.6-flash-preview-0915", "gemini-3.6-flash-lite-preview", "gemini-3.6-flash-image"]);
  assert.equal(g.losOp("gemini-flash-latest", lijst), "gemini-flash-latest");
  assert.equal(g.losOp("gemini-3.6-flash", lijst), "gemini-3.6-flash-preview-0915", "geen Lite- of afbeeldingsmodel");
  assert.equal(g.losOp("gemini-3.6-flash-lite", lijst), "gemini-3.6-flash-lite-preview");
  assert.equal(g.losOp("gemini-9-flash", lijst), null);
  assert.equal(g.losOp("gemini-flash-lite-latest", lijst), "gemini-flash-lite-latest", "een -latest-naam valt nooit weg");
  assert.equal(g.losOp("gemini-9-flash", null), "gemini-9-flash", "zonder lijst blijft de naam staan");
});

test("ontdekModellen: een naam die Google niet kent valt weg, een bijna-naam wordt gevonden", async () => {
  global.fetch = async (url) => {
    if (String(url).includes("generateContent")) return goed({ ok: true });
    return {
      ok: true,
      json: async () => ({
        models: [
          { name: `models/${LICHT1}`, supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-3.1-flash-lite-preview-0301", supportedGenerationMethods: ["generateContent"] },
          { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
          { name: "models/gemini-flash-latest", supportedGenerationMethods: ["generateContent"] },
        ],
      }),
    };
  };
  const ontdekt = await g.ontdekModellen("sleutel");
  assert.equal(ontdekt.aantal, 3, "een model zonder generateContent telt niet");

  const gebeld = [];
  global.fetch = async (url) => {
    gebeld.push(modelUit(url));
    return fout(429, "quota (per day)");
  };
  await assert.rejects(g.roepGeminiWire("prompt", "sleutel"));
  assert.deepEqual(gebeld, [LICHT1, "gemini-3.1-flash-lite-preview-0301"], "2.5 Flash-Lite bestaat niet en wordt overgeslagen");
});

test("ontdekModellen: een veel te kleine lijst wordt genegeerd", async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({ models: [{ name: "models/iets", supportedGenerationMethods: ["generateContent"] }] }) });
  assert.equal(await g.ontdekModellen("sleutel"), null);
  const google = nepGoogle({ [LICHT1]: goed() });
  assert.equal((await g.roepGeminiWire("prompt", "sleutel")).model, LICHT1);
  assert.deepEqual(google.gebeld, [LICHT1]);
});

test("ontdekModellen: mislukt het, dan werken de namen zoals ze staan", async () => {
  global.fetch = async () => {
    throw new Error("netwerk weg");
  };
  assert.equal(await g.ontdekModellen("sleutel"), null);
  const google = nepGoogle({ [LICHT1]: goed() });
  assert.equal((await g.roepGeminiWire("prompt", "sleutel")).model, LICHT1);
  assert.deepEqual(google.gebeld, [LICHT1]);
});

test("meer tekst per bericht: een batch geeft tot 6.000 tekens brontekst mee", () => {
  assert.equal(g.BATCH_TEKENS_PER_ITEM, 6000);
  const prompt = g.bouwMeldingBatchPrompt(
    [{ id: "a", modus: "volledig", titel: "T", tekst: "x".repeat(9000), bronNaam: "B", gepubliceerdOp: "2026-11-22" }],
    "volledig",
    []
  );
  const xen = (prompt.match(/x/g) || []).length;
  assert.ok(xen >= 5900 && xen <= 6100, `verwacht ongeveer 6000 tekens, kreeg ${xen}`);
});

test("dubbel nieuws: 1.500 tekens per artikel", () => {
  const prompt = g.bouwZelfdeBatchPrompt([{ sleutel: "s", a: { titel: "A", bronNaam: "X", tekst: "y".repeat(3000) }, b: { titel: "B", bronNaam: "Y", tekst: "z".repeat(3000) } }]);
  assert.equal((prompt.match(/y/g) || []).length >= 1500 && (prompt.match(/y/g) || []).length < 1600, true);
  assert.equal((prompt.match(/z/g) || []).length >= 1500 && (prompt.match(/z/g) || []).length < 1600, true);
});
