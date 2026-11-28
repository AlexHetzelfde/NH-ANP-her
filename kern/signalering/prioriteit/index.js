// signalering/prioriteit/index.js
//
// De ene functie die zanp.js aanroept (ZANP 9): bepaalt welke agenda-items en
// nieuwsberichten "groot leven" en dus rood worden.
//
// Wat hij doet, in volgorde:
//  1. Volledige teksten ophalen van alle agenda-items en berichten (tekst.js)
//     en per stuk een vingerafdruk bewaren (analyse.js). De tekst zelf wordt
//     bewaard in data/zanp-teksten/ (per publicatiedag, zie tekstarchief.js).
//  2. Voor elk item dat rood kan worden: zoekwoorden bepalen, de bewaarde
//     stukken erover zoeken, reeksen van dezelfde bron tot één stuk
//     samenvoegen, impact meten, de score berekenen (score.js). Geannuleerde
//     agenda-items doen niet mee en dubbele agenda-items tellen als één.
//  3. De drempel tau bepalen en beslissen (beslis.js): één rood per onderwerp
//     (bij agenda het eerstvolgende item), met als laatste stap een optionele
//     AI-controle die alleen kan tegenhouden (ai.js).
//
// Bij een nieuwe formule of de overgang naar modus "aan" wordt het rood-geheugen
// van de schaduwtijd gewist (stempel in instellingen.js); oude teksten worden
// na tekstBewaarDagen opgeruimd.
//  4. In modus "aan": het veld `rood` op de items zetten. In modus "schaduw"
//     alleen rekenen en loggen.
//
// Sinds 2026-11-19 loopt daarnaast de tweede manier van rood bepalen: de routes naar rood
// (verhalen.js, routes.js), naar het voorbeeld van het ANP-persalarm. Eerst worden alle
// stukken (agenda, nieuws, en de bewijsstukken van Rodi en Zaanstad.nieuws) in verhalen
// ingedeeld; daarna beslissen vier routes (brekend, uitkomst, gepland moment, breed
// opgepikt) elk met een eigen reden. De modus staat in ZANP_ROOD_ROUTES: "schaduw"
// (standaard) rekent en logt in routelog.json, "aan" kleurt alleen via de routes (de oude
// formule kleurt dan niets), "uit" slaat ze over.
//
// Raakt `prio` van berichten niet aan. De frontend vertaalt `rood` naar kleur.
// Een fout in deze functie mag de ZANP-run nooit stoppen: zanp.js vangt hem op.

"use strict";

const path = require("path");
const { kalenderdagAmsterdam } = require("../../basis/hulpmiddelen");
const { leesInstellingen, formuleStempel, routesStempel } = require("./instellingen");
const { analyseer, schoon, AFGELAST } = require("./taal");
const {
  maakVingerafdruk,
  analyseUitVingerafdruk,
  bouwContext,
  bouwZoekvraag,
  zoekEvidentie,
  pasReeksregelToe,
} = require("./analyse");
const { berekenImpact, berekenScore, bepaalTau, PIEK_CATS } = require("./score");
const { maakAiVeto } = require("./ai");
const { maakAiVerhaal } = require("./verhaal-ai");
const { bouwVerhalen } = require("./verhalen");
const { beoordeelVerhalen, pasRoodToe } = require("./routes");
const { beslis } = require("./beslis");
const { cameraRood, vraagRood } = require("./regels");
const tekstarchief = require("../../verwerking/tekstarchief");
const { maakWerklijst, haalTeksten, agendaKomt, laatstePerGroep } = require("./tekst");
const {
  mapVan,
  leesGeheugen,
  schrijfGeheugen,
  ruimOp,
  ruimTekstenOp,
  schrijfSchaduwlog,
  schrijfRoutelog,
  voegTekstenToe,
} = require("./geheugen");

function afronden(x) {
  return Math.round(x * 100) / 100;
}

