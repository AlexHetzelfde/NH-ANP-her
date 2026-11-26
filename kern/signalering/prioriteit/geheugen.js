// signalering/prioriteit/geheugen.js
//
// Wat de prioriteitsfunctie onthoudt tussen runs, in data/zanp-prioriteit/:
//   geheugen.json    vingerafdrukken (kernfeiten per stuk, ±30 dagen), kandidaten
//                    (items boven de drempel, nog niet bevestigd), rode items, en
//                    de stempel van de formule en de modus van de laatste run
//                    (daarmee weet index.js wanneer het rood gewist moet worden)
//   schaduwlog.json  scores, onderdelen en redenen van de laatste run, plus de
//                    hoogste scores per dag (14 dagen), om de formule bij te stellen.
//                    Begint opnieuw zodra de formule verandert.
//   (De volledige teksten staan sinds 2026-11-10 niet meer hier maar in
//   data/zanp-teksten/JJJJ-MM-DD.json, één bestand per publicatiedag; zie
//   tekstarchief.js. De oude teksten-*.jsonl worden bij de eerstvolgende run
//   overgezet en verwijderd.)
//
//   routelog.json    (sinds 2026-11-19) wat de routes naar rood deden: de grootste
//                    verhalen van de laatste run met hun metingen en routes, het nieuwe
//                    rood per dag en de verhalen die rood hadden moeten worden maar geen
//                    bericht hadden om te kleuren ("zonder doel"). Begint opnieuw zodra
//                    de routes veranderen.
//   bewijs.json      de stukken van Rodi en Zaanstad.nieuws (zie ../bewijs.js)
//
// Dit zijn eigen bestanden: de pitchrun raakt ze niet aan en zij raken
// data/*.json van de pitchrun niet aan.

"use strict";

const fs = require("fs/promises");
const path = require("path");
const tekstarchief = require("../../verwerking/tekstarchief");

const DAG_MS = 24 * 3600 * 1000;

function mapVan(env) {
  const basis = (env && env.ZANP_DATA_DIR) || require("../../basis/gemeenten").dataMap();
  return path.join(basis, "zanp-prioriteit");
}

function object(x) {
  return x && typeof x === "object" && !Array.isArray(x) ? x : {};
}

function normaliseer(j) {
  const o = object(j);
  return {
    versie: 1,
    stempel: typeof o.stempel === "string" ? o.stempel : null,
    modus: typeof o.modus === "string" ? o.modus : null,
    docs: object(o.docs),
    kandidaten: object(o.kandidaten),
    rood: object(o.rood),
    // Routes naar rood (routes.js): stempel en modus van de laatste run, de fases per verhaal,
    // het rood per item (key -> { sinds, route, routes, label, reden, ... }) en de koppelingen
    // die de AI legde (stuk -> { met: key | null }).
    routesStempel: typeof o.routesStempel === "string" ? o.routesStempel : null,
    routesModus: typeof o.routesModus === "string" ? o.routesModus : null,
    verhalen: object(o.verhalen),
    routeRood: object(o.routeRood),
    aiBanden: object(o.aiBanden),
  };
}

async function leesGeheugen(map) {
  try {
    const geheugen = normaliseer(JSON.parse(await fs.readFile(path.join(map, "geheugen.json"), "utf-8")));
    return { geheugen, voor: JSON.stringify(geheugen) };
  } catch {
    const geheugen = normaliseer({});
    return { geheugen, voor: JSON.stringify(geheugen) };
  }
}

// Schrijft alleen als er iets veranderd is, zodat de uurlijkse commit klein blijft.
async function schrijfGeheugen(map, geheugen, voor, nu) {
  const na = JSON.stringify(geheugen);
  if (na === voor) return false;
  await fs.mkdir(map, { recursive: true });
  await fs.writeFile(
    path.join(map, "geheugen.json"),
    JSON.stringify({ bijgewerkt: nu.toISOString(), ...geheugen }),
    "utf-8"
  );
  return true;
}

// Vergeet stukken ouder dan geheugenDagen en rode items van meer dan roodBewaarDagen geleden.
function ruimOp(geheugen, nu, F) {
  let weg = 0;
  const docGrens = nu.getTime() - F.geheugenDagen * DAG_MS;
  for (const [k, fp] of Object.entries(geheugen.docs)) {
    const t = Date.parse(fp && fp.datum);
    if (Number.isFinite(t) && t < docGrens) {
      delete geheugen.docs[k];
      weg++;
    }
  }
  const roodGrens = nu.getTime() - F.roodBewaarDagen * DAG_MS;
  for (const [k, r] of Object.entries(geheugen.rood)) {
    const t = Date.parse(r && r.tot ? `${r.tot}T12:00:00Z` : r && r.sinds);
    if (Number.isFinite(t) && t < roodGrens) delete geheugen.rood[k];
  }
  // Routes: rood en fases na roodBewaarDagen vergeten; koppelingen van de AI zodra een van de
  // twee stukken niet meer bewaard wordt.
  for (const [k, r] of Object.entries(geheugen.routeRood)) {
    const t = Date.parse(r && r.sinds);
    if (Number.isFinite(t) && t < roodGrens) delete geheugen.routeRood[k];
  }
  for (const [k, v] of Object.entries(geheugen.verhalen)) {
    const t = Date.parse(v && v.laatst);
    if (Number.isFinite(t) && t < roodGrens) delete geheugen.verhalen[k];
  }
  for (const [k, b] of Object.entries(geheugen.aiBanden)) {
    if (!geheugen.docs[k] || (b && b.met && !geheugen.docs[b.met])) delete geheugen.aiBanden[k];
  }
  return weg;
}

