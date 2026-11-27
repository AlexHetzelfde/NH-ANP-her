# Architectuur: waar staat wat

Dit is de kaart van het project. `PLAN.md` (in deze map) is het logboek van wat er
wanneer is gebouwd en waarom; de paden daarin zijn die van vóór de herindeling
(`scraper/` heet nu `kern/`). Dit bestand beschrijft hoe het er NU uitziet.

## In het kort

ZANP (de nieuwsdienst) draait elk uur als GitHub Action (`zanp-run.yml`). Die haalt de
bronnen van een gemeente op, verwerkt en beoordeelt de berichten en schrijft het resultaat
naar `data/<gemeente>/`. De website leest die bestanden alleen en rekent niets zelf uit.

```
kern/             HOE het gaat: de code, voor elke gemeente hetzelfde
gemeenten/        WAT er opgehaald wordt: bronnen en gegevens per gemeente
data/<gemeente>/  het RESULTAAT van een run (door de run geschreven, in git bewaard)
index.html, script.js, style.css, gemeenten.json    de website
docs/             documentatie
.github/workflows/    de automatische taken
```

Een run draait voor EEN gemeente (nu `zaanstad`; te kiezen met `ZANP_GEMEENTE`): de
bronnen van die gemeente plus die van `gemeenten/_regio`, met het resultaat in
`data/<gemeente>/`. Alleen `kern/basis/gemeenten.js` weet hoe `gemeenten/` en `data/` zijn
ingedeeld.

## gemeenten/

```
gemeenten/
  _regio/                 bronnen die voor meerdere gemeenten gelden
    nieuws.json           provincie, veiligheidsregio, vervoerregio, rechtspraak, stroomstoringen, ...
    rubrieken.json        de ZANP-instellingen van die bronnen
  zaanstad/
    gemeente.json         naam, plaatsen, iBabs-adres en de bronvolgorde
    nieuws.json           nieuwsbronnen
    agenda.json           kalenderbronnen
    signalering.json      Orkaan (scrapers) en Rodi, Zaanstad.nieuws (bewijs)
    rubrieken.json        de ZANP-instellingen per bron, en de lijst met rubrieken (tags)
    GESCHIEDENIS.md       welke bronnen er zijn gekomen en gegaan, en waarom
```

Zie `gemeenten/README.md` voor de details. `gemeenten.json` in de root is iets anders: dat is
het gemeentemenu van de website (welke gemeenten, plaatsen en welke bron bij welke gemeente
hoort).

## kern/

De startbestanden zijn `zanp.js` (de run) en de scripts in `gereedschap/`; de workflows roepen
alleen die aan.

| Map | Inhoud |
|---|---|
| `basis/` | de basis die alles gebruikt: `gemeenten.js` (leest `gemeenten/` en bepaalt `data/<gemeente>/`), `gedeeld.js` (scrapen, effectieve bron), `hulpmiddelen.js` (gedeelde functies), `runlog.js` (logboek per run), `rubrieken.js` (instellingen per bron) |
| `scrapers/` | één bestand per brontype (iBabs, RSS, WordPress, TenderNed, moties, camera, stroomstoringen, ...). `scraper-register.js` koppelt een `type` aan zijn scraper |
| `ai/` | `gemini.js` (alle Gemini-aanroepen, modellen, quotum), `wire.js` (maakt `berichten.json` en `agenda.json`, met de AI-koppen), `agenda-ai.js` (de AI-kant van de agenda-signalering), `brontrouw.js` (klopt de AI-tekst met de bron?), `spelling.js` |
| `verwerking/` | berichten verwerken zonder AI: `tags.js`, `koppel.js`, `agenda-regels.js`, `agenda-poort.js` (de poort: staat er een toekomstige datum in?), `aanbesteding-regels.js`, `camera-reeks.js`, `patronen.js`, `tekstarchief.js`, `tekstopschoning.js` |
| `signalering/` | wat een bericht rood of belangrijk maakt: `alert-regels.js`, `bron-rood.js`, `jubileum.js`, `bewijs.js` (aandacht in andere media), `samengesteld.js`, `dossiers.js`, `cluster.js` (dubbel nieuws herkennen) en `prioriteit/` (score, routes, verhalen, geheugen) |
| `functies/` | `agenda-signalering.js` (agendapunten uit het nieuws), en de raadsvergaderingen: `besluitenlijst.js` en `verslag.js` |
| `gereedschap/` | bronnen beheren: `voeg-bron-toe.js`, `herstel-bronnen.js`, `valideer-bronnen.js`, `valideer-rubrieken.js` en hun hulpbestanden (`bron-ontdekking.js`, `bron-poort.js`, `bronnen-schrijver.js`, `gemini-recept-lus.js`) |
| `tests/` | alle unittests (`npm test` in `kern/`) |

## data/<gemeente>/

Alles wat de run voor die gemeente schrijft. Niet met de hand aanpassen.