function groepVanBerichtId(id) {
  return String(id).replace(/-v\d+$/, "");
}

function eigenGroepen(item) {
  return new Set(
    [item.berichtId, ...(item.meerBerichten || []), item.uitkomstId].filter(Boolean).map(groepVanBerichtId)
  );
}

function openbaar(e) {
  return { sinds: e.sinds, score: e.score, route: e.route, reden: e.reden, ...(e.label ? { label: e.label } : {}) };
}

// Dezelfde kop op dezelfde startdag is hetzelfde agenda-item, ook als meer
// bronnen het melden.
function dubbelSleutel(i) {
  const kop = schoon(i.kop || "").replace(/[^a-z0-9]+/g, " ").trim();
  return `${kop}|${i.startDag || ""}`;
}

function maakReden(k, s, evidentie, F) {
  const meetellend = evidentie.filter((e) => e.c >= F.minCentraliteit);
  const bronnen = [...new Set(meetellend.map((e) => e.bron))].slice(0, 3).join(", ");
  return (
    `${s.n} stuk(ken) over ${k.ankers.slice(0, 3).join(", ")} in ${s.dagen} dag(en) uit ${s.bronnen} bron(nen)` +
    `${bronnen ? ` (${bronnen})` : ""}; ${s.route === "piek" ? "piek in de laatste 48 uur" : "aanhoudend"}; ` +
    `impact ${(s.route === "piek" ? s.Kp : s.K).toFixed(2)}; score ${s.S.toFixed(2)}`
  );
}

// ---------------------------------------------------------------------------
// Routes naar rood
// ---------------------------------------------------------------------------

function bewaarBewijsDocs({ geheugen, bewijs, F }) {
  let nieuw = 0;
  for (const it of bewijs) {
    if (!it || !it.key || !it.titel) continue;
    const oud = geheugen.docs[it.key];
    if (oud && (oud.volledig || !it.tekst)) continue; // alleen bijwerken als er nu een volledige tekst is
    const tekst = it.tekst || it.teaser || "";
    const a = analyseer({ kop: it.titel, tekst });
    const fp = maakVingerafdruk(
      a,
      {
        key: it.key,
        url: it.url,
        bron: it.bron,
        datum: it.datum,
        groep: null,
        versie: 1,
        soort: "bewijs",
        kop: it.titel,
        volledig: Boolean(it.tekst),
        pogingen: it.tekst ? 1 : 0,
        methode: it.tekst ? "artikel" : "teaser",
      },
      F
    );
    fp.rubriek = it.rubriek || "";
    if (!oud) nieuw++;
    geheugen.docs[it.key] = fp;
  }
  return nieuw;
}

