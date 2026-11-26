// Routes naar rood (prioriteit/routes.js, verhalen.js, index.js): het persalarm in code.
// Geen netwerk; de bewijsstukken van Rodi en Zaanstad.nieuws worden als gegevens meegegeven.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { tijdelijkeDataMap } = require("./helpers");
const map = tijdelijkeDataMap();
const { draaiPrioriteit } = require("../signalering/prioriteit");
const { ROUTES } = require("../signalering/prioriteit/instellingen");

const nu = new Date("2026-11-18T12:00:00Z");
const uur = (n) => new Date(nu.getTime() - n * 3600000).toISOString();
const log = { log() {}, warn() {}, error: console.error };

function rec(id, bronId, kop, tekst, uren, extra = {}) {
  return {
    id: id + "-v1", groepId: id, versie: 1, url: "https://v.nl/" + id, kop, tekst, rubriek: "ALG", bronId, bronNaam: bronId,
    eerstGezienOp: uur(uren), tijd: uur(uren), heeftTijd: true, woorden: 300, ...extra,
  };
}
function bew(id, bron, titel, teaser, uren) {
  return { key: "b:https://b.nl/" + id, url: "https://b.nl/" + id, bron, bronNaam: bron, titel, teaser, datum: uur(uren), rubriek: "" };
}
async function draai({ records, agendaItems = [], bewijs = [], routes = "aan", extraEnv = {}, schoon = true }) {
  if (schoon) {
    fs.rmSync(map, { recursive: true, force: true });
    fs.mkdirSync(map);
  }
  return draaiPrioriteit({
    records,
    agendaItems,
    bewijs,
    nu,
    env: { ZANP_DATA_DIR: map, ZANP_PRIORITEIT_MODUS: "schaduw", ZANP_ROOD_ROUTES: routes, ZANP_PRIORITEIT_TEKST_MAX: "0", ...extraEnv },
    log,
    nietOphalen: () => true,
  });
}
// Een echt corpus heeft honderden stukken; een woord dat in 5 van 5 stukken staat is geen eigen woord.
// Vulling: stukken over iets heel anders, zodat de zeldzaamheid van woorden klopt.
function vulling(n) {
  const woorden = ["bibliotheek", "zwembad", "carnaval", "parkeren", "speeltuin", "afvalinzameling", "schaatsbaan", "begraafplaats", "kermis", "fietsenstalling"];
  return Array.from({ length: n }, (_, i) =>
    rec("vul" + i, "nh-actueel", `Nieuws over ${woorden[i % 10]} nummer ${i}`, `${woorden[i % 10]} ${woorden[(i + 3) % 10]} gemeente vergadering besluit nummer ${i} in wijk ${i * 7}.`, 100 + i)
  );
}
const rood = (uit, id) => (uit.records.find((r) => r.id === id + "-v1") || {}).rood;
const routelog = () => JSON.parse(fs.readFileSync(map + "/zanp-prioriteit/routelog.json", "utf8"));

const BRAND =
  "Een grote brand in de Kuiperstraat in Krommenie heeft vanochtend een loods van de scheepsbouwer Janssonwerf verwoest. Brandweer Zaanstreek is met veel voertuigen ter plaatse.";

test("brekend: een incident met twee onafhankelijke bronnen binnen zes uur wordt rood", async () => {
  const records = [
    rec("vr", "veiligheidsregio-nieuws", "Grote brand bij Janssonwerf in Krommenie", BRAND, 1, { rubriek: "112" }),
  ];
  const bewijs = [bew("r1", "rodi-zaanstad", "Brand verwoest loods Janssonwerf Krommenie", BRAND, 2)];
  const uit = await draai({ records, bewijs });
  const r = rood(uit, "vr");
  assert.ok(r, "het bericht van de veiligheidsregio hoort rood te zijn");
  assert.equal(r.label, "Brekend");
  assert.match(r.reden, /Brekend: .*2 bronnen/);
  assert.equal(uit.records.length, 1, "bewijs wordt nooit een nieuwsbericht");
  assert.equal(JSON.stringify(uit).includes("b:https://b.nl"), false, "geen bewijsstuk in de uitvoer");
});

