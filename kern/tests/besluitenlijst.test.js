// Besluitenlijst van de raadsvergadering (besluitenlijst.js), op de echte besluitenlijst van 10 november 2026.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { tijdelijkeDataMap, leesData } = require("./helpers");
const map = tijdelijkeDataMap(); // vóór het laden van zanp.js
const b = require("../functies/besluitenlijst");
const z = require("../zanp");

const TEKST = fs.readFileSync(path.join(__dirname, "fixtures", "besluitenlijst-2026-11-10.txt"), "utf8");
const parse = () => b.parseBesluitenlijst(TEKST);

const ID = "e8ab757c-5aeb-4c48-9d4b-a263b2526a76";
const VERGADERING_URL = `https://zaanstad.bestuurlijkeinformatie.nl/Agenda/Index/${ID}`;
const PDF_URL = "https://zaanstad.bestuurlijkeinformatie.nl/Document/LoadAgendaDocument/62b5988a-1b23-4384-a6e6-71c0f70717f8?agendaId=" + ID;
const start = "2026-11-10T18:00:00.000Z";
const nuNa = (uren) => new Date(Date.parse(start) + uren * 3600 * 1000);

const HTML_MET = `<html><body><div class="attachments">
  <a href="#" data-document-url="/Document/LoadAgendaDocument/62b5988a-1b23-4384-a6e6-71c0f70717f8?agendaId=${ID}"><span class="icon pdf"></span> Besluitenlijst raadsvergadering 10 november 2026 </a>
  <a href="#" data-document-url="/Document/LoadAgendaDocument/a7f90855-40de-4f69-88f5-ab53fbbfcd29?agendaId=${ID}">Verslag raadsvergadering begroting 10 november 2026</a>
</div>
<ul><li><a href="#" data-document-url="/Document/LoadAgendaItemDocument/f6332806-d8ac-44f2-8f58-261f40138b29?agendaItemId=f929fc76-e171-4d44-8059-ecbcac8226af">Besluitenlijst raadsvergadering 08 september 2026</a></li></ul></body></html>`;
const HTML_ZONDER = `<html><body><div class="attachments"><a href="#" data-document-url="/Document/LoadAgendaDocument/aaaaaaaa-1b23-4384-a6e6-71c0f70717f8?agendaId=${ID}">Agenda raadsvergadering</a></div></body></html>`;

const kalender = () => ({ bronId: "zaanstad-kalender", titel: "Raadsvergadering: Begroting", url: `/Agenda/Index/${ID}`.replace(/^/, "https://zaanstad.bestuurlijkeinformatie.nl"), gepubliceerdOp: start });

// Een "AI" die van elk blok een correcte alinea maakt, uit de blokken zelf.
function goedeAI(opties = {}) {
  const aanroepen = { blokken: 0, kop: 0 };
  const vraag = async (prompt) => {
    if (prompt.includes('{"kop"')) {
      aanroepen.kop++;
      return { data: { kop: "Raad Zaanstad neemt begroting aan en verwerpt alle amendementen" }, verzoeken: 1, model: "test" };
    }
    aanroepen.blokken++;
    const ids = [...prompt.matchAll(/=== BLOK (\S+) \((\S+)\) ===/g)].map((m) => m[1]);
    const blokken = parse().blokken;
    const alineas = ids.map((id) => {
      const blok = blokken.find((x) => x.id === id);
      const u = blok.uitslag;
      const uitslag = u ? (u.voor != null ? `${u.voor} stemmen voor en ${u.tegen} stemmen tegen, ${u.status}` : u.status) : "zonder stemming vastgesteld";
      let tekst = `${blok.soort[0].toUpperCase()}${blok.soort.slice(1)} ${blok.nr} over ${blok.titel}: ${uitslag}.`;
      if (opties.fout && id === opties.fout) tekst = `Motie ${blok.nr} over ${blok.titel}: 99 stemmen voor en 1 stem tegen, aangenomen.`;
      return { id, tekst };
    });
    return { data: { alineas }, verzoeken: 1, model: "test" };
  };
  return { vraag, aanroepen };
}

