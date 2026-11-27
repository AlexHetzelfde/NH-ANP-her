const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  scrapeStroomstoringen,
  leesLijst,
  leesDetail,
  looptijdInMinuten,
  bouwTitel,
  normaliseerPlaats,
} = require("../scrapers/stroomstoringen");
const zanpBronnen = require("../basis/gemeenten").bronnenVoor();

const fixture = (naam) => fs.readFileSync(path.join(__dirname, "fixtures", naam), "utf-8");
const PROVINCIE = fixture("stroomstoring-provincie.html");
const DETAIL = fixture("stroomstoring-detail.html");

const BASIS = "https://www.stroomstoringkaart.nl";
const PROVINCIE_URL = `${BASIS}/provincie/noord-holland`;
const ASSENDELFT = `${BASIS}/storing/2026/assendelft-2026-11-15-24add6`;
const OBDAM = `${BASIS}/storing/2026/obdam-2026-11-15-366e93`;
const AMSTERDAM = `${BASIS}/storing/2026/amsterdam-2026-11-16-aaaa01`;

const bron = {
  id: "stroomstoringkaart",
  naam: "Stroomstoringkaart",
  categorie: "lokaal",
  type: "stroomstoringen",
  url: PROVINCIE_URL,
  vasteRubriek: "112",
  plaatsen: ["Assendelft", "Westzaan", "Landsmeer", "Zaandam"],
};

// Een detailpagina met andere plaatsen: de plaatsen staan in de tabel en in de zin eronder.
function detailMet(plaatsen) {
  const links = plaatsen.map((p) => `<a href="/stroomstoring/${p.toLowerCase()}">${p}</a>`);
  const tekst = links.length > 1 ? `${links.slice(0, -1).join(", ")} en ${links[links.length - 1]}` : links[0];
  // De plaatsen staan twee keer op de pagina (zin en tabel): alle plekken vervangen.
  return DETAIL.split('<a href="/stroomstoring/assendelft">Assendelft</a> en <a href="/stroomstoring/westzaan">Westzaan</a>')
    .join(tekst)
    .replace(/"datePosted":"[^"]+"/, '"datePosted":"2026-11-16T09:30:00+01:00"')
    .replace('"spatialCoverage":{"@type":"Place","name":"Assendelft"', `"spatialCoverage":{"@type":"Place","name":"${plaatsen[0]}"`);
}

function nepHaal(paginas) {
  const aanroepen = [];
  const haal = async (url) => {
    aanroepen.push(url);
    if (!(url in paginas)) throw new Error(`HTTP 404 voor ${url}`);
    const p = paginas[url];
    if (p instanceof Error) throw p;
    return p;
  };
  haal.aanroepen = aanroepen;
  return haal;
}

const NU = new Date("2026-11-16T09:50:00Z");

test("de lijst van de provinciepagina: plaats, link en status per storing", () => {
  const lijst = leesLijst(PROVINCIE, PROVINCIE_URL);
  assert.equal(lijst.length, 3);
  assert.deepEqual(lijst.map((i) => i.plaats), ["Assendelft", "Obdam", "Amsterdam"]);
  assert.equal(lijst[0].url, ASSENDELFT);
  assert.equal(lijst[0].status, "er is een monteur onderweg");
  assert.match(lijst[0].meta, /600 huishoudens/);
});