test("brekend: één bron is geen persalarm", async () => {
  const records = [rec("vr", "veiligheidsregio-nieuws", "Grote brand bij Janssonwerf in Krommenie", BRAND, 1, { rubriek: "112" })];
  const uit = await draai({ records });
  assert.equal(rood(uit, "vr"), undefined);
});

test("brekend: zonder incident-soort telt twee bronnen niet", async () => {
  const records = [rec("n1", "nh-actueel", "Wethouder opent Janssonwerf in Krommenie", BRAND, 1)];
  const bewijs = [bew("r1", "rodi-zaanstad", "Wethouder bij Janssonwerf Krommenie", BRAND, 2)];
  const uit = await draai({ records, bewijs });
  assert.equal(rood(uit, "n1"), undefined);
});

test("schaduwmodus (standaard) kleurt niets maar logt wel", async () => {
  const records = [rec("vr", "veiligheidsregio-nieuws", "Grote brand bij Janssonwerf in Krommenie", BRAND, 1, { rubriek: "112" })];
  const bewijs = [bew("r1", "rodi-zaanstad", "Brand verwoest loods Janssonwerf Krommenie", BRAND, 2)];
  const uit = await draai({ records, bewijs, routes: "schaduw" });
  assert.equal(rood(uit, "vr"), undefined);
  const l = routelog();
  assert.equal(l.modus, "schaduw");
  assert.ok(l.verhalen.some((v) => v.routes.some((r) => r.route === "brekend")));
  assert.ok(l.dagen["2026-11-18"].nieuwRood.length >= 1);
});

test("modus uit rekent niets en schrijft geen routelog", async () => {
  const records = [rec("vr", "veiligheidsregio-nieuws", "Grote brand bij Janssonwerf in Krommenie", BRAND, 1, { rubriek: "112" })];
  await draai({ records, routes: "uit" });
  assert.equal(fs.existsSync(map + "/zanp-prioriteit/routelog.json"), false);
});

const TUNNEL =
  "De Westerwateringtunnel in Zaandam blijft voorlopig dicht. De gemeente onderzoekt scheuren in het dak van de Westerwateringtunnel.";

test("breed: drie verschillende media binnen 48 uur (De Orkaan telt mee, maar wordt zelf niet rood)", async () => {
  const records = [
    rec("g1", "ibabs-collegeberichten", "Gemeente onderzoekt scheuren Westerwateringtunnel", TUNNEL, 3),
    rec("o1", "DeOrkaan", "Westerwateringtunnel dicht door scheuren", TUNNEL, 5, { alleenAgenda: true }),
  ];
  const bewijs = [
    bew("r1", "rodi-zaanstad", "Scheuren in Westerwateringtunnel", TUNNEL, 8),
    bew("z1", "zaanstad-nieuws", "Westerwateringtunnel voorlopig dicht", TUNNEL, 10),
  ];
  const uit = await draai({ records, bewijs });
  const r = rood(uit, "g1");
  assert.ok(r, "het collegebericht hoort rood te zijn");
  assert.equal(r.label, "Breed opgepikt");
  assert.match(r.reden, /3 media in/);
  assert.equal(rood(uit, "o1"), undefined, "De Orkaan staat niet in de nieuwsdienst en wordt nooit rood");
});

test("breed: twee media is te weinig", async () => {
  const records = [rec("g1", "ibabs-collegeberichten", "Gemeente onderzoekt scheuren Westerwateringtunnel", TUNNEL, 3)];
  const bewijs = [bew("r1", "rodi-zaanstad", "Scheuren in Westerwateringtunnel", TUNNEL, 8), bew("z1", "zaanstad-nieuws", "Westerwateringtunnel voorlopig dicht", TUNNEL, 10)];
  const uit = await draai({ records, bewijs });
  assert.equal(rood(uit, "g1"), undefined);
});

test("breed: een herschreven overheidsbericht (echo) telt niet als extra medium", async () => {
  const kop = "Gemeente onderzoekt scheuren Westerwateringtunnel";
  const records = [
    rec("g1", "ibabs-collegeberichten", kop, TUNNEL, 3),
    rec("o1", "DeOrkaan", "Westerwateringtunnel dicht door scheuren", TUNNEL, 5, { alleenAgenda: true }),
  ];
  // zaanstad-nieuws schrijft de kop van de gemeente over: echo
  const bewijs = [bew("r1", "rodi-zaanstad", "Scheuren in Westerwateringtunnel", TUNNEL, 8), bew("z1", "zaanstad-nieuws", kop, TUNNEL, 10)];
  const uit = await draai({ records, bewijs });
  assert.equal(rood(uit, "g1"), undefined, "zonder het echo-stuk blijven er twee media over");
});