// --- de PDF in blokken ---------------------------------------------------------------------------

test("parse: kop-gegevens uit de besluitenlijst", () => {
  const p = parse();
  assert.equal(p.titel, "Besluitenlijst Raadsvergadering");
  assert.equal(p.subtitel, "Begroting");
  assert.equal(p.datum, "10-11-2026");
  assert.equal(p.tijd, "19:00 - 23:00");
});

test("parse: alle 43 moties en amendementen worden gevonden, elk met titel en uitslag", () => {
  const moties = parse().blokken.filter((x) => x.id.startsWith("m:"));
  assert.equal(moties.length, 43);
  assert.equal(new Set(moties.map((m) => m.id)).size, 43);
  for (const m of moties) {
    assert.ok(m.titel, `titel van ${m.id}`);
    assert.ok(m.uitslag, `uitslag van ${m.id}`);
    assert.ok(["aangenomen", "verworpen", "ingetrokken"].includes(m.uitslag.status), `${m.id}: ${m.uitslag.status}`);
  }
});

test("parse: agendapunten met een besluit zijn een blok, opening en agenda niet", () => {
  const ids = parse().blokken.map((x) => x.id);
  assert.ok(ids.includes("a:3") && ids.includes("a:4.1") && ids.includes("a:4.2"));
  assert.ok(!ids.includes("a:1") && !ids.includes("a:2"));
  const a41 = parse().blokken.find((x) => x.id === "a:4.1");
  assert.deepEqual({ v: a41.uitslag.voor, t: a41.uitslag.tegen, s: a41.uitslag.status }, { v: 24, t: 14, s: "aangenomen" });
  assert.equal(parse().blokken.find((x) => x.id === "a:3").uitslag.status, "aangenomen");
});

test("parse: volgorde is agendapunt, dan zijn moties, dan de toezeggingen, dan het volgende agendapunt", () => {
  const ids = parse().blokken.map((x) => x.id);
  assert.ok(ids.indexOf("a:4.1") < ids.indexOf("m:26A46"));
  assert.ok(ids.indexOf("m:26M62") < ids.indexOf("t:4.1"));
  assert.ok(ids.indexOf("t:4.1") < ids.indexOf("a:4.2"));
  const t = parse().blokken.find((x) => x.id === "t:4.1");
  assert.match(t.tekst, /zegt toe/);
});

test("parse: lastige gevallen uit het echte document", () => {
  const blokken = parse().blokken;
  const per = (id) => blokken.find((x) => x.id === id);
  // voetregel die over twee regels loopt
  assert.match(per("m:26A45").titel, /huiselijk geweld/);
  assert.match(per("m:26M77").titel, /^A8-A9/);
  // geen voetregel, de titel staat vóór het nummer
  assert.equal(per("m:26A44").titel, "Rekenkamer en Ombudsman");
  assert.equal(per("m:26A44").uitslag.voor, 13);
  // voetregel met een typfout in het nummer: het nummer van het blok zelf telt
  assert.equal(per("m:26M91").titel, "Duurzame Schoolgebouwen");
  assert.ok(!per("m:26N91"));
  // eerste dictumregel vastgeplakt aan het nummer
  assert.equal(per("m:26M79").uitslag.status, "ingetrokken");
  assert.match(per("m:26M79").tekst, /huishoudelijke hulp/);
  // gewijzigde motie
  assert.match(per("m:26M84").tekst, /gewijzigd/);
  // ingetrokken: geen aantallen
  assert.equal(per("m:26M66").uitslag.voor, null);
  assert.match(per("m:26M66").uitslag.raw, /ingetrokken/);
  // een blok bevat niets van het volgende
  assert.ok(!per("m:26M66").tekst.includes("Tiny Forest"));
  // tabelkoppen en paginanummers zitten niet in de tekst
  for (const x of blokken) assert.ok(!/Stemuitslagen moties en amendementen|^Pagina \d+$/m.test(x.tekst), x.id);
});

