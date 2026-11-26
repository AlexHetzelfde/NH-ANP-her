// ai/gemini.js
//
// Roept Gemini aan voor de nieuwsdienst (ZANP):
//   1. schrijfMeldingen — twee modi: "volledig" schrijft bij een officiële bron
//      of een persbericht een korte, feitelijke kop en kiest prio, tag,
//      checklist en agendapunten; "analyse" schrijft ook geen kop en haalt
//      alleen een tag, checklist en agendapunten uit de bron (artikelen van
//      andere redacties). Sinds 2026-11-11 schrijft de AI geen samenvatting
//      meer: de popup toont de volledige tekst uit het tekstarchief. Wie
//      volledig mag, bepaalt rubrieken.json. De uitvoer wordt in wire.js
//      gecontroleerd tegen de bron.
//   2. beslisZelfdeNieuwsfeit — voor dubbel nieuws, alleen bij twijfelgevallen.
//
// Sinds 2026-10-26:
//  - ZANP draait op gemini-flash-lite-latest (ruimer gratis quotum).
//  - Sinds 2026-11-19: een tijdelijke Google-fout (HTTP 500, 502, 503, 504) wordt in
//    roepGeminiWire tot twee keer opnieuw geprobeerd (na 3 s en 9 s); blijft Google
//    overbelast, dan stopt schrijfMeldingen na twee mislukte verzoeken achter elkaar.
//  - Stroomonderbreker: bij een 429 stopt schrijfMeldingen direct met
//    verdere batches, zodat we geen tijd en quota verspillen.
//
// Sinds 2026-10-29:
//  - ZANP werkt in batches: tot BATCH_GROOTTE berichten per verzoek, want het
//    quotum telt verzoeken. De cap van schrijfMeldingen en
//    beslisZelfdeNieuwsfeit is dus een aantal VERZOEKEN. Het resultaat heeft
//    een eigenschap "verzoeken" met het aantal beantwoorde verzoeken.
//  - De melding bevat ook een tag (kolom) uit een gesloten lijst.
//
// Sinds 2026-11-14 (regio Midden-Noord-Holland): de pitchmachine is uit de repo
// gehaald. Het criteria-filter, de pitchprompts (beoordeelBerichten,
// genereerPitches) en de bijbehorende modellen zijn hier verwijderd.

// Sinds 2026-11-19: elk nieuwsbericht krijgt een AI-kop. Berichten die tot nu toe nooit langs
// de AI gingen (moties, schriftelijke vragen, aanbestedingen) krijgen de modus "kop": alleen een
// kop en het soort bericht. Alle modi met een kop geven ook "soort" (incident, uitkomst,
// gepland of overig) met een zin uit de bron als bewijs; de routes naar rood
// (prioriteit/routes.js) gebruiken dat om een incident of een uitkomst te herkennen.
const PROMPT_VERSIE_WIRE = "2026-11-22-batch-tekst6000-kop-soort-tag-checklist-agendapunten";

const SOORTEN = Object.freeze(["incident", "uitkomst", "gepland", "overig"]);