test("uitkomst: een beslissing van een verhaal dat al aandacht had wordt rood", async () => {
  const uitspraak = "De rechtbank heeft uitspraak gedaan in de zaak rond het Hembrugterrein. De rechtbank wijst de claim van Hembrugontwikkelaar Terraplan af.";
  const eerder = "Over het Hembrugterrein en de claim van Hembrugontwikkelaar Terraplan wordt al weken gesproken; de rechtbank beslist binnenkort.";
  const records = [
    rec("u1", "rechtspraak-noord-holland", "Rechtbank wijst claim Terraplan af", uitspraak, 2, {
      persType: { soort: "uitkomst", zin: "De rechtbank wijst de claim van Hembrugontwikkelaar Terraplan af." },
    }),
  ];
  const bewijs = [
    bew("r1", "rodi-zaanstad", "Claim Terraplan Hembrugterrein: rechtbank beslist", eerder, 24 * 5),
    bew("z1", "zaanstad-nieuws", "Hembrugontwikkelaar Terraplan eist miljoenen", eerder, 24 * 9),
  ];
  const uit = await draai({ records, bewijs });
  const r = rood(uit, "u1");
  assert.ok(r, "de uitspraak hoort rood te zijn");
  assert.equal(r.label, "Uitkomst");
  assert.match(r.reden, /eerder 2 stukken in 2 media/);
});

test("gepland: een agendapunt dat al leeft wordt rood, maar niet als er nauwelijks over geschreven is", async () => {
  const hoorzitting = "Hoorzitting over de Westerwateringtunnel: inwoners en deskundigen spreken met de raad over de scheuren in de Westerwateringtunnel.";
  const agendaItems = [
    {
      id: "ag1", url: "https://z.nl/ag1", kop: "Hoorzitting Westerwateringtunnel", afkomst: "bron", bronId: "zaanstad-hoorzittingen",
      start: new Date(nu.getTime() + 20 * 3600000).toISOString(), startDag: "2026-11-19", eindDag: "2026-11-19", zichtbaar: true,
    },
  ];
  const records = [
    rec("g1", "ibabs-collegeberichten", "Scheuren Westerwateringtunnel: gemeente reageert", hoorzitting, 30),
    rec("o1", "DeOrkaan", "Westerwateringtunnel: inwoners boos over scheuren", hoorzitting, 24 * 4, { alleenAgenda: true }),
    ...vulling(100),
  ];
  const bewijs = [
    bew("r1", "rodi-zaanstad", "Scheuren in Westerwateringtunnel", hoorzitting, 24 * 3),
    bew("z1", "zaanstad-nieuws", "Westerwateringtunnel dicht", hoorzitting, 24 * 6),
  ];
  const uit = await draai({ records, agendaItems, bewijs });
  const a = uit.agendaItems[0];
  assert.ok(a.rood, "het agendapunt hoort rood te zijn");
  assert.equal(a.rood.label.includes("Gepland moment"), true);
  assert.match(a.rood.reden, /Gepland: .* op 19 november; 3 stukken in 3 media/);

  // Alleen aandacht van de overheid zelf (geen media) is geen aandacht.
  const weinig = await draai({ records: records.slice(0, 1), agendaItems, bewijs: bewijs.slice(0, 1) });
  assert.equal(weinig.agendaItems[0].rood, undefined);
});

test("één rood per verhaal en fase: de tweede run verandert niets en bewaart 'sinds'", async () => {
  const records = [rec("vr", "veiligheidsregio-nieuws", "Grote brand bij Janssonwerf in Krommenie", BRAND, 1, { rubriek: "112" })];
  const bewijs = [bew("r1", "rodi-zaanstad", "Brand verwoest loods Janssonwerf Krommenie", BRAND, 2)];
  const eerst = await draai({ records, bewijs });
  const sinds = rood(eerst, "vr").sinds;
  const nieuweRecords = [...records, rec("vr2", "nh-actueel", "Brand Janssonwerf: oorzaak onderzocht", BRAND + " De oorzaak wordt onderzocht.", 0, { rubriek: "112" })];
  const tweede = await draai({ records: nieuweRecords, bewijs, schoon: false });
  assert.equal(rood(tweede, "vr").sinds, sinds);
  assert.equal(rood(tweede, "vr2"), undefined, "een vervolgstuk in dezelfde fase wordt niet nog eens rood");
});

