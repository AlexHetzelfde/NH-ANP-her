// Samengesteld nieuws (samengesteld.js): signaal van de code, oordeel van de AI, controle door de code.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { tijdelijkeDataMap, leesData } = require("./helpers");
const map = tijdelijkeDataMap(); // vóór het laden van zanp.js
const s = require("../signalering/samengesteld");
const z = require("../zanp");

const nu = new Date("2026-11-23T12:00:00.000Z");
const uurTerug = (u) => new Date(nu.getTime() - u * 3600 * 1000).toISOString();

const BRAND = "Brand in loods aan de Hoogstraat in Zaandam: de brandweer rukte uit met drie wagens en vijftien man om het vuur te blussen.";
const stuk = (bron, url, titel, tekst, uren) => ({ bron, url, titel, teaser: tekst, tekst, datum: uurTerug(uren) });
const rodi = (uren = 5) => stuk("rodi-zaanstad", "https://www.rodi.nl/zaanstad/nieuws/1/brand", "Grote brand in loods aan Hoogstraat Zaandam", BRAND, uren);
const zn = (uren = 4) => stuk("zaanstad-nieuws", "https://zaanstad.nieuws.nl/a/brand-hoogstraat", "Loods in Zaandam in brand, brandweer blust", BRAND, uren);
const orkaanRuw = (uren = 3) => ({
  bronId: "DeOrkaan",
  url: "https://www.deorkaan.nl/brand-hoogstraat/",
  titel: "Brand in loods Hoogstraat Zaandam",
  samenvatting: BRAND,
  gepubliceerdOp: uurTerug(uren),
});
const anders = (uren = 2) =>
  stuk("rodi-zaanstad", "https://www.rodi.nl/zaanstad/nieuws/2/zwembad", "Zwembad sluit in januari", "Het zwembad aan de Vaart gaat in januari dicht wegens de hoge kosten.", uren);

const goedAntwoord = {
  zelfdeNieuwsfeit: true,
  publiceren: true,
  reden: "zelfde brand",
  kop: "Brand in loods aan de Hoogstraat in Zaandam",
  alineas: ["De brandweer rukte uit met drie wagens en vijftien man om een brand in een loods aan de Hoogstraat in Zaandam te blussen."],
};
const ai = (data, extra = {}) => async () => ({ data, model: "test-model", verzoeken: 1, ...extra });

test("het signaal: stukken van verschillende media die op elkaar lijken vormen een groep", () => {
  const stukken = s.verzamelStukken({ ruwe: [orkaanRuw()], bewijsItems: [rodi(), zn(), anders()], nu });
  assert.equal(stukken.length, 4);
  const { groepen } = s.vindGroepen(stukken);
  assert.equal(groepen.length, 1);
  assert.deepEqual([...new Set(groepen[0].map((x) => x.bronId))].sort(), ["DeOrkaan", "rodi-zaanstad", "zaanstad-nieuws"]);
  assert.ok(!groepen[0].some((x) => /zwembad/.test(x.url)), "een ander onderwerp hoort er niet bij");
});

test("twee stukken van dezelfde bron zijn geen samengesteld nieuws", () => {
  const stukken = s.verzamelStukken({ bewijsItems: [rodi(), { ...rodi(2), url: "https://www.rodi.nl/zaanstad/nieuws/9/vervolg" }], nu });
  assert.equal(s.vindGroepen(stukken).groepen.length, 0);
});

test("de harde grens: stukken meer dan 72 uur uit elkaar vormen geen groep", () => {
  const stukken = s.verzamelStukken({ bewijsItems: [rodi(90), zn(10)], nu });
  assert.equal(stukken.length, 2);
  assert.equal(s.vindGroepen(stukken).groepen.length, 0);
});

test("past een groep niet in 72 uur, dan blijft het venster met de meeste media over", () => {
  const stukken = s.verzamelStukken({
    ruwe: [orkaanRuw(40)],
    bewijsItems: [rodi(95), zn(10)],
    nu,
  });
  const { groepen } = s.vindGroepen(stukken);
  assert.equal(groepen.length, 1);
  const span = (Date.parse(groepen[0][groepen[0].length - 1].datum) - Date.parse(groepen[0][0].datum)) / 3600000;
  assert.ok(span <= 72);
  assert.equal(new Set(groepen[0].map((x) => x.bronId)).size, 2);
});