| Bestand | Inhoud |
|---|---|
| `berichten.json`, `agenda.json` | wat de website toont |
| `zanp-status.json`, `zanp-log.json` | status per bron, quotum en het logboek per run |
| `zanp-prioriteit/` | geheugen en logs van de prioriteitsberekening, bewijsstukken |
| `zanp-teksten/` | volledige teksten per publicatiedag (14 dagen) |
| `zanp-agenda-voortgang.json` | per nieuw bericht: heeft de poort een datum gezien, en heeft de AI het gelezen (zie hieronder) |
| `zanp-camera/`, `zanp-besluitenlijsten.json`, `zanp-verslagen.json`, `zanp-samengesteld.json`, `zanp-dossiers.json`, `zanp-stubs.json` | uitkomsten van de afzonderlijke functies |

De run commit de hele map `data/zaanstad/` (stap "Resultaten committen" in `zanp-run.yml`), dus een
nieuw databestand hoeft nergens te worden aangemeld.

## Workflows (.github/workflows/)

| Workflow | Doet |
|---|---|
| `zanp-run.yml` | elk uur: controleren, `node zanp.js`, `data/zaanstad/` committen |
| `bron-toevoegen.yml` | handmatig: een bron toevoegen en de bronbestanden + `rubrieken.json` committen |
| `bron-herstellen.yml` | handmatig: een kapotte bron laten herstellen (maakt een pull request) |
| `controle.yml` | bij elke push: syntaxis, bronnen, rubrieken en alle tests |

## Wat nog NIET per gemeente is

De mappen, de bronnen, de plaatsen, het iBabs-adres en de data zijn per gemeente. De rest nog niet.
Dit moet nagelopen worden voor een tweede gemeente werkt:

- De AI-prompts die Zaanstreek noemen: `signalering/samengesteld.js`, `signalering/prioriteit/ai.js`,
  `functies/besluitenlijst.js` en `functies/verslag.js`, en de woordenlijst in `ai/spelling.js`.
- De scrapers voor moties, schriftelijke vragen, camera's en de raadsfuncties kunnen nog
  Zaanstad-specifieke details bevatten (namen van commissies, zoektermen). Het iBabs-adres komt
  wel uit `gemeente.json`.
- De media in `signalering.json` (Rodi, Zaanstad.nieuws) hebben elk een eigen adapter in
  `signalering/bewijs.js`; een ander medium kan een eigen adapter nodig hebben.
- De workflow draait één run, voor de standaardgemeente. Per gemeente een eigen run (bijvoorbeeld als
  matrix) kan nog niet, en de `_regio`-bronnen zouden dan per gemeente worden opgehaald.
- De lijst met rubrieken (de tags) staat alleen in `gemeenten/zaanstad/rubrieken.json`.
- De website toont `data/zaanstad/` (`DATA_MAP` bovenin `script.js`) en staat nog in de root. Hij kan
  niet zomaar naar een map `site/`: GitHub Pages publiceert vanaf een tak alleen de root of `/docs`,
  dus daarvoor is eerst een andere Pages-instelling (via een workflow) nodig.

## Agendapunten uit het nieuws (ZANP 5b)

Evenementen die in nieuwsberichten staan, komen in de agenda via een aparte stap die draait **nadat** de berichten hun kop, tag en checklist hebben (`functies/agenda-signalering.js`):

1. **Poort (code).** Van elk nieuw bericht (behalve moties, vragen, aanbestedingen, camera en stroomstoringen) leest `verwerking/agenda-poort.js` de kop en de **volledige** tekst, zonder tekenlimiet. De poort is ruim: een datum, een weekdag, "morgen", "komend weekend", "volgende week donderdag". Een datum vóór de dag van de run valt af, net als een weekdag na "vorige" of "afgelopen".
2. **AI.** Alleen een bericht met een signaal gaat, met de volledige tekst, naar de AI (`ai/agenda-ai.js`, lichte modelketen). Vijf berichten of 150.000 tekens per verzoek; een groter bericht krijgt een eigen verzoek.
3. **Controle (code).** Elk punt gaat door `verifieerAgendapunten`: de datum staat in de tekst, de weekdag klopt, tijd en plaats staan in de tekst. Een punt vóór de rundag valt af.
4. **Voortgang.** `zanp-agenda-voortgang.json` onthoudt per bericht de status (`geen-signaal`, `in-afwachting`, `klaar`, `mislukt`, `geen-tekst`). Lukt de AI niet (geen sleutel, quotum, storing), dan blijft het bericht in afwachting; elke run begint met de oudste die nog openstaat. Bij een storing wacht de stap 30 seconden en probeert de hele modelketen nog één keer. De tekst van berichten met een signaal staat daarvoor in `zanp-teksten/`.

Instellingen: `ZANP_AGENDA_CAP` (AI-verzoeken per run, standaard 12) en `ZANP_AGENDA_WACHT_MS` (wachttijd bij een storing, standaard 30000). De kop-, tag- en checklistverzoeken halen geen agendapunten meer uit de bron.
