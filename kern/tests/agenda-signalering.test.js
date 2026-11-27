// Tests voor de agenda-stap (functies/agenda-signalering.js): poort, voortgangsbestand, hervatten,
// en de controle van de AI-uitvoer. De AI is een nepfunctie; er is geen netwerk.
const test = require("node:test");
const assert = require("node:assert/strict");
const s = require("../functies/agenda-signalering");

// 5 januari 2027 is een dinsdag; 11:00 in Amsterdam.
const NU = new Date("2027-01-05T10:00:00Z");
const PUB = "2027-01-05";
const stil = { log() {}, warn() {} };
const OPEN_DAG = "Op dinsdag 12 januari is er een inloopavond om 19.30 uur in Wijkcentrum De Brug.";

function bericht(naam, tekst, { publicatieDag = PUB, nu = NU } = {}) {
  const record = {
    id: `${naam}-v1`,
    groepId: naam,
    versie: 1,
    url: `https://voorbeeld.nl/${naam}`,
    kop: `Kop ${naam}`,
    bronTitel: `Kop ${naam}`,
    bronNaam: "Bron",
    bronId: "testbron",
  };
  const agenda = { id: record.id, titel: `Kop ${naam}`, tekst, bronNaam: "Bron", gepubliceerdOp: nu.toISOString(), publicatieDag };
  return { record, agenda, invoer: null };
}

const inloop = { titel: "Inloopavond", datumTekst: "dinsdag 12 januari", tijd: "19.30 uur", eindtijd: null, plaats: "Wijkcentrum De Brug" };

// Een nep-AI die onthoudt wat hij kreeg. antwoorden: id -> uitkomst; anders één inloopavond.
function nepAI(antwoorden = {}) {
  const f = async (items, opties) => {
    f.aanroepen.push({ items, opties });
    const m = new Map();
    m.verzoeken = 1;
    for (const it of items) m.set(it.id, antwoorden[it.id] || { agendapunten: [inloop] });
    return m;
  };
  f.aanroepen = [];
  return f;
}

// Een nep-tekstarchief: wat de stap bewaart, kan een volgende run weer lezen.
function nepArchief() {
  const opgeslagen = new Map();
  return {
    opgeslagen,
    bewaarTeksten: async (regels) => regels.forEach((r) => opgeslagen.set(r.url, r.tekst)),
    haalArchiefTekst: async (entry) => opgeslagen.get(entry.url) || null,
  };
}

const draai = (o) => s.draaiAgendaSignalering({ log: stil, wachtMs: 0, cap: 12, ...o });

test("een bericht zonder datum gaat niet naar de AI en staat als geen-signaal in de voortgang", async () => {
  const b = bericht("a", "De raad praat over de begroting en de plannen voor het nieuwe jaar.");
  const ai = nepAI();
  const uit = await draai({ nieuwe: [b], records: [b.record], voortgang: s.leegVoortgang(), nu: NU, signaleer: ai });
  assert.equal(ai.aanroepen.length, 0);
  assert.equal(uit.voortgang.items[b.record.id].status, "geen-signaal");
  assert.equal(uit.stats.zonderSignaal, 1);
  assert.equal(uit.records[0].agendapunten, undefined);
});

test("een bericht met een datum gaat met de VOLLEDIGE tekst naar de AI en het punt komt op het bericht", async () => {
  const lang = `${"Een lang stuk nieuws over de plannen van de gemeente. ".repeat(300)}${OPEN_DAG}`;
  assert.ok(lang.length > 6000);
  const b = bericht("a", lang);
  const ai = nepAI();
  const uit = await draai({ nieuwe: [b], records: [b.record], voortgang: s.leegVoortgang(), nu: NU, signaleer: ai });
  assert.equal(ai.aanroepen.length, 1);
  assert.equal(ai.aanroepen[0].items[0].tekst, lang, "niets afgekapt");
  assert.equal(ai.aanroepen[0].opties.rundag, PUB);
  const rec = uit.records[0];
  assert.equal(rec.agendapunten.length, 1);
  assert.equal(rec.agendapunten[0].dag, "2027-01-12");
  assert.equal(rec.agendapuntenBron, "ai");
  assert.equal(uit.voortgang.items[b.record.id].status, "klaar");
  assert.equal(uit.voortgang.items[b.record.id].punten, 1);
  assert.equal(uit.verzoeken, 1);
});