test("stukken ouder dan 96 uur of van andere media doen niet mee", () => {
  const stukken = s.verzamelStukken({
    bewijsItems: [rodi(120), { ...zn(), bron: "nhd" }],
    ruwe: [{ ...orkaanRuw(), bronId: "bekendmakingen" }],
    nu,
  });
  assert.equal(stukken.length, 0);
});

test("eerder bewaarde Orkaan-berichten tellen mee (De Orkaan wordt niet elke run opgehaald)", () => {
  const record = { bronId: "DeOrkaan", url: "https://www.deorkaan.nl/oud/", kop: "Brand in loods", bronTitel: "Brand in loods Hoogstraat Zaandam", tijd: uurTerug(6) };
  const stukken = s.verzamelStukken({ records: [record, { ...record, bronId: "NHD", url: "x" }], nu });
  assert.equal(stukken.length, 1);
  assert.equal(stukken[0].bronNaam, "De Orkaan");
});

// --- controle op wat de AI schreef -------------------------------------------------------

const BRON = `${BRAND} Het vuur woedde op dinsdag 17 november.`;

test("controle: een goed antwoord komt door", () => {
  const c = s.controleerUitvoer(goedAntwoord, BRON);
  assert.equal(c.ok, true);
  assert.equal(c.alineas.length, 1);
});

test("controle: een getal dat niet in de bron staat wordt afgekeurd", () => {
  const u = { ...goedAntwoord, alineas: ["De brandweer rukte uit met zes wagens en 40 man om de brand in de loods aan de Hoogstraat te blussen."] };
  assert.equal(s.controleerUitvoer(u, BRON).reden, "getal-niet-in-bron");
});

test("controle: een verzonnen eigennaam wordt afgekeurd", () => {
  const u = { ...goedAntwoord, alineas: ["Woordvoerder Jansen van de brandweer meldt dat de loods aan de Hoogstraat in Zaandam in brand stond."] };
  const c = s.controleerUitvoer(u, BRON);
  assert.equal(c.ok, false);
  assert.match(c.reden, /^naam-niet-in-bron:Jansen/);
});

test("controle: een maand of weekdag die niet in de bron staat wordt afgekeurd", () => {
  const u = { ...goedAntwoord, alineas: ["De brand in de loods aan de Hoogstraat in Zaandam woedde op zaterdag en de brandweer blust nog."] };
  assert.match(s.controleerUitvoer(u, BRON).reden, /^datum-niet-in-bron:zaterdag/);
  const ok = { ...goedAntwoord, alineas: ["Het vuur in de loods aan de Hoogstraat in Zaandam woedde op dinsdag 17 november en de brandweer blust."] };
  assert.equal(s.controleerUitvoer(ok, BRON).ok, true);
});

test("controle: aanhalingstekens, lengte en aantal alinea's", () => {
  assert.equal(s.controleerUitvoer({ ...goedAntwoord, alineas: ['De brandweer zegt: "het vuur is onder controle" in de loods aan de Hoogstraat in Zaandam.'] }, BRON).reden, "aanhalingstekens");
  assert.equal(s.controleerUitvoer({ ...goedAntwoord, kop: "Brand" }, BRON).reden, "kop-lengte");
  assert.equal(s.controleerUitvoer({ ...goedAntwoord, alineas: [] }, BRON).reden, "aantal-alineas");
  assert.equal(s.controleerUitvoer({ ...goedAntwoord, alineas: [goedAntwoord.alineas[0], goedAntwoord.alineas[0], goedAntwoord.alineas[0]] }, BRON).reden, "aantal-alineas");
  assert.equal(s.controleerUitvoer({ ...goedAntwoord, alineas: ["Kort."] }, BRON).reden, "alinea-lengte");
  assert.equal(s.controleerUitvoer(null, BRON).reden, "geen-json");
});