// Zet eerst eventuele oude teksten-*.jsonl over naar het tekstarchief en
// verwijdert daarna de dagbestanden met teksten die langer dan tekstBewaarDagen
// geleden zijn gepubliceerd. Geeft het aantal verwijderde bestanden terug.
async function ruimTekstenOp(map, vandaag, F) {
  const archiefMap = path.join(path.dirname(map), "zanp-teksten");
  await tekstarchief.migreerOudeBestanden(map, archiefMap, { vandaag, bewaarDagen: F.tekstBewaarDagen });
  const r = await tekstarchief.ruimOp(archiefMap, vandaag, F.tekstBewaarDagen);
  return r.verwijderd;
}

// opnieuw: de formule is veranderd, de log begint leeg (oude cijfers zijn dan niet vergelijkbaar).
async function schrijfSchaduwlog(map, log, vandaag, topDezeRun, F, opnieuw = false) {
  let oud = {};
  try {
    oud = opnieuw ? {} : JSON.parse(await fs.readFile(path.join(map, "schaduwlog.json"), "utf-8"));
  } catch {
    oud = {};
  }
  const dagen = object(oud.dagen);
  const dag = object(dagen[vandaag]);
  for (const t of topDezeRun) {
    const vorig = dag[t.key];
    if (!vorig || t.S > vorig.S) dag[t.key] = { kop: t.kop, S: t.S, route: t.route, K: t.K, n: t.n, bronnen: t.bronnen };
  }
  dagen[vandaag] = Object.fromEntries(
    Object.entries(dag)
      .sort((a, b) => b[1].S - a[1].S)
      .slice(0, 25)
  );
  const dagSleutels = Object.keys(dagen).sort();
  for (const d of dagSleutels.slice(0, Math.max(0, dagSleutels.length - 14))) delete dagen[d];

  await fs.mkdir(map, { recursive: true });
  await fs.writeFile(
    path.join(map, "schaduwlog.json"),
    JSON.stringify({ ...log, formule: F, dagen }, null, 2),
    "utf-8"
  );
}

/**
 * Het logboek van de routes (routelog.json). `uitkomst`:
 *   { gegenereerdOp, modus, stempel, stats, verhalen: [...], dagen: { dag: { nieuwRood: [...], zonderDoel: [...] } } }
 * `dagen` houdt per dag bij wat rood werd en wat geen doel had (14 dagen); `verhalen` is de
 * lijst van de laatste run. `opnieuw`: de routes zijn veranderd, het logboek begint leeg.
 */
async function schrijfRoutelog(map, log, vandaag, { nieuwRood = [], zonderDoel = [] }, R, opnieuw = false) {
  let oud = {};
  try {
    oud = opnieuw ? {} : JSON.parse(await fs.readFile(path.join(map, "routelog.json"), "utf-8"));
  } catch {
    oud = {};
  }
  const dagen = object(oud.dagen);
  const dag = object(dagen[vandaag]);
  const rood = Array.isArray(dag.nieuwRood) ? dag.nieuwRood : [];
  const zonder = Array.isArray(dag.zonderDoel) ? dag.zonderDoel : [];
  for (const r of nieuwRood) {
    if (!rood.some((x) => x.key === r.key && x.route === r.route && x.sinds === r.sinds)) {
      rood.push({ key: r.key, sinds: r.sinds, routes: r.routes, label: r.label, reden: r.reden, kop: r.kop, verhaal: r.verhaal });
    }
  }
  for (const z of zonderDoel) {
    if (!zonder.some((x) => x.verhaal === z.verhaal && x.route === z.route)) zonder.push(z);
  }
  dagen[vandaag] = { nieuwRood: rood, zonderDoel: zonder };
  const sleutels = Object.keys(dagen).sort();
  for (const d of sleutels.slice(0, Math.max(0, sleutels.length - (R.logDagen || 14)))) delete dagen[d];

  await fs.mkdir(map, { recursive: true });
  await fs.writeFile(path.join(map, "routelog.json"), JSON.stringify({ ...log, routes: R, dagen }, null, 2), "utf-8");
}

// Bewaart volledige teksten in het tekstarchief (per publicatiedag). `dag` is
// vandaag; elke regel draagt zijn eigen datum.
async function voegTekstenToe(map, dag, regels, F = {}) {
  if (!regels.length) return;
  const archiefMap = path.join(path.dirname(map), "zanp-teksten");
  await tekstarchief.voegToe(archiefMap, regels, {
    vandaag: dag,
    bewaarDagen: F.tekstBewaarDagen || tekstarchief.BEWAAR_DAGEN,
  });
}

module.exports = {
  mapVan,
  leesGeheugen,
  schrijfGeheugen,
  ruimOp,
  ruimTekstenOp,
  schrijfSchaduwlog,
  schrijfRoutelog,
  voegTekstenToe,
};
