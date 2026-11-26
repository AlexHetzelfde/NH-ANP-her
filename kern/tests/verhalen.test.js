// Verhalen (prioriteit/verhalen.js): stukken over hetzelfde bij elkaar, reeksen en losse woorden niet.
const test = require("node:test");
const assert = require("node:assert/strict");
const { FORMULE: F, ROUTES: R } = require("../signalering/prioriteit/instellingen");
const { analyseer } = require("../signalering/prioriteit/taal");
const { maakVingerafdruk, bouwContext } = require("../signalering/prioriteit/analyse");
const { bouwVerhalen, laagVan, onafhankelijkeBron, typeVan } = require("../signalering/prioriteit/verhalen");

const nu = new Date("2026-11-18T12:00:00Z");
function stuk(id, bron, kop, tekst, uren, extra = {}) {
  const a = analyseer({ kop, tekst });
  const fp = maakVingerafdruk(a, { key: `n:${id}`, url: id, bron, datum: new Date(nu.getTime() - uren * 3600000).toISOString(), soort: "nieuws", kop, volledig: true }, F);
  return { ...fp, ...extra };
}
function vulling(n) {
  const w = ["bibliotheek", "zwembad", "carnaval", "parkeren", "speeltuin", "afvalinzameling", "schaatsbaan", "begraafplaats", "kermis", "fietsenstalling"];
  return Array.from({ length: n }, (_, i) => stuk(`vul${i}`, "nh-actueel", `Nieuws over ${w[i % 10]} nummer ${i}`, `${w[i % 10]} ${w[(i + 3) % 10]} gemeente vergadering besluit nummer ${i} in wijk ${i * 7}.`, 200 + i));
}
const bouw = (stukken) => bouwVerhalen({ stukken, ctx: bouwContext(stukken, [], F), F, R, nu });
const groep = (b, id) => b.verhalen.find((v) => v.leden.some((s) => s.k === `n:${id}`));

test("laag en onafhankelijke bron", () => {
  assert.equal(laagVan("DeOrkaan", R), "media");
  assert.equal(laagVan("rodi-zaanstad", R), "media");
  assert.equal(laagVan("veiligheidsregio-nieuws", R), "hulpdienst");
  assert.equal(laagVan("bekendmakingen", R), "overheid");
  assert.equal(onafhankelijkeBron("wetenregelgeving", R), onafhankelijkeBron("bekendmakingen", R));
  assert.notEqual(onafhankelijkeBron("DeOrkaan", R), onafhankelijkeBron("rodi-zaanstad", R));
});

test("het soort: AI-soort, anders rubriek 112, anders niets", () => {
  assert.equal(typeVan({ type: { soort: "uitkomst", zin: "x" } }), "uitkomst");
  assert.equal(typeVan({ rubriek: "112" }), "incident");
  assert.equal(typeVan({ rubriek: "GEM" }), null);
});

test("dezelfde zaak in twee bronnen wordt één verhaal", () => {
  const t = "Een grote brand in de Kuiperstraat in Krommenie verwoest een loods van scheepsbouwer Janssonwerf.";
  const b = bouw([stuk("a", "veiligheidsregio-nieuws", "Grote brand Janssonwerf Krommenie", t, 3), stuk("b", "DeOrkaan", "Brand verwoest loods Janssonwerf", t, 2), ...vulling(100)]);
  assert.equal(groep(b, "a"), groep(b, "b"));
  assert.equal(groep(b, "a").leden.length, 2);
});

test("een reeks van één overheidsbron (stroomstoringen op verschillende plekken) is geen verhaal", () => {
  const reeks = ["Zanderhorn", "Houtveldweg", "Bloemgracht", "Kleimanstraat", "Durgerdamstraat"].map((s, i) =>
    stuk(`s${i}`, "stroomstoringkaart", `Stroomstoring in Zaandam`, `Stroomstoring aan de ${s} en omgeving in Zaandam, de netbeheerder werkt aan herstel van de stroomstoring bij de ${s}.`, 5 + i)
  );
  const b = bouw([...reeks, ...vulling(100)]);
  assert.ok(b.verhalen.every((v) => v.leden.length === 1), "elke stroomstoring staat apart");
});

test("een enkel gedeeld woord in twee verschillende onderwerpen koppelt niet", () => {
  const a = stuk("a", "ibabs-ingekomen-stukken", "Inspraak evenementen Hemkade en Hembrugterrein", "Schriftelijke inspraak over evenementen op de Hemkade en het Hembrugterrein, ingediend door buurtbewoners, met zorgen over geluid, verkeer en veiligheid tijdens grote evenementen rond de Hemkade.", 30);
  const b = stuk("b", "DeOrkaan", "Dagje stroomstoring aan Hogendijk", "Een stroomstoring legde de Hogendijk en omgeving plat. Bij de Hemkade bleef het licht aan. Monteurs werkten de hele dag aan het herstel van de kabel.", 20);
  const r = bouw([a, b, ...vulling(100)]);
  assert.notEqual(groep(r, "a"), groep(r, "b"));
});

test("een verhaal heeft stukken van media van dezelfde bron (vervolgberichten) als de kop verschilt", () => {
  const t = "De poller in de Russische Buurt verdwijnt. Bewoners van de Russische Buurt protesteren tegen het verdwijnen van de poller.";
  const r = bouw([stuk("a", "DeOrkaan", "Russische Buurt voert actie om poller", t, 100), stuk("b", "DeOrkaan", "Petitie voor behoud van de poller gestart", t + " De petitie loopt.", 10), ...vulling(100)]);
  assert.equal(groep(r, "a"), groep(r, "b"));
});

test("stukken ouder dan het venster en geannuleerde stukken doen niet mee", () => {
  const t = "De Westerwateringtunnel blijft dicht vanwege scheuren in het dak van de Westerwateringtunnel.";
  const oud = stuk("a", "DeOrkaan", "Westerwateringtunnel dicht door scheuren", t, 24 * 40);
  const afgelast = { ...stuk("b", "nh-actueel", "Westerwateringtunnel scheuren", t, 5), afgelast: true };
  const r = bouw([oud, afgelast, ...vulling(100)]);
  assert.equal(groep(r, "a"), undefined);
  assert.equal(groep(r, "b"), undefined);
});

test("een te grote groep wordt strenger gesneden of als te groot gemarkeerd", () => {
  const t = "Windturbine bij het Hembrugterrein: omwonenden maken bezwaar tegen de windturbine bij het Hembrugterrein vanwege geluid.";
  const stukken = Array.from({ length: 20 }, (_, i) => stuk(`w${i}`, ["DeOrkaan", "rodi-zaanstad", "zaanstad-nieuws"][i % 3], `Windturbine Hembrugterrein bezwaar ${i}`, t + ` Variant ${i}.`, i + 1));
  const r = bouw([...stukken, ...vulling(100)]);
  assert.ok(r.verhalen.every((v) => v.leden.length <= R.maxVerhaalGrootte || v.teGroot));
});
