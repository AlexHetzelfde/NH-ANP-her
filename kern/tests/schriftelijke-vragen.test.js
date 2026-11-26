// Tests voor de schriftelijke vragen: detailpagina, wanneer iets gepubliceerd wordt,
// het verloop vraag (versie 1) -> antwoord (versie 2) en de rode regel. Zonder netwerk:
// de lijst en de detailpagina zijn nagemaakt. De detailpagina is een verkleind
// exemplaar van een echte pagina (vraag 1024, DZ, huisbezoeken).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { tijdelijkeDataMap } = require("./helpers");

const map = tijdelijkeDataMap();

const V = require("../scrapers/schriftelijke-vragen");
const wire = require("../ai/wire");
const { vraagRood } = require("../signalering/prioriteit/regels");
const { vandaagAmsterdam } = require("../basis/hulpmiddelen");

const BASIS = "https://zaanstad.bestuurlijkeinformatie.nl";
const ITEM_ID = "97e973b3-ebd2-4d29-807e-7a954e451295";
const ITEM_URL = `${BASIS}/Reports/Item/${ITEM_ID}`;

function dagMinus(n) {
  const d = new Date(`${vandaagAmsterdam()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  const [j, m, dd] = d.toISOString().slice(0, 10).split("-");
  return `${dd}-${m}-${j}`;
}

const DETAIL_HTML = (extra = "") => `<!DOCTYPE html><html><body><main>
<h1>Schriftelijke vragen</h1><h2>Artikel 51 vragen DZ Uitvoering gemeentelijke huisbezoeken interventie-teams en waarborgen voor inwoners</h2>
<dl class="row">
<dt class="col-sm-3">ID</dt><dd class="col-sm-9">1024</dd>
<dt class="col-sm-3">Datum vraag</dt><dd class="col-sm-9">30-07-2026</dd>
<dt class="col-sm-3">Onderwerp</dt><dd class="col-sm-9">Artikel 51 vragen DZ Uitvoering gemeentelijke huisbezoeken interventie-teams en waarborgen voor inwoners</dd>
<dt class="col-sm-3">Raadsleden</dt><dd class="col-sm-9"><ul class="mb-0 pl-3"><li>Rot, Juliette</li><li>Doe, Jan</li></ul></dd>
<dt class="col-sm-3">Steunfractielid</dt><dd class="col-sm-9"></dd>
<dt class="col-sm-3">Partij</dt><dd class="col-sm-9"><ul class="mb-0 pl-3"><li>DZ</li></ul></dd>
<dt class="col-sm-3">Portefeuillehouder</dt><dd class="col-sm-9"><ul class="mb-0 pl-3"><li>Hamming, J.</li></ul></dd>
<dt class="col-sm-3">Toelichting</dt><dd class="col-sm-9"><span class="pre-line">De beantwoording vraagt afstemming met diverse afdelingen en dit vraagt meer tijd.
Het streven is om uw brief voor 4 december te beantwoorden.</span></dd>
<dt class="col-sm-3">Datum tussenantwoord</dt><dd class="col-sm-9"></dd>
<dt class="col-sm-3">Verwachte datum afdoening</dt><dd class="col-sm-9">04-12-2026</dd>
<dt class="col-sm-3">Afgedaan</dt><dd class="col-sm-9"><i class="far fa-square" title="Niet afgedaan"></i><span class="sr-only">Niet afgedaan</span></dd>
<dt class="col-sm-3">Datum antwoord</dt><dd class="col-sm-9"></dd>
<dt class="col-sm-3">Bijlage(s)</dt><dd class="col-sm-9"><ul class="list-group list-attachments">
<li class="list-group-item"><a href="/Reports/Document/${ITEM_ID}?documentId=e045e4ea-be27-4f19-8db3-d72e53dae07b"><span class="icon pdf"></span> Artikel 51 vragen DZ Uitvoering gemeentelijke huisbezoeken <span class="badge">170 KB</span></a></li>
<li class="list-group-item"><a href="/Reports/Document/${ITEM_ID}?documentId=b64adb6a-5bb7-4747-b7cc-5abe9e6e9c76"><span class="icon pdf"></span> Uitstelbrief artikel 51 vragen DZ <span class="badge">55 KB</span></a></li>
<li class="list-group-item"><a href="/Reports/Document/${ITEM_ID}?documentId=3af4857e-72a1-4488-9ca6-2a8dcecf1383"><span class="icon pdf"></span> Uitstelbrief artikel 51 vragen DZ <span class="badge">55 KB</span></a></li>
${extra}
</ul></dd>
</dl></main></body></html>`;

// ---------------------------------------------------------------------------
// Detailpagina
// ---------------------------------------------------------------------------

test("detailpagina: lijsten blijven lijsten, lege velden vallen weg, bijlagen zonder dubbelen", () => {
  const { velden, bijlagen } = V.parseerVraagDetail(DETAIL_HTML(), `${ITEM_URL}`);
  assert.deepEqual(velden["raadsleden"], ["Rot, Juliette", "Doe, Jan"]);
  assert.deepEqual(velden["partij"], ["DZ"]);
  assert.equal(velden["verwachte datum afdoening"], "04-12-2026");
  assert.equal(velden["steunfractielid"], undefined);
  assert.equal(velden["datum antwoord"], undefined);
  assert.match(velden["toelichting"], /voor 4 december/);
  // twee identieke uitstelbrieven met verschillend documentId blijven twee bijlagen; de naam is geschoond
  assert.equal(bijlagen.length, 3);
  assert.equal(bijlagen[0].naam, "Artikel 51 vragen DZ Uitvoering gemeentelijke huisbezoeken");
});

test("bijlagesoort: vraag, antwoord of uitstel", () => {
  assert.equal(V.soortBijlage("Uitstelbrief artikel 51 vragen"), "uitstel");
  assert.equal(V.soortBijlage("Beantwoording artikel 51 vragen DZ"), "antwoord");
  assert.equal(V.soortBijlage("Antwoordbrief college"), "antwoord");
  assert.equal(V.soortBijlage("Artikel 51 vragen DZ Uitvoering"), "vraag");
});

// ---------------------------------------------------------------------------
// Lijstrij
// ---------------------------------------------------------------------------

test("lijstrij: afgedaan in verschillende vormen, datums uit de lijst", () => {
  assert.equal(V.isAfgedaan(true), true);
  assert.equal(V.isAfgedaan("True"), true);
  assert.equal(V.isAfgedaan("Ja"), true);
  assert.equal(V.isAfgedaan('<i class="fas fa-check-square"></i>'), true);
  assert.equal(V.isAfgedaan("False"), false);
  assert.equal(V.isAfgedaan("Nee"), false);
  assert.equal(V.isAfgedaan(""), false);
  assert.equal(V.isAfgedaan(null), false);
  assert.equal(V.isAfgedaan('<i class="far fa-square"></i><span class="sr-only">Niet afgedaan</span>'), false);

  const rij = V.parseRij(
    { DT_RowId: `row_${ITEM_ID}`, title: " Artikel 51 vragen DZ  ", registrationdate: "30-07-2026", afgedaan: "False", datumantwoord: "" },
    BASIS
  );
  assert.equal(rij.url, ITEM_URL);
  assert.equal(rij.onderwerp, "Artikel 51 vragen DZ");
  assert.ok(rij.datumVraag);
  assert.equal(rij.datumAntwoord, null);
  assert.equal(V.isBeantwoord(rij), false);
});

// ---------------------------------------------------------------------------
// Wanneer publiceren?
// ---------------------------------------------------------------------------

const rij = (o) => V.parseRij({ DT_RowId: ITEM_ID, title: "Vragen over X", registrationdate: dagMinus(1), afgedaan: "False", datumantwoord: "", ...o }, BASIS);

test("nieuwe vraag van gisteren: publiceren als gesteld", () => {
  assert.deepEqual(V.beslis(rij({}), undefined), { actie: "publiceer", status: "gesteld", reden: "nieuwe vraag" });
});

test("oude open vraag die we niet kennen: niet opnieuw als nieuws", () => {
  assert.equal(V.beslis(rij({ registrationdate: dagMinus(60) }), undefined).actie, "overslaan");
});

test("open vraag die al gepubliceerd is: overslaan, geen detailpagina elk uur", () => {
  assert.equal(V.beslis(rij({}), "gesteld").actie, "overslaan");
});

test("bekende vraag van maanden terug die nu beantwoord is: publiceren als antwoord", () => {
  const b = V.beslis(rij({ registrationdate: dagMinus(120), afgedaan: "True", datumantwoord: dagMinus(0) }), "gesteld");
  assert.equal(b.actie, "publiceer");
  assert.equal(b.status, "beantwoord");
});

test("onbekende vraag met recent antwoord: publiceren als antwoord; met oud antwoord niet", () => {
  assert.equal(V.beslis(rij({ registrationdate: dagMinus(120), datumantwoord: dagMinus(2) }), undefined).status, "beantwoord");
  assert.equal(V.beslis(rij({ registrationdate: dagMinus(120), datumantwoord: dagMinus(40) }), undefined).actie, "overslaan");
});

test("vraag die al als beantwoord bekend is: overslaan", () => {
  assert.equal(V.beslis(rij({ afgedaan: "True", datumantwoord: dagMinus(0) }), "beantwoord").actie, "overslaan");
});

test("antwoorddatum in de toekomst telt niet als antwoord", () => {
  const toekomst = new Date(`${vandaagAmsterdam()}T12:00:00Z`);
  toekomst.setUTCDate(toekomst.getUTCDate() + 5);
  const [j, m, d] = toekomst.toISOString().slice(0, 10).split("-");
  assert.equal(V.isBeantwoord(rij({ datumantwoord: `${d}-${m}-${j}` })), false);
});

// ---------------------------------------------------------------------------
// Geheugen uit berichten.json
// ---------------------------------------------------------------------------

test("bekendeVragen: de nieuwste versie bepaalt de status", () => {
  const pad = path.join(map, "berichten-test.json");
  fs.writeFileSync(
    pad,
    JSON.stringify({
      berichten: [
        { url: "u1", versie: 1, vraag: { status: "gesteld" } },
        { url: "u1", versie: 2, vraag: { status: "beantwoord" } },
        { url: "u2", versie: 1, vraag: { status: "gesteld" } },
        { url: "u3", versie: 1 },
      ],
    })
  );
  const bekend = V.bekendeVragen(pad);
  assert.equal(bekend.get("u1"), "beantwoord");
  assert.equal(bekend.get("u2"), "gesteld");
  assert.equal(bekend.has("u3"), false);
  assert.equal(V.bekendeVragen(path.join(map, "bestaat-niet.json")).size, 0);
});

// ---------------------------------------------------------------------------
// De hele scraper, met nagemaakte iBabs
// ---------------------------------------------------------------------------

function nepFetch(rijen, detailHtml) {
  const echt = global.fetch;
  const verzoeken = [];
  global.fetch = async (url, opties = {}) => {
    verzoeken.push({ url: String(url), methode: opties.method || "GET" });
    const u = String(url);
    const antwoord = (body, status = 200, headers = {}) => ({
      ok: status < 400,
      status,
      headers: { get: (n) => headers[n.toLowerCase()] || null, getSetCookie: () => ["ASP.NET_SessionId=abc; path=/"] },
      json: async () => body,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    if (u.includes("/Reports/GetReportData/")) return antwoord({ data: rijen });
    if (u.includes("/Reports/Item/")) return antwoord(detailHtml);
    if (u.endsWith("/Reports/Details/36b1b6ca-8c4b-4d88-b910-a1edba601ac1")) return antwoord("<html></html>");
    return antwoord("niet gevonden", 404);
  };
  return { verzoeken, herstel: () => (global.fetch = echt) };
}

const BRON = {
  id: "zaanstad-schriftelijke-vragen",
  naam: "Gemeente Zaanstad: schriftelijke vragen (iBabs)",
  categorie: "lokaal",
  type: "schriftelijke-vragen",
  url: `${BASIS}/Reports/Details/36b1b6ca-8c4b-4d88-b910-a1edba601ac1`,
};

test("scraper: nieuwe vraag wordt gepubliceerd met kop, tekst en vraag-object", async () => {
  const lijst = [
    { DT_RowId: `row_${ITEM_ID}`, title: "Artikel 51 vragen DZ Uitvoering gemeentelijke huisbezoeken", registrationdate: dagMinus(0), raadsledenselectie: "Rot, Juliette", partijselectie: "DZ", afgedaan: "False", datumantwoord: "" },
    { DT_RowId: "row_aaaaaaaa-0000-0000-0000-000000000001", title: "Oude vraag", registrationdate: dagMinus(200), afgedaan: "False", datumantwoord: "" },
  ];
  const nep = nepFetch(lijst, DETAIL_HTML());
  try {
    const stil = console.log;
    const warn = console.warn;
    console.log = () => {};
    console.warn = () => {};
    let uit;
    try {
      uit = await V.scrapeSchriftelijkeVragen(BRON);
    } finally {
      console.log = stil;
      console.warn = warn;
    }
    assert.equal(uit.length, 1, "alleen de nieuwe vraag, niet de oude open vraag");
    const b = uit[0];
    assert.equal(b.url, ITEM_URL);
    assert.equal(b.titel, "Schriftelijke vragen: Artikel 51 vragen DZ Uitvoering gemeentelijke huisbezoeken");
    assert.equal(b.vraag.status, "gesteld");
    assert.deepEqual(b.vraag.raadsleden, ["Rot, Juliette", "Doe, Jan"]);
    assert.deepEqual(b.vraag.partijen, ["DZ"]);
    assert.equal(b.vraag.verwachteAfdoening, "2026-12-04");
    assert.equal(b.vasteRubriek, "GEM");
    assert.equal(b.geenAi, true);
    assert.match(b.samenvatting, /Verwachte datum afdoening: 04-12-2026/);
    assert.match(b.samenvatting, /Portefeuillehouder: Hamming, J\./);
    // een detailpagina is alleen voor de vraag die we publiceren opgehaald
    assert.equal(nep.verzoeken.filter((v) => v.url.includes("/Reports/Item/")).length, 1);
  } finally {
    nep.herstel();
  }
});

test("scraper: bekende vraag die nu beantwoord is komt terug met andere kop en status beantwoord", async () => {
  fs.writeFileSync(
    path.join(map, "berichten.json"),
    JSON.stringify({ berichten: [{ url: ITEM_URL, versie: 1, vraag: { status: "gesteld" } }] })
  );
  const lijst = [
    { DT_RowId: `row_${ITEM_ID}`, title: "Artikel 51 vragen DZ Uitvoering gemeentelijke huisbezoeken", registrationdate: "30-07-2026", afgedaan: "True", datumantwoord: dagMinus(0) },
  ];
  const detail = DETAIL_HTML().replace(
    '<dt class="col-sm-3">Datum antwoord</dt><dd class="col-sm-9"></dd>',
    `<dt class="col-sm-3">Datum antwoord</dt><dd class="col-sm-9">${dagMinus(0)}</dd>`
  );
  const nep = nepFetch(lijst, detail);
  try {
    const stil = console.log;
    const warn = console.warn;
    console.log = () => {};
    console.warn = () => {};
    let uit;
    try {
      uit = await V.scrapeSchriftelijkeVragen(BRON);
    } finally {
      console.log = stil;
      console.warn = warn;
    }
    assert.equal(uit.length, 1);
    assert.equal(uit[0].vraag.status, "beantwoord");
    assert.equal(uit[0].titel, "Antwoord op schriftelijke vragen: Artikel 51 vragen DZ Uitvoering gemeentelijke huisbezoeken");
    assert.match(uit[0].samenvatting, /Het college heeft geantwoord/);
    assert.equal(uit[0].url, ITEM_URL, "zelfde url als de vraag, anders geen nieuwe versie");
  } finally {
    nep.herstel();
    fs.rmSync(path.join(map, "berichten.json"), { force: true });
  }
});

// ---------------------------------------------------------------------------
// Vraag -> antwoord als versie 1 -> versie 2, en rood
// ---------------------------------------------------------------------------

const nu = new Date();
const vraagBericht = (status) => ({
  bronId: "zaanstad-schriftelijke-vragen",
  bronNaam: "Gemeente Zaanstad: schriftelijke vragen (iBabs)",
  categorie: "lokaal",
  titel: V.bouwKop("Artikel 51 vragen DZ Uitvoering gemeentelijke huisbezoeken", status),
  url: ITEM_URL,
  samenvatting: status === "beantwoord" ? "Het college heeft geantwoord. Korte tekst." : "Schriftelijke vragen van DZ aan het college. Korte tekst.",
  gepubliceerdOp: nu.toISOString(),
  vraag: { status },
  vasteRubriek: "GEM",
  geenAi: true,
});

test("wire: het antwoord is versie 2 van hetzelfde bericht, ook als de tekst nauwelijks verandert", () => {
  const v1 = wire.planBerichten({ vensterBerichten: [vraagBericht("gesteld")], nu });
  assert.equal(v1.stats.nieuw, 1);
  const rec1 = v1.nieuwe[0].record;
  assert.equal(rec1.versie, 1);
  assert.equal(rec1.vraag.status, "gesteld");

  const v2 = wire.planBerichten({ vensterBerichten: [vraagBericht("beantwoord")], bestaand: [rec1], nu });
  assert.equal(v2.stats.update, 1, "andere kop = nieuwe versie");
  const rec2 = v2.nieuwe[0].record;
  assert.equal(rec2.versie, 2);
  assert.equal(rec2.groepId, rec1.groepId);
  assert.equal(rec2.vraag.status, "beantwoord");
  assert.equal(rec2.rubriek, "GEM");
  assert.equal(rec2.controle, "geen-ai");
  assert.equal(rec2.tijd, nu.toISOString(), "tijd = moment waarop wij het antwoord zagen");
});

test("rood: alleen de beantwoording, en niet langer dan 24 uur", () => {
  const rec1 = wire.planBerichten({ vensterBerichten: [vraagBericht("gesteld")], nu }).nieuwe[0].record;
  const rec2 = wire.planBerichten({ vensterBerichten: [vraagBericht("beantwoord")], bestaand: [rec1], nu }).nieuwe[0].record;

  const rood = vraagRood({ records: [rec1, rec2], nu });
  assert.equal(rood.size, 1, "één url, en alleen vanwege de beantwoorde versie");
  const e = rood.get(`n:${ITEM_URL}`);
  assert.equal(e.reden, "Antwoord op schriftelijke vragen");
  assert.equal(e.route, "regel");

  assert.equal(vraagRood({ records: [rec1], nu }).size, 0, "de vraag zelf is niet rood");
  const morgen = new Date(nu.getTime() + 25 * 3600 * 1000);
  assert.equal(vraagRood({ records: [rec2], nu: morgen }).size, 0, "na 24 uur niet meer rood");
});