test("de oude formule kleurt niets als de routes op aan staan", async () => {
  const records = [rec("g1", "ibabs-collegeberichten", "Scheuren Westerwateringtunnel", TUNNEL, 3)];
  const uit = await draai({ records, extraEnv: { ZANP_PRIORITEIT_MODUS: "aan" } });
  assert.equal(rood(uit, "g1"), undefined);
});

test("vervolg is alleen schaduw: een langlopend verhaal wordt nooit rood door die route", async () => {
  const records = [];
  const koppen = ["Westerwateringtunnel dicht door scheuren", "Onderzoek naar scheuren in de Westerwateringtunnel", "Omleiding rond Westerwateringtunnel", "Aannemer maakt plan voor Westerwateringtunnel", "Raad vraagt antwoorden over Westerwateringtunnel"];
  const bronnen = ["nh-actueel", "ibabs-collegeberichten", "veiligheidsregio-nieuws", "vervoerregio-persberichten", "omgevingsdienstnoordzeekanaal"];
  koppen.forEach((k, i) => records.push(rec("v" + i, bronnen[i], k, TUNNEL, i * 48 + 2)));
  records.push(...vulling(100));
  const uit = await draai({ records });
  assert.equal(uit.records.filter((r) => r.rood).length, 0);
  const l = routelog();
  const v = l.verhalen.find((x) => x.routes.some((r) => r.route === "vervolg"));
  assert.ok(v, "het vervolg staat wel in het logboek");
});

test("de routes veranderen niet door een andere volgorde of door ROUTES-constanten die niet kloppen", () => {
  assert.ok(ROUTES.brekendMinBronnen >= 2 && ROUTES.breedMinMedia >= 3, "drempels zijn absoluut en niet nul");
});

test("AI-indeling: een los stuk dat de code niet koppelt komt via de AI bij het verhaal; de code telt zelf", async () => {
  const records = [
    rec("vr", "veiligheidsregio-nieuws", "Grote brand bij Janssonwerf in Krommenie", BRAND, 1, { rubriek: "112" }),
    rec("vr2", "nh-actueel", "Janssonwerf Krommenie: brandweer blust loods", BRAND + " Brandweer Zaanstreek blust nog na.", 2, { rubriek: "112" }),
    ...vulling(100),
  ];
  // Een stuk over hetzelfde zonder één gemeenschappelijk eigen woord.
  const bewijs = [bew("z9", "zaanstad-nieuws", "Rook trekt over Krommenie, vuur woedt in loods", "Een enorme zwarte rookpluim hangt boven het dorp; omwonenden moeten ramen sluiten.", 1)];
  let vragen = 0;
  const aiVerhaal = async ({ losse, lopende }) => {
    vragen++;
    const uit = new Map();
    for (const s of losse) if (s.k === "b:https://b.nl/z9") uit.set(s.k, { met: lopende[0].id });
    return uit;
  };
  const zonder = await draai({ records, bewijs, routes: "schaduw" });
  assert.equal(zonder.records.length, records.length);
  const met = await draaiPrioriteit({
    records, agendaItems: [], bewijs, nu, aiVerhaal, log, nietOphalen: () => true,
    env: { ZANP_DATA_DIR: map, ZANP_PRIORITEIT_MODUS: "schaduw", ZANP_ROOD_ROUTES: "schaduw", ZANP_PRIORITEIT_TEKST_MAX: "0" },
  });
  assert.equal(vragen >= 1, true);
  const g = JSON.parse(fs.readFileSync(map + "/zanp-prioriteit/geheugen.json", "utf8"));
  assert.deepEqual(Object.keys(g.aiBanden), ["b:https://b.nl/z9"]);
  const l = routelog();
  const v = l.verhalen.find((x) => x.leden.some((s) => s.k === "b:https://b.nl/z9"));
  assert.ok(v && v.leden.length >= 3, "het AI-stuk hoort bij het verhaal");
  assert.equal(met.stats.verhalen.aiBanden, 1);
});