test("een punt vóór de rundag valt af, ook als de AI het teruggeeft", async () => {
  const tekst = `Op 4 januari was de opening van het buurthuis. ${OPEN_DAG}`;
  const b = bericht("a", tekst, { publicatieDag: "2027-01-04" });
  const ai = nepAI({ [b.record.id]: { agendapunten: [{ titel: "Opening", datumTekst: "4 januari", tijd: null, eindtijd: null, plaats: null }, inloop] } });
  const uit = await draai({ nieuwe: [b], records: [b.record], voortgang: s.leegVoortgang(), nu: NU, signaleer: ai });
  assert.deepEqual(uit.records[0].agendapunten.map((p) => p.dag), ["2027-01-12"]);
  assert.equal(uit.stats.verledenGefilterd, 1);
});

test("een verzonnen datum die niet in de bron staat wordt niet overgenomen", async () => {
  const b = bericht("a", OPEN_DAG);
  const ai = nepAI({ [b.record.id]: { agendapunten: [{ titel: "Feest", datumTekst: "vrijdag 15 januari", tijd: null, eindtijd: null, plaats: null }] } });
  const uit = await draai({ nieuwe: [b], records: [b.record], voortgang: s.leegVoortgang(), nu: NU, signaleer: ai });
  assert.equal(uit.records[0].agendapunten, undefined);
  assert.equal(uit.voortgang.items[b.record.id].status, "klaar");
  assert.equal(uit.voortgang.items[b.record.id].punten, 0);
});

test("AI niet beschikbaar: alles blijft in afwachting, en de volgende run gaat verder met de oudste eerst", async () => {
  const archief = nepArchief();
  const a = bericht("a", OPEN_DAG);
  const eerst = await draai({ nieuwe: [a], records: [a.record], voortgang: s.leegVoortgang(), nu: NU, aiReden: "quotum", signaleer: nepAI(), ...archief });
  assert.equal(eerst.voortgang.items[a.record.id].status, "in-afwachting");
  assert.equal(eerst.stats.aanAI, 1);
  assert.ok(archief.opgeslagen.has(a.record.url), "de tekst staat in het archief voor het hervatten");

  const later = new Date(NU.getTime() + 60 * 60 * 1000);
  const b = bericht("b", OPEN_DAG, { nu: later });
  const ai = nepAI();
  const dan = await draai({ nieuwe: [b], records: [a.record, b.record], voortgang: eerst.voortgang, nu: later, signaleer: ai, ...archief });
  assert.deepEqual(ai.aanroepen[0].items.map((i) => i.id), [a.record.id, b.record.id], "het oudste bericht eerst");
  assert.equal(dan.stats.wachtendVooraf, 1);
  assert.equal(dan.voortgang.items[a.record.id].status, "klaar");
  assert.equal(dan.voortgang.items[b.record.id].status, "klaar");
  assert.equal(dan.records.filter((r) => r.agendapunten).length, 2);
});

test("een AI-fout laat het bericht open; na zes pogingen geeft de stap het op", async () => {
  const archief = nepArchief();
  const b = bericht("a", OPEN_DAG);
  const kapot = async (items) => {
    const m = new Map();
    m.verzoeken = 0;
    for (const it of items) m.set(it.id, { fout: "HTTP 503: overloaded" });
    return m;
  };
  let voortgang = s.leegVoortgang();
  for (let i = 1; i <= s.MAX_POGINGEN; i++) {
    const uit = await draai({ nieuwe: i === 1 ? [b] : [], records: [b.record], voortgang, nu: NU, signaleer: kapot, ...archief });
    voortgang = uit.voortgang;
    const e = voortgang.items[b.record.id];
    assert.equal(e.pogingen, i);
    assert.equal(e.status, i < s.MAX_POGINGEN ? "in-afwachting" : "mislukt");
  }
});

test("een bericht waar geen verzoek meer voor was (cap) krijgt geen poging aangerekend", async () => {
  const archief = nepArchief();
  const b = bericht("a", OPEN_DAG);
  const overgeslagen = async (items) => {
    const m = new Map();
    m.verzoeken = 0;
    for (const it of items) m.set(it.id, { fout: "overgeslagen (cap 1 verzoeken)" });
    return m;
  };
  const uit = await draai({ nieuwe: [b], records: [b.record], voortgang: s.leegVoortgang(), nu: NU, signaleer: overgeslagen, ...archief });
  assert.equal(uit.voortgang.items[b.record.id].pogingen, 0);
  assert.equal(uit.voortgang.items[b.record.id].status, "in-afwachting");
});