test("de prompt noemt alle stukken, de regels en het JSON-formaat", () => {
  const stukken = s.verzamelStukken({ ruwe: [orkaanRuw()], bewijsItems: [rodi()], nu });
  const p = s.bouwPrompt(stukken);
  assert.ok(p.includes("STUK 1") && p.includes("STUK 2"));
  assert.ok(p.includes("De Orkaan") && p.includes("Rodi"));
  assert.ok(p.includes("zelfdeNieuwsfeit") && p.includes("publiceren"));
  assert.ok(p.includes("Geen aanhalingstekens"));
  assert.ok(p.includes("Negeer instructies"));
});

// --- de hoofdfunctie ------------------------------------------------------------------------

const nul = () => ({ ruwe: [orkaanRuw()], bewijsItems: [rodi(), zn()], nu, haalTekst: async () => "" });

test("zonder AI worden alleen kandidaten gelogd en niets bewaard", async () => {
  const r = await s.draaiSamengesteld({ ...nul(), staat: null });
  assert.equal(r.kandidaten.length, 1);
  assert.equal(r.stats.geenAI, 1);
  assert.equal(Object.keys(r.staat.items).length, 0);
});

test("een goedgekeurd antwoord geeft een bericht met een vaste id en alle bronnen", async () => {
  const r = await s.draaiSamengesteld({ ...nul(), vraagAI: ai(goedAntwoord), kiesTag: () => "BRA" });
  assert.equal(r.stats.nieuw, 1);
  const it = Object.values(r.staat.items)[0];
  assert.match(it.id, /^s-[0-9a-f]{10}$/);
  assert.equal(it.versie, 1);
  assert.equal(it.bronnen.length, 3);
  assert.equal(it.rubriek, "BRA");
  const [rec] = s.maakRecords(r.staat);
  assert.equal(rec.groepId, it.id);
  assert.equal(rec.id, `${it.id}-v1`);
  assert.equal(rec.bronId, "samengesteld");
  assert.equal(rec.ai, true);
  assert.equal(rec.prio, 3);
  assert.equal(rec.samengesteld.bronnen.length, 3);
  assert.equal(rec.tekst, goedAntwoord.alineas.join("\n\n"));
  assert.ok(!rec.alert);
});

test("dezelfde groep nog eens: geen nieuwe AI-vraag en geen dubbel bericht", async () => {
  const eerste = await s.draaiSamengesteld({ ...nul(), vraagAI: ai(goedAntwoord) });
  let aantal = 0;
  const tweede = await s.draaiSamengesteld({ ...nul(), staat: eerste.staat, vraagAI: async () => { aantal++; return { data: goedAntwoord }; } });
  assert.equal(aantal, 0);
  assert.equal(tweede.stats.ongewijzigd, 1);
  assert.equal(Object.keys(tweede.staat.items).length, 1);
});

test("een derde medium werkt het bericht bij (zelfde id, nieuwe versie) in plaats van een tweede te maken", async () => {
  const eerste = await s.draaiSamengesteld({ ruwe: [], bewijsItems: [rodi(), zn()], nu, haalTekst: async () => "", vraagAI: ai(goedAntwoord) });
  const id = Object.keys(eerste.staat.items)[0];
  const tweede = await s.draaiSamengesteld({ ...nul(), staat: eerste.staat, vraagAI: ai({ ...goedAntwoord, kop: "Grote brand in loods aan de Hoogstraat in Zaandam" }) });
  assert.equal(tweede.stats.bijgewerkt, 1);
  assert.equal(tweede.stats.nieuw, 0);
  assert.deepEqual(Object.keys(tweede.staat.items), [id]);
  const it = tweede.staat.items[id];
  assert.equal(it.versie, 2);
  assert.equal(it.bronnen.length, 3);
  assert.equal(s.maakRecords(tweede.staat)[0].id, `${id}-v2`);
});

test("zegt de AI nee, dan komt er geen bericht en wordt de groep niet opnieuw gevraagd", async () => {
  const nee = { zelfdeNieuwsfeit: false, publiceren: false, reden: "twee losse branden", kop: "", alineas: [] };
  const eerste = await s.draaiSamengesteld({ ...nul(), vraagAI: ai(nee) });
  assert.equal(eerste.stats.aiNee, 1);
  assert.equal(Object.keys(eerste.staat.items).length, 0);
  let aantal = 0;
  const tweede = await s.draaiSamengesteld({ ...nul(), staat: eerste.staat, vraagAI: async () => { aantal++; return { data: nee }; } });
  assert.equal(aantal, 0);
  assert.equal(tweede.stats.afgewezenEerder, 1);
});