// ZANP gebruikt twee klassen modellen, elk met een eerste keus en twee reserves (steeds
// iets minder goed). Is een model vol of kapot, dan pakt roepGeminiWire het volgende.
//   licht  koppen, tags, checklists, dubbel nieuws, verhalen indelen, dossiers
//          (Flash-Lite: ruim quotum, 500 verzoeken per dag per model)
//   zwaar  taken waar kwaliteit telt en die zelden voorkomen: de rode controle,
//          samengesteld nieuws, raadsverslagen (Flash: 20 verzoeken per dag per model)
// De namen met "-latest" bestaan zeker; de versies erachter zijn een gok die ontdekModellen()
// bij de start van een run controleert. Een naam die niet bestaat wordt overgeslagen.
// Aanpassen zonder code: de variabelen ZANP_MODELLEN_LICHT en ZANP_MODELLEN_ZWAAR
// (namen gescheiden door komma's) in de GitHub-instellingen.
const KETENS_STANDAARD = {
  licht: ["gemini-flash-lite-latest", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"],
  zwaar: ["gemini-flash-latest", "gemini-3.6-flash", "gemini-3-flash"],
};
const MODELLEN = {
  licht: [...KETENS_STANDAARD.licht],
  zwaar: [...KETENS_STANDAARD.zwaar],
  get wire() {
    return this.licht; // oude naam: ZANP draaide eerst alleen op Flash-Lite
  },
};

// Hoeveel verzoeken per dag we hoogstens aan één model vragen. De echte limieten (gratis
// account, 22 nov 2026): Flash-Lite 500, Flash 20, 2.5 Flash-Lite 20. We blijven eronder,
// zodat er ruimte is voor herhalingen en voor wat je zelf in AI Studio doet.
const CAP_STANDAARD = { licht: 300, zwaar: 15 };
const CAP_PER_MODEL = { "gemini-2.5-flash-lite": 15 };
const MIN_UITVOER_ZWAAR = 16384; // Flash-modellen "denken" eerst: ruimte voor het antwoord
const TIJDSLIMIET_MS = { licht: 90_000, zwaar: 180_000 };
const ZWAAR_PAUZE_MS = 13_000; // Flash: 5 verzoeken per minuut, dus ruim 12 seconden ertussen

const TEMPERATUUR_WIRE = 0.1; // feiten overnemen, niet fantaseren
const PARALLEL = 3;

function ketenVoor(klasse) {
  const ingesteld = process.env[`ZANP_MODELLEN_${String(klasse).toUpperCase()}`];
  if (ingesteld && ingesteld.trim()) return ingesteld.split(",").map((m) => m.trim()).filter(Boolean);
  return MODELLEN[klasse] || MODELLEN.licht;
}

function getalUitEnv(naam, standaard) {
  const v = process.env[naam];
  if (v === undefined || String(v).trim() === "") return standaard;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : standaard;
}

function capVoor(klasse, model) {
  const klasseCap = getalUitEnv(`ZANP_CAP_${String(klasse).toUpperCase()}`, CAP_STANDAARD[klasse] ?? CAP_STANDAARD.licht);
  return CAP_PER_MODEL[model] !== undefined ? Math.min(klasseCap, CAP_PER_MODEL[model]) : klasseCap;
}

// ---------------------------------------------------------------------------
// Teller en onderbreker per model
// ---------------------------------------------------------------------------
// Per model: hoeveel verzoeken vandaag beantwoord zijn en tot wanneer we het model
// overslaan (na een 429 of als de dagcap bereikt is). zanp.js laadt dit uit
// zanp-status.json bij de start van een run en bewaart het aan het eind.

let modelStaat = { dag: null, modellen: {} };
let wachtBerekening = (_tekst, nu) => new Date(nu.getTime() + 3600 * 1000).toISOString();
const laatsteAanroep = new Map();
let beschikbaarLijst = null; // Set met modelnamen die Google kent, of null als dat niet is nagegaan
const gemeldeOntbrekend = new Set();

function laadModelStaat(opgeslagen, { dag = null, nu = new Date(), wachtTotNaQuotum = null } = {}) {
  if (typeof wachtTotNaQuotum === "function") wachtBerekening = wachtTotNaQuotum;
  const oud = opgeslagen && typeof opgeslagen === "object" ? opgeslagen : {};
  const zelfdeDag = oud.dag != null && oud.dag === dag;
  modelStaat = { dag, modellen: {} };
  for (const [model, m] of Object.entries(oud.modellen || {})) {
    if (!m || typeof m !== "object") continue;
    const wachtTot = m.wachtTot && new Date(m.wachtTot) > nu ? m.wachtTot : null; // een wachttijd die loopt blijft gelden
    modelStaat.modellen[model] = { gebruikt: zelfdeDag ? Number(m.gebruikt) || 0 : 0, wachtTot };
  }
}

function geefModelStaat() {
  return JSON.parse(JSON.stringify(modelStaat));
}

function staatVan(model) {
  if (!modelStaat.modellen[model]) modelStaat.modellen[model] = { gebruikt: 0, wachtTot: null };
  return modelStaat.modellen[model];
}

/** Voor de tests: alles terug naar het begin. */
function resetModelStaat() {
  modelStaat = { dag: null, modellen: {} };
  laatsteAanroep.clear();
  beschikbaarLijst = null;
  gemeldeOntbrekend.clear();
}

/** "retry in 1h2m3s": zo leest wachtTotNaQuotum (zanp.js) een wachttijd. */
function wachtTekst(totIso, nu) {
  const sec = Math.max(1, Math.ceil((new Date(totIso).getTime() - nu.getTime()) / 1000));
  return `retry in ${Math.floor(sec / 3600)}h${Math.floor((sec % 3600) / 60)}m${sec % 60}s`;
}

// ---------------------------------------------------------------------------
// Welke modellen bestaan er? (één keer per run, alleen vanuit zanp.js)
// ---------------------------------------------------------------------------

const NIET_TEKSTMODEL = /(tts|image|live|audio|transcribe|embedding|robotics|computer|omni|lyria|genie)/;

/**
 * Zoekt voor een gewenste naam de echte naam. Bestaat de naam, dan is dat hem. Anders de
 * nieuwste naam die ermee begint ("gemini-3.6-flash" → "gemini-3.6-flash-preview-0915"),
 * zonder Lite-modellen als je om een gewoon model vraagt. Niets gevonden: null.
 */
function losOp(naam, beschikbaar) {
  if (!beschikbaar) return naam;
  if (beschikbaar.has(naam)) return naam;
  if (/-latest$/.test(naam)) return naam; // deze namen werken altijd, ook als de lijst ze niet noemt
  const lite = /lite/.test(naam);
  const kandidaten = [...beschikbaar]
    .filter((m) => m.startsWith(`${naam}-`) && !NIET_TEKSTMODEL.test(m) && (lite || !/lite/.test(m)))
    .sort();
  return kandidaten.length ? kandidaten[kandidaten.length - 1] : null;
}

/**
 * Vraagt Google welke modellen dit account kan gebruiken en bewaart de lijst voor
 * deze run. Mislukt het, dan werkt alles met de namen zoals ze staan. Geeft
 * { aantal, tekstmodellen } terug voor het logboek, of null.
 */
async function ontdekModellen(apiKey) {
  try {
    const namen = new Set();
    let pagina = "";
    for (let i = 0; i < 5; i++) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200${pagina}`, {
        headers: { "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) return null;
      const json = await response.json();
      for (const m of json.models || []) {
        const methoden = m.supportedGenerationMethods || [];
        if (methoden.length && !methoden.includes("generateContent")) continue;
        namen.add(String(m.name || "").replace(/^models\//, ""));
      }
      if (!json.nextPageToken) break;
      pagina = `&pageToken=${encodeURIComponent(json.nextPageToken)}`;
    }
    namen.delete("");
    if (namen.size < 3) return null; // een lijst die zo klein is, klopt niet; dan blijven de namen staan
    beschikbaarLijst = namen;
    const tekstmodellen = [...namen].filter((m) => /flash|pro/.test(m) && !NIET_TEKSTMODEL.test(m)).sort();
    return { aantal: namen.size, tekstmodellen };
  } catch (fout) {
    console.warn(`  Modellenlijst van Google niet op te halen (${fout.message}); we gebruiken de namen zoals ze staan.`);
    return null;
  }
}

// De keten voor een klasse met de echte namen. Een naam die Google niet kent valt weg.
function werkKeten(klasse) {
  const uit = [];
  for (const naam of ketenVoor(klasse)) {
    const echt = losOp(naam, beschikbaarLijst);
    if (echt) {
      if (!uit.includes(echt)) uit.push(echt);
    } else if (!gemeldeOntbrekend.has(naam)) {
      gemeldeOntbrekend.add(naam);
      console.warn(`  Gemini-model "${naam}" bestaat niet voor dit account; overgeslagen.`);
    }
  }
  return uit;
}


// Tijdelijke fouten van Google (overbelasting, storing): één verzoek mislukt dan,
// maar een paar seconden later lukt het vaak wel. Een 429 (quotum) valt hier
// bewust NIET onder: die heeft zijn eigen stroomonderbreker.
const HERPOGING_STATUSSEN = Object.freeze([500, 502, 503, 504]);
const HERPOGINGEN = 2; // extra pogingen per verzoek, dus hoogstens 3 aanroepen
const HERPOGING_PAUZE_MS = 3000; // pauze voor poging 2; daarna 3x zo lang (3 s, 9 s)
// Mislukken zoveel verzoeken achter elkaar (na alle pogingen) op een tijdelijke
// fout, dan start schrijfMeldingen / beslisZelfdeNieuwsfeit in deze run niets meer.
// De berichten blijven dan "overgeslagen" en komen bij de volgende run aan de beurt.
const OVERBELAST_STOP = 2;

/** Is dit een tijdelijke Google-fout waarbij een nieuwe poging zin heeft? */
function isTijdelijkeFout(fout) {
  return Boolean(fout) && HERPOGING_STATUSSEN.includes(fout.status);
}

/** Basispauze in ms. ZANP_AI_PAUZE_MS overschrijft de standaard (0 = niet wachten, voor tests). */
function herpogingPauzeMs() {
  const ingesteld = process.env.ZANP_AI_PAUZE_MS;
  if (ingesteld !== undefined && ingesteld !== "") {
    const n = Number(ingesteld);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return HERPOGING_PAUZE_MS;
}

const wacht = (ms) => (ms > 0 ? new Promise((klaar) => setTimeout(klaar, ms)) : Promise.resolve());

/**
 * Voert "poging" uit en probeert het bij een tijdelijke Google-fout (HTTP 500, 502,
 * 503, 504) opnieuw, met een oplopende pauze. Andere fouten (429, onbruikbaar antwoord,
 * netwerkfout) gaan meteen door. Bij een fout die na alle pogingen blijft staan,
 * krijgt de fout "tijdelijk = true", zodat de aanroeper kan zien dat het aan Google lag.
 */
async function metHerpogingen(model, poging) {
  const basis = herpogingPauzeMs();
  for (let nr = 0; ; nr++) {
    try {
      return await poging();
    } catch (fout) {
      if (!isTijdelijkeFout(fout)) throw fout;
      if (nr >= HERPOGINGEN) {
        fout.tijdelijk = true;
        throw fout;
      }
      const pauze = basis * 3 ** nr;
      console.warn(`  Gemini (${model}) tijdelijk niet beschikbaar (HTTP ${fout.status}); poging ${nr + 2}/${HERPOGINGEN + 1} over ${pauze / 1000} s.`);
      await wacht(pauze);
    }
  }
}

// ---------------------------------------------------------------------------
// Antwoord lezen
// ---------------------------------------------------------------------------

function parseAntwoord(tekst) {
  if (typeof tekst !== "string") return null;
  const schoon = tekst.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(schoon);
  } catch {
    const begin = schoon.indexOf("{");
    const eind = schoon.lastIndexOf("}");
    if (begin !== -1 && eind > begin) {
      try {
        return JSON.parse(schoon.slice(begin, eind + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Melding voor de nieuwsdienst (ZANP)
// ---------------------------------------------------------------------------
//
// Twee modi per bericht:
//   "volledig"  kop, prio, tag + checklist + agendapunten (officiële en
//               organisatiebronnen die we mogen herschrijven); geen samenvatting
//   "analyse"   alleen tag + checklist + agendapunten, GEEN kop en geen tekst
//               (artikelen van andere redacties en onbekende bronnen)
//   "kop"       alleen kop + soort, geen tag, checklist of agendapunten (moties,
//               schriftelijke vragen, aanbestedingen: berichten waarvan de kop
//               uit de scraper komt en die nooit langs de AI gingen)
// Alles wat de AI teruggeeft wordt in wire.js gecontroleerd tegen de bron.
//
// BATCHES. Het gratis quotum telt VERZOEKEN, geen tokens. Daarom gaan er per
// verzoek maximaal BATCH_GROOTTE berichten mee (van dezelfde modus). Elk
// bericht wordt apart gecontroleerd; een deels bruikbaar antwoord blijft
// bruikbaar en wat ontbreekt wordt bij een volgende run opnieuw geprobeerd.
//
// De functies hieronder gebruiken de aanroep roepGeminiWire.

const BATCH_GROOTTE = 6; // berichten per verzoek
const BATCH_TEKENS_PER_ITEM = 6000; // brontekst per bericht in een batch (de tekststap levert er hoogstens 6.000)
const MAX_OUTPUT_TOKENS_BATCH = 8192; // een batch heeft meer uitvoer nodig dan één bericht
const ZELFDE_PER_VERZOEK = 10; // twijfelparen per verzoek (dubbel nieuws)

/**
 * Eén Gemini-aanroep voor ZANP, met een eigen uitvoerlimiet.
 * Geeft { data, verzoeken, model, modelVersie } terug; "verzoeken" telt de aanroepen die
 * Google heeft beantwoord (ook een antwoord dat geen geldige JSON bleek te zijn), want
 * die tellen mee voor het dagquotum. Een HTTP-fout telt niet.
 *
 * KETEN. opties.klasse ("licht", standaard, of "zwaar") kiest de reeks modellen. Is een
 * model vol (dagcap, of een 429) of mislukt het, dan volgt het volgende model in de reeks.
 * opties.terugval (bijvoorbeeld "licht" bij klasse "zwaar") is een tweede reeks voor als
 * de eerste helemaal vol of kapot is. Alleen als ALLE modellen falen komt er een fout, met
 * status 429 als dat door het quotum kwam.
 *
 * Bij een tijdelijke Google-fout (HTTP 500, 502, 503, 504) probeert hij het
 * hoogstens HERPOGINGEN keer opnieuw, na 3 s en dan 9 s (zie metHerpogingen); daarna
 * volgt het volgende model. Een mislukte poging telt niet mee voor het dagquotum.
 * Blijft de fout staan, dan krijgt de fout "tijdelijk = true" en verandert de foutmelding niet.
 * Elke aanroep heeft een tijdslimiet (licht 90 s, zwaar 180 s; ZANP_AI_TIMEOUT_MS).
 */
async function roepGeminiWire(prompt, apiKey, maxTokens = MAX_OUTPUT_TOKENS_BATCH, opties = {}) {
  const klassen = [opties.klasse === "zwaar" ? "zwaar" : "licht"];
  if (opties.terugval && !klassen.includes(opties.terugval)) klassen.push(opties.terugval === "zwaar" ? "zwaar" : "licht");

  let verzoeken = 0;
  let laatsteFout;
  let quotumGeraakt = false;
  let quotumTekst = "";
  const wachtTijden = [];

  for (const klasse of klassen) {
    const keten = werkKeten(klasse);
    const uitvoer = klasse === "zwaar" ? Math.max(maxTokens, MIN_UITVOER_ZWAAR) : maxTokens;
    const limiet = getalUitEnv("ZANP_AI_TIMEOUT_MS", TIJDSLIMIET_MS[klasse]);
    for (let i = 0; i < keten.length; i++) {
      const model = keten[i];
      const staat = staatVan(model);
      const nu = new Date();
      if (!(staat.wachtTot && new Date(staat.wachtTot) > nu) && staat.gebruikt >= capVoor(klasse, model)) {
        staat.wachtTot = wachtBerekening("per day", nu); // dagcap bereikt: tot de volgende quotumdag
        console.warn(`  Gemini (${model}) heeft de dagcap bereikt (${staat.gebruikt}); overgeslagen tot ${staat.wachtTot}.`);
      }
      if (staat.wachtTot && new Date(staat.wachtTot) > nu) {
        quotumGeraakt = true;
        wachtTijden.push(staat.wachtTot);
        continue;
      }

      await tempo(klasse, model);
      let uit;
      try {
        uit = await metHerpogingen(model, async () => {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: TEMPERATUUR_WIRE,
                responseMimeType: "application/json",
                maxOutputTokens: uitvoer,
              },
            }),
            signal: AbortSignal.timeout(limiet),
          }).catch((fout) => {
            if (fout && (fout.name === "TimeoutError" || fout.name === "AbortError")) {
              throw new Error(`geen antwoord binnen ${Math.round(limiet / 1000)} s`);
            }
            throw fout;
          });
          if (!response.ok) {
            let foutTekst = `HTTP ${response.status}`;
            try {
              const foutJson = await response.json();
              if (foutJson.error && foutJson.error.message) foutTekst += `: ${foutJson.error.message}`;
            } catch {
              // geen JSON, laat de HTTP-status staan
            }
            const fout = new Error(foutTekst);
            fout.status = response.status;
            throw fout;
          }
          verzoeken++;
          staat.gebruikt++;
          const antwoord = await response.json();
          const kandidaat = antwoord && antwoord.candidates && antwoord.candidates[0];
          const delen = (kandidaat && kandidaat.content && kandidaat.content.parts) || [];
          const uitTekst = delen
            .filter((d) => !d.thought && typeof d.text === "string")
            .map((d) => d.text)
            .join("");
          if (!uitTekst) {
            throw new Error(`leeg antwoord (finishReason: ${(kandidaat && kandidaat.finishReason) || "onbekend"})`);
          }
          return { tekst: uitTekst, modelVersie: (antwoord && antwoord.modelVersion) || null };
        });
      } catch (fout) {
        laatsteFout = fout;
        if (fout.status === 429) {
          quotumGeraakt = true;
          quotumTekst = fout.message;
          staat.wachtTot = wachtBerekening(fout.message, new Date());
          wachtTijden.push(staat.wachtTot);
        }
        console.warn(`  Gemini (${model}) mislukte: ${fout.message}`);
        continue;
      }
      const data = parseAntwoord(uit.tekst);
      if (data) {
        if (i > 0 || klasse !== klassen[0]) console.log(`  Gemini: reservemodel ${model} gebruikt (${klasse}).`);
        return { data, verzoeken, model, modelVersie: uit.modelVersie, klasse };
      }
      laatsteFout = new Error("antwoord is geen geldige JSON");
      console.warn(`  Gemini (${model}) gaf geen geldige JSON.`);
    }
  }

  let fout;
  if (quotumGeraakt && !(laatsteFout && laatsteFout.tijdelijk)) {
    // Alle modellen waren vol. Een echte 429-melding van Google blijft staan (daar leest
    // zanp.js de wachttijd uit); anders maken we er een uit de vroegste wachttijd.
    const vroegste = wachtTijden.sort()[0];
    fout = new Error(quotumTekst || `HTTP 429: alle modellen zijn vol; ${vroegste ? wachtTekst(vroegste, new Date()) : "retry in 1h0m0s"}`);
    fout.status = 429;
  } else {
    fout = laatsteFout || new Error("alle modellen faalden");
  }
  fout.verzoeken = verzoeken;
  throw fout;
}

async function tempo(klasse, model) {
  if (klasse !== "zwaar" || process.env.ZANP_AI_PAUZE_MS === "0") return;
  const pauze = getalUitEnv("ZANP_ZWAAR_PAUZE_MS", ZWAAR_PAUZE_MS);
  const laatst = laatsteAanroep.get(model);
  if (laatst) await wacht(Math.max(0, laatst + pauze - Date.now()));
  laatsteAanroep.set(model, Date.now());
}

const CHECKLIST_UITLEG = `CHECKLIST (feiten uit de bron; bij twijfel false of null):
- gevaar: true bij acuut gevaar voor mensen (brand, gaslek, instortingsgevaar, ernstig ongeval). Niet bij gewone wegwerkzaamheden.
- evacuatieOfNlAlert: true als er sprake is van ontruiming, evacuatie of een NL-Alert.
- gewondenOfDoden: true als er gewonden of doden worden genoemd.
- betrokkenen: het aantal getroffenen, gewonden of ontruimden als getal dat letterlijk in de bron staat, anders null.
- geldbedragEuro: een bedrag in euro dat letterlijk in de bron staat, in hele euro's (2,5 miljoen wordt 2500000), anders null.
- banen: het aantal banen dat verdwijnt of erbij komt, als getal dat letterlijk in de bron staat, anders null.
- bestuurlijkeCrisis: true bij aftreden of schorsing van een bestuurder, motie van wantrouwen, coalitiebreuk of integriteitsonderzoek naar bestuurders.
- besluitMetGrootGevolg: true bij een besluit dat veel inwoners direct raakt (sluiting van een voorziening, grote bouwplannen, belastingverhoging).
- tijdkritisch: true als het nu speelt of binnen enkele uren, en mensen direct moeten handelen.`;

const AGENDAPUNTEN_UITLEG = `AGENDAPUNTEN (optioneel, hooguit 3):
Alleen openbare bijeenkomsten, zittingen, inspraakmomenten, inloopavonden of evenementen met een concrete datum in de toekomst die in de tekst staat. Geen deadlines (die vindt de code zelf), geen gebeurtenissen uit het verleden. Staat er geen datum in de tekst, laat het punt dan weg.
Per punt:
  "titel": maximaal 12 woorden
  "datumTekst": de datum EXACT zoals in de bron geschreven, bijvoorbeeld "dinsdag 3 november" of "morgen"
  "tijd": de begintijd exact zoals in de bron ("19.30 uur"), of null
  "eindtijd": de eindtijd exact zoals in de bron, of null
  "plaats": de plaats of locatie exact zoals in de bron, of null`;

const CHECKLIST_VOORBEELD = `"checklist": {
      "gevaar": false,
      "evacuatieOfNlAlert": false,
      "gewondenOfDoden": false,
      "betrokkenen": null,
      "geldbedragEuro": null,
      "banen": null,
      "bestuurlijkeCrisis": false,
      "besluitMetGrootGevolg": false,
      "tijdkritisch": false
    },
    "agendapunten": []`;

// Het soort bericht, met een bewijszin. Geen woordenlijst: de AI leest, de code controleert
// alleen dat de zin echt in de bron staat (wire.js).
const SOORT_UITLEG = `SOORT (kies precies één):
  incident: iets dat nu gebeurt of net gebeurd is en direct aandacht vraagt (ongeval, brand, stroomstoring, ontruiming, vermissing, grote politie-inzet, gewonden).
  uitkomst: de afloop of de beslissing van iets dat al langer speelde (uitspraak van een rechter, raadsbesluit, stemming, benoeming, aftreden, definitief besluit).
  gepland: een aankondiging van een vaste, geplande gebeurtenis in de toekomst (zitting, hoorzitting, stemming, opening, evenement).
  overig: alles anders, ook routine en gewone mededelingen. Twijfel je, kies dan overig.
SOORTZIN: kopieer bij incident, uitkomst en gepland LETTERLIJK één zin of zinsdeel uit de bron (titel of tekst) die je keuze onderbouwt. Bij overig: een lege tekst "".`;

// De tag (kolom) van een bericht: waar gaat het OVER, niet waar komt het
// vandaan. tags = [{ code, naam, hint }] uit rubrieken.json (zie tags.js).
function tagUitleg(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return "";
  const regels = tags.map((t) => `  ${t.code}: ${t.naam}${t.hint ? ` (${t.hint})` : ""}`).join("\n");
  return `TAG (kies precies één code uit deze lijst; het gaat erom waar het bericht OVER gaat, niet om de bron):
${regels}
  ALG: geen van bovenstaande past`;
}

function bronBlok(item, nr) {
  const tekst = (item.tekst || "").trim().slice(0, BATCH_TEKENS_PER_ITEM);
  return `BRON ${nr}:
Titel: ${item.titel || ""}
Bron: ${item.bronNaam || ""}
Datum: ${item.gepubliceerdOp || ""}
Tekst:
${tekst || "(geen tekst beschikbaar)"}`;
}

/**
 * Eén prompt voor een groep berichten van dezelfde modus. Het voorbeeld is
 * bewust verzonnen, zodat het model het niet overneemt.
 */
function bouwMeldingBatchPrompt(items, modus = "volledig", tags = []) {
  const n = items.length;
  if (modus === "kop") return bouwKopBatchPrompt(items);
  const volledig = modus !== "analyse";
  const tag = tagUitleg(tags);
  const tagVeld = tag ? `\n      "tag": "<code uit de lijst>",` : "";

  const intro = volledig
    ? `Je bent redacteur bij een regionale nieuwsdienst voor Zaanstreek-Waterland, in de stijl van een persbureau: kort, feitelijk en neutraal.
Hieronder staan ${n} bron(nen). Schrijf voor ELKE bron een kop, kies een prio${tag ? ", een tag" : ""} en het soort bericht, vul een checklist in en haal eventuele agendapunten uit de bron. Je schrijft geen samenvatting: de lezer krijgt de volledige tekst van de bron te zien. Behandel elke bron los van de andere: gebruik voor een kop alleen de tekst van die ene bron.

kop
Eis: maximaal 14 woorden, tegenwoordige tijd, feitelijk. Noem wie of wat en de kern. Geen vraag, geen aanloktaal, geen uitroepteken.
Voorbeeld: "Fietspad langs de Vaart in Wormer twee weken dicht voor onderhoud"

prio
Een geheel getal van 2 tot en met 4:
  2: raakt veel inwoners of heeft direct gevolgen voor het dagelijks leven (verkeer, veiligheid, zorg, geld).
  3: relevant voor een kleinere groep, of een belangrijk besluit.
  4: routine of administratief (vergunning, bekendmaking, persbericht van een instelling).`
    : `Je analyseert berichten voor een regionale nieuwsdienst voor Zaanstreek-Waterland. Hieronder staan ${n} bron(nen). Je schrijft zelf geen tekst: je kiest ${tag ? "een tag, " : ""}vult een checklist in en haalt eventuele agendapunten uit de bron. Behandel elke bron los van de andere.`;

  const regels = volledig
    ? `REGELS:
- Gebruik alleen wat in de bron staat. Staat iets er niet in, laat het dan weg. Verzin geen namen, getallen, data of plaatsen.
- Neem getallen letterlijk over; reken niets om en tel niets op.
- Is de brontekst te kort of te onduidelijk voor een kop, antwoord voor die bron dan {"nr": <nummer>, "onvoldoende": true}.
- Schrijf de kop in correct, helder Nederlands. Gebruik alleen woorden en namen zoals ze in de bron staan of gewone Nederlandse woorden; verzin geen woorden.`
    : `REGELS:
- Gebruik alleen wat in de bron staat. Verzin geen getallen, data of plaatsen.
- Is de brontekst te kort of te onduidelijk, antwoord voor die bron dan {"nr": <nummer>, "onvoldoende": true}.`;

  const voorbeeld = volledig
    ? `    {
      "nr": 1,
      "kop": "...",
      "prio": 3,${tagVeld}
      "soort": "overig",
      "soortZin": "",
      ${CHECKLIST_VOORBEELD}
    }`
    : `    {
      "nr": 1,${tagVeld}
      ${CHECKLIST_VOORBEELD}
    }`;

  return `${intro}

${tag ? `${tag}\n\n` : ""}${volledig ? `${SOORT_UITLEG}\n\n` : ""}${CHECKLIST_UITLEG}

${AGENDAPUNTEN_UITLEG}

${regels}

Geef ALLEEN geldige JSON terug, geen markdown-fences en geen andere tekst. Precies één object per bron, met het nummer van die bron, in dezelfde volgorde:
{
  "resultaten": [
${voorbeeld}
  ]
}

${items.map((item, i) => bronBlok(item, i + 1)).join("\n\n")}`;
}

// Modus "kop": alleen een kop en het soort bericht. Voor berichten waarvan de
// kop uit de scraper komt (moties, schriftelijke vragen, aanbestedingen).
function bouwKopBatchPrompt(items) {
  return `Je bent redacteur bij een regionale nieuwsdienst voor Zaanstreek-Waterland, in de stijl van een persbureau: kort, feitelijk en neutraal.
Hieronder staan ${items.length} bron(nen). Schrijf voor ELKE bron een kop en geef het soort bericht. Behandel elke bron los van de andere: gebruik voor een kop alleen de tekst van die ene bron.

kop
Eis: maximaal 14 woorden, tegenwoordige tijd, feitelijk. Noem wie of wat en de kern. Geen vraag, geen aanloktaal, geen uitroepteken. Noem een uitkomst (aangenomen, verworpen, beantwoord) alleen als die in de bron staat.
Voorbeeld: "Gemeenteraad wil extra geld voor onderhoud van de Zaanse bruggen"

${SOORT_UITLEG}

REGELS:
- Gebruik alleen wat in de bron staat. Staat iets er niet in, laat het dan weg. Verzin geen namen, getallen, data of plaatsen.
- Neem getallen letterlijk over; reken niets om en tel niets op.
- Is de brontekst te kort of te onduidelijk voor een kop, antwoord voor die bron dan {"nr": <nummer>, "onvoldoende": true}.
- Schrijf de kop in correct, helder Nederlands. Gebruik alleen woorden en namen zoals ze in de bron staan of gewone Nederlandse woorden; verzin geen woorden.

Geef ALLEEN geldige JSON terug, geen markdown-fences en geen andere tekst. Precies één object per bron, met het nummer van die bron, in dezelfde volgorde:
{
  "resultaten": [
    { "nr": 1, "kop": "...", "soort": "overig", "soortZin": "" }
  ]
}

${items.map((item, i) => bronBlok(item, i + 1)).join("\n\n")}`;
}

// Geeft { onvoldoende: true } of { kop, prio, tag, checklist, agendapunten, type }
// terug (modus "analyse": { checklist, agendapunten, tag }), of null bij een
// onbruikbaar antwoord (modus "kop": { kop, type }). Een eventueel meegestuurde "tekst" wordt genegeerd. Checklist, agendapunten en tag
// gaan ongecontroleerd door; wire.js controleert ze tegen de bron en de lijst.
function valideerMelding(data, modus = "volledig") {
  if (!data || typeof data !== "object") return null;
  if (data.onvoldoende === true) return { onvoldoende: true };

  const checklist = data.checklist && typeof data.checklist === "object" ? data.checklist : null;
  const agendapunten = Array.isArray(data.agendapunten) ? data.agendapunten : [];
  const tag = typeof data.tag === "string" && data.tag.trim() ? data.tag.trim() : null;

  if (modus === "analyse") {
    if (!checklist) return null;
    return { checklist, agendapunten, tag };
  }

  if (typeof data.kop !== "string" || !data.kop.trim()) return null;
  const kop = data.kop.trim();
  if (kop.length > 160) return null;
  // Het soort: een onbekende waarde of een ontbrekende zin geeft geen soort (wire.js
  // controleert daarna of de zin in de bron staat).
  const soort = typeof data.soort === "string" ? data.soort.trim().toLowerCase() : "";
  const soortZin = typeof data.soortZin === "string" ? data.soortZin.trim().slice(0, 400) : "";
  const type = SOORTEN.includes(soort) ? { soort, zin: soortZin } : null;
  if (modus === "kop") return { kop, type };
  const prio = Number(data.prio);
  return {
    kop,
    prio: Number.isInteger(prio) ? prio : null,
    tag,
    checklist,
    agendapunten,
    type,
  };
}

// Groepeert items in batches van dezelfde modus, in de volgorde van de lijst
// (de lijst is al op belang gesorteerd). Een batch staat op de plek van zijn
// eerste item.
function maakBatches(items, grootte) {
  const batches = [];
  const open = { volledig: null, analyse: null, kop: null };
  for (const item of items) {
    const modus = item.modus === "analyse" ? "analyse" : item.modus === "kop" ? "kop" : "volledig";
    let batch = open[modus];
    if (!batch) {
      batch = { modus, items: [] };
      open[modus] = batch;
      batches.push(batch);
    }
    batch.items.push(item);
    if (batch.items.length >= grootte) open[modus] = null;
  }
  return batches;
}

/**
 * Schrijft meldingen of analyses voor een lijst items, in batches.
 *
 * @param {object[]} items  { id, modus, titel, tekst, bronNaam, gepubliceerdOp, ... }
 * @param {string}   apiKey
 * @param {number}   cap    hoogstens zoveel VERZOEKEN (niet berichten)
 * @param {object}   [opties] { tags: [{code,naam,hint}], batchGrootte }
 * @returns {Map} item.id naar { melding } | { onvoldoende: true } | { fout, status }.
 *   Op de Map staat ook "verzoeken": het aantal verzoeken dat Google beantwoordde
 *   (alleen die tellen voor het dagquotum).
 *
 * Items die niet aan bod kwamen (cap of quotum) krijgen { fout: "overgeslagen …" }
 * en worden bij een volgende run opnieuw geprobeerd.
 *
 * Stroomonderbreker: bij een 429 starten er geen nieuwe verzoeken meer.
 */
async function schrijfMeldingen(items, apiKey, cap, opties = {}) {
  const resultaten = new Map();
  resultaten.verzoeken = 0;
  if (!Array.isArray(items) || items.length === 0) return resultaten;

  const grootte = Math.max(1, opties.batchGrootte || BATCH_GROOTTE);
  const tags = opties.tags || [];
  const batches = maakBatches(items, grootte);
  const teDoen = batches.slice(0, Math.max(0, cap));

  let quotaHit = false;
  let overbelast = false; // Google gaf OVERBELAST_STOP keer achter elkaar een tijdelijke fout
  let tijdelijkAchtereen = 0;

  async function verwerkBatch(batch) {
    const prompt = bouwMeldingBatchPrompt(batch.items, batch.modus, tags);
    let antwoord;
    try {
      antwoord = await roepGeminiWire(prompt, apiKey);
    } catch (fout) {
      resultaten.verzoeken += fout.verzoeken || 0;
      for (const item of batch.items) resultaten.set(item.id, { fout: fout.message, status: fout.status });
      if (fout.status === 429) quotaHit = true;
      if (fout.tijdelijk && ++tijdelijkAchtereen >= OVERBELAST_STOP) overbelast = true;
      return;
    }
    tijdelijkAchtereen = 0;
    resultaten.verzoeken += antwoord.verzoeken;

    let lijst = [];
    if (Array.isArray(antwoord.data)) lijst = antwoord.data;
    else if (Array.isArray(antwoord.data.resultaten)) lijst = antwoord.data.resultaten;
    else if (batch.items.length === 1 && (antwoord.data.kop || antwoord.data.checklist || antwoord.data.onvoldoende)) {
      lijst = [{ ...antwoord.data, nr: 1 }]; // het model gaf één los object
    }
    const perNr = new Map();
    for (const r of lijst) {
      const nr = Number(r && r.nr);
      if (Number.isInteger(nr) && !perNr.has(nr)) perNr.set(nr, r);
    }

    batch.items.forEach((item, i) => {
      const r = perNr.get(i + 1);
      if (!r) {
        resultaten.set(item.id, { fout: "ontbreekt in het antwoord" });
        return;
      }
      const melding = valideerMelding(r, batch.modus);
      if (!melding) {
        resultaten.set(item.id, {
          fout: batch.modus === "analyse" ? "onvolledige analyse (checklist ontbreekt)" : "onvolledige melding (kop ontbreekt)",
        });
        return;
      }
      resultaten.set(item.id, melding.onvoldoende ? { onvoldoende: true } : { melding });
    });
  }

  for (let i = 0; i < teDoen.length; i += PARALLEL) {
    if (quotaHit || overbelast) break;
    await Promise.all(teDoen.slice(i, i + PARALLEL).map(verwerkBatch));
    const gedaan = Math.min(i + PARALLEL, teDoen.length);
    console.log(`  melding: ${gedaan}/${teDoen.length} verzoek(en), ${resultaten.size} bericht(en) verwerkt`);
  }
  if (overbelast) console.warn("  Gemini is overbelast: geen nieuwe verzoeken meer in deze run; de rest komt bij de volgende run.");

  for (const item of items) {
    if (!resultaten.has(item.id)) {
      resultaten.set(item.id, {
        fout: quotaHit
          ? "overgeslagen (quotum bereikt)"
          : overbelast
            ? "overgeslagen (Gemini overbelast, volgende run opnieuw)"
            : `overgeslagen (cap ${cap} verzoeken)`,
      });
    }
  }
  return resultaten;
}

// ---------------------------------------------------------------------------
// Dubbel nieuws: gaat het om hetzelfde nieuwsfeit?
// ---------------------------------------------------------------------------

function bouwZelfdeBatchPrompt(paren) {
  const blok = (x) => `Titel: ${x.titel || ""}\nBron: ${x.bronNaam || ""}\nTekst: ${(x.tekst || "").slice(0, 1500)}`;
  return `Hieronder staan ${paren.length} paar(en) berichten uit Zaanstreek-Waterland. Beoordeel elk paar los van de andere: gaat het om HETZELFDE nieuwsfeit, dus dezelfde gebeurtenis of hetzelfde besluit, ook als ze anders zijn geschreven?
Antwoord alleen "zelfde": true als het over dezelfde gebeurtenis gaat. Een vervolg, een reactie, een ander aspect of een soortgelijke maar andere gebeurtenis is "zelfde": false.

${paren
  .map((p, i) => `PAAR ${i + 1}\nBERICHT A\n${blok(p.a)}\n\nBERICHT B\n${blok(p.b)}`)
  .join("\n\n")}

Geef ALLEEN geldige JSON terug, geen markdown-fences en geen andere tekst. Precies één object per paar, met het nummer van het paar:
{ "antwoorden": [ { "nr": 1, "zelfde": true } ] }`;
}

/**
 * Beslist voor een lijst twijfelparen of ze hetzelfde nieuwsfeit zijn, tot
 * ZELFDE_PER_VERZOEK paren per verzoek.
 *
 * @param {object[]} paren  { sleutel, a, b }
 * @param {string}   apiKey
 * @param {number}   cap    hoogstens zoveel VERZOEKEN
 * @returns {Map} sleutel naar true | false | null (null bij een fout of
 *   overgeslagen). Op de Map staan ook "verzoeken" (beantwoorde verzoeken) en
 *   "quotum" (true bij een 429, met de melding in "quotumTekst"). Stopt bij een 429.
 */
async function beslisZelfdeNieuwsfeit(paren, apiKey, cap) {
  const uit = new Map();
  uit.verzoeken = 0;
  const lijst = paren || [];
  const groepen = [];
  for (let i = 0; i < lijst.length; i += ZELFDE_PER_VERZOEK) groepen.push(lijst.slice(i, i + ZELFDE_PER_VERZOEK));
  const teDoen = groepen.slice(0, Math.max(0, cap));

  let quotaHit = false;
  let overbelast = false; // OVERBELAST_STOP keer achter elkaar een tijdelijke Google-fout
  let tijdelijkAchtereen = 0;

  async function verwerkGroep(groep) {
    let antwoord;
    try {
      antwoord = await roepGeminiWire(bouwZelfdeBatchPrompt(groep), apiKey, 2048);
    } catch (fout) {
      uit.verzoeken += fout.verzoeken || 0;
      for (const paar of groep) uit.set(paar.sleutel, null);
      if (fout.status === 429) {
        quotaHit = true;
        uit.quotumTekst = fout.message;
      }
      if (fout.tijdelijk && ++tijdelijkAchtereen >= OVERBELAST_STOP) overbelast = true;
      return;
    }
    tijdelijkAchtereen = 0;
    uit.verzoeken += antwoord.verzoeken;
    let antwoorden = [];
    if (Array.isArray(antwoord.data)) antwoorden = antwoord.data;
    else if (Array.isArray(antwoord.data.antwoorden)) antwoorden = antwoord.data.antwoorden;
    else if (groep.length === 1 && typeof antwoord.data.zelfde === "boolean") antwoorden = [{ ...antwoord.data, nr: 1 }];
    const perNr = new Map();
    for (const a of antwoorden) {
      const nr = Number(a && a.nr);
      if (Number.isInteger(nr) && !perNr.has(nr)) perNr.set(nr, a);
    }
    groep.forEach((paar, i) => {
      const a = perNr.get(i + 1);
      uit.set(paar.sleutel, a && typeof a.zelfde === "boolean" ? a.zelfde : null);
    });
  }

  for (let i = 0; i < teDoen.length; i += PARALLEL) {
    if (quotaHit || overbelast) break;
    await Promise.all(teDoen.slice(i, i + PARALLEL).map(verwerkGroep));
  }
  for (const paar of lijst) {
    if (!uit.has(paar.sleutel)) uit.set(paar.sleutel, null);
  }
  uit.quotum = quotaHit;
  return uit;
}

module.exports = {
  schrijfMeldingen,
  beslisZelfdeNieuwsfeit,
  roepGeminiWire, // ook voor de AI-controle van de prioriteitsfunctie (prioriteit/ai.js)
  ketenVoor,
  capVoor,
  laadModelStaat,
  geefModelStaat,
  resetModelStaat,
  ontdekModellen,
  losOp,
  BATCH_TEKENS_PER_ITEM,
  isTijdelijkeFout,
  HERPOGING_STATUSSEN,
  HERPOGINGEN,
  OVERBELAST_STOP,
  PROMPT_VERSIE_WIRE,
  MODELLEN,
  BATCH_GROOTTE,
  ZELFDE_PER_VERZOEK,
  bouwMeldingBatchPrompt,
  bouwKopBatchPrompt,
  SOORTEN,
  bouwZelfdeBatchPrompt,
  maakBatches,
  valideerMelding,
  parseAntwoord,
};
