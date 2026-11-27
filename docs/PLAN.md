> **Let op:** dit is het logboek van vóór de herindeling. De paden hierin zijn de oude: `scraper/` heet nu
> `kern/` (met submappen), de bronnen staan in `gemeenten/` en de data in `data/zaanstad/`. De huidige indeling staat in
> [`ARCHITECTUUR.md`](ARCHITECTUUR.md).

# PLAN.md: ZANP verbeteringen

Bron van waarheid voor alle chats. Elke chat begint met: clone de repo, lees dit bestand, doe alleen de genoemde fase. Werk dit bestand aan het eind van elke chat bij.

Status: `[ ]` open, `[x]` af, `[~]` deels (zie opmerking).

## Spelregels (gelden voor elke fase)

1. Het pitchdeel bestaat niet meer (verwijderd op 2026-11-14, zie "Fase 0" hieronder). Er worden geen pitches meer gemaakt.
2. Er zijn twee klassen Gemini-modellen, elk met een eerste keus en twee reserves (`MODELLEN` in `gemini.js`, zie "AI-modellen" hieronder). Het lichte werk draait op Flash-Lite, het zware werk (rode controle, samengesteld nieuws, raadsverslagen) op Flash. Pro is niet beschikbaar op dit account.
3. Alleen fouten oplossen en de gevraagde verbeteringen doorvoeren. Wat werkt of goed is, blijft zoals het is.

### Fase 0: regio Midden-Noord-Holland, opruimen (2026-11-14)

Voorbereiding op een nieuwe repo voor de regio tussen Zaanstreek-Waterland en Alkmaar.

- [x] Pitchmachine verwijderd: `scraper/index.js`, `scraper/nieuwscriteria.js`, `.github/workflows/dagelijkse-run.yml`, `data/pitches.json`, `data/nieuws-lokaal.json`, `data/nieuws-landelijk.json`, `data/feed.json`, `data/bron-gezondheid.json`.
- [x] `gemini.js`: criteria-filter en pitchprompts eruit (`beoordeelBerichten`, `genereerPitches` en bijbehorende helpers); alleen de ZANP-functies blijven.
- [x] Front-end: tab Pitches, Nieuwsfeed en de lijsten "Alle lokale/landelijke berichten" eruit (`index.html`, `script.js`, `style.css`).
- [x] `package.json`: `npm start` draait nu `zanp.js`.
- [x] `herstel-bronnen.js` leest zijn tellers uit `data/zanp-status.json`. Er is geen automatisch zelfherstel meer; "Bron herstellen" werkt alleen handmatig.
- [x] Bronnen verwijderd (uit `bronnen.js`, `zanp-bronnen.js` en `rubrieken.json`): DeOrkaan, hhnk, zaansche-molen, ovo-zaanstad, zaans-museum, zaanse-schans, zaandijk-leeft, zaans-cultuur-huis, WaarheenAgenda, vervoerregio-persberichten, zaanstad-ted.
- [x] Gemeentemenu in de header (Nieuwsdienst en Agenda): "Gemeente: Alles" plus 15 gemeenten van Zaanstreek-Waterland tot Alkmaar, uit `gemeenten.json`. De keuze geldt voor beide tabs en wordt onthouden. Een bericht of agendapunt hoort bij een gemeente als kop, plaats of tekst de gemeente of een plaats noemt, of als de bron aan de gemeente gekoppeld is (`bronnen` in `gemeenten.json`). Bij een nieuwe bron daar dus ook een koppeling toevoegen. Berichten zonder herkende gemeente staan alleen bij Alles.
- [ ] Nog te doen voor de nieuwe regio: bronnen voor Alkmaar en omgeving toevoegen, titels en teksten ("Zaanstreek-Waterland") aanpassen, en de bestaande data (`berichten.json`, `agenda.json`, `zanp-*`) leegmaken of bewaren.

## AI-modellen (22 nov 2026)

Limieten van het gratis Google AI Studio-account (overzicht van 22 nov 2026; RPM = verzoeken per minuut, RPD = per dag, per model):

| Model | RPM | TPM | RPD |
|---|---|---|---|
| 3.5 Flash Lite, 3.1 Flash Lite | 15 | 250K | 500 |
| 2.5 Flash Lite | 10 | 250K | 20 |
| 3.8 Flash, 3.6 Flash, 3 Flash, 2.5 Flash, 4 Hydrogen | 5 | 250K | 20 |
| Gemma 4 26B/31B | 30 | 16K | 14.400 |
| Pro-modellen, Gemini 4 Argon/Carbon/Neon | 0 | 0 | 0 |

