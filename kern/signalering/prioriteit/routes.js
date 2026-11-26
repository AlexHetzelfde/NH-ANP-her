// signalering/prioriteit/routes.js
//
// Rood volgens het ANP-persalarm: geen ernst-score met één drempel, maar
// meerdere routes, elk met een eigen trigger en een eigen reden. Een verhaal
// (verhalen.js) is rood als minstens één route afgaat. De getallen staan in
// instellingen.js (ROUTES); ze zijn absoluut, er is geen quotum.
//
//   1. brekend   Een incident (type "incident" van de AI, of de bron zet het zelf
//                onder 112) met minstens 2 onafhankelijke bronnen binnen 6 uur,
//                waarvan één medium of hulpdienst.
//   2. uitkomst  Een beslissende uitkomst (type "uitkomst") van een verhaal dat in
//                de 14 dagen ervoor al aandacht had: minstens 2 stukken uit
//                minstens 2 media.
//   3. gepland   Een agendapunt in de komende 48 uur waarover al geschreven is:
//                minstens 3 stukken uit minstens 2 media in de 30 dagen ervoor.
//   4. breed     Minstens 3 verschillende media binnen 48 uur over hetzelfde.
//   5. vervolg   Alleen schaduw: een verhaal van 7+ dagen met stukken op 3+ dagen
//                en een nieuw stuk. Wordt gelogd, nooit rood.
//
// Aandacht komt van media: een herschreven bericht (echo) telt niet als extra
// medium, officiële stukken en spiegelkanalen tellen als één bron. Er zijn geen
// impactwoorden: wat telt is wie erover schrijft, hoe snel, en wat de bron of de
// AI zegt dat het is (type + bewijszin, zie wire.js).
//
// Eén rood per verhaal en fase: een verhaal kan één keer rood worden voor elke
// fase (brekend, uitkomst, gepland, breed). Een nieuwe fase mag opnieuw rood
// worden, een vervolgstuk in dezelfde fase niet.
//
// Wat rood gekleurd wordt: bij "gepland" het agendapunt, anders het nieuwste
// nieuwsbericht van het verhaal in de nieuwsdienst. Is er geen bericht om te
// kleuren (het verhaal bestaat alleen uit bewijsstukken van andere media), dan
// staat het wel in routelog.json als "zonder doel".

"use strict";

const { bouwVerhalen, titelGelijkenisSets } = require("./verhalen");

const UUR_MS = 3600 * 1000;
const DAG_MS = 24 * UUR_MS;

const ROUTE_LABEL = Object.freeze({
  brekend: "Brekend",
  uitkomst: "Uitkomst",
  gepland: "Gepland moment",
  breed: "Breed opgepikt",
  vervolg: "Vervolg",
});

// Routes die rood kunnen geven, met hun fase. "vervolg" staat er bewust niet bij.
const FASE_VAN = Object.freeze({ brekend: "brekend", uitkomst: "uitkomst", gepland: "gepland", breed: "breed" });

function uren(ms) {
  return Math.max(1, Math.round(ms / UUR_MS));
}

function kopVan(fp) {
  return String((fp && fp.titel) || "").trim();
}

