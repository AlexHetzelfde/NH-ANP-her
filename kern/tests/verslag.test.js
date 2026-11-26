// Verslag van de raadsvergadering (verslag.js), op het echte verslag van 10 november 2026.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { tijdelijkeDataMap, leesData } = require("./helpers");
const map = tijdelijkeDataMap(); // vóór het laden van zanp.js
const v = require("../functies/verslag");
const bl = require("../functies/besluitenlijst");
const z = require("../zanp");

const VERSLAG = fs.readFileSync(path.join(__dirname, "fixtures", "verslag-2026-11-10.txt"), "utf8");
const LIJST = fs.readFileSync(path.join(__dirname, "fixtures", "besluitenlijst-2026-11-10.txt"), "utf8");
const parse = () => v.parseVerslag(VERSLAG);

const ID = "e8ab757c-5aeb-4c48-9d4b-a263b2526a76";
const VERGADERING_URL = `https://zaanstad.bestuurlijkeinformatie.nl/Agenda/Index/${ID}`;
const PDF_URL = `https://zaanstad.bestuurlijkeinformatie.nl/Document/LoadAgendaDocument/a7f90855-40de-4f69-88f5-ab53fbbfcd29?agendaId=${ID}`;
const start = "2026-11-10T18:00:00.000Z";
const nuNa = (dagen) => new Date(Date.parse(start) + dagen * 24 * 3600 * 1000);

const HTML_MET = `<html><body><div class="attachments">
  <a href="#" data-document-url="/Document/LoadAgendaDocument/62b5988a-1b23-4384-a6e6-71c0f70717f8?agendaId=${ID}">Besluitenlijst raadsvergadering 10 november 2026</a>
  <a href="#" data-document-url="/Document/LoadAgendaDocument/a7f90855-40de-4f69-88f5-ab53fbbfcd29?agendaId=${ID}">Verslag raadsvergadering begroting 10 november 2026</a>
</div>
<ul><li><a href="#" data-document-url="/Document/LoadAgendaItemDocument/f6332806-d8ac-44f2-8f58-261f40138b29?agendaItemId=f929fc76-e171-4d44-8059-ecbcac8226af">Verslag raadsvergadering 08 september 2026</a></li></ul></body></html>`;
const HTML_ZONDER = `<html><body><div class="attachments"><a href="#" data-document-url="/Document/LoadAgendaDocument/62b5988a-1b23-4384-a6e6-71c0f70717f8?agendaId=${ID}">Besluitenlijst raadsvergadering 10 november 2026</a></div></body></html>`;

const kalender = () => ({ bronId: "zaanstad-kalender", titel: "Raadsvergadering: Begroting", url: `https://zaanstad.bestuurlijkeinformatie.nl/Agenda/Index/${ID}`, gepubliceerdOp: start });

// De staat van de besluitenlijst, zoals besluitenlijst.js hem bewaart (blokken met teksten en uitslagen).
function besluitStaat() {
  const p = bl.parseBesluitenlijst(LIJST);
  return { vergaderingen: { [ID]: { id: ID, datum: p.datum, subtitel: p.subtitel, blokken: p.blokken } } };
}

