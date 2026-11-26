// Eerste tests voor de prioriteitsmodule (rood-berekening). Alleen schaduwmodus, geen netwerk.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { tijdelijkeDataMap } = require("./helpers");
const map = tijdelijkeDataMap(); // vóór het laden van de module
const taal = require("../signalering/prioriteit/taal");
const { draaiPrioriteit } = require("../signalering/prioriteit");

test("sjabloonwoorden (kennisgeving, persbericht) tellen niet als onderwerp", () => {
  for (const w of ["kennisgeving", "persbericht", "mededeling", "aankondiging", "nieuwsbrief"]) {
    assert.ok(taal.SOORT_SEED.has(taal.stam(w)), `${w} hoort in SOORT_SEED`);
  }
});

const nu = new Date("2026-11-16T12:00:00Z");
const uur = (n) => new Date(nu.getTime() - n * 3600000).toISOString();
function rec(id, bronId, kop, tekst, uren, extra = {}) {
  return { id: id + "-v1", groepId: id, versie: 1, url: "https://v.nl/" + id, kop, tekst, rubriek: "ALG", bronId, bronNaam: bronId,
    eerstGezienOp: uur(uren), tijd: uur(uren), heeftTijd: true, woorden: 300, ...extra };
}

test("een record met alleenAgenda wordt nooit zelf een rood-kandidaat, maar telt wel mee als bewijs", async () => {
  fs.rmSync(map, { recursive: true, force: true }); fs.mkdirSync(map);
  const onderwerp = "De windturbine bij het Hembrugterrein krijgt bezwaren van omwonenden over geluid en slagschaduw.";
  const records = [
    rec("a", "DeOrkaan", "Omwonenden verzetten zich tegen windturbine Hembrug", onderwerp, 2, { alleenAgenda: true }),
    rec("b", "nh-nieuws", "Bezwaren tegen windturbine Hembrugterrein", onderwerp + " De gemeente bekijkt de bezwaren.", 3),
    rec("c", "zaans-nieuws", "Windturbine Hembrug: omwonenden maken bezwaar", onderwerp, 5),
  ];
  const log = { log() {}, warn() {}, error: console.error };
  await draaiPrioriteit({ records, agendaItems: [], nu, env: { ZANP_DATA_DIR: map, ZANP_PRIORITEIT_MODUS: "schaduw", ZANP_PRIORITEIT_TEKST_MAX: "0" }, log, nietOphalen: () => true });
  const s = JSON.parse(fs.readFileSync(map + "/zanp-prioriteit/schaduwlog.json", "utf8"));
  const koppen = s.top.map((t) => t.kop);
  assert.ok(!koppen.some((k) => /Omwonenden verzetten zich/.test(k)), "het Orkaan-artikel mag geen kandidaat zijn");
  assert.ok(koppen.some((k) => /Bezwaren tegen windturbine/.test(k)), "de echte nieuwsberichten wel");
  const b = s.top.find((t) => /Bezwaren tegen windturbine/.test(t.kop));
  assert.ok(b.n >= 1 && b.bronnen >= 2, "het Orkaan-artikel telt wel mee als bewijs");
});