function korteKop(t, max = 90) {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function lijst(namen) {
  const u = [...new Set(namen)];
  return u.join(", ");
}

function datumKort(ms) {
  const d = new Date(ms);
  const dag = new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", day: "numeric", month: "long" }).format(d);
  return dag;
}

// Een medium-stuk dat een herschreven overheidsbericht lijkt (bijna dezelfde kop)
// telt niet als extra medium. Overheid = alles wat geen medium of hulpdienst is.
function bepaalEcho(leden, R) {
  const echo = new Set();
  const overheid = leden.filter((s) => s.laag === "overheid");
  for (const s of leden) {
    if (s.laag !== "media" || !R.echoBronnen.includes(s.bron)) continue;
    if (overheid.some((o) => titelGelijkenisSets(s.kopSet, o.kopSet) >= R.echoJaccard)) echo.add(s.k);
  }
  return echo;
}

function meetVerhaal(v, nu, R) {
  const echo = bepaalEcho(v.leden, R);
  const nieuws = v.leden.filter((s) => !s.agenda);
  const media = nieuws.filter((s) => s.laag === "media" && !echo.has(s.k));
  const metTijd = nieuws.filter((s) => s.tijd !== null);
  const dagen = new Set(metTijd.map((s) => Math.floor(s.tijd / DAG_MS)));
  return {
    echo,
    nieuws,
    media,
    mediaBronnen: new Set(media.map((s) => s.bron)),
    onafhankelijk: new Set(nieuws.map((s) => s.onafhankelijk)),
    eerste: metTijd.length ? metTijd[0].tijd : null,
    laatste: metTijd.length ? metTijd[metTijd.length - 1].tijd : null,
    dagen: dagen.size,
  };
}

function tijdLijst(stukken) {
  return stukken.filter((s) => s.tijd !== null).sort((a, b) => a.tijd - b.tijd);
}

// ---------------------------------------------------------------------------
// De routes. Elke functie geeft null of { reden, stukken, uitkomst? }.
// ---------------------------------------------------------------------------

function routeBrekend(v, m, nu, R, ctx) {
  if (!v.leden.some((s) => s.type === "incident")) return null;
  const stukken = tijdLijst(m.nieuws.filter((s) => !m.echo.has(s.k)));
  let beste = null;
  for (let i = 0; i < stukken.length; i++) {
    const begin = stukken[i].tijd;
    const venster = stukken.filter((s) => s.tijd >= begin && s.tijd <= begin + R.brekendUren * UUR_MS);
    const onafh = new Set(venster.map((s) => s.onafhankelijk));
    const eenMedium = venster.some((s) => s.laag !== "overheid");
    const laatste = venster[venster.length - 1].tijd;
    if (onafh.size >= R.brekendMinBronnen && eenMedium && laatste >= nu.getTime() - R.brekendVersUren * UUR_MS) {
      beste = { venster, onafh, laatste };
    }
  }
  if (!beste) return null;
  const kern = beste.venster.find((s) => s.type === "incident") || beste.venster[0];
  const spanne = uren(beste.laatste - beste.venster[0].tijd);
  const namen = lijst(beste.venster.map((s) => ctx.bronNaam(s.bron)));
  return {
    reden: `Brekend: ${korteKop(kopVan(kern.fp))}, ${beste.onafh.size} bronnen in ${spanne} uur (${namen})`,
    stukken: beste.venster.map((s) => s.k),
  };
}

function routeUitkomst(v, m, nu, R, ctx) {
  const kandidaten = tijdLijst(v.leden.filter((s) => !s.agenda && s.type === "uitkomst")).filter(
    (s) => s.tijd >= nu.getTime() - R.uitkomstVersUren * UUR_MS
  );
  let beste = null;
  for (const u of kandidaten) {
    const voor = m.media.filter((s) => s.tijd !== null && s.tijd < u.tijd - UUR_MS && s.tijd >= u.tijd - R.uitkomstTerugDagen * DAG_MS);
    const media = new Set(voor.map((s) => s.bron));
    if (voor.length >= R.uitkomstMinStukken && media.size >= R.uitkomstMinMedia) beste = { u, voor, media };
  }
  if (!beste) return null;
  return {
    reden: `Uitkomst: ${korteKop(kopVan(beste.u.fp))}; eerder ${beste.voor.length} stukken in ${beste.media.size} media (${lijst(
      [...beste.media].map((b) => ctx.bronNaam(b))
    )})`,
    stukken: [beste.u.k, ...beste.voor.map((s) => s.k)],
    uitkomst: beste.u.k,
  };
}

function routeGepland(v, m, nu, R, ctx) {
  const agenda = v.leden
    .filter((s) => s.agenda && ctx.agendaStart.has(s.k))
    .map((s) => ({ s, start: ctx.agendaStart.get(s.k) }))
    .filter((x) => x.start >= nu.getTime() - 2 * UUR_MS && x.start <= nu.getTime() + R.geplandVooruitUren * UUR_MS)
    .sort((a, b) => a.start - b.start);
  if (!agenda.length) return null;
  const terug = m.media.filter((s) => s.tijd !== null && s.tijd >= nu.getTime() - R.geplandTerugDagen * DAG_MS && s.tijd <= nu.getTime());
  const media = new Set(terug.map((s) => s.bron));
  if (terug.length < R.geplandMinStukken || media.size < R.geplandMinMedia) return null;
  const doel = agenda[0];
  return {
    reden: `Gepland: ${korteKop(kopVan(doel.s.fp))} op ${datumKort(doel.start)}; ${terug.length} stukken in ${media.size} media (${lijst(
      [...media].map((b) => ctx.bronNaam(b))
    )})`,
    stukken: [doel.s.k, ...terug.map((s) => s.k)],
    agenda: doel.s.k,
  };
}

function routeBreed(v, m, nu, R, ctx) {
  const stukken = tijdLijst(m.media);
  let beste = null;
  for (let i = 0; i < stukken.length; i++) {
    const begin = stukken[i].tijd;
    const venster = stukken.filter((s) => s.tijd >= begin && s.tijd <= begin + R.breedUren * UUR_MS);
    const bronnen = new Set(venster.map((s) => s.bron));
    const laatste = venster[venster.length - 1].tijd;
    if (bronnen.size >= R.breedMinMedia && laatste >= nu.getTime() - R.breedVersUren * UUR_MS) beste = { venster, bronnen, laatste };
  }
  if (!beste) return null;
  const spanne = uren(beste.laatste - beste.venster[0].tijd);
  return {
    reden: `Breed opgepikt: ${beste.bronnen.size} media in ${spanne} uur (${lijst([...beste.bronnen].map((b) => ctx.bronNaam(b)))})`,
    stukken: beste.venster.map((s) => s.k),
  };
}

function routeVervolg(v, m, nu, R, ctx) {
  if (m.eerste === null || m.laatste === null) return null;
  if (m.laatste - m.eerste < R.vervolgMinDagen * DAG_MS) return null;
  if (m.dagen < R.vervolgMinStukDagen) return null;
  if (m.laatste < nu.getTime() - R.vervolgVersUren * UUR_MS) return null;
  return {
    reden: `Vervolg: verhaal van ${Math.round((m.laatste - m.eerste) / DAG_MS)} dagen met stukken op ${m.dagen} dagen en een nieuw stuk`,
    stukken: m.nieuws.map((s) => s.k),
  };
}

const ROUTE_FUNCTIES = Object.freeze({
  brekend: routeBrekend,
  uitkomst: routeUitkomst,
  gepland: routeGepland,
  breed: routeBreed,
  vervolg: routeVervolg,
});

// Welk stuk wordt rood gekleurd? Gepland: het agendapunt. Anders het nieuwste
// bericht van het verhaal dat in de nieuwsdienst staat (de uitkomst zelf als dat
// kan). Geen doel: null.
function kiesDoel(route, uitkomstRes, v, ctx) {
  if (route === "gepland") return uitkomstRes.agenda || null;
  const kleurbaar = (s) => !s.agenda && ctx.doelKeys.has(s.k);
  if (route === "uitkomst" && uitkomstRes.uitkomst && ctx.doelKeys.has(uitkomstRes.uitkomst)) return uitkomstRes.uitkomst;
  const nieuwste = [...v.leden].filter(kleurbaar).sort((a, b) => (b.tijd || 0) - (a.tijd || 0));
  return nieuwste.length ? nieuwste[0].k : null;
}

/**
 * Beoordeelt alle verhalen.
 *
 * @param {object} o
 * @param {object[]} o.verhalen   uit bouwVerhalen
 * @param {Date}     o.nu
 * @param {object}   o.R          ROUTES
 * @param {Set}      o.doelKeys   sleutels (n:url) van berichten die rood gekleurd mogen worden
 * @param {Map}      o.agendaStart sleutel (a:id) -> begintijd in ms
 * @param {Function} o.bronNaam   (bronId) => weergavenaam
 * @returns {object[]} per verhaal { id, kop, leden, teGroot, meting, routes: [{route, reden, stukken, doel, fase}] }
 */
function beoordeelVerhalen({ verhalen, nu, R, doelKeys = new Set(), agendaStart = new Map(), bronNaam = (b) => b }) {
  const ctx = { doelKeys, agendaStart, bronNaam };
  const uit = [];
  for (const v of verhalen) {
    const kop = korteKop(kopVan((v.leden.find((s) => !s.agenda) || v.leden[0]).fp), 120);
    const rij = { id: v.id, kop, leden: v.leden.length, teGroot: Boolean(v.teGroot), routes: [] };
    if (v.leden.length < 2 || v.teGroot) {
      uit.push({ ...rij, meting: null, verhaal: v });
      continue;
    }
    const m = meetVerhaal(v, nu, R);
    rij.meting = {
      stukken: m.nieuws.length,
      media: m.mediaBronnen.size,
      mediaStukken: m.media.length,
      echo: m.echo.size,
      onafhankelijk: m.onafhankelijk.size,
      dagen: m.dagen,
      eerste: m.eerste !== null ? new Date(m.eerste).toISOString() : null,
      laatste: m.laatste !== null ? new Date(m.laatste).toISOString() : null,
    };
    for (const [route, f] of Object.entries(ROUTE_FUNCTIES)) {
      const res = f(v, m, nu, R, ctx);
      if (!res) continue;
      rij.routes.push({
        route,
        label: ROUTE_LABEL[route],
        reden: res.reden,
        stukken: res.stukken,
        doel: route === "vervolg" ? null : kiesDoel(route, res, v, ctx),
        fase: FASE_VAN[route] || null,
      });
    }
    uit.push({ ...rij, verhaal: v });
  }
  return uit;
}

/**
 * Zet de uitkomst om in rood, met "één rood per verhaal en fase".
 *
 * @param {object[]} beoordeeld   uit beoordeelVerhalen
 * @param {object}   geheugenRoutes { verhalen: {id: {fasen: {fase: iso}}}, rood: {key: {...}} } (wordt bijgewerkt)
 * @param {Date} nu
 * @returns {{ nieuwRood: object[], bijgewerkt: object[], zonderDoel: object[] }}
 */
function pasRoodToe(beoordeeld, geheugenRoutes, nu) {
  const nieuwRood = [];
  const bijgewerkt = [];
  const zonderDoel = [];
  const iso = nu.toISOString();
  geheugenRoutes.verhalen = geheugenRoutes.verhalen || {};
  geheugenRoutes.rood = geheugenRoutes.rood || {};

  for (const b of beoordeeld) {
    const roodRoutes = b.routes.filter((r) => r.fase);
    if (!roodRoutes.length) continue;
    // De id van een verhaal is het eerste stuk. Komt er later een eerder stuk bij, dan verandert
    // de id: de fases van elk lid dat eerder een id was tellen dus mee.
    const leden = b.verhaal ? b.verhaal.leden.map((s) => s.k) : [];
    const gebruikt = {};
    for (const k of [b.id, ...leden]) {
      const m = geheugenRoutes.verhalen[k];
      if (m && m.fasen) for (const [f, t] of Object.entries(m.fasen)) if (!gebruikt[f] || t < gebruikt[f]) gebruikt[f] = t;
    }
    const mem = (geheugenRoutes.verhalen[b.id] = geheugenRoutes.verhalen[b.id] || { fasen: {} });
    Object.assign(mem.fasen, gebruikt, mem.fasen);
    // Een doel dat al rood is voor dezelfde route telt ook als gebruikt.
    const nieuw = roodRoutes.filter((r) => {
      if (mem.fasen[r.fase]) return false;
      const bestaand = r.doel && geheugenRoutes.rood[r.doel];
      return !(bestaand && bestaand.routes && bestaand.routes.includes(r.route));
    });
    if (!nieuw.length) continue;

    // Alle nieuwe routes met een doel; routes zonder doel worden apart gemeld.
    const metDoel = nieuw.filter((r) => r.doel);
    for (const r of nieuw.filter((x) => !x.doel)) {
      zonderDoel.push({ verhaal: b.id, kop: b.kop, route: r.route, reden: r.reden, sinds: iso });
    }
    // Een fase zonder doel telt niet als gebruikt: komt er later een bericht, dan alsnog.
    const perDoel = new Map();
    for (const r of metDoel) {
      if (!perDoel.has(r.doel)) perDoel.set(r.doel, []);
      perDoel.get(r.doel).push(r);
    }
    for (const [doel, routes] of perDoel) {
      for (const r of routes) mem.fasen[r.fase] = iso;
      mem.laatst = iso;
      const bestaand = geheugenRoutes.rood[doel];
      const redenen = routes.map((r) => r.reden);
      if (bestaand) {
        for (const r of routes) if (!bestaand.routes.includes(r.route)) bestaand.routes.push(r.route);
        for (const t of redenen) if (!bestaand.reden.includes(t)) bestaand.reden = `${bestaand.reden} · ${t}`;
        bestaand.label = bestaand.routes.map((r) => ROUTE_LABEL[r]).join(" + ");
        bijgewerkt.push({ key: doel, verhaal: b.id, routes: routes.map((r) => r.route) });
      } else {
        const rood = {
          sinds: iso,
          route: routes[0].route,
          routes: routes.map((r) => r.route),
          label: routes.map((r) => r.label).join(" + "),
          reden: redenen.join(" · "),
          verhaal: b.id,
          kop: b.kop,
        };
        geheugenRoutes.rood[doel] = rood;
        nieuwRood.push({ key: doel, ...rood });
      }
    }
  }
  return { nieuwRood, bijgewerkt, zonderDoel };
}

/**
 * Alles in één keer: verhalen bouwen, beoordelen, rood toepassen.
 * Geen schijf, geen netwerk; index.js geeft de invoer en bewaart de uitkomst.
 */
function draaiRoutes({ stukken, ctx, F, R, nu, aiBanden = {}, doelKeys, agendaStart, bronNaam, geheugenRoutes, bandenCache = null }) {
  const bouw = bouwVerhalen({ stukken, ctx, F, R, nu, aiBanden, bandenCache });
  const beoordeeld = beoordeelVerhalen({ verhalen: bouw.verhalen, nu, R, doelKeys, agendaStart, bronNaam });
  const toegepast = pasRoodToe(beoordeeld, geheugenRoutes, nu);
  return { bouw, beoordeeld, ...toegepast };
}

module.exports = {
  ROUTE_LABEL,
  FASE_VAN,
  meetVerhaal,
  beoordeelVerhalen,
  pasRoodToe,
  draaiRoutes,
  routeBrekend,
  routeUitkomst,
  routeGepland,
  routeBreed,
  routeVervolg,
};