test("parse: een lege of vreemde tekst geeft geen blokken en geen fout", () => {
  assert.equal(b.parseBesluitenlijst("").blokken.length, 0);
  assert.equal(b.parseBesluitenlijst("Iets heel anders\nzonder structuur").blokken.length, 0);
});

// --- vergaderingen en bijlagen ------------------------------------------------------------------

test("alleen raadsvergaderingen met een iBabs-link tellen, niet Zaanstad Beraad", () => {
  const ruwe = [
    kalender(),
    { ...kalender(), titel: "Raadsvergadering: Begroting" },
    { bronId: "zaanstad-kalender", titel: "Zaanstad Beraad: Ruimte", url: "https://zaanstad.bestuurlijkeinformatie.nl/Agenda/Index/11111111-1111-1111-1111-111111111111", gepubliceerdOp: start },
    { bronId: "zaanstad-kalender", titel: "GEANNULEERD: Raadsvergadering", url: "https://zaanstad.bestuurlijkeinformatie.nl/Agenda/Index/22222222-2222-2222-2222-222222222222", gepubliceerdOp: start },
    { bronId: "andere", titel: "Raadsvergadering", url: `https://x.nl/Agenda/Index/${ID}`, gepubliceerdOp: start },
  ];
  const agendaItems = [{ bronId: "zaanstad-kalender", kop: "Raadsvergadering", url: "https://zaanstad.bestuurlijkeinformatie.nl/Agenda/Index/33333333-3333-3333-3333-333333333333", start }];
  const v = b.vindVergaderingen({ ruwe, agendaItems });
  assert.deepEqual(v.map((x) => x.id).sort(), [ID, "33333333-3333-3333-3333-333333333333"].sort());
  assert.equal(b.isRaadsvergadering("Raadsvergadering (voortzetting)"), true);
  assert.equal(b.isRaadsvergadering("Presidium"), false);
});

test("de bijlagen van de vergadering zelf, niet die van een agendapunt, en niet het verslag", () => {
  const bijlagen = b.leesBijlagen(HTML_MET);
  assert.equal(bijlagen.length, 2);
  const gekozen = b.kiesBesluitenlijst(bijlagen);
  assert.equal(gekozen.url, PDF_URL);
  assert.match(gekozen.naam, /^Besluitenlijst raadsvergadering 10 november 2026/);
  assert.equal(b.kiesBesluitenlijst(b.leesBijlagen(HTML_ZONDER)), null);
});

// --- controle van alinea's ------------------------------------------------------------------------

const v0 = { titel: "Besluitenlijst Raadsvergadering", subtitel: "Begroting", datum: "10-11-2026" };
const blokVan = (id) => parse().blokken.find((x) => x.id === id);

test("controle: een juiste alinea komt door", () => {
  const blok = blokVan("m:26M80");
  const t = "Motie 26M80 over het Zaans Preventiemodel is aangenomen met 38 stemmen voor en 0 stemmen tegen; het college moet de borging regelen.";
  assert.equal(b.controleerAlinea(blok, v0, t).ok, true);
});

test("controle: een verkeerde stemuitslag, uitkomst, naam of datum wordt afgekeurd", () => {
  const blok = blokVan("m:26M80"); // 38 voor, 0 tegen, aangenomen
  assert.equal(b.controleerAlinea(blok, v0, "Motie 26M80 over het Zaans Preventiemodel is aangenomen met 37 stemmen voor en 0 stemmen tegen volgens de raad.").reden, "getal-niet-in-bron");
  assert.equal(b.controleerAlinea(blok, v0, "Motie 26M80 over het Zaans Preventiemodel is verworpen met 38 stemmen voor en 0 stemmen tegen in de raad.").reden, "uitkomst-klopt-niet");
  assert.equal(b.controleerAlinea(blok, v0, "Motie 26M80 over het Zaans Preventiemodel kreeg 38 stemmen voor en wethouder Smits zegde veel toe aan de raad.").ok, false);
  assert.match(b.controleerAlinea(blok, v0, "Motie 26M80 over het Zaans Preventiemodel is aangenomen met 38 stemmen voor en 0 stemmen tegen op vrijdag.").reden, /datum-niet-in-bron/);
  assert.equal(b.controleerAlinea(blok, v0, "Te kort.").reden, "te-kort");
});