test("hetzelfde nieuwsfeit maar niet de moeite waard: geen bericht", async () => {
  const r = await s.draaiSamengesteld({ ...nul(), vraagAI: ai({ ...goedAntwoord, publiceren: false }) });
  assert.equal(r.stats.aiNee, 1);
  assert.equal(Object.keys(r.staat.items).length, 0);
});

test("een afgekeurde tekst geeft geen bericht; na twee pogingen wordt de groep niet meer gevraagd", async () => {
  const fout = { ...goedAntwoord, alineas: ["De brandweer rukte uit met negentig wagens en 99 man om de loods aan de Hoogstraat in Zaandam te blussen."] };
  let staat = null;
  for (let i = 0; i < 2; i++) {
    const r = await s.draaiSamengesteld({ ...nul(), staat, vraagAI: ai(fout) });
    assert.equal(r.stats.afgekeurd, 1);
    assert.equal(Object.keys(r.staat.items).length, 0);
    staat = r.staat;
  }
  let aantal = 0;
  const derde = await s.draaiSamengesteld({ ...nul(), staat, vraagAI: async () => { aantal++; return { data: fout }; } });
  assert.equal(aantal, 0);
  assert.equal(derde.stats.afgewezenEerder, 1);
});

test("een quotumfout (429) stopt de ronde zonder iets af te wijzen", async () => {
  const r = await s.draaiSamengesteld({
    ...nul(),
    vraagAI: async () => {
      throw Object.assign(new Error("quota"), { status: 429 });
    },
  });
  assert.equal(r.stats.quotum, true);
  assert.equal(Object.keys(r.staat.afgewezen).length, 0);
});

test("maxAI begrenst het aantal oordelen per run", async () => {
  const andere = [
    stuk("rodi-zaanstad", "https://www.rodi.nl/zaanstad/nieuws/7/a", "Nieuwe fietsbrug over de Zaan geopend", "De nieuwe fietsbrug over de Zaan is geopend door de wethouder.", 6),
    stuk("zaanstad-nieuws", "https://zaanstad.nieuws.nl/a/fietsbrug", "Fietsbrug over de Zaan geopend", "De nieuwe fietsbrug over de Zaan is geopend door de wethouder.", 5),
  ];
  let aantal = 0;
  const r = await s.draaiSamengesteld({
    ruwe: [orkaanRuw()],
    bewijsItems: [rodi(), zn(), ...andere],
    nu,
    haalTekst: async () => "",
    maxAI: 1,
    vraagAI: async () => {
      aantal++;
      return { data: goedAntwoord };
    },
  });
  assert.equal(r.kandidaten.length, 2);
  assert.equal(aantal, 1);
  assert.equal(r.stats.uitgesteld, 1);
});

test("de volledige tekst van de bronnen gaat naar de AI en telt mee in de controle", async () => {
  let prompt = "";
  const haalTekst = async (x) => `${x.tekst} De loods is van een transportbedrijf. Eigenaar De Vries is ter plaatse.`;
  const r = await s.draaiSamengesteld({
    ...nul(),
    haalTekst,
    vraagAI: async (p) => {
      prompt = p;
      return { data: { ...goedAntwoord, alineas: ["De loods aan de Hoogstraat in Zaandam is van een transportbedrijf en brandde fors, meldt eigenaar De Vries ter plaatse."] } };
    },
  });
  assert.ok(prompt.includes("transportbedrijf"));
  assert.equal(r.stats.nieuw, 1);
});

test("oude berichten en afwijzingen worden opgeruimd", async () => {
  const staat = {
    items: {
      "s-oud": { id: "s-oud", kop: "Oud", tekst: "Oud bericht", bronnen: [{ bronId: "x", url: "u" }], aangemaaktOp: "2026-10-01T00:00:00.000Z", bijgewerktOp: "2026-10-01T00:00:00.000Z" },
    },
    afgewezen: { oud: { op: "2026-10-01T00:00:00.000Z", permanent: true } },
  };
  const r = await s.draaiSamengesteld({ ruwe: [], bewijsItems: [], nu, staat, vraagAI: ai(goedAntwoord) });
  assert.equal(Object.keys(r.staat.items).length, 0);
  assert.equal(Object.keys(r.staat.afgewezen).length, 0);
});