// Drie lange beurten van raadsleden na elkaar zoeken (bereik voor een onderwerp).
function bereiken(aantal) {
  const beurten = parse().beurten;
  const uit = [];
  let i = 100;
  while (uit.length < aantal && i < beurten.length - 3) {
    if (!beurten[i].voorzitter && beurten[i].tekst.length > 400 && !/["“”]/.test(beurten[i].tekst)) {
      uit.push({ van: beurten[i].n, tot: beurten[i].n });
      i += 40;
    } else i++;
  }
  return uit;
}

// Een "AI": kiest de onderwerpen, en schrijft elk bericht uit de eerste zinnen van de bronbeurt.
function goedeAI(opties = {}) {
  const aanroepen = { selectie: 0, schrijf: 0, prompts: [] };
  const verslag = parse();
  const vraag = async (prompt) => {
    aanroepen.prompts.push(prompt);
    if (prompt.includes('{"onderwerpen"')) {
      aanroepen.selectie++;
      if (opties.slechteSelectie) return { data: { onderwerpen: [{ titel: "x", van: 5000, tot: 5001 }] }, verzoeken: 1, model: "test" };
      const r = bereiken(opties.aantal || 4);
      return { data: { onderwerpen: r.map((x, i) => ({ titel: `Onderwerp ${i + 1}`, reden: "nieuws", van: x.van, tot: x.tot, moties: i === 0 ? ["26A46", "99X99"] : [] })) }, verzoeken: 1, model: "test" };
    }
    aanroepen.schrijf++;
    const ids = [...prompt.matchAll(/=== ONDERWERP (\S+): /g)].map((m) => m[1]);
    const berichten = ids.map((id) => {
      const blok = prompt.split(`=== ONDERWERP ${id}: `)[1];
      const n = Number(blok.match(/\[#(\d+)\]/)[1]);
      const beurt = verslag.beurten.find((b) => b.n === n);
      const zinnen = beurt.tekst.split(/(?<=[.!?])\s+/).slice(0, 3).join(" ");
      if (opties.geen && id === opties.geen) return { id, geen: true };
      let alinea = `${beurt.spreker} zei in het debat: ${zinnen}`;
      if (opties.fout && id === opties.fout) alinea = `${beurt.spreker} sprak over 987654 euro die nergens in het verslag staat en zei verder niets zinnigs over de zaak.`;
      return { id, kop: `Raadsdebat Zaanstad over onderwerp ${"abcdefghijklmno"[Number(id.slice(1)) - 1]} in de begroting`, alinea: alinea.slice(0, 700), bronBeurten: opties.verkeerdeBron === id ? [1] : [n] };
    });
    return { data: { berichten }, verzoeken: 1, model: "test" };
  };
  return { vraag, aanroepen };
}

function basis(extra = {}) {
  return { ruwe: [kalender()], agendaItems: [], staat: null, besluitStaat: besluitStaat(), nu: nuNa(8), haalHtml: async () => HTML_MET, haalPdfTekst: async () => VERSLAG, log: { log() {}, warn() {} }, ...extra };
}

// --- het verslag in beurten -----------------------------------------------------------------------

test("parse: beurten, paginakop weg, wethouders uit de tekst", () => {
  const p = parse();
  assert.equal(p.titel, "Verslag raadsvergadering begroting 10 november 2026");
  assert.ok(p.beurten.length > 700);
  assert.equal(p.beurten[0].spreker, "Voorzitter");
  assert.ok(p.beurten[0].voorzitter);
  assert.ok(p.beurten.every((b, i) => b.n === i + 1 && b.tekst));
  assert.ok(!p.beurten.some((b) => b.tekst.includes("Verslag raadsvergadering begroting 10 november 2026")));
  for (const w of ["Onclin", "Karst"]) assert.ok(p.wethouders.includes(w), w);
  assert.ok(!p.wethouders.includes("Van") && !p.wethouders.includes("De"));
});

test("partijen: uit de indieners in de besluitenlijst, alleen als ze eenduidig zijn", () => {
  const kaart = v.partijenUitTeksten(besluitStaat().vergaderingen[ID].blokken.map((b) => b.tekst));
  assert.equal(v.partijVan("Kuyper", kaart), "ROSA");
  assert.equal(v.partijVan("De Groot", kaart), "SP");
  assert.equal(v.partijVan("Onclin", kaart), null); // wethouder: geen indiener
  const dubbel = new Map([["jan jansen", "VVD"], ["piet jansen", "CDA"]]);
  assert.equal(v.partijVan("Jansen", dubbel), null);
  assert.equal(v.partijVan("Jansen", new Map([["jan jansen", "VVD"], ["jann jansen", "VVD"]])), "VVD");
});

test("context uit de besluitenlijst: moties met indieners en uitslag", () => {
  const c = v.contextUitBesluitenlijst(besluitStaat(), ID);
  const m = c.moties.find((x) => x.nr === "26A46");
  assert.equal(m.status, "verworpen");
  assert.equal(m.voor, 9);
  assert.equal(m.indieners, "Lilit Zeltsburg (PRO), Abdelhak Belkasmi (PRO)");
  assert.equal(v.contextUitBesluitenlijst(null, ID).moties.length, 0);
});

// --- selectie en bericht controleren --------------------------------------------------------------

test("selectie: bereiken moeten bestaan, onbekende moties vallen weg, hooguit 15", () => {
  const verslag = parse();
  const ctx = { moties: [{ nr: "26A46" }] };
  const goed = v.controleerSelectie({ onderwerpen: [{ titel: "a", van: 3, tot: 9, moties: ["26a46", "26A99"] }, { titel: "b", van: 0, tot: 4 }, { titel: "c", van: 9, tot: 3 }, { titel: "d", van: 10, tot: 99999 }] }, verslag, ctx);
  assert.ok(goed.ok);
  assert.equal(goed.onderwerpen.length, 1);
  assert.deepEqual(goed.onderwerpen[0].moties, ["26A46"]);
  assert.equal(v.controleerSelectie({ onderwerpen: [] }, verslag, ctx).ok, false);
  assert.equal(v.controleerSelectie({}, verslag, ctx).ok, false);
  const veel = Array.from({ length: 30 }, (_, i) => ({ titel: `t${i}`, van: i + 1, tot: i + 2 }));
  assert.equal(v.controleerSelectie({ onderwerpen: veel }, verslag, ctx).onderwerpen.length, 15);
});

test("bericht: getal, citaat, lengte en bronbeurt worden gecontroleerd", () => {
  const verslag = parse();
  const [r] = bereiken(1);
  const o = { id: "o1", titel: "x", van: r.van, tot: r.tot, moties: [] };
  const b = verslag.beurten.find((x) => x.n === r.van);
  const ctx = { moties: [], sprekers: new Map([[b.spreker, null]]) };
  const meta = { datum: "10-11-2026" };
  const zinnen = b.tekst.split(/(?<=[.!?])\s+/).slice(0, 3).join(" ").slice(0, 600);
  const goed = { kop: "Raad Zaanstad bespreekt een onderwerp uit de begroting", alinea: `${b.spreker} zei: ${zinnen}`, bronBeurten: [r.van] };
  assert.ok(v.controleerBericht(o, goed, verslag, ctx, meta).ok);
  assert.equal(v.controleerBericht(o, { ...goed, alinea: goed.alinea + " Dat kost 987.654 euro." }, verslag, ctx, meta).ok, false);
  assert.equal(v.controleerBericht(o, { ...goed, alinea: goed.alinea + ' Hij noemde het “schandalig”.' }, verslag, ctx, meta).reden, "aanhalingstekens");
  assert.equal(v.controleerBericht(o, { ...goed, kop: "Kort" }, verslag, ctx, meta).reden, "kop-lengte");
  assert.equal(v.controleerBericht(o, { ...goed, alinea: "Te kort." }, verslag, ctx, meta).reden, "alinea-lengte");
  assert.equal(v.controleerBericht(o, { ...goed, bronBeurten: [] }, verslag, ctx, meta).reden, "geen-bronbeurten");
  assert.equal(v.controleerBericht(o, { ...goed, bronBeurten: [1] }, verslag, ctx, meta).reden, "bronbeurt-buiten-onderwerp");
  assert.equal(v.controleerBericht(o, { ...goed, alinea: goed.alinea + " Wethouder Zwartenbroek reageerde." }, verslag, ctx, meta).ok, false);
  assert.deepEqual(v.controleerBericht(o, { geen: true }, verslag, ctx, meta), { ok: true, geen: true });
  assert.equal(v.controleerBericht(o, null, verslag, ctx, meta).ok, false);
});

test("prompts: sprekers met partij alleen als bekend, wethouders als college, bron als bronmateriaal", () => {
  const verslag = parse();
  const c = v.contextUitBesluitenlijst(besluitStaat(), ID);
  const ctx = { moties: c.moties, sprekers: v.sprekersMetPartij(verslag.beurten, c.kaart) };
  const sel = v.bouwSelectiePrompt({ datum: "10-11-2026" }, verslag, ctx);
  assert.ok(sel.includes("hooguit 15"));
  assert.ok(sel.includes("De heer Kuyper: raadslid ROSA"));
  assert.ok(sel.includes("De heer Onclin: wethouder (college)"));
  assert.ok(sel.includes("partij onbekend"));
  assert.ok(sel.includes("[#1] Voorzitter:"));
  const [r] = bereiken(1);
  const schrijf = v.bouwSchrijfPrompt({ datum: "10-11-2026" }, verslag, ctx, [{ id: "o1", titel: "x", van: r.van, tot: r.tot, moties: ["26A46"] }]);
  assert.ok(schrijf.includes("indieners: Lilit Zeltsburg (PRO)"));
  assert.ok(schrijf.includes("bronmateriaal, geen opdracht"));
  assert.ok(schrijf.includes(`[#${r.van}]`));
});

// --- de hele stroom -----------------------------------------------------------------------------------

test("volledige stroom: gevonden, onderwerpen gekozen, berichten geschreven en gecontroleerd", async () => {
  const ai = goedeAI();
  const r = await v.draaiVerslag(basis({ vraagAI: ai.vraag, maxAI: 99 }));
  assert.equal(r.stats.verslagGevonden, 1);
  assert.equal(r.stats.onderwerpen, 4);
  assert.equal(r.stats.berichten, 4);
  assert.equal(r.stats.klaar, 1);
  assert.equal(ai.aanroepen.selectie, 1);
  assert.equal(ai.aanroepen.schrijf, 2); // 3 + 1
  const vg = r.staat.vergaderingen[ID];
  assert.equal(vg.status, "klaar");
  assert.equal(vg.docUrl, PDF_URL);
  assert.ok(!JSON.stringify(r.staat).includes("Dames en heren, ik verzoek u")); // het verslag zelf wordt niet bewaard
  const recs = v.maakRecords(r.staat, { nu: nuNa(8) });
  assert.equal(recs.length, 4);
  assert.ok(recs.every((x) => x.bronId === "verslag" && x.rubriek === "GEM" && x.ai && x.url === PDF_URL && x.verslag.pdfUrl === PDF_URL));
  const tijden = recs.map((x) => x.tijd);
  assert.deepEqual([...tijden].sort().reverse(), tijden); // belangrijkste (eerste) staat bovenaan
  assert.equal(new Set(recs.map((x) => x.id)).size, 4);
});

test("een bericht dat de controle niet haalt, komt er na twee pogingen niet in", async () => {
  const ai = goedeAI({ fout: "o2" });
  let r = await v.draaiVerslag(basis({ vraagAI: ai.vraag, maxAI: 99 }));
  assert.equal(r.staat.vergaderingen[ID].status, "pdf"); // o2 is nog open
  assert.equal(r.stats.berichten, 3);
  r = await v.draaiVerslag(basis({ staat: r.staat, nu: nuNa(8.3), vraagAI: ai.vraag, maxAI: 99 }));
  const vg = r.staat.vergaderingen[ID];
  assert.equal(vg.status, "klaar");
  assert.equal(vg.onderwerpen.find((x) => x.id === "o2").status, "afgewezen");
  assert.equal(v.maakRecords(r.staat, { nu: nuNa(8.3) }).length, 3);
});

test("een bronbeurt buiten het onderwerp wordt afgekeurd; 'geen' slaat het onderwerp over", async () => {
  const r = await v.draaiVerslag(basis({ vraagAI: goedeAI({ verkeerdeBron: "o1", geen: "o3" }).vraag, maxAI: 99 }));
  const o = r.staat.vergaderingen[ID].onderwerpen;
  assert.equal(o.find((x) => x.id === "o1").status, "open");
  assert.equal(o.find((x) => x.id === "o1").laatsteReden, "bronbeurt-buiten-onderwerp");
  assert.equal(o.find((x) => x.id === "o3").status, "overgeslagen");
});

test("een slechte selectie: twee pogingen, dan mislukt (geen bericht)", async () => {
  const ai = goedeAI({ slechteSelectie: true });
  let r = await v.draaiVerslag(basis({ vraagAI: ai.vraag, maxAI: 99 }));
  assert.equal(r.staat.vergaderingen[ID].status, "pdf");
  r = await v.draaiVerslag(basis({ staat: r.staat, nu: nuNa(8.3), vraagAI: ai.vraag, maxAI: 99 }));
  assert.equal(r.staat.vergaderingen[ID].status, "mislukt");
  assert.equal(v.maakRecords(r.staat, { nu: nuNa(9) }).length, 0);
});

test("zonder AI: verslag gevonden, geen berichten, volgende run gaat verder", async () => {
  let r = await v.draaiVerslag(basis({}));
  assert.equal(r.staat.vergaderingen[ID].status, "pdf");
  assert.equal(v.maakRecords(r.staat, { nu: nuNa(8) }).length, 0);
  r = await v.draaiVerslag(basis({ staat: r.staat, nu: nuNa(8.1), vraagAI: goedeAI().vraag, maxAI: 99 }));
  assert.equal(r.staat.vergaderingen[ID].status, "klaar");
});

test("maxAI: hooguit zoveel verzoeken per run, de rest volgt later", async () => {
  const ai = goedeAI();
  let r = await v.draaiVerslag(basis({ vraagAI: ai.vraag, maxAI: 2 }));
  assert.equal(ai.aanroepen.selectie + ai.aanroepen.schrijf, 2);
  assert.equal(r.staat.vergaderingen[ID].status, "pdf");
  r = await v.draaiVerslag(basis({ staat: r.staat, nu: nuNa(8.1), vraagAI: ai.vraag, maxAI: 2 }));
  assert.equal(ai.aanroepen.selectie, 1); // de selectie wordt niet herhaald
  assert.equal(r.staat.vergaderingen[ID].status, "klaar");
});

test("quotum (429): stoppen zonder fout, volgende run verder", async () => {
  const quota = async () => { const f = new Error("quota"); f.status = 429; throw f; };
  const r = await v.draaiVerslag(basis({ vraagAI: quota, maxAI: 99 }));
  assert.equal(r.stats.quotum, true);
  assert.equal(r.staat.vergaderingen[ID].status, "pdf");
  assert.equal(r.staat.vergaderingen[ID].onderwerpen, undefined);
});

test("een gewijzigd verslag (andere hash): de selectie begint opnieuw", async () => {
  const ai = goedeAI();
  let r = await v.draaiVerslag(basis({ vraagAI: ai.vraag, maxAI: 1 }));
  assert.ok(r.staat.vergaderingen[ID].onderwerpen);
  r = await v.draaiVerslag(basis({ staat: r.staat, nu: nuNa(8.1), haalPdfTekst: async () => VERSLAG + "\nVoorzitter: Een extra beurt aan het eind van het verslag.", vraagAI: ai.vraag, maxAI: 1 }));
  assert.equal(ai.aanroepen.selectie, 2);
});

test("na 72 uur: open onderwerpen worden opgegeven en het geheel is klaar", async () => {
  const ai = goedeAI({ fout: "o2" });
  let r = await v.draaiVerslag(basis({ vraagAI: ai.vraag, maxAI: 99 }));
  r = await v.draaiVerslag(basis({ staat: r.staat, nu: new Date(nuNa(8).getTime() + 80 * 3600 * 1000), vraagAI: async () => ({ data: { berichten: [] } }), maxAI: 99 }));
  assert.equal(r.staat.vergaderingen[ID].status, "klaar");
});

test("nog niet gepubliceerd: wachten en niet vaker kijken dan elke 6 uur", async () => {
  let aantal = 0;
  const html = async () => { aantal++; return HTML_ZONDER; };
  let r = await v.draaiVerslag(basis({ haalHtml: html }));
  assert.equal(aantal, 1);
  assert.equal(r.staat.vergaderingen[ID].status, "wacht");
  r = await v.draaiVerslag(basis({ staat: r.staat, nu: new Date(nuNa(8).getTime() + 3 * 3600 * 1000), haalHtml: html }));
  assert.equal(aantal, 1);
  r = await v.draaiVerslag(basis({ staat: r.staat, nu: new Date(nuNa(8).getTime() + 7 * 3600 * 1000), haalHtml: html }));
  assert.equal(aantal, 2);
});

test("het verslag van een agendapunt telt niet, en de besluitenlijst ook niet", async () => {
  const r = await v.draaiVerslag(basis({ haalHtml: async () => HTML_ZONDER }));
  assert.equal(r.staat.vergaderingen[ID].status, "wacht");
});

test("vóór de vergadering niet kijken; 45 dagen na de vergadering opgeven", async () => {
  let aantal = 0;
  const html = async () => { aantal++; return HTML_ZONDER; };
  await v.draaiVerslag(basis({ nu: new Date(Date.parse(start) - 3600 * 1000), haalHtml: html }));
  assert.equal(aantal, 0);
  const r = await v.draaiVerslag(basis({ nu: nuNa(50), haalHtml: html }));
  assert.equal(aantal, 0);
  assert.equal(r.staat.vergaderingen[ID].status, "geen");
});

test("een PDF die niet leesbaar is: fout bewaard, na vier pogingen mislukt", async () => {
  let r = null;
  for (let i = 0; i < 4; i++) {
    r = await v.draaiVerslag(basis({ staat: r && r.staat, nu: nuNa(8 + i * 0.1), haalPdfTekst: async () => { throw new Error("download mislukt"); }, vraagAI: goedeAI().vraag, maxAI: 9 }));
  }
  assert.equal(r.staat.vergaderingen[ID].status, "mislukt");
  assert.ok(r.staat.vergaderingen[ID].fout.includes("download mislukt"));
});

test("een tekst zonder beurten telt als fout (opmaak veranderd)", async () => {
  const r = await v.draaiVerslag(basis({ haalPdfTekst: async () => "Verslag\nEen tekst zonder sprekers.\nNog een regel.", vraagAI: goedeAI().vraag, maxAI: 9 }));
  assert.ok(r.staat.vergaderingen[ID].fout.includes("geen beurten"));
});

test("leesModus: standaard schaduw", () => {
  assert.equal(v.leesModus({}), "schaduw");
  assert.equal(v.leesModus({ ZANP_VERSLAG_MODUS: "aan" }), "aan");
  assert.equal(v.leesModus({ ZANP_VERSLAG_MODUS: "uit" }), "uit");
  assert.equal(v.leesMaxAI({}), 8);
  assert.equal(v.leesMaxAI({ ZANP_VERSLAG_MAX: "2" }), 2);
});

// --- in de hele run ---------------------------------------------------------------------------------

const nuRun = nuNa(8);
const diversRuw = () => ({ bronId: "bekendmakingen", bronNaam: "Bekendmakingen", gepubliceerdOp: nuRun.toISOString(), url: "https://voorbeeld.nl/niets", titel: "Kennisgeving iets anders", samenvatting: "Een kennisgeving die hier niets mee te maken heeft." });
const runDeps = (modus, extra = {}) => ({
  nu: nuRun, apiKey: null, env: { ZANP_VERSLAG_MODUS: modus, ZANP_BESLUITENLIJST_MODUS: "uit" }, scrape: async () => [diversRuw(), kalender()], haalTekst: async () => {},
  verslag: { haalHtml: async () => HTML_MET, haalPdfTekst: async () => VERSLAG, vraagAI: goedeAI().vraag, besluitStaat: besluitStaat(), ...extra },
});

test("run in schaduwmodus: bestand bewaard, niets in de stroom", async () => {
  fs.rmSync(map, { recursive: true, force: true }); fs.mkdirSync(map);
  await z.draai(runDeps("schaduw"));
  const bestand = leesData(map, "zanp-verslagen.json");
  assert.equal(bestand.modus, "schaduw");
  assert.equal(bestand.vergaderingen[ID].status, "klaar");
  assert.ok(!leesData(map, "berichten.json").berichten.some((x) => x.bronId === "verslag"));
});

test("run in modus aan: berichten in de stroom, blijven bij de volgende run, niet dubbel", async () => {
  fs.rmSync(map, { recursive: true, force: true }); fs.mkdirSync(map);
  await z.draai(runDeps("aan"));
  let berichten = leesData(map, "berichten.json").berichten.filter((x) => x.bronId === "verslag");
  assert.equal(berichten.length, 4);
  assert.equal(berichten[0].verslag.pdfUrl, PDF_URL);
  let gevraagd = 0;
  await z.draai({ ...runDeps("aan"), nu: new Date(nuRun.getTime() + 3600 * 1000), verslag: { haalHtml: async () => { gevraagd++; return HTML_MET; }, haalPdfTekst: async () => { gevraagd++; return VERSLAG; }, vraagAI: async () => { gevraagd++; return { data: {} }; }, besluitStaat: besluitStaat() } });
  berichten = leesData(map, "berichten.json").berichten.filter((x) => x.bronId === "verslag");
  assert.equal(berichten.length, 4);
  assert.equal(gevraagd, 0);
});

test("modus uit: een bestand zonder vergaderingen en geen bericht", async () => {
  fs.rmSync(map, { recursive: true, force: true }); fs.mkdirSync(map);
  await z.draai(runDeps("uit"));
  const bestand = leesData(map, "zanp-verslagen.json");
  assert.equal(bestand.modus, "uit");
  assert.deepEqual(bestand.vergaderingen, {});
});