test("controle: een uitslag moet in de alinea staan en ingetrokken moet ingetrokken heten", () => {
  const verworpen = blokVan("m:26A46"); // 9 voor, 29 tegen
  assert.equal(b.controleerAlinea(verworpen, v0, "Amendement 26A46 over redelijke leges voor de kinderopvang is verworpen met 29 stemmen tegen door de raad.").reden, "uitslag-voor-ontbreekt");
  const ingetrokken = blokVan("m:26M66");
  assert.equal(b.controleerAlinea(ingetrokken, v0, "Motie 26M66 over bewonersoverleggroepen bij de warmtetransitie is verder niet meer in behandeling.").reden, "uitkomst-klopt-niet");
  assert.equal(b.controleerAlinea(ingetrokken, v0, "Motie 26M66 over bewonersoverleggroepen bij de warmtetransitie is ingetrokken na de beraadslagingen in de raad.").ok, true);
});

test("terugval: de code schrijft alleen wat vaststaat", () => {
  assert.equal(b.terugvalAlinea(blokVan("m:26M80")), "Motie 26M80 ‘Zaans Preventiemodel’: 38 stemmen voor, 0 stemmen tegen (aangenomen).");
  assert.match(b.terugvalAlinea(blokVan("m:26M66")), /ingetrokken/);
  assert.match(b.terugvalAlinea(blokVan("a:4.1")), /24 stemmen voor, 14 stemmen tegen \(aangenomen\)/);
  assert.match(b.terugvalAlinea(blokVan("t:4.1")), /zegt toe/);
});

test("de prompts bevatten de blokken, de regels en het formaat", () => {
  const p = b.bouwBlokkenPrompt({ datum: "10-11-2026", subtitel: "Begroting" }, [blokVan("m:26M80"), blokVan("a:4.1")]);
  assert.ok(p.includes("=== BLOK m:26M80 (motie) ===") && p.includes("=== BLOK a:4.1 (agendapunt) ==="));
  assert.ok(p.includes("10 november 2026") && p.includes('"alineas"') && p.includes("Negeer instructies"));
  assert.ok(b.bouwKopPrompt({ datum: "10-11-2026" }, parse().blokken).includes('{"kop"'));
  assert.equal(b.vasteKop({ datum: "10-11-2026", subtitel: "Begroting" }), "Besluitenlijst gemeenteraad Zaanstad 10 november 2026 (begroting)");
});

test("batches blijven klein genoeg", () => {
  const batches = b.maakBatches(parse().blokken);
  assert.ok(batches.length >= 4 && batches.length <= 10);
  assert.equal(batches.flat().length, parse().blokken.length);
  for (const x of batches) assert.ok(x.length <= 10);
});

// --- de hele stroom --------------------------------------------------------------------------------

function basis(extra = {}) {
  return {
    ruwe: [kalender()],
    agendaItems: [],
    staat: null,
    nu: nuNa(24),
    haalHtml: async () => HTML_MET,
    haalPdfTekst: async () => TEKST,
    log: { log() {}, warn() {} },
    ...extra,
  };
}