test("leesModus: standaard schaduw", () => {
  assert.equal(s.leesModus({}), "schaduw");
  assert.equal(s.leesModus({ ZANP_SAMENGESTELD_MODUS: "AAN" }), "aan");
  assert.equal(s.leesModus({ ZANP_SAMENGESTELD_MODUS: "uit" }), "uit");
  assert.equal(s.leesModus({ ZANP_SAMENGESTELD_MODUS: "onzin" }), "schaduw");
  assert.equal(s.leesMaxAI({}), 3);
  assert.equal(s.leesMaxAI({ ZANP_SAMENGESTELD_MAX: "1" }), 1);
});

// --- in de hele run ---------------------------------------------------------------------------

function ruweBrand() {
  return {
    bronId: "bekendmakingen", bronNaam: "Bekendmakingen", gepubliceerdOp: nu.toISOString(),
    url: "https://voorbeeld.nl/niets", titel: "Kennisgeving iets anders", samenvatting: "Een kennisgeving die hier niets mee te maken heeft.",
  };
}

test("run in schaduwmodus: bestand bewaard, niets in de stroom", async () => {
  fs.rmSync(map, { recursive: true, force: true }); fs.mkdirSync(map);
  const r = await z.draai({
    nu, apiKey: null, env: {}, scrape: async () => [ruweBrand(), orkaanRuw()], haalTekst: async () => {},
    samengesteld: { bewijsItems: [rodi(), zn()], vraagAI: ai(goedAntwoord), haalTekst: async () => "" },
  });
  assert.ok(!r.records.some((x) => x.bronId === "samengesteld"));
  const bestand = leesData(map, "zanp-samengesteld.json");
  assert.equal(bestand.modus, "schaduw");
  assert.equal(Object.keys(bestand.items).length, 1);
  const berichten = leesData(map, "berichten.json").berichten;
  assert.ok(!berichten.some((x) => x.bronId === "samengesteld"));
});

test("run in modus aan: het bericht staat in de stroom, blijft bij de volgende run en wordt niet dubbel", async () => {
  fs.rmSync(map, { recursive: true, force: true }); fs.mkdirSync(map);
  const deps = { nu, apiKey: null, env: { ZANP_SAMENGESTELD_MODUS: "aan" }, scrape: async () => [ruweBrand(), orkaanRuw()], haalTekst: async () => {},
    samengesteld: { bewijsItems: [rodi(), zn()], vraagAI: ai(goedAntwoord), haalTekst: async () => "" } };
  await z.draai(deps);
  let berichten = leesData(map, "berichten.json").berichten.filter((x) => x.bronId === "samengesteld");
  assert.equal(berichten.length, 1);
  assert.equal(berichten[0].kop, goedAntwoord.kop);
  assert.equal(berichten[0].samengesteld.bronnen.length, 3);

  let gevraagd = 0;
  await z.draai({ ...deps, nu: new Date(nu.getTime() + 3600 * 1000), samengesteld: { ...deps.samengesteld, vraagAI: async () => { gevraagd++; return { data: goedAntwoord }; } } });
  berichten = leesData(map, "berichten.json").berichten.filter((x) => x.bronId === "samengesteld");
  assert.equal(berichten.length, 1, "geen dubbel bericht");
  assert.equal(gevraagd, 0, "geen nieuwe AI-vraag");
});

test("modus uit: er komt wel een (leeg) bestand, geen bericht", async () => {
  fs.rmSync(map, { recursive: true, force: true }); fs.mkdirSync(map);
  await z.draai({ nu, apiKey: null, env: { ZANP_SAMENGESTELD_MODUS: "uit" }, scrape: async () => [ruweBrand()], haalTekst: async () => {} });
  const bestand = leesData(map, "zanp-samengesteld.json");
  assert.equal(bestand.modus, "uit");
});
