// verwerking/patronen.js
//
// ZANP: wat code zelf uit een brontekst kan halen, zonder AI en zonder quotum.
//
// WAAROM
// Het gratis Gemini-quotum is klein. Als de AI niet draait (geen sleutel,
// quotum op, aanroep mislukt, cap bereikt) moet de nieuwsdienst toch bruikbaar
// blijven. Dit bestand levert dan een eerste versie van:
//
//   een checklist met feiten (gevaar, evacuatie, gewonden, getallen) voor de
//   alert-regels.
//
// Agendapunten haalt deze module NIET meer uit een tekst (tot 2026-11-27 wel): dat doet de
// aparte agenda-stap, functies/agenda-signalering.js, met de poort in agenda-poort.js.
//
// De uitkomst gaat daarna door dezelfde controle als de AI-uitvoer (maakChecklist in
// wire.js): getallen blijven alleen staan als ze in de bron staan. Zodra de AI het bericht
// later wel beoordeelt, vervangt zijn uitkomst deze versie.
//
// BEWUST VOORZICHTIG
// Een vals alarm kost meer vertrouwen dan een gemist alarm. "tijdkritisch" wordt
// dus alleen waar als er een duidelijk gevaarwoord in staat EN het bericht
// jong is. Alerts staan bovendien standaard in logmodus (ALERT_MODUS=log).

const W = (inhoud) => new RegExp(`(?<![\\p{L}\\d])(?:${inhoud})(?![\\p{L}\\d])`, "iu");

const EVACUATIE = W("nl-alert|evacuatie|ge[eë]vacueerd|ontruiming|ontruimd|ontruimen|evacueren");
const GEWONDEN = W("gewonden?|gewond geraakt|slachtoffers?|overleden|dodelijk\\w*|doden|omgekomen|levenloos");
const GEVAAR = W(
  "gaslek|explosie|uitslaande brand|grote brand|zeer grote brand|instortingsgevaar|instorting|giftige\\w*|rookwolk|gevaarlijke stoffen|asbestbrand"
);
const BESTUURLIJKE_CRISIS = W(
  "treedt af|aftreden|stapt op|opgestapt|motie van wantrouwen|coalitiebreuk|coalitiecrisis|integriteitsonderzoek|geschorst|schorsing van de wethouder|schorsing van de burgemeester"
);
const GROOT_BESLUIT = W(
  "sluiting van|gaat dicht|sluit de deuren|wordt gesloten|belastingverhoging|ozb-verhoging|verhoging van de ozb|verhoging van de afvalstoffenheffing"
);

const TIJDKRITISCH_UREN = 6;

// "12 gewonden", "40 bewoners", "200 mensen"
const BETROKKENEN = /(?<![\d.,])(\d{1,6})\s+(?:gewonden|slachtoffers|doden|personen|mensen|bewoners|inzittenden|kinderen|woningen)\b/gi;
const BANEN = /(?<![\d.,])(\d{1,6})\s+(?:banen|arbeidsplaatsen|medewerkers)\b/gi;
// "€ 2,5 miljoen", "2,5 miljoen euro", "€ 1.200.000"
const BEDRAG_VOOR = /€\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?\s*(miljoen|miljard|mln|mld)?/gi;
const BEDRAG_NA = /(?<![\d.,])(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?\s*(miljoen|miljard|mln|mld)\s+euro/gi;

const EENHEDEN = { miljoen: 1e6, mln: 1e6, miljard: 1e9, mld: 1e9 };

function grootsteGetal(tekst, regex) {
  regex.lastIndex = 0;
  let max = null;
  let m;
  while ((m = regex.exec(tekst)) !== null) {
    const n = Number(m[1].replace(/\./g, ""));
    if (Number.isFinite(n) && (max === null || n > max)) max = n;
  }
  return max;
}

function grootsteBedrag(tekst) {
  let max = null;
  for (const regex of [BEDRAG_VOOR, BEDRAG_NA]) {
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(tekst)) !== null) {
      const heel = Number(m[1].replace(/\./g, ""));
      const basis = m[2] ? Number(`${heel}.${m[2]}`) : heel;
      const euro = basis * (EENHEDEN[(m[3] || "").toLowerCase()] || 1);
      if (Number.isFinite(euro) && (max === null || euro > max)) max = Math.round(euro);
    }
  }
  return max;
}

/**
 * Een eerste checklist uit de brontekst, in dezelfde vorm als het AI-antwoord.
 * maakChecklist (wire.js) controleert de getallen daarna tegen de bron.
 *
 * @param {string} bron          titel en tekst van de bron
 * @param {object} [opties]      { nu: Date, gepubliceerdOp: ISO } voor "tijdkritisch"
 */
function checklistUitPatronen(bron, opties = {}) {
  const t = String(bron ?? "");
  const evacuatie = EVACUATIE.test(t);
  const gewonden = GEWONDEN.test(t);
  const gevaar = GEVAAR.test(t);

  let jong = false;
  if (opties.gepubliceerdOp) {
    const nu = (opties.nu || new Date()).getTime();
    const tijd = new Date(opties.gepubliceerdOp).getTime();
    jong = Number.isFinite(tijd) && nu - tijd <= TIJDKRITISCH_UREN * 3600 * 1000 && tijd <= nu + 3600 * 1000;
  }

  return {
    gevaar,
    evacuatieOfNlAlert: evacuatie,
    gewondenOfDoden: gewonden,
    betrokkenen: grootsteGetal(t, BETROKKENEN),
    geldbedragEuro: grootsteBedrag(t),
    banen: grootsteGetal(t, BANEN),
    bestuurlijkeCrisis: BESTUURLIJKE_CRISIS.test(t),
    besluitMetGrootGevolg: GROOT_BESLUIT.test(t),
    tijdkritisch: jong && (evacuatie || gevaar || gewonden),
  };
}

module.exports = { checklistUitPatronen, TIJDKRITISCH_UREN };