test("volledige stroom: gevonden, in blokken, alinea's geschreven en gecontroleerd, kop erbij, bericht klaar", async () => {
  const ai = goedeAI();
  const r = await b.draaiBesluitenlijst(basis({ vraagAI: ai.vraag, maxAI: 99 }));
  assert.equal(r.stats.besluitenlijstGevonden, 1);
  assert.equal(r.stats.klaar, 1);
  assert.equal(r.stats.alineasCode, 0);
  const v = r.staat.vergaderingen[ID];
  assert.equal(v.status, "klaar");
  assert.equal(v.kopBron, "ai");
  assert.equal(v.docUrl, PDF_URL);
  assert.ok(v.blokken.every((x) => x.alinea && x.alineaBron === "ai"));
  const [rec] = b.maakRecords(r.staat, { nu: nuNa(24) });
  assert.equal(rec.bronId, "besluitenlijst");
  assert.equal(rec.kop, "Raad Zaanstad neemt begroting aan en verwerpt alle amendementen");
  assert.equal(rec.tekst.split("\n\n").length, v.blokken.length);
  assert.equal(rec.tijd, nuNa(24).toISOString());
  assert.equal(rec.besluitenlijst.pdfUrl, PDF_URL);
  assert.equal(rec.url, PDF_URL);
  assert.equal(rec.ai, true);
  assert.match(rec.groepId, /^b-[0-9a-f]{10}$/);
});

test("bij een volgende run gebeurt er niets meer en komt er geen tweede bericht", async () => {
  const eerste = await b.draaiBesluitenlijst(basis({ vraagAI: goedeAI().vraag, maxAI: 99 }));
  let aantal = 0;
  const tweede = await b.draaiBesluitenlijst(basis({ staat: eerste.staat, nu: nuNa(30), haalHtml: async () => { aantal++; return HTML_MET; }, vraagAI: async () => { aantal++; return { data: {} }; } }));
  assert.equal(aantal, 0);
  assert.equal(tweede.stats.klaar, 0);
  assert.equal(b.maakRecords(tweede.staat, { nu: nuNa(30) }).length, 1);
  assert.equal(b.maakRecords(tweede.staat, { nu: nuNa(30) })[0].tijd, nuNa(24).toISOString());
});

test("voortgang blijft bewaard: te weinig verzoeken in één run, de volgende run maakt af", async () => {
  const ai = goedeAI();
  const eerste = await b.draaiBesluitenlijst(basis({ vraagAI: ai.vraag, maxAI: 2 }));
  assert.equal(eerste.staat.vergaderingen[ID].status, "pdf");
  const klaarNa1 = eerste.staat.vergaderingen[ID].blokken.filter((x) => x.alinea).length;
  assert.ok(klaarNa1 > 0 && klaarNa1 < eerste.staat.vergaderingen[ID].blokken.length);
  assert.equal(b.maakRecords(eerste.staat).length, 0, "nog geen bericht");
  let r = eerste;
  for (let i = 0; i < 6 && r.staat.vergaderingen[ID].status !== "klaar"; i++) {
    r = await b.draaiBesluitenlijst(basis({ staat: r.staat, nu: nuNa(25 + i), vraagAI: ai.vraag, maxAI: 3 }));
  }
  assert.equal(r.staat.vergaderingen[ID].status, "klaar");
  assert.ok(r.staat.vergaderingen[ID].blokken.every((x) => x.alinea));
});

test("een quotumfout (429) stopt de ronde en verliest niets", async () => {
  const r = await b.draaiBesluitenlijst(basis({ vraagAI: async () => { throw Object.assign(new Error("quota"), { status: 429 }); }, maxAI: 99 }));
  assert.equal(r.stats.quotum, true);
  assert.equal(r.staat.vergaderingen[ID].status, "pdf");
  assert.ok(r.staat.vergaderingen[ID].blokken.every((x) => x.alinea === null));
  assert.equal(b.maakRecords(r.staat).length, 0);
});