test("de tabel 'Storingen per plaats' telt niet mee als storing", () => {
  const lijst = leesLijst(PROVINCIE, PROVINCIE_URL);
  assert.ok(lijst.every((i) => /\/storing\/2026\//.test(i.url)));
});

test("de detailpagina: alle plaatsen, begin, huishoudens, oorzaak en straten", () => {
  const d = leesDetail(DETAIL);
  assert.deepEqual(d.plaatsen, ["Assendelft", "Westzaan"]);
  assert.equal(d.begonIso, "2026-11-15T21:51:00.000Z"); // 22:51 Nederlandse tijd
  assert.equal(d.begonTekst, "15 november 2026 om 22:51");
  assert.equal(d.huishoudens, "Ongeveer 600 huishoudens");
  assert.equal(d.netbeheerder, "Liander");
  assert.equal(d.soort, "onvoorziene storing");
  assert.equal(d.oorzaak, "Een spontane storing in het net");
  assert.equal(d.postcodes, "1551 en 1566");
  assert.match(d.straten, /^Het gaat om de Boeilijn/);
});

test("een pagina zonder plaatsen is geen bruikbare detailpagina", () => {
  assert.equal(leesDetail("<html><body><p>Niets</p></body></html>"), null);
});

test("looptijd in minuten", () => {
  assert.equal(looptijdInMinuten("Ongeveer 600 huishoudens, al 1 uur en 17 minuten."), 77);
  assert.equal(looptijdInMinuten("al 35 minuten"), 35);
  assert.equal(looptijdInMinuten("al 7 dagen en 2 uur"), 7 * 1440 + 120);
  assert.equal(looptijdInMinuten("Ongeveer 25 huishoudens"), null);
});

test("de kop noemt alle plaatsen", () => {
  assert.equal(bouwTitel(["Assendelft"]), "Stroomstoring in Assendelft");
  assert.equal(bouwTitel(["Assendelft", "Westzaan"]), "Stroomstoring in Assendelft en Westzaan");
  assert.equal(bouwTitel(["Zaandam", "Koog aan de Zaan", "Zaandijk"]), "Stroomstoring in Zaandam, Koog aan de Zaan en Zaandijk");
});

test("plaatsnamen worden vergeleken zonder letter- en spatieverschil", () => {
  assert.equal(normaliseerPlaats("  Koog  aan de Zaan "), "koog aan de zaan");
  assert.equal(normaliseerPlaats("\u2019s-Graveland"), "'s-graveland");
});

test("alleen storingen in de regio worden berichten; de rest van de provincie valt weg", async () => {
  const haal = nepHaal({
    [PROVINCIE_URL]: PROVINCIE,
    [ASSENDELFT]: DETAIL,
    [OBDAM]: detailMet(["Obdam"]),
    [AMSTERDAM]: detailMet(["Amsterdam"]),
  });
  const berichten = await scrapeStroomstoringen(bron, { haal, nu: NU });
  assert.equal(berichten.length, 1);
  const b = berichten[0];
  assert.equal(b.titel, "Stroomstoring in Assendelft en Westzaan");
  assert.equal(b.url, ASSENDELFT);
  assert.equal(b.bronId, "stroomstoringkaart");
  assert.equal(b.vasteRubriek, "112");
  assert.equal(b.geenAi, true);
  assert.equal(b.gepubliceerdOp, "2026-11-15T21:51:00.000Z");
});

test("een storing met meerdere plaatsen komt binnen als minstens een plaats in de regio ligt", async () => {
  // In de lijst staat alleen de eerste plaats (Amsterdam); de detailpagina noemt ook Landsmeer.
  const haal = nepHaal({
    [PROVINCIE_URL]: PROVINCIE,
    [ASSENDELFT]: detailMet(["Hoofddorp"]),
    [OBDAM]: detailMet(["Obdam"]),
    [AMSTERDAM]: detailMet(["Amsterdam", "Landsmeer"]),
  });
  const berichten = await scrapeStroomstoringen(bron, { haal, nu: NU });
  assert.deepEqual(berichten.map((b) => b.titel), ["Stroomstoring in Amsterdam en Landsmeer"]);
});

test("de tekst bevat de feiten en geen gegevens die elke run veranderen", async () => {
  const haal = nepHaal({ [PROVINCIE_URL]: PROVINCIE, [ASSENDELFT]: DETAIL, [OBDAM]: detailMet(["Obdam"]), [AMSTERDAM]: detailMet(["Amsterdam"]) });
  const [b] = await scrapeStroomstoringen(bron, { haal, nu: NU });
  const t = b.samenvatting;
  assert.match(t, /^Stroomstoring in Assendelft en Westzaan\./);
  assert.match(t, /begon op 15 november 2026 om 22:51/);
  assert.match(t, /Ongeveer 600 huishoudens zijn zonder stroom/);
  assert.match(t, /Netbeheerder: Liander/);
  assert.match(t, /Oorzaak: Een spontane storing in het net/);
  assert.match(t, /Postcodes: 1551 en 1566/);
  assert.match(t, /Het gaat om de Boeilijn/);
  // Looptijd en status wijzigen elke run en zouden elke keer een nieuwe versie van het bericht maken.
  assert.doesNotMatch(t, /\bal \d+ (uur|minuten)/);
  assert.doesNotMatch(t, /monteur/);
});

test("kop en tekst zijn gelijk in twee runs op verschillende tijden (geen nieuwe versie per run)", async () => {
  const paginas = { [PROVINCIE_URL]: PROVINCIE, [ASSENDELFT]: DETAIL, [OBDAM]: detailMet(["Obdam"]), [AMSTERDAM]: detailMet(["Amsterdam"]) };
  const [een] = await scrapeStroomstoringen(bron, { haal: nepHaal(paginas), nu: NU });
  // De provinciepagina is een half uur later: dezelfde storing, langere looptijd en een andere status.
  const later = PROVINCIE.replace("al 1 uur en 17 minuten", "al 1 uur en 47 minuten").replace("er is een monteur onderweg", "de monteur is ter plaatse");
  const [twee] = await scrapeStroomstoringen(bron, {
    haal: nepHaal({ ...paginas, [PROVINCIE_URL]: later }),
    nu: new Date(NU.getTime() + 30 * 60 * 1000),
  });
  assert.equal(twee.titel, een.titel);
  assert.equal(twee.samenvatting, een.samenvatting);
  assert.equal(twee.url, een.url);
  assert.equal(twee.gepubliceerdOp, een.gepubliceerdOp);
});

test("faalt de detailpagina, dan gaat het bericht door met de gegevens uit de lijst", async () => {
  const haal = nepHaal({
    [PROVINCIE_URL]: PROVINCIE,
    [ASSENDELFT]: new Error("HTTP 503"),
    [OBDAM]: detailMet(["Obdam"]),
    [AMSTERDAM]: detailMet(["Amsterdam"]),
  });
  const [b] = await scrapeStroomstoringen(bron, { haal, nu: NU });
  assert.equal(b.titel, "Stroomstoring in Assendelft");
  // Begin geschat uit de looptijd uit de lijst: 77 minuten voor NU.
  assert.equal(b.gepubliceerdOp, new Date(NU.getTime() - 77 * 60 * 1000).toISOString());
  assert.match(b.samenvatting, /Ongeveer 600 huishoudens zijn zonder stroom/);
  assert.doesNotMatch(b.samenvatting, /al 1 uur/);
});

test("zonder plaatsenlijst levert de bron niets op (niet de hele provincie)", async () => {
  const haal = nepHaal({ [PROVINCIE_URL]: PROVINCIE });
  const fouten = [];
  const oud = console.error;
  console.error = (m) => fouten.push(m);
  try {
    const berichten = await scrapeStroomstoringen({ ...bron, plaatsen: [] }, { haal, nu: NU });
    assert.deepEqual(berichten, []);
  } finally {
    console.error = oud;
  }
  assert.equal(haal.aanroepen.length, 0);
  assert.match(fouten.join(" "), /Geen "plaatsen"/);
});

test("een provinciepagina zonder storingen geeft een lege lijst", async () => {
  const leeg = PROVINCIE.replace(/<ul class="storingen">[\s\S]*?<\/ul>/, '<ul class="storingen"></ul>');
  const berichten = await scrapeStroomstoringen(bron, { haal: nepHaal({ [PROVINCIE_URL]: leeg }), nu: NU });
  assert.deepEqual(berichten, []);
});

test("de bron in _regio/nieuws.json is compleet: eigen type, plaatsen, vaste tag en rood naar ernst", () => {
  const b = zanpBronnen.find((x) => x.id === "stroomstoringkaart");
  assert.ok(b, "stroomstoringkaart staat niet in de bronbestanden");
  assert.equal(b.type, "stroomstoringen");
  assert.equal(b.url, "https://www.stroomstoringkaart.nl/provincie/noord-holland");
  assert.equal(b.vasteRubriek, "112");
  assert.ok(b.stroomErnst && b.stroomErnst.label);
  assert.equal(b.stroomErnst.drempel, 0.8);
  assert.ok(!b.altijdRood, "altijdRood zou stroomErnst overrulen");
  assert.equal(b.nooitVertragen, true);
  // De plaatsen uit het voorbeeld van de provinciepagina: wel in de regio of niet.
  const regio = new Set(b.plaatsen.map(normaliseerPlaats));
  for (const p of ["Assendelft", "Westzaan", "Zaandam", "Purmerend", "Volendam", "Edam", "Wormer", "Jisp", "Landsmeer", "Oostzaan", "Monnickendam", "Marken", "Broek in Waterland", "Koog aan de Zaan", "Krommenie", "Wormerveer", "Zaandijk"]) {
    assert.ok(regio.has(normaliseerPlaats(p)), `${p} hoort in de plaatsenlijst`);
  }
  for (const p of ["Amsterdam", "Haarlem", "Alkmaar", "Obdam", "Hoorn", "Heemskerk", "Beverwijk", "Halfweg", "Uitgeest"]) {
    assert.ok(!regio.has(normaliseerPlaats(p)), `${p} hoort niet in de plaatsenlijst`);
  }
});