De piek van ZANP op Flash-Lite was 36 verzoeken per dag (28 dagen). Het quotum telt verzoeken, geen tokens: meer tekst per verzoek kost dus niets extra. Het quotum geldt per model en wordt gedeeld met alles wat je zelf in AI Studio doet.

**Klassen** (`MODELLEN` in `gemini.js`, aan te passen met de GitHub-variabelen `ZANP_MODELLEN_LICHT` en `ZANP_MODELLEN_ZWAAR`, namen gescheiden door komma's):

| Klasse | Eerste keus | Reserve 1 | Reserve 2 | Voor |
|---|---|---|---|---|
| licht | `gemini-flash-lite-latest` | `gemini-3.1-flash-lite` | `gemini-2.5-flash-lite` | koppen, tags, checklists, agendapunten, dubbel nieuws, verhalen indelen, dossiers |
| zwaar | `gemini-flash-latest` | `gemini-3.6-flash` | `gemini-3-flash` | rode controle (met terugval op licht), samengesteld nieuws, besluitenlijst en raadsverslag |

- `roepGeminiWire(prompt, sleutel, maxTokens, { klasse, terugval })` probeert de reeks van boven naar onder. Een model dat vol is (429 of dagcap) of niet antwoordt (fout, 90 s licht, 180 s zwaar) wordt overgeslagen; pas als alle modellen falen komt er een fout, met status 429 als dat door het quotum kwam.
- De teller en de wachttijd per model staan in `data/zanp-status.json` onder `gemini.modellen`. Dagcap per model: `ZANP_CAP_LICHT` (standaard 300) en `ZANP_CAP_ZWAAR` (standaard 15); 2.5 Flash-Lite krijgt hoogstens 15. Zware modellen krijgen 13 s tussen twee verzoeken (5 per minuut).
- Bij de start van een run vraagt `ontdekModellen()` aan Google welke modellen bestaan; een naam die niet bestaat wordt overgeslagen en de lijst staat in het logboek (`ai.modellenBeschikbaar`). Welk model echt antwoordde staat in elk antwoord (`model`, `modelVersie`) en per model in `ai.perModelVandaag`.
- De namen met `-latest` staan vast; de versies erachter zijn een gok die bij de eerste run gecontroleerd wordt.
- Alleen Flash en Flash-Lite. Hydrogen (codenaam, waarschijnlijk preview) en Gemma (16K tokens per minuut, te weinig voor een verslag) zijn bewust niet gebruikt.
- `ZANP_DAGCAP` (standaard 80) blijft het totaal aan verzoeken per dag over alle modellen.
- Bronnen toevoegen/herstellen (`gemini-recept-lus.js`): Flash-Lite, daarna Flash; de Pro-stap is eruit.

**Meer tekst naar de AI:** brontekst per bericht in een batch 3.000 → 6.000 tekens; dubbel nieuws 500 → 1.500 tekens per artikel; de kern (begin van de tekst voor de rode controle en het indelen van verhalen) één zin van 200 → eerste zinnen tot 500 tekens. De tekststap levert nog steeds hoogstens 6.000 tekens per artikel.

### Eerste controle in de repo, voor elke fase

Dit plan is opgesteld uit het chatgesprek, niet uit de actuele repo. Controleer eerst de actuele staat van de bestanden hieronder. Het gesprek meldt dat Flash-Lite voor ZANP en een stop bij een 429 in `zanp.js` mogelijk al (deels) staan. (Fase 0 hierboven is wel uitgevoerd.)

---

## Samengesteld nieuws (23 nov 2026, stap 3)

Nieuws dat binnen 72 uur op minstens twee van De Orkaan, Rodi en Zaanstad Nieuws staat, krijgt één eigen bericht in de ZANP-stroom: kop plus één of twee alinea's, en in de pop-up links naar alle publicaties. Geen meldingen, alleen de stroom.

- **Wie doet wat.** De code geeft het signaal (`scraper/samengesteld.js`: zelfde gelijkenismaat als het dubbele nieuws, `cluster.js`, alleen tussen verschillende media, alle stukken binnen 72 uur van elkaar; past een groep niet, dan blijft het venster met de meeste media over). Een sterk model (Flash, klasse zwaar, zonder terugval op het lichte model) beslist: is het hetzelfde nieuwsfeit, is het de moeite waard, en schrijft kop en alinea's. De code controleert die tekst: elk getal, elke maand of weekdag en elke eigennaam moet letterlijk in de bronteksten staan, geen aanhalingstekens, kop 15 tot 120 tekens, 1 of 2 alinea's. Faalt dat, dan is er geen bericht (twee pogingen, daarna wordt die groep niet meer gevraagd).
- **Volledige teksten.** `bewijs.json` bewaart alleen kop en inleiding. Voor kandidaten die de drempel halen worden de artikelen van Rodi, Zaanstad Nieuws en De Orkaan opnieuw opgehaald (maximaal 5000 tekens per stuk naar het model).
- **Vaste id.** `s-` plus een hash van de URL van het oudste stuk. Komt er later een derde medium bij, dan wordt het bericht bijgewerkt (zelfde id, nieuwe versie) in plaats van dubbel gemaakt. Een groep zonder nieuw medium wordt niet opnieuw beoordeeld. Zegt het model nee, dan wordt dezelfde groep (zelfde URL's) niet opnieuw gevraagd.
- **Modus.** `ZANP_SAMENGESTELD_MODUS`: `schaduw` (standaard: rekenen, kandidaten loggen en alles bewaren in `data/zanp-samengesteld.json`, niets in de stroom), `aan` of `uit`. Zet hem pas op `aan` als je in schaduw genoeg goede voorbeelden hebt gezien. `ZANP_SAMENGESTELD_MAX` (standaard 3) is het maximum aantal oordelen per run.
- **In de stroom.** Alleen in modus `aan` zet `zanp.js` de berichten (bronId `samengesteld`, bronNaam "Samengesteld nieuws", prio 3, `samengesteld.bronnen` met alle links) vlak voor het wegschrijven in `berichten.json`. De gewone verwerking (clusters, alerts, prioriteit, dossiers) ziet ze niet. `script.js` toont ze met de tekst uit het record, een AI-label en de lijst "Gepubliceerd door".
- **Quotum.** Telt mee in het dagquotum (`ZANP_DAGCAP`) en in het quotum per model (Flash: 15 per dag per model in de standaardinstelling); bij een 429 stopt de ronde en probeert de volgende run het weer.
- **Let op, redactioneel.** Rodi en Zaanstad Nieuws zijn andere redacties (zie `rubrieken.json`: analyse, geen herschrijving). Dit onderdeel gaat daar bewust een stap overheen: de tekst blijft kort en feitelijk, zonder citaten, met de bronnen altijd zichtbaar. Beoordeel de schaduwvoorbeelden hier ook op.
- Eerste controle in het logboek (`data/zanp-log.json`, onderdeel `samengesteld`): aantal stukken, groepen, `aiNee`, `afgekeurd` (met `reden` in `zanp-samengesteld.json` onder `afgewezen`).

## Besluitenlijst raadsvergadering (24 nov 2026, stap 4a)

Na een raadsvergadering van Zaanstad (niet Zaanstad Beraad) komt ongeveer een dag later de besluitenlijst online in iBabs (PDF). ZANP maakt daar één bericht van: een kop en per besluit één alinea in lopende tekst met alle details (agendapunten met een besluit, elke motie, elk amendement, de toezeggingen). Het verslag (stap 4b) is een apart bericht en volgt later.

- **Vinden.** `scraper/besluitenlijst.js` onthoudt elke kalenderregel "Raadsvergadering" (iBabs-kalender, `zaanstad-kalender`) in `data/zanp-besluitenlijsten.json`. Zodra een vergadering is begonnen kijkt ZANP hooguit elke 3 uur op `/Agenda/Index/{id}` naar een bijlage "Besluitenlijst …" (`/Document/LoadAgendaDocument/…`, de vergaderbijlage, niet die van een agendapunt, en niet het verslag). Tot 14 dagen na de vergadering.
- **Blokken (code).** De PDF-tekst (pdf-parse) wordt door de code in blokken verdeeld, elk met ruwe tekst en stemuitslag (voor, tegen, aangenomen of verworpen, of ingetrokken). Getest op de echte lijst van 10 november 2026 (47 blokken, 43 moties en amendementen), inclusief de rommelige gevallen: voetregel over twee regels, voetregel zonder suffix of vervangen door een URL, typfout in het nummer, nummer vastgeplakt aan de eerste regel.
- **Alinea's (AI, Flash, klasse zwaar, geen terugval op het lichte model).** Per verzoek hooguit 10 blokken of 12000 tekens; per run hooguit `ZANP_BESLUITENLIJST_MAX` (6) verzoeken. De voortgang staat per blok in het bestand: raakt het quotum op, dan gaat de volgende run verder.
- **Controle (code, `scraper/brontrouw.js`, gedeeld met het samengestelde nieuws).** Elk getal, elke maand of weekdag en elke eigennaam staat letterlijk in het blok; het aantal voor en tegen staat in de alinea; "aangenomen", "verworpen" of "ingetrokken" komt overeen met de uitslag. Een alinea die faalt wordt één keer opnieuw gevraagd; daarna schrijft de code zelf een kale regel uit de gegevens (bijvoorbeeld "Motie 26M80 ‘Zaans Preventiemodel’: 38 stemmen voor, 0 stemmen tegen (aangenomen)."), nooit een verkeerde uitslag. De kop komt van het model (met controle) en anders van een vaste kop ("Besluitenlijst gemeenteraad Zaanstad 10 november 2026 (begroting)").
- **Bericht.** Pas als alle blokken een alinea hebben komt het bericht (bronId `besluitenlijst`, prio 3, tag GEM, `herkomst: officieel`). De tijd is het moment waarop ZANP de besluitenlijst voor het eerst vond. Zijn na 48 uur nog niet alle alinea's door het model geschreven, dan maakt de code de rest zelf af. De pop-up toont de alinea's, een AI-label (met het aantal kale code-regels) en links naar de PDF en de vergaderpagina.
- **Modus.** `ZANP_BESLUITENLIJST_MODUS`: `schaduw` (standaard: alles doen en bewaren, niets in de stroom), `aan` of `uit`.
- **Nog niet bewezen vanaf de server.** Het ophalen van de PDF (`fetch` op de `LoadAgendaDocument`-link, controle op `%PDF-`) is hier niet vanuit GitHub Actions geprobeerd. Kijk bij de eerste raadsvergadering in `data/zanp-log.json` (onderdeel `besluitenlijst`, velden `fout-…`) of dat lukt. Mislukt het ophalen vier keer, dan staat de vergadering op `mislukt` en de fout in `zanp-besluitenlijsten.json`.
- **Bekende beperking.** Een later gecorrigeerde besluitenlijst wordt niet opnieuw ingelezen.

## Verslag raadsvergadering (24 nov 2026, stap 4b)

Ongeveer een week na een raadsvergadering van Zaanstad (niet Zaanstad Beraad) staat het woordelijke verslag online (PDF; dat van 10 november 2026 is 87 pagina's, 802 beurten). ZANP maakt daar hooguit 15 nieuwsberichten van, alleen zoveel als nodig is: elk met een kop en één alinea. Het is een apart bericht naast de besluitenlijst (4a).

- **Vinden.** `scraper/verslag.js` gebruikt dezelfde vergaderingen als de besluitenlijst (`vindVergaderingen`). Vanaf de vergadering kijkt ZANP hooguit elke 6 uur (twee vergaderingen per run) op `/Agenda/Index/{id}` naar een vergaderbijlage "Verslag …" (niet de besluitenlijst, niet een bijlage van een agendapunt), tot 45 dagen na de vergadering. Staat in `data/zanp-verslagen.json`.
- **Beurten (code).** De PDF-tekst wordt door de code in genummerde beurten verdeeld (wie spreekt, wat is gezegd; de paginakop valt weg). De wethouders haalt de code uit de tekst zelf (de voorzitter noemt hun rol; alleen namen van mensen die ook spreken). De partij van een raadslid komt uit de indieners (`Naam (PARTIJ)`) in de besluitenlijst, en alleen als alle namen met die achternaam dezelfde partij hebben; anders weet het model de partij niet en noemt het alleen de naam.
- **Stap 1: onderwerpen kiezen (AI, Flash, klasse zwaar).** Eén verzoek met het hele verslag (ongeveer 200.000 tekens), de sprekerslijst en de moties uit de besluitenlijst. Het model geeft hooguit 15 onderwerpen, belangrijkste eerst, met per onderwerp het bereik van beurten en de bijbehorende moties. De code controleert dat de beurten bestaan (hooguit 60 beurten of 14.000 tekens per onderwerp) en dat de moties in de besluitenlijst staan. Twee mislukte pogingen: de vergadering staat op `mislukt`.
- **Stap 2: schrijven (AI, Flash).** Drie onderwerpen per verzoek, met alleen de volledige tekst van hun beurten. Per bericht een kop (20 tot 110 tekens) en één alinea (80 tot 900 tekens), zonder aanhalingstekens.
- **Controle (code, `scraper/brontrouw.js`).** Elk getal, elke maand of weekdag en elke eigennaam staat letterlijk in de bronbeurten, de motiegegevens of de sprekerslijst; de beurten die het model als bron noemt horen bij het onderwerp. Faalt een bericht twee keer, dan komt dat onderwerp er niet in: geen AI = geen bericht (er is bij het verslag geen kale code-regel als terugval). Het model mag een onderwerp zelf overslaan.
- **Bericht.** Per onderwerp een record (bronId `verslag`, prio 3, tag GEM, `herkomst: officieel`), pas als alle onderwerpen klaar of opgegeven zijn (uiterlijk na 72 uur). De tijd is het moment waarop ZANP het verslag vond; het belangrijkste onderwerp staat bovenaan. De pop-up toont de alinea, een AI-label en links naar de PDF en de vergaderpagina.
- **Bewaren.** Het verslag zelf staat niet in het bestand (te groot); zolang er werk is wordt de PDF bij elke run opnieuw gelezen. Verandert het verslag (andere hash), dan begint de selectie opnieuw.
- **Quotum.** `ZANP_VERSLAG_MAX` (8) verzoeken per run, op het gedeelde Flash-budget (15 per dag per model) met veto, samengesteld nieuws en besluitenlijst. Een volledig verslag kost ongeveer 1 + 5 verzoeken. Bij quotum gaat de volgende run verder.
- **Modus.** `ZANP_VERSLAG_MODUS`: `schaduw` (standaard), `aan` of `uit`.
- **Nog niet bewezen vanaf de server.** Het ophalen van de PDF vanaf GitHub Actions (zie 4a) en of Flash 200.000 tekens in één verzoek goed verwerkt. Kijk na het eerste verslag in `data/zanp-log.json` (onderdeel `verslag`, velden `fout-…`) en lees de berichten in `zanp-verslagen.json` door voordat je de modus op `aan` zet.

## Fase 1: AI-laag en quotum

Doel: ZANP werkt binnen een klein dagquotum en ook zonder AI.
Verwachte bestanden: `scraper/gemini.js`, `scraper/zanp.js`, `scraper/wire.js`, `scraper/alert-regels.js`, `.github/workflows/zanp-run.yml`, `data/zanp-status.json` (gegenereerd).

Fouten uit de eerste run:
- [ ] AI-aanroepen mislukten met een 429: het gratis quotum was 20 verzoeken per dag, niet 150 of 80.
- [ ] De teller telde pogingen in plaats van successen (32 bij een grens van 20). Na de eerste 429 gingen er nog zeven zinloze aanroepen af.
- [ ] Van 84 berichten hadden er maar 4 een checklist. Alerts en agendapunten uit berichten zijn dus ongetest en 61 berichten zijn nooit geanalyseerd.

Verbeteringen:
- [ ] ZANP overal op Flash-Lite zetten (eerst controleren wat er al staat in `zanp.js`).
- [ ] Batchen: meerdere berichten in één verzoek, voor meldingen, analyses en de dubbel-nieuws-vragen. Elk bericht in een batch wordt apart gecontroleerd; een gedeeltelijk antwoord blijft bruikbaar.
- [ ] Stroomonderbreker: bij de eerste 429 stopt de run met AI, de wachttijd komt in `zanp-status.json`, volgende runs slaan AI over tot die tijd.
- [ ] Alleen geslaagde verzoeken tellen mee. De quotumdag volgt de Amerikaanse middernacht.
- [ ] Prioriteit: eerst signaalberichten en officiële berichten met prio 3 of hoger, routine pas als er ruimte over is.
- [ ] Zonder AI moet ZANP volledig werken:
  - [ ] een eerste checklist via patronen
  - [ ] agendapunten via trefwoorden plus datum
  - [ ] (de tag via trefwoorden volgt in Fase 3)
- [ ] De AI verfijnt alleen.
- [ ] `ZANP_DAGCAP` en `ZANP_RUNCAP` instellen op basis van de echte Flash-Lite-limiet in AI Studio (https://ai.dev/rate-limit).

Afronding: ZANP-workflow handmatig starten met "alles" aan, log van STAP 2 en 5 lezen, controleren dat de pitchbestanden ongewijzigd zijn.

---

## Fase 2: Scraper, agenda en timing

Doel: sneller scrapen en een agenda die twee weken vooruit kijkt.
Verwachte bestanden: `scraper/gedeeld.js`, `scraper/zanp.js`, `scraper/agenda-regels.js`, `.github/workflows/zanp-run.yml`.

Fouten uit de eerste run:
- [ ] Bronnen worden één voor één afgewerkt.
- [ ] De Waarheen-agenda reikt maar tot 30 oktober, omdat de scraper stopt zodra een pagina na vandaag begint. De weekagenda is vanaf ongeveer vrijdag leeg.
- [ ] Het jubileumfilter mist "Tentoonstelling 150 jaar Noordzeekanaal".
- [ ] De cron is onbetrouwbaar: drie runs in ruim vier uur, waarschijnlijk was er maar één gepland.

Verbeteringen:
- [ ] Bronnen parallel ophalen (ongeveer vier tegelijk), met een maximumtijd van ongeveer 45 seconden per bron.
- [ ] Agendahorizon voor ZANP naar twee weken vooruit. Dit is een optionele instelling in de gedeelde scrapecode; de pitchrun houdt zijn huidige gedrag (alleen de dag zelf en de dag ervoor).
- [ ] Jubileumjaren toevoegen: 10, 20, 30 jaar enzovoort.
- [ ] Leeftijden zoals "4-10 jaar" blijven uitgesloten.
- [ ] "150 jaar Noordzeekanaal" moet door het filter komen.
- [ ] Externe timer (gratis cron-dienst) die de workflow elke 30 minuten start, met de GitHub-cron als reserve. Vraagt een token van jou.

Afronding: handmatige run, controleren dat de agenda ruim voorbij 30 oktober loopt en dat de pitchuitvoer ongewijzigd is.

---

## Fase 3: Tags, Bron toevoegen en layout

Doel: onderwerpindeling in negen tags en een slankere ANP-achtige weergave.
Verwachte bestanden: `scraper/wire.js`, `scraper/gemini.js` (alleen ZANP-deel), `scraper/rubrieken.js`, `scraper/rubrieken.json`, `scraper/voeg-bron-toe.js`, `scraper/valideer-rubrieken.js`, `.github/workflows/bron-toevoegen.yml`, `index.html`, `script.js`, `style.css`.

Fout uit de eerste run:
- [ ] 54 berichten staan in de kolom "Lokaal nieuws". Je wilde een onderwerpindeling.

### Tags (negen)

- [ ] Lijst: cultuur, gemeente, provincie, recht, bedrijven, 112, sport, verkeer, onderwijs.
- [ ] Onderwijs is voor Blaise Pascal College en OVO.
- [ ] De AI kiest per bericht één tag uit de gesloten lijst, in dezelfde batch.
- [ ] Zonder AI kiest een trefwoordenlijst, en bij geen treffer de standaardtag van de bron.
- [ ] Standaardtags per bron:
  - gemeente: bekendmakingen, regelgeving, hoorzittingen
  - recht: rechtspraak
  - provincie: nh-actueel, waterschap, omgevingsdiensten
  - cultuur: museum, molen, Zaanse Schans, Cultuurhuis, Waarheen, nh-cultuur
  - onderwijs: Blaise Pascal College, OVO
- [ ] Een bericht zonder passende tag staat alleen in "ZANP totaal".
- [ ] Lege kolommen (112, sport, verkeer, bedrijven) worden verborgen.
- [ ] Oude records houden hun oude code en vallen terug op alleen het totaal.
- [ ] Agendapunten uit berichten erven de tag van hun bericht.
- [ ] "Bron toevoegen": bij een nieuwe bron kies je zelf een tag. De lijst in `bron-toevoegen.yml` wordt bijgewerkt (inclusief onderwijs), en `rubrieken.json` en `valideer-rubrieken.js` kennen de nieuwe tag.

### Layout (zelfde opzet, slanker, meer ANP)

- [ ] Slanke witte bovenbalk van ongeveer 40 px: klein ZANP-woordmerk, tabs Nieuws, Agenda en Pitches, een stipje voor de laatste update en een ⋮-menu voor kolommen. Een waarschuwing verschijnt alleen als de stroom verouderd is.
- [ ] Kolommen smaller (ongeveer 220 px), kleinere letter, krappere regels.
- [ ] Per kolom alleen een titel, een zoekicoon en de agendabalk.
- [ ] Alert als rode rij in de stroom (oranje voor "mogelijk groot"), niet als aparte balk bovenaan.
- [ ] Eruit halen: werkbalk met filters, uitlegtekst, dagkoppen in de kolommen, berichtenteller per kolom, chips in de lijst.
- [ ] "Ook gemeld door" en de agendakoppeling komen alleen nog in het uitgeklapte bericht.
- [ ] Agenda: alleen ‹ Vandaag › met weeklabel en zeven dagkolommen. Dagbalk, datumkiezer en de knop "Toon ook gefilterde items" vervallen. Gefilterde items zijn alleen nog te zien via `#agenda?alles=1`.
- [ ] Klein rond "T"-icoon bij agendapunten die aan een bericht hangen.
- [ ] Op de telefoon staan de zeven dagen onder elkaar.

Afronding: handmatige run, daarna de site in een echte browser controleren (tot nu toe alleen in jsdom getest).

---

## Fase 4: Prioriteit (rood kleuren)

Doel: agenda-items en nieuwsberichten rood kleuren als het onderwerp groot leeft (veel erover geschreven en besproken, bij impact). Eén nieuwe functie in de ZANP-run, verder verandert er niets aan ZANP. Alle bronnen wegen gelijk.
Bestanden: `scraper/prioriteit/` (instellingen, taal, impact, analyse, score, beslis, geheugen, tekst, index), een haakje in `scraper/zanp.js` (ZANP 9), `maxTekens` in `scraper/hulpmiddelen.js`, `script.js`, `style.css`, `.github/workflows/zanp-run.yml`.
Data (eigen map, raakt het pitchdeel niet): `data/zanp-prioriteit/geheugen.json`, `schaduwlog.json`, `teksten-JJJJ-MM-DD.jsonl`.

Ontwerp (vastgesteld):
- Volledige tekst van alle agenda-items en berichten wordt opgehaald (ook Zaanstad-hoorzittingen, de iBabs-kalender, Waarheen, De Orkaan), zonder afkapping op 6.000 tekens. Per stuk blijft een vingerafdruk (termen, positie, impact) 30 dagen in het geheugen.
- Twee routes naar een score: aanhoudend (volume x duur x diepte) en piek (laatste 48 uur, alleen met impact-signaal). Verval met halfwaardetijd 7 dagen.
- Drempel tau = max(0,50; mediaan + 3 x MAD), dagelijks opnieuw. Rood na bevestiging in 2 runs. Rood is rood.
- Agenda-items altijd; van nieuws alleen een vers bericht, hooguit één per onderwerp per 24 uur. Noodrem bij meer dan 10 nieuw rood in één run.
- `prio` van berichten blijft ongemoeid; het resultaat staat in het veld `rood` (met reden).
- Modus via variabele `ZANP_PRIORITEIT_MODUS`: `uit`, `schaduw` (standaard, niets kleuren) of `aan`.

- [x] Module gebouwd en in `zanp.js` gehangen (NIET getest: bouwen eerst, bugs later).
- [ ] Eerste runs controleren: log van ZANP 9, `schaduwlog.json`, hoeveel teksten zijn opgehaald (`stats.tekst`).
- [ ] Kloppen de teksten van de hoorzittingen en de iBabs-kalender? (de iBabs-pagina's zijn nog niet bekeken; de reserve neemt de hoofdtekst van de pagina)
- [ ] Constanten en de impactlijst (`impact.js`) bijstellen op de schaduwlog (minstens 2 weken).
- [ ] AI-veto als laatste controle (haak `aiVeto` staat klaar in `beslis.js`, nog niet aangesloten op Gemini).
- [ ] Modus op `aan` zetten.

---

## Backlog (nog niet ingepland)

Pas oppakken na Fase 3, per stuk beslissen.

- [ ] Nieuwe bronnen: politie, brandweer en 112, verkeer, sport, bedrijven, gemeentenieuws, gemeenten buiten Zaanstad. Eerst per bron uitzoeken welke open feeds bestaan. (Brandweer en 112 deels gedaan: zie "Bronnen toegevoegd 2026-11-16" onder Voortgang.)
- [ ] Koppeling op harde sleutels (adres, zaaknummer, ECLI, postcode).
- [ ] Agendapunt dat na de zitting naar het resultaat linkt.
- [ ] Kwaliteitslog van AI-afkeuringen over meerdere dagen.
- [ ] Tests in de repo (`scraper/tests/` plus een stap in `controle.yml`).
- [ ] Echte live-meldingen met push of geluid.
- [ ] Getallen als woord ("twee gewonden") herkennen voor alerts.
- [ ] Termijnen buiten het agendavenster beter zichtbaar maken.

---

## Startprompt per fase

> Clone https://github.com/AlexHetzelfde/PitcherDEEPSEEK en lees `PLAN.md`. We doen alleen **Fase N**. Wijzig niets wat werkt. Controleer eerst de actuele staat van de bestanden van deze fase. Bouw, test, en geef alleen de gewijzigde bestanden terug. Werk daarna `PLAN.md` bij met wat af is en wat open staat.

## Voortgang

- Fase 1: open
- Fase 2: open
- Fase 3: open
- Fase 4 (prioriteit, rood): gebouwd, nog niet getest; draait in schaduwmodus

### Bronnen toegevoegd 2026-11-16 (buiten de fasen om)

- `veiligheidsregio-nieuws` (bronnen.js, type gemini-recept met selectors): nieuws van de Veiligheidsregio Zaanstreek-Waterland. Tag 112, herkomst officieel, prio 3, AI herschrijft. Gekoppeld in gemeenten.json aan zaanstad, waterland, wormerland, oostzaan, landsmeer, purmerend en edam-volendam (alleen de eerste pagina van de lijst wordt gelezen).
- `stroomstoringkaart` (zanp-bronnen.js, nieuw scrapertype `stroomstoringen` in `scrapers/stroomstoringen.js`): actuele stroomstoringen uit Noord-Holland, gefilterd op de plaatsen in `plaatsen` (dorpen en steden van Zaanstreek-Waterland). Per storing wordt de detailpagina gelezen, zodat ook storingen met meerdere plaatsen (de lijst toont alleen de eerste) goed worden gefilterd. Geen AI (`geenAi`), vaste tag 112. In gemeenten.json gekoppeld aan `"*"`: de berichten staan bij alle gemeenten.
- Nieuwe regel `altijdRood` per bron (`scraper/bron-rood.js`, aangeroepen in `zanp.js` na prioriteit en jubileum): elk bericht van die bron is rood, los van de prioriteitsberekening. Nu alleen aan voor `stroomstoringkaart`.
- Stroomstoringen kregen daarna een slimmere regel (`stroomErnst`, `kern/signalering/stroom-ernst.js`) in plaats van `altijdRood`: het aantal huishoudens wordt vergeleken met de grootste storing tot nu toe (de piek, bewaard in `data/zaanstad/zanp-stroom-piek.json`, begint bij 0 en gaat alleen omhoog). Rood vanaf 80% van de piek; een storing die de piek overtreft is zelf de nieuwe piek. Onbekend aantal blijft rood. Opgeloste storingen (niet meer op de lijst en de detailpagina zegt "opgelost") gaan uit `berichten.json`; zonder bevestiging blijft een storing staan, behalve na 72 uur als de bron wel storingen gaf. Tests: `tests/stroom-ernst.test.js` en `tests/stroom-ernst-run.test.js`.
- Kop en tekst van een stroomstoring bevatten bewust geen looptijd of status: die veranderen elke run en zouden elke keer een nieuwe versie van het bericht maken.
- `script.js`: een bron die in gemeenten.json aan `"*"` hangt, staat bij alle gemeenten.
- `hulpmiddelen.js`: `.news-related-wrap` (TYPO3-blok "Terug naar overzicht / Delen") valt weg uit artikeltekst.
- Open: de Atom-feed van Stroomstoringkaart (`/feed.xml`) zou ook al opgeloste en korte storingen kunnen geven; nu kijkt ZANP alleen naar wat er op dat moment op de provinciepagina staat. Controleer na de eerste echte runs of de plaatsenlijst compleet is en of rood niet te lang blijft staan (berichten staan standaard drie dagen in de stroom).
- 2026-11-23 stap 3: samengesteld nieuws (zie het gelijknamige hoofdstuk). Nieuw: `scraper/samengesteld.js`, `tests/samengesteld.test.js`, bestand `data/zanp-samengesteld.json` (ook in de workflow-commit), pop-up in `script.js`. `cluster.js` en `bewijs.js` exporteren een paar extra hulpfuncties.
- 2026-11-24 stap 4a: besluitenlijst raadsvergadering (zie het gelijknamige hoofdstuk). Nieuw: `scraper/besluitenlijst.js`, `scraper/brontrouw.js`, `tests/besluitenlijst.test.js`, `tests/fixtures/besluitenlijst-2026-11-10.txt`, bestand `data/zanp-besluitenlijsten.json` (ook in de workflow-commit), pop-up in `script.js`.
- 2026-11-24 stap 4b: verslag raadsvergadering (zie het gelijknamige hoofdstuk). Nieuw: `scraper/verslag.js`, `tests/verslag.test.js`, `tests/fixtures/verslag-2026-11-10.txt`, bestand `data/zanp-verslagen.json` (ook in de workflow-commit), pop-up in `script.js`. `besluitenlijst.js` exporteert een paar extra hulpfuncties.