test("een afgekeurde alinea wordt één keer opnieuw gevraagd en dan door de code geschreven, nooit met een verkeerde uitslag", async () => {
  const ai = goedeAI({ fout: "m:26M80" });
  let r = await b.draaiBesluitenlijst(basis({ vraagAI: ai.vraag, maxAI: 99 }));
  const blok = () => r.staat.vergaderingen[ID].blokken.find((x) => x.id === "m:26M80");
  assert.equal(blok().alinea, null);
  assert.equal(blok().pogingen, 1);
  assert.equal(r.staat.vergaderingen[ID].status, "pdf");
  r = await b.draaiBesluitenlijst(basis({ staat: r.staat, nu: nuNa(25), vraagAI: ai.vraag, maxAI: 99 }));
  assert.equal(blok().alineaBron, "code");
  assert.equal(blok().alinea, "Motie 26M80 ‘Zaans Preventiemodel’: 38 stemmen voor, 0 stemmen tegen (aangenomen).");
  assert.equal(r.staat.vergaderingen[ID].status, "klaar");
  assert.equal(b.maakRecords(r.staat, { nu: nuNa(25) })[0].besluitenlijst.alineasDoorCode, 1);
});

test("faalt de kop twee keer, dan komt er een vaste kop", async () => {
  const goed = goedeAI();
  const vraag = async (p) => (p.includes('{"kop"') ? { data: { kop: "Raad stemt 99 keer in met Wethouder Onbekend" }, verzoeken: 1 } : goed.vraag(p));
  let r = await b.draaiBesluitenlijst(basis({ vraagAI: vraag, maxAI: 99 }));
  r = await b.draaiBesluitenlijst(basis({ staat: r.staat, nu: nuNa(25), vraagAI: vraag, maxAI: 99 }));
  assert.equal(r.staat.vergaderingen[ID].status, "klaar");
  assert.equal(r.staat.vergaderingen[ID].kopBron, "code");
  assert.equal(r.staat.vergaderingen[ID].kop2, "Besluitenlijst gemeenteraad Zaanstad 10 november 2026 (begroting)");
});

test("na 48 uur schrijft de code de rest zelf, zodat het bericht niet blijft hangen", async () => {
  const eerste = await b.draaiBesluitenlijst(basis({ vraagAI: undefined }));
  assert.equal(eerste.staat.vergaderingen[ID].status, "pdf");
  const later = await b.draaiBesluitenlijst(basis({ staat: eerste.staat, nu: nuNa(24 + 49) }));
  assert.equal(later.staat.vergaderingen[ID].status, "klaar");
  assert.ok(later.staat.vergaderingen[ID].blokken.every((x) => x.alineaBron === "code"));
  assert.equal(later.staat.vergaderingen[ID].kopBron, "code");
});

test("nog niet gepubliceerd: wachten, en niet vaker kijken dan elke 3 uur", async () => {
  let paginas = 0;
  const haalHtml = async () => { paginas++; return HTML_ZONDER; };
  let r = await b.draaiBesluitenlijst(basis({ haalHtml, nu: nuNa(2) }));
  assert.equal(r.staat.vergaderingen[ID].status, "wacht");
  assert.equal(paginas, 1);
  r = await b.draaiBesluitenlijst(basis({ staat: r.staat, haalHtml, nu: nuNa(3) }));
  assert.equal(paginas, 1, "binnen 3 uur niet opnieuw");
  r = await b.draaiBesluitenlijst(basis({ staat: r.staat, haalHtml, nu: nuNa(6) }));
  assert.equal(paginas, 2);
});

test("vóór de vergadering niet kijken; 14 dagen na de vergadering opgeven", async () => {
  let paginas = 0;
  const haalHtml = async () => { paginas++; return HTML_ZONDER; };
  await b.draaiBesluitenlijst(basis({ haalHtml, nu: nuNa(-5) }));
  assert.equal(paginas, 0);
  const r = await b.draaiBesluitenlijst(basis({ haalHtml, nu: nuNa(15 * 24) }));
  assert.equal(paginas, 0);
  assert.equal(r.staat.vergaderingen[ID].status, "geen");
});