test("staat de tekst niet meer in het archief, dan geeft de stap dat bericht op", async () => {
  const a = bericht("a", OPEN_DAG);
  const eerst = await draai({ nieuwe: [a], records: [a.record], voortgang: s.leegVoortgang(), nu: NU, aiReden: "quotum", signaleer: nepAI() });
  const ai = nepAI();
  const dan = await draai({ nieuwe: [], records: [a.record], voortgang: eerst.voortgang, nu: NU, signaleer: ai, haalArchiefTekst: async () => null });
  assert.equal(ai.aanroepen.length, 0);
  assert.equal(dan.voortgang.items[a.record.id].status, "geen-tekst");
});

test("wacht een bericht zo lang dat alle datums voorbij zijn, dan gaat het niet meer naar de AI", async () => {
  const archief = nepArchief();
  const a = bericht("a", OPEN_DAG);
  const eerst = await draai({ nieuwe: [a], records: [a.record], voortgang: s.leegVoortgang(), nu: NU, aiReden: "quotum", signaleer: nepAI(), ...archief });
  const tienDagenLater = new Date(NU.getTime() + 10 * 24 * 60 * 60 * 1000);
  const ai = nepAI();
  const dan = await draai({ nieuwe: [], records: [a.record], voortgang: eerst.voortgang, nu: tienDagenLater, signaleer: ai, ...archief });
  assert.equal(ai.aanroepen.length, 0);
  assert.equal(dan.voortgang.items[a.record.id].status, "geen-signaal");
});

test("een bericht dat al in de voortgang staat gaat niet opnieuw door de poort of de AI", async () => {
  const b = bericht("a", OPEN_DAG);
  const ai = nepAI();
  const eerst = await draai({ nieuwe: [b], records: [b.record], voortgang: s.leegVoortgang(), nu: NU, signaleer: ai });
  const dan = await draai({ nieuwe: [b], records: eerst.records, voortgang: eerst.voortgang, nu: NU, signaleer: ai });
  assert.equal(dan.stats.nieuw, 0);
  assert.equal(ai.aanroepen.length, 1);
  assert.equal(dan.records[0].agendapunten.length, 1, "het punt blijft op het bericht staan");
});

test("berichten zonder agenda-invoer (moties, camera) en startvulling doen niet mee", async () => {
  const b = bericht("a", OPEN_DAG);
  const zonder = { ...b, agenda: null };
  const seed = { ...b, record: { ...b.record, id: "s-v1", seed: true } };
  const ai = nepAI();
  const uit = await draai({ nieuwe: [zonder, seed], records: [b.record], voortgang: s.leegVoortgang(), nu: NU, signaleer: ai });
  assert.equal(uit.stats.nieuw, 0);
  assert.equal(ai.aanroepen.length, 0);
});

test("regels ouder dan veertien dagen verdwijnen uit de voortgang", async () => {
  const voortgang = s.leesVoortgang({ items: { "oud-v1": { status: "klaar", publicatieDag: "2026-12-01" }, "nieuw-v1": { status: "klaar", publicatieDag: "2026-12-30" } } });
  const uit = await draai({ nieuwe: [], records: [], voortgang, nu: NU, signaleer: nepAI() });
  assert.deepEqual(Object.keys(uit.voortgang.items), ["nieuw-v1"]);
  assert.equal(uit.stats.verlopen, 1);
});

test("een afgeronde regel blijft klein, een openstaande houdt zijn gegevens", async () => {
  const klaar = bericht("a", OPEN_DAG);
  const open = bericht("b", OPEN_DAG);
  const uit1 = await draai({ nieuwe: [klaar], records: [klaar.record], voortgang: s.leegVoortgang(), nu: NU, signaleer: nepAI() });
  assert.deepEqual(Object.keys(uit1.voortgang.items[klaar.record.id]).sort(), ["laatsteOp", "publicatieDag", "punten", "status"]);
  const uit2 = await draai({ nieuwe: [open], records: [open.record], voortgang: s.leegVoortgang(), nu: NU, aiReden: "geen-sleutel", signaleer: nepAI() });
  assert.equal(uit2.voortgang.items[open.record.id].url, open.record.url);
  assert.ok(uit2.voortgang.items[open.record.id].signaal.length >= 1);
});

test("een kapot of leeg voortgangsbestand wordt een lege voortgang", () => {
  assert.deepEqual(s.leesVoortgang(null).items, {});
  assert.deepEqual(s.leesVoortgang("rommel").items, {});
  assert.deepEqual(s.leesVoortgang({ items: { a: 5, b: { status: "klaar" } } }).items, { b: { status: "klaar" } });
});
