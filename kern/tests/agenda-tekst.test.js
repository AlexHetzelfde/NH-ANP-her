const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { maakWerklijst, agendaKomt, agendaTekstKomt, agendaArchiefDag } = require("../signalering/prioriteit/tekst");
const { FORMULE, leesInstellingen } = require("../signalering/prioriteit/instellingen");
const wire = require("../ai/wire");
const arch = require("../verwerking/tekstarchief");
const runlog = require("../basis/runlog");

const VANDAAG = "2026-11-28";
const NU = new Date("2026-11-28T10:00:00Z");
const F = FORMULE;
const inst = leesInstellingen({});

const dagPlus = (n) => {
  const d = new Date(`${VANDAAG}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const item = (id, startPlus, extra = {}) => ({
  id,
  afkomst: "bron",
  zichtbaar: true,
  inAfwachting: false,
  doorlopend: false,
  url: `https://bron.example/${id}`,
  kop: `Kop ${id}`,
  bronId: "testbron",
  startDag: dagPlus(startPlus),
  eindDag: dagPlus(startPlus),
  eerstGezienOp: "2026-11-27T08:00:00Z",
  ...extra,
});

const lijst = (agendaItems) => maakWerklijst({ records: [], agendaItems, docs: {}, vandaag: VANDAAG, nu: NU, F, inst });

test("het tekstvenster voor agenda is even groot als wat de site toont", () => {
  assert.equal(inst.tekstAgendaVooruitDagen, wire.AGENDA_VOORUIT_DAGEN);
});

test("de nieuwe instelling zit niet in FORMULE, dus de stempel (en het rood-geheugen) blijft gelijk", () => {
  assert.equal("tekstAgendaVooruitDagen" in FORMULE, false);
});

test("agenda-items 15 tot 21 dagen vooruit krijgen nu ook een tekst, de rood-beoordeling blijft op 14 dagen", () => {
  const i = item("ver", 18);
  assert.equal(agendaKomt(i, VANDAAG, F), false);
  assert.equal(agendaTekstKomt(i, VANDAAG, inst), true);
  assert.deepEqual(lijst([i]).map((t) => t.key), ["a:ver"]);
  assert.equal(agendaTekstKomt(item("te-ver", 22), VANDAAG, inst), false);
});

test("items uit een bericht, camera, gefilterde en wachtende items krijgen geen eigen tekst", () => {
  const items = [
    item("bericht", 2, { afkomst: "bericht" }),
    item("termijn", 2, { afkomst: "termijn" }),
    item("camera", 2, { afkomst: "camera" }),
    item("gefilterd", 2, { zichtbaar: false }),
    item("wacht", 2, { inAfwachting: true }),
  ];
  assert.deepEqual(lijst(items), []);
});

test("doorlopende items die nog bezig zijn krijgen wel een tekst", () => {
  const i = item("lang", -3, { doorlopend: true, eindDag: dagPlus(60), eerstGezienOp: "2026-11-27T08:00:00Z" });
  assert.deepEqual(lijst([i]).map((t) => t.key), ["a:lang"]);
});

test("de archiefdag is de startdag, of de dag van eerst gezien als het item al bezig was", () => {
  assert.equal(agendaArchiefDag(item("a", 18, { eerstGezienOp: "2026-11-01T08:00:00Z" })), dagPlus(18));
  assert.equal(agendaArchiefDag(item("b", -3, { eerstGezienOp: "2026-11-27T08:00:00Z" })), "2026-11-27");
  assert.equal(agendaArchiefDag({ eerstGezienOp: "2026-11-27T23:30:00Z" }), "2026-11-28"); // Nederlandse kalenderdag
});

test("de taak krijgt de archiefdatum mee; datum (voor het geheugen) blijft eerst gezien", () => {
  const [taak] = lijst([item("x", 10, { eerstGezienOp: "2026-11-01T08:00:00Z" })]);
  assert.equal(taak.archiefDatum, `${dagPlus(10)}T12:00:00Z`);
  assert.equal(taak.datum, "2026-11-01T08:00:00Z");
});

test("een item waarvan de archiefdag al buiten de bewaartermijn valt wordt niet opgehaald", () => {
  // Al meer dan 14 dagen bezig en al meer dan 14 dagen bekend: het archief zou de tekst meteen weggooien.
  const oud = item("oud", -30, { eindDag: dagPlus(5), eerstGezienOp: "2026-10-01T08:00:00Z" });
  assert.deepEqual(lijst([oud]), []);
});

test("een tekst die weken vooruit is aangekondigd blijft bewaard tot na het evenement", async () => {
  const map = fs.mkdtempSync(path.join(os.tmpdir(), "zanp-agenda-"));
  const stil = { log() {}, error() {} };
  const log = runlog.maakRunLog({ konsole: stil });
  // Voor het eerst gezien 20 dagen geleden, evenement over 5 dagen. Onder de dag van eerst gezien
  // zou de tekst nooit zijn opgeslagen (te oud), onder de startdag wel.
  const i = item("lang-aangekondigd", 5, { eerstGezienOp: dagPlus(-20) + "T08:00:00Z" });
  const [taak] = lijst([i]);
  assert.ok(taak, "het item moet in de werklijst staan");
  const tekst = "Eerste alinea met genoeg woorden.\nTweede alinea met ook genoeg woorden.";
  const s = await arch.voegToe(
    map,
    [{ k: taak.key, url: taak.url, bron: taak.bron, datum: taak.archiefDatum || taak.datum, versie: 1, methode: "artikel", kop: taak.kop, tekst }],
    { vandaag: VANDAAG, log }
  );
  assert.equal(s.teOud, 0);
  assert.deepEqual(fs.readdirSync(map), [`${dagPlus(5)}.json`]);

  // Op de dag van het evenement en 14 dagen erna staat de tekst er nog, daarna wordt het bestand opgeruimd.
  await arch.ruimOp(map, dagPlus(5 + 14), 14, log);
  assert.deepEqual(fs.readdirSync(map), [`${dagPlus(5)}.json`]);
  await arch.ruimOp(map, dagPlus(5 + 15), 14, log);
  assert.deepEqual(fs.readdirSync(map), []);
});
