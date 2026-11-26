// signalering/prioriteit/verhaal-ai.js
//
// De AI als hulp bij het indelen van stukken in verhalen, nooit als teller.
//
// De code groepeert stukken op zeldzame eigen woorden (verhalen.js). Soms hebben twee
// stukken over hetzelfde geen woord gemeen ("de brand" en "het vuur aan de Hoogstraat").
// Alleen voor losse stukken van de laatste 48 uur vragen we de AI: hoort dit stuk bij
// een van de lopende verhalen, of bij een ander los stuk? De AI geeft alleen een nummer
// terug. De code controleert dat het nummer bestaat, bewaart de uitkomst
// (geheugen.aiBanden, ook "nee", zodat een stuk maar één keer gevraagd wordt) en telt zelf
// hoeveel bronnen en media er zijn. Twijfelt de AI, dan blijft het stuk los.
//
// Deze module praat zelf niet met Google: zanp.js geeft de aanroep mee (roepGeminiWire),
// zodat het dagquotum klopt. Zonder aanroep (geen sleutel, quotum op) gebeurt er niets.

"use strict";

function kort(t, max) {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function datum(iso) {
  return String(iso || "").slice(0, 10);
}

/**
 * @param {object} o
 * @param {object[]} o.losse    [{ k, titel, bron, datum, kern }]
 * @param {object[]} o.lopende  [{ id, titel, stukken: [{ titel, bron, datum }] }]
 */
function bouwVerhaalPrompt({ losse, lopende }) {
  const verhaalBlok = (v, i) =>
    `V${i + 1}: ${kort(v.titel, 120)}\n` +
    v.stukken.map((s) => `   - ${s.bron || "?"}, ${datum(s.datum)}: ${kort(s.titel, 120)}`).join("\n");
  const losBlok = (s, i) =>
    `L${i + 1}: ${kort(s.titel, 140)} (${s.bron || "?"}, ${datum(s.datum)})${s.kern ? `\n   Begin: ${kort(s.kern, 500)}` : ""}`;
  return `Je helpt een lokale nieuwsredactie in de Zaanstreek (Nederland) berichten bij elkaar te zoeken die over HETZELFDE gaan: dezelfde gebeurtenis, hetzelfde besluit of dezelfde zaak.
Hieronder staan lopende verhalen (V1, V2, ...) en losse berichten (L1, L2, ...). Geef voor elk los bericht aan bij welk lopend verhaal het hoort, of bij welk ander los bericht, of dat het bij niets hoort.

Antwoord ALLEEN met een verwijzing als je er zeker van bent dat het over precies dezelfde gebeurtenis of zaak gaat, ook als de woorden verschillen. Hetzelfde onderwerp in het algemeen (bijvoorbeeld allebei "verkeer" of allebei "de gemeenteraad") is niet genoeg. Twijfel je, antwoord dan null.

LOPENDE VERHALEN
${lopende.length ? lopende.map(verhaalBlok).join("\n") : "(geen)"}

LOSSE BERICHTEN
${losse.map(losBlok).join("\n")}

Geef ALLEEN geldige JSON terug, geen markdown-fences en geen andere tekst. Precies één object per los bericht, met het nummer van dat bericht. "bij" is een verwijzing zoals "V2" of "L5", of null:
{ "antwoorden": [ { "nr": 1, "bij": null } ] }`;
}

// Leest het antwoord: nr -> "V3" | "L5" | null. Alles wat geen geldige verwijzing is wordt null.
function leesAntwoorden(data, aantalLos, aantalVerhaal) {
  let lijst = [];
  if (Array.isArray(data)) lijst = data;
  else if (data && Array.isArray(data.antwoorden)) lijst = data.antwoorden;
  const perNr = new Map();
  for (const a of lijst) {
    const nr = Number(a && a.nr);
    if (!Number.isInteger(nr) || nr < 1 || nr > aantalLos || perNr.has(nr)) continue;
    const bij = typeof a.bij === "string" ? a.bij.trim().toUpperCase() : null;
    const m = bij && /^([VL])(\d+)$/.exec(bij);
    let ok = null;
    if (m) {
      const n = Number(m[2]);
      if (m[1] === "V" && n >= 1 && n <= aantalVerhaal) ok = bij;
      if (m[1] === "L" && n >= 1 && n <= aantalLos && n !== nr) ok = bij;
    }
    perNr.set(nr, ok);
  }
  return perNr;
}

/**
 * Maakt de aiVerhaal-functie voor index.js.
 *
 * @param {object}   o
 * @param {Function} o.roep           async (prompt, apiKey, maxTokens) => { data, verzoeken } (roepGeminiWire)
 * @param {string}   o.apiKey
 * @param {number}   o.ruimte         hoogstens zoveel verzoeken (dagquotum van ZANP)
 * @param {Function} [o.telVerzoeken] (aantal) => void
 * @param {Function} [o.bijQuotum]    (foutTekst) => void, bij een 429
 * @param {object}   [o.log]
 * @returns {Function} async ({ losse, lopende }, { maxVerzoeken, perVerzoek }) =>
 *   Map losKey -> { met: key | null } (alleen voor stukken waarvoor de AI antwoordde)
 */
function maakAiVerhaal({ roep, apiKey, ruimte, telVerzoeken = () => {}, bijQuotum = () => {}, log = console }) {
  return async function aiVerhaal({ losse, lopende }, { maxVerzoeken = 2, perVerzoek = 12 } = {}) {
    const uit = new Map();
    let over = Math.max(0, Math.min(ruimte, maxVerzoeken));
    for (let i = 0; i < losse.length && over > 0; i += perVerzoek) {
      const groep = losse.slice(i, i + perVerzoek);
      over--;
      let antwoord;
      try {
        antwoord = await roep(bouwVerhaalPrompt({ losse: groep, lopende }), apiKey, 2048);
      } catch (fout) {
        telVerzoeken(fout.verzoeken || 0);
        if (fout.status === 429) {
          bijQuotum(fout.message);
          log.warn(`[prioriteit] AI-quotum bereikt bij het indelen van verhalen; de code deelt alleen in.`);
          break;
        }
        log.warn(`[prioriteit] AI-indeling mislukte voor ${groep.length} stuk(ken); ze blijven los: ${fout.message}`);
        continue;
      }
      telVerzoeken(antwoord.verzoeken || 0);
      const perNr = leesAntwoorden(antwoord.data, groep.length, lopende.length);
      groep.forEach((s, j) => {
        if (!perNr.has(j + 1)) return; // geen antwoord: een volgende run mag opnieuw vragen
        const bij = perNr.get(j + 1);
        if (!bij) return uit.set(s.k, { met: null });
        const n = Number(bij.slice(1));
        if (bij[0] === "V") uit.set(s.k, { met: lopende[n - 1].id });
        else uit.set(s.k, { met: groep[n - 1].k });
      });
    }
    return uit;
  };
}

module.exports = { maakAiVerhaal, bouwVerhaalPrompt, leesAntwoorden };