test("een PDF die niet leesbaar is: fout bewaard, na vier pogingen mislukt", async () => {
  let r = null;
  for (let i = 0; i < 4; i++) {
    r = await b.draaiBesluitenlijst(basis({ staat: r && r.staat, nu: nuNa(24 + i * 4), haalPdfTekst: async () => { throw new Error("HTTP 403"); } }));
  }
  assert.equal(r.staat.vergaderingen[ID].status, "mislukt");
  assert.match(r.staat.vergaderingen[ID].fout, /403/);
  const leeg = await b.draaiBesluitenlijst(basis({ haalPdfTekst: async () => "niets" }));
  assert.match(leeg.staat.vergaderingen[ID].fout, /geen besluiten/);
});

test("leesModus: standaard schaduw", () => {
  assert.equal(b.leesModus({}), "schaduw");
  assert.equal(b.leesModus({ ZANP_BESLUITENLIJST_MODUS: "aan" }), "aan");
  assert.equal(b.leesModus({ ZANP_BESLUITENLIJST_MODUS: "uit" }), "uit");
  assert.equal(b.leesMaxAI({}), 6);
  assert.equal(b.leesMaxAI({ ZANP_BESLUITENLIJST_MAX: "2" }), 2);
});

// --- in de hele run ---------------------------------------------------------------------------------

const nuRun = nuNa(24);
const diversRuw = () => ({ bronId: "bekendmakingen", bronNaam: "Bekendmakingen", gepubliceerdOp: nuRun.toISOString(), url: "https://voorbeeld.nl/niets", titel: "Kennisgeving iets anders", samenvatting: "Een kennisgeving die hier niets mee te maken heeft." });
const runDeps = (modus, extra = {}) => ({
  nu: nuRun, apiKey: null, env: { ZANP_BESLUITENLIJST_MODUS: modus }, scrape: async () => [diversRuw(), kalender()], haalTekst: async () => {},
  besluitenlijst: { haalHtml: async () => HTML_MET, haalPdfTekst: async () => TEKST, vraagAI: goedeAI().vraag, ...extra },
});

test("run in schaduwmodus: bestand bewaard, niets in de stroom", async () => {
  fs.rmSync(map, { recursive: true, force: true }); fs.mkdirSync(map);
  await z.draai(runDeps("schaduw"));
  const bestand = leesData(map, "zanp-besluitenlijsten.json");
  assert.equal(bestand.modus, "schaduw");
  assert.equal(bestand.vergaderingen[ID].status, "klaar");
  assert.ok(!leesData(map, "berichten.json").berichten.some((x) => x.bronId === "besluitenlijst"));
});

test("run in modus aan: bericht in de stroom, blijft bij de volgende run, niet dubbel", async () => {
  fs.rmSync(map, { recursive: true, force: true }); fs.mkdirSync(map);
  await z.draai(runDeps("aan"));
  let berichten = leesData(map, "berichten.json").berichten.filter((x) => x.bronId === "besluitenlijst");
  assert.equal(berichten.length, 1);
  assert.equal(berichten[0].besluitenlijst.pdfUrl, PDF_URL);
  assert.ok(berichten[0].tekst.includes("Motie 26M80"));
  let gevraagd = 0;
  await z.draai({ ...runDeps("aan"), nu: new Date(nuRun.getTime() + 3600 * 1000), besluitenlijst: { haalHtml: async () => { gevraagd++; return HTML_MET; }, haalPdfTekst: async () => TEKST, vraagAI: async () => { gevraagd++; return { data: {} }; } } });
  berichten = leesData(map, "berichten.json").berichten.filter((x) => x.bronId === "besluitenlijst");
  assert.equal(berichten.length, 1);
  assert.equal(gevraagd, 0);
});

test("modus uit: een bestand zonder vergaderingen en geen bericht", async () => {
  fs.rmSync(map, { recursive: true, force: true }); fs.mkdirSync(map);
  await z.draai(runDeps("uit"));
  const bestand = leesData(map, "zanp-besluitenlijsten.json");
  assert.equal(bestand.modus, "uit");
  assert.deepEqual(bestand.vergaderingen, {});
});