function kortLog(t, max = 70) {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// Welke losse stukken en lopende verhalen gaan naar de AI? Alleen de laatste 48 uur en alleen
// stukken die de AI nog niet beoordeeld heeft.
function kiesVoorAi(bouw, geheugen, R, nu) {
  const grens = nu.getTime() - R.aiLosVensterUren * 3600 * 1000;
  const losse = bouw.verhalen
    .filter((v) => v.leden.length === 1 && !v.leden[0].agenda && v.leden[0].tijd !== null && v.leden[0].tijd >= grens)
    .map((v) => v.leden[0])
    .filter((s) => !geheugen.aiBanden[s.k])
    .sort((a, b) => b.tijd - a.tijd)
    .slice(0, R.aiPerVerzoek * R.aiVerzoekenMax)
    .map((s) => ({ k: s.k, titel: s.fp.titel, bron: s.bron, datum: s.fp.datum, kern: s.fp.kern }));
  const weekGrens = nu.getTime() - 7 * 24 * 3600 * 1000;
  const lopende = bouw.verhalen
    .filter((v) => v.leden.length > 1 && !v.teGroot && v.leden.some((s) => !s.agenda && s.tijd !== null && s.tijd >= weekGrens))
    .map((v) => {
      const nieuws = v.leden.filter((s) => !s.agenda);
      const laatste = Math.max(...nieuws.map((s) => s.tijd || 0));
      return { v, nieuws, laatste, bronnen: new Set(nieuws.map((s) => s.bron)).size };
    })
    .sort((a, b) => b.bronnen - a.bronnen || b.laatste - a.laatste)
    .slice(0, R.aiVerhalenMax)
    .map(({ v, nieuws }) => ({
      id: v.id,
      titel: nieuws[nieuws.length - 1].fp.titel,
      stukken: nieuws.slice(-3).map((s) => ({ titel: s.fp.titel, bron: s.bron, datum: s.fp.datum })),
    }));
  return { losse, lopende };
}

/**
 * Verhalen bouwen, door de routes laten beoordelen en het rood vastleggen in het geheugen.
 * Verandert `geheugen` (routeRood, verhalen, aiBanden) en geeft de uitkomst terug.
 */
async function routesStap({ geheugen, records, agendaItems, agendaKandidaten, inst, F, nu, aiVerhaal, bronNaam, log }) {
  const R = inst.routes;
  const iso = nu.toISOString();

  // Per nieuwsbericht: het soort (AI of bron) en de rubriek.
  const recVanKey = new Map();
  for (const r of laatstePerGroep(records)) if (r.url) recVanKey.set(`n:${r.url}`, r);
  const agendaStart = new Map();
  for (const i of agendaItems) {
    const sleutel = `a:${i.id}`;
    const t = Date.parse(i.start);
    if (agendaKandidaten.has(sleutel) && Number.isFinite(t)) agendaStart.set(sleutel, t);
  }
  const doelKeys = new Set();
  for (const [sleutel, r] of recVanKey) {
    if (r.alleenAgenda || r.camera || r.seed) continue; // De Orkaan, camerabesluiten en kale signalen kleuren we niet
    doelKeys.add(sleutel);
  }

  const stukken = [];
  for (const fp of Object.values(geheugen.docs)) {
    if (!fp || !fp.k) continue;
    if (fp.k.startsWith("a:") && !agendaStart.has(fp.k)) continue;
    if (fp.k.startsWith("b:") && !inst.bewijs) continue;
    const r = recVanKey.get(fp.k);
    stukken.push(r ? { ...fp, type: r.persType || null, rubriek: r.rubriek || fp.rubriek } : fp);
  }
  const agendaKoppen = agendaItems.filter((i) => i.afkomst === "bron").map((i) => i.kop || "");
  const ctx = bouwContext(stukken, agendaKoppen, F);

  let bouw = bouwVerhalen({ stukken, ctx, F, R, nu, aiBanden: geheugen.aiBanden });
  const stats = { ...bouw.stats, aiGevraagd: 0, aiBanden: 0 };

  if (aiVerhaal && inst.verhaalAi) {
    try {
      const { losse, lopende } = kiesVoorAi(bouw, geheugen, R, nu);
      if (losse.length && (lopende.length || losse.length > 1)) {
        const uit = await aiVerhaal({ losse, lopende }, { maxVerzoeken: R.aiVerzoekenMax, perVerzoek: R.aiPerVerzoek });
        stats.aiGevraagd = losse.length;
        for (const [k, b] of uit) {
          geheugen.aiBanden[k] = { met: b.met, op: iso };
          if (b.met) stats.aiBanden++;
        }
        if (stats.aiBanden) bouw = bouwVerhalen({ stukken, ctx, F, R, nu, aiBanden: geheugen.aiBanden, bandenCache: bouw.banden });
      }
    } catch (fout) {
      log.error(`[prioriteit] AI-indeling van verhalen mislukte (de code deelt alleen in): ${fout.stack || fout.message}`);
    }
  }

  const beoordeeld = beoordeelVerhalen({ verhalen: bouw.verhalen, nu, R, doelKeys, agendaStart, bronNaam });
  const toegepast = pasRoodToe(beoordeeld, { verhalen: geheugen.verhalen, rood: geheugen.routeRood }, nu);

  // Voor het logboek: de verhalen met routes of met aandacht van meerdere media, de grootste eerst.
  const metRoute = (b) => b.routes.length;
  const logVerhalen = beoordeeld
    .filter((b) => b.meting && (metRoute(b) || b.meting.media >= 2))
    .sort((a, b) => metRoute(b) - metRoute(a) || b.meting.media - a.meting.media || b.meting.stukken - a.meting.stukken)
    .slice(0, R.logVerhalen)
    .map((b) => ({
      id: b.id,
      kop: b.kop,
      meting: b.meting,
      routes: b.routes.map((r) => ({ route: r.route, reden: r.reden, doel: r.doel })),
      leden: b.verhaal.leden.map((s) => ({ k: s.k, bron: s.bron, datum: s.fp.datum, type: s.type, titel: kortLog(s.fp.titel) })),
    }));

  stats.metRoute = beoordeeld.filter(metRoute).length;
  stats.nieuwRood = toegepast.nieuwRood.length;
  stats.zonderDoel = toegepast.zonderDoel.length;
  stats.routeRood = Object.keys(geheugen.routeRood).length;
  return { stats, logVerhalen, beoordeeld, aiVeto: {}, ...toegepast };
}

async function draaiPrioriteit(opties) {
  const {
    records,
    agendaItems,
    ruwe = [],
    nu = new Date(),
    env = process.env,
    bronPerId = {},
    cameraReeksen = [],
    nietOphalen = () => false,
    aiVeto = null,
    bewijs = [],
    aiVerhaal = null,
    log = console,
  } = opties;

  const inst = leesInstellingen(env);
  const F = inst.formule;
  const stats = { modus: inst.modus, ai: Boolean(aiVeto) && inst.ai };
  if (inst.modus === "uit" && inst.routesModus === "uit") return { records, agendaItems, stats };
  stats.routesModus = inst.routesModus;

  const map = mapVan(env);
  const { geheugen, voor } = await leesGeheugen(map);
  const vandaag = kalenderdagAmsterdam(nu.toISOString());

  // Rood uit de schaduwtijd is geen echt rood. Bij een nieuwe formule (zolang de
  // modus niet "aan" is) en bij de overgang naar "aan" begint het rood-geheugen
  // leeg; wat dan echt boven de drempel blijft, wordt binnen twee runs opnieuw
  // rood. In modus "aan" blijft rood staan, ook als de formule verandert.
  const stempel = formuleStempel();
  const formuleNieuw = geheugen.stempel !== stempel;
  const naarAan = inst.modus === "aan" && geheugen.modus !== "aan";
  if ((formuleNieuw && inst.modus !== "aan") || naarAan) {
    stats.roodGewist = Object.keys(geheugen.rood).length;
    geheugen.rood = {};
    geheugen.kandidaten = {};
    log.log(`[prioriteit] ${naarAan ? "Start van modus aan" : `Nieuwe formule ${stempel}`}: rood-geheugen leeggemaakt (${stats.roodGewist} item(s)).`);
  }
  geheugen.stempel = stempel;
  geheugen.modus = inst.modus;
  stats.formule = stempel;

  // Hetzelfde voor de routes: rood uit de schaduwtijd is geen echt rood.
  const rStempel = routesStempel();
  const routesNieuw = geheugen.routesStempel !== rStempel;
  const routesNaarAan = inst.routesModus === "aan" && geheugen.routesModus !== "aan";
  const routesGewist = (routesNieuw && inst.routesModus !== "aan") || routesNaarAan;
  if (routesGewist) {
    stats.routeRoodGewist = Object.keys(geheugen.routeRood).length;
    geheugen.routeRood = {};
    geheugen.verhalen = {};
    log.log(`[prioriteit] ${routesNaarAan ? "Start van routes-modus aan" : `Nieuwe routes ${rStempel}`}: route-rood leeggemaakt (${stats.routeRoodGewist} item(s)).`);
  }
  geheugen.routesStempel = rStempel;
  geheugen.routesModus = inst.routesModus;
  stats.routes = rStempel;

  // 1. Teksten ophalen en vingerafdrukken maken
  try {
    const werklijst = maakWerklijst({ records, agendaItems, docs: geheugen.docs, vandaag, nu, F, inst });
    const ruweVanUrl = new Map();
    for (const b of ruwe) if (b && b.url && !ruweVanUrl.has(b.url)) ruweVanUrl.set(b.url, b);
    const ophaal = await haalTeksten(werklijst, {
      inst,
      ruweVanUrl,
      nietOphalen,
      detailSelectorVoor: (bronId) => (bronPerId[bronId] && bronPerId[bronId].detailSelector) || null,
      log,
    });
    const regels = [];
    for (const r of ophaal.resultaten) {
      const taak = r.taak;
      const a = analyseer({ kop: taak.kop, tekst: r.tekst });
      const pogingen = r.geenNieuwePoging ? inst.tekstMaxPogingen : taak.pogingen + (r.volledig ? 0 : 1);
      geheugen.docs[taak.key] = maakVingerafdruk(
        a,
        {
          key: taak.key,
          url: taak.url,
          bron: taak.bron,
          datum: taak.datum,
          groep: taak.groep,
          versie: taak.versie,
          soort: taak.soort,
          kop: taak.kop,
          volledig: r.volledig,
          pogingen,
          methode: r.methode,
        },
        F
      );
      if (r.tekst && r.methode !== "kort") {
        regels.push({
          k: taak.key,
          url: taak.url,
          bron: taak.bron,
          datum: taak.archiefDatum || taak.datum, // agenda: de startdag, zodat de tekst tot na het evenement blijft staan
          versie: taak.versie,
          methode: r.methode,
          kop: taak.kop,
          tekst: r.tekst,
        });
      }
    }
    await voegTekstenToe(map, vandaag, regels, F);
    stats.tekst = ophaal.stats;
  } catch (fout) {
    log.error(`[prioriteit] Teksten ophalen mislukte (er wordt gerekend met wat al bewaard is): ${fout.stack || fout.message}`);
  }

  // Bewijsstukken (Rodi, Zaanstad.nieuws): alleen een vingerafdruk, nooit nieuws of agenda.
  if (inst.bewijs && inst.routesModus !== "uit") {
    try {
      stats.bewijsNieuw = bewaarBewijsDocs({ geheugen, bewijs, F });
    } catch (fout) {
      log.error(`[prioriteit] Bewijsstukken verwerken mislukte: ${fout.stack || fout.message}`);
    }
  }

  stats.vergeten = ruimOp(geheugen, nu, F);
  try {
    stats.tekstenOpgeruimd = await ruimTekstenOp(map, vandaag, F);
  } catch (fout) {
    log.error(`[prioriteit] Oude tekstbestanden opruimen mislukte: ${fout.message}`);
  }
  // Logboek: hoeveel berichten hebben nu een volledige tekst in het archief?
  try {
    const d = await tekstarchief.dekking(path.join(path.dirname(map), "zanp-teksten"), records, {
      vandaag,
      bewaarDagen: F.tekstBewaarDagen,
    });
    stats.tekstDekkingPct = d.pct;
  } catch (fout) {
    log.error(`[prioriteit] Dekking van het tekstarchief berekenen mislukte: ${fout.message}`);
  }
  // De oude formule kent de bewijsstukken niet: haar cijfers blijven zoals ze waren.
  const vingerafdrukken = Object.values(geheugen.docs).filter((fp) => !String(fp.k).startsWith("b:"));
  stats.stukken = vingerafdrukken.length;
  stats.bewijsStukken = Object.keys(geheugen.docs).length - vingerafdrukken.length;
  const oudAan = inst.modus !== "uit";

  // 2. Kandidaten: wat kan rood worden?
  const kandidaten = [];
  const nieuwsGrens = nu.getTime() - F.nieuwsVersUren * 3600 * 1000;
  // Agenda: geannuleerde items doen niet mee, dubbele items worden één kandidaat.
  const aliasVan = new Map(); // sleutel van een dubbel item -> sleutel van de kandidaat
  const dubbelGroepen = new Map();
  let afgelast = 0;
  for (const i of agendaItems) {
    if (!agendaKomt(i, vandaag, F)) continue;
    const sleutel = `a:${i.id}`;
    const fp = geheugen.docs[sleutel];
    if (i.status === "VERVALLEN" || AFGELAST.test(schoon(i.kop || "")) || (fp && fp.afgelast)) {
      afgelast++;
      continue;
    }
    const dk = dubbelSleutel(i);
    if (!dubbelGroepen.has(dk)) dubbelGroepen.set(dk, []);
    dubbelGroepen.get(dk).push({ i, sleutel, fp });
  }
  let dubbel = 0;
  for (const lijst of dubbelGroepen.values()) {
    // Voorkeur: het item dat al rood is, daarna het item met de meeste tekst.
    lijst.sort(
      (x, y) =>
        Number(Boolean(geheugen.rood[y.sleutel])) - Number(Boolean(geheugen.rood[x.sleutel])) ||
        ((y.fp && y.fp.woorden) || 0) - ((x.fp && x.fp.woorden) || 0)
    );
    const { i, sleutel, fp } = lijst[0];
    const gelijk = new Set(lijst.map((x) => x.sleutel));
    for (const x of lijst.slice(1)) {
      aliasVan.set(x.sleutel, sleutel);
      dubbel++;
    }
    kandidaten.push({
      key: sleutel,
      soort: "agenda",
      kop: i.kop || "",
      url: i.url,
      bron: i.bronId,
      start: i.startDag,
      tot: i.eindDag || i.startDag,
      groepen: eigenGroepen(i),
      gelijk,
    });
  }
  for (const r of laatstePerGroep(records)) {
    if (!r.url || r.seed) continue;
    if (r.alleenAgenda) continue; // De Orkaan: wel bewijsstuk (vingerafdruk), nooit zelf rood
    if (r.camera) continue; // cameratoezicht: vaste regel (regels.js), niet de formule
    if (r.vraag && r.vraag.status === "beantwoord") continue; // beantwoording schriftelijke vragen: vaste regel (regels.js)
    const eerst = Date.parse(r.eerstGezienOp);
    if (!Number.isFinite(eerst) || eerst < nieuwsGrens) continue;
    kandidaten.push({
      key: `n:${r.url}`,
      soort: "nieuws",
      kop: r.bronTitel || r.kop || "",
      url: r.url,
      bron: r.bronId,
      tot: null,
      groepen: new Set([r.groepId || r.id]),
      gelijk: new Set([`n:${r.url}`]),
    });
  }

  // 3. Scoren
  const agendaKoppen = agendaItems.filter((i) => i.afkomst === "bron").map((i) => i.kop || "");
  const ctx = bouwContext(vingerafdrukken, agendaKoppen, F);
  const gescoord = [];
  let zonderAnker = 0;
  for (const k of oudAan ? kandidaten : []) {
    const fp = geheugen.docs[k.key];
    const a = fp ? analyseUitVingerafdruk(fp) : analyseer({ kop: k.kop, tekst: "" });
    const vraag = bouwZoekvraag(a, ctx, F);
    if (!vraag.ankers.length) {
      zonderAnker++;
      continue;
    }
    const uitsluiten = (ander) =>
      k.gelijk.has(ander.k) || ander.url === k.url || (ander.groep && k.groepen.has(ander.groep));
    const ruw = zoekEvidentie(vraag, vingerafdrukken, uitsluiten, F);
    const evidentie = pasReeksregelToe(ruw, { bron: (fp && fp.bron) || k.bron, kop: a.kopStammen }, F);
    const K = berekenImpact(a.impact, evidentie, nu, F);
    const Kp = berekenImpact(a.impact, evidentie, nu, F, PIEK_CATS);
    const score = berekenScore(evidentie, K, nu, F, Kp);
    k.kern = (fp && fp.kern) || "";
    k.ankers = vraag.ankers;
    k.topAnkers = vraag.ankers.slice(0, 2);
    k.score = score;
    k.reden = maakReden(k, score, evidentie, F);
    k.bewijs = evidentie
      .filter((e) => e.c >= F.minCentraliteit)
      .sort((x, y) => y.c - x.c)
      .slice(0, 5)
      .map((e) => ({ bron: e.bron, datum: e.datum, c: afronden(e.c), plek: e.plek, titel: e.titel }));
    gescoord.push(k);
  }

  const tau = bepaalTau(gescoord.map((k) => k.score.S), F);

  // 4. Beslissen
  const besluit = oudAan
    ? await beslis({
        kandidaten: gescoord,
        tau,
        geheugen,
        nu,
        vandaag,
        F,
        aiVeto: inst.ai ? aiVeto : null,
        log,
      })
    : { nieuwRood: [], stats: {} };
  stats.kandidaten = kandidaten.length;
  stats.metAnker = gescoord.length;
  stats.zonderAnker = zonderAnker;
  stats.afgelast = afgelast;
  stats.dubbel = dubbel;
  stats.tau = afronden(tau);
  stats.besluit = besluit.stats;
  stats.rood = Object.keys(geheugen.rood).length;
  for (const k of besluit.nieuwRood) {
    log.log(`  ROOD (${inst.modus}) ${k.soort}: ${k.kop.slice(0, 70)} — ${k.reden}`);
  }

  // 4b. Routes naar rood
  let routeUit = null;
  if (inst.routesModus !== "uit") {
    try {
      const naam = new Map();
      for (const r of records) if (r.bronId && r.bronNaam) naam.set(r.bronId, r.bronNaam);
      for (const it of bewijs) if (it.bron && it.bronNaam) naam.set(it.bron, it.bronNaam);
      routeUit = await routesStap({
        geheugen,
        records,
        agendaItems,
        agendaKandidaten: new Set(kandidaten.filter((k) => k.soort === "agenda").map((k) => k.key)),
        inst,
        F,
        nu,
        aiVerhaal,
        bronNaam: (id) => naam.get(id) || id,
        log,
      });
      stats.verhalen = routeUit.stats;
      // AI-controle van het nieuwe route-rood: standaard alleen loggen (ZANP_ROOD_AI_VETO=1: ook tegenhouden).
      if (aiVeto && inst.ai && routeUit.nieuwRood.length) {
        try {
          const items = routeUit.nieuwRood.map((k) => {
            const b = routeUit.beoordeeld.find((x) => x.id === k.verhaal);
            return {
              key: k.key,
              soort: k.key.startsWith("a:") ? "agenda" : "nieuws",
              kop: k.kop,
              ankers: [],
              reden: k.reden,
              bewijs: ((b && b.verhaal.leden) || []).slice(-5).map((s) => ({ bron: s.bron, datum: s.fp.datum, titel: s.fp.titel })),
            };
          });
          const antwoord = await aiVeto(items, { maxVerzoeken: inst.routes.aiVerzoekenMax, perVerzoek: inst.routes.aiPerVerzoek });
          for (const [key, groot] of antwoord) {
            routeUit.aiVeto[key] = groot;
            if (groot === false && inst.routesAiVeto) {
              delete geheugen.routeRood[key];
              stats.aiVetoTegengehouden = (stats.aiVetoTegengehouden || 0) + 1;
            }
          }
        } catch (fout) {
          log.error(`[prioriteit] AI-controle van het route-rood mislukte (het rood blijft): ${fout.message}`);
        }
      }
      for (const k of routeUit.nieuwRood) {
        log.log(`  ROOD-ROUTE (${inst.routesModus}) ${k.key.startsWith("a:") ? "agenda" : "nieuws"}: ${kortLog(k.kop)} — ${k.label}: ${k.reden}`);
      }
    } catch (fout) {
      log.error(`[prioriteit] Routes naar rood mislukten (de oude formule en de rest gaan door): ${fout.stack || fout.message}`);
    }
  }

  // 5. Opslaan
  const top = [...gescoord]
    .sort((x, y) => y.score.S - x.score.S)
    .slice(0, 40)
    .map((k) => ({
      key: k.key,
      soort: k.soort,
      kop: k.kop,
      S: afronden(k.score.S),
      Sa: afronden(k.score.Sa),
      Sp: afronden(k.score.Sp),
      route: k.score.route,
      K: afronden(k.score.K),
      Kp: afronden(k.score.Kp),
      n: k.score.n,
      dagen: k.score.dagen,
      bronnen: k.score.bronnen,
      ankers: k.ankers,
      bewijs: k.bewijs,
    }));
  try {
    await schrijfGeheugen(map, geheugen, voor, nu);
    await schrijfSchaduwlog(
      map,
      { gegenereerdOp: nu.toISOString(), modus: inst.modus, stempel, tau: stats.tau, stats, top },
      vandaag,
      top,
      F,
      formuleNieuw
    );
    if (routeUit) {
      await schrijfRoutelog(
        map,
        { gegenereerdOp: nu.toISOString(), modus: inst.routesModus, stempel: rStempel, stats: routeUit.stats, verhalen: routeUit.logVerhalen, aiVeto: routeUit.aiVeto },
        vandaag,
        routeUit,
        inst.routes,
        routesNieuw
      );
    }
  } catch (fout) {
    log.error(`[prioriteit] Opslaan mislukte: ${fout.stack || fout.message}`);
  }

  // Rood op grond van een vaste regel (cameratoezicht): niet bewaard, elke run opnieuw bepaald.
  let regelRood = new Map();
  try {
    regelRood = cameraRood({ records, cameraReeksen });
    for (const [sleutel, e] of vraagRood({ records, nu })) regelRood.set(sleutel, e);
    stats.regelRood = regelRood.size;
    for (const e of regelRood.values()) {
      if (e.sinds && nu.getTime() - Date.parse(e.sinds) <= 2 * 3600 * 1000) {
        log.log(`  ROOD-REGEL (${inst.modus}) nieuws: ${String(e.kop).slice(0, 70)} — ${e.reden}`);
      }
    }
  } catch (fout) {
    log.error(`[prioriteit] Rood op regel (camera of vragen) mislukte: ${fout.stack || fout.message}`);
  }

  // 6. Kleuren. Staan de routes op "aan", dan kleuren alleen zij (en de vaste regels); de oude
  // formule doet dan niet mee. Anders kleurt de oude formule, alleen in modus "aan".
  const viaRoutes = inst.routesModus === "aan";
  if (!viaRoutes && inst.modus !== "aan") return { records, agendaItems, stats };
  const roodBron = viaRoutes ? geheugen.routeRood : geheugen.rood;
  const nieuweRecords = records.map((r) => {
    const e = roodBron[`n:${r.url}`] || regelRood.get(`n:${r.url}`);
    return e ? { ...r, rood: openbaar(e) } : r;
  });
  const nieuweAgenda = agendaItems.map((i) => {
    const sleutel = `a:${i.id}`;
    const e = roodBron[sleutel] || roodBron[aliasVan.get(sleutel)];
    return e ? { ...i, rood: openbaar(e) } : i;
  });
  return { records: nieuweRecords, agendaItems: nieuweAgenda, stats };
}

module.exports = { draaiPrioriteit, leesInstellingen, maakAiVeto, maakAiVerhaal, mapVan };
