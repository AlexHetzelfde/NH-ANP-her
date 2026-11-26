# Geschiedenis van de bronnen (Zaanstad)

Dit is de toelichting die bovenin de oude bronbestanden stond, bewaard als logboek.
De bestandsnamen daarin (bronnen.js, zanp-bronnen.js, bewijs-bronnen.js) bestaan niet meer:
sinds de herindeling staan de bronnen in nieuws.json, agenda.json en signalering.json
(deze map) en in ../_regio/nieuws.json.

## Uit bronnen.js

```
gemeenten/zaanstad/bronnen.js

Centrale lijst van bronnen. Elke bron krijgt een categorie: "lokaal" of "landelijk".

Sinds 2026-10-26:
 - blaise-pascal-college en OmgevingsdienstNHN verwijderd (leverden
   onvoldoende op en kostten te veel tijd).

Sinds 2026-11-14 (voorbereiding op de regio Midden-Noord-Holland):
 - De pitchmachine is uit de repo gehaald; ZANP is de enige gebruiker van deze lijst.
 - Verwijderd op verzoek: hhnk, zaansche-molen, ovo-zaanstad,
   zaans-museum, zaanse-schans, zaandijk-leeft, zaans-cultuur-huis,
   WaarheenAgenda en vervoerregio-persberichten.
 - DeOrkaan was ook verwijderd, maar staat sinds 2026-11-17 terug met alleenAgenda: de
   artikelen worden gewoon opgehaald (volledige tekst, AI-analyse), maar komen nooit als
   nieuwsbericht in de nieuwsdienst. Ze dienen alleen om agendapunten en termijnen te
   signaleren (en als bewijsstuk voor de prioriteitsberekening).
 - politie-zaanstad verwijderd (52 ZANP-runs achter elkaar niets; de selectors
   van politie.nl werken niet meer).

Sinds 2026-11-16:
 - veiligheidsregio-nieuws toegevoegd (Veiligheidsregio Zaanstreek-Waterland, TYPO3-
   nieuwslijst). De stroomstoringen van Stroomstoringkaart staan in zanp-bronnen.js,
   want die hebben een eigen scraper.
```

Midden in bronnen.js stond, boven zaanstad-kalender en de bronnen daarna, deze regel:

> Bronnen die op 2026-10-31 aan ZANP zijn toegevoegd (politie-zaanstad is op 2026-11-14 weer verwijderd, zie hierboven).

## Uit zanp-bronnen.js

```
gemeenten/zaanstad/zanp-bronnen.js

Aanvullende bronnen voor ZANP (de nieuwsstroom, zanp.js), naast bronnen.js.
zanp.js leest beide lijsten. De pitchmachine bestaat niet meer, dus het
onderscheid is alleen nog praktisch: "Bron toevoegen" en "Bron herstellen"
werken op bronnen.js; bronnen met een eigen scraper of speciale opties
staan hier. Vergeet niet een regel in rubrieken.json.

Dit bestand wordt niet door "Bron toevoegen" of "Bron herstellen"
herschreven: die workflows werken alleen op bronnen.js.

Sinds 2026-11-14: zaanstad-tenderned verwijderd (50 runs achter elkaar niets)
en zaanstad-ted verwijderd op verzoek (regio Midden-Noord-Holland). De
scrapers zelf (scrapers/tenderned.js en scrapers/ted.js) blijven staan,
mocht een van beide bronnen terugkomen.

Sinds 2026-11-16: stroomstoringkaart toegevoegd (stroomstoringen in Zaanstreek-
Waterland, altijd rood).
```

## Uit bewijs-bronnen.js

```
gemeenten/zaanstad/bewijs-bronnen.js

Bronnen die ALLEEN dienen als bewijs voor aandacht: hoeveel wordt er in andere
media over een onderwerp geschreven? Ze staan bewust NIET in bronnen.js:

  - hun stukken worden geen nieuwsbericht (niet in berichten.json of de site),
  - ze leveren geen agendapunten en geen termijnen,
  - ze krijgen geen AI-kop of -analyse,
  - ze worden niet zelf rood.

Wat er wel mee gebeurt (zie bewijs.js en prioriteit/index.js): kop, korte tekst
en datum worden ingelezen, er wordt een vingerafdruk van gemaakt en die telt mee
bij het bepalen van de verhalen en de routes naar rood (prioriteit/routes.js).

De Orkaan staat wel in bronnen.js (met alleenAgenda: hij levert ook agendapunten
en termijnen) en telt daarnaast net zo mee als bewijs.

Gegevens gecontroleerd op de aangeleverde broncode van 2026-11-18:
  Rodi          RSS-feed https://www.rodi.nl/rss (in de <head> van elk artikel) en
                de lijstpagina met kaarten (kop, intro, rubriek, "17 nov, 14:30").
                Een artikel heeft time[datetime] (Nederlandse tijd), .article-intro
                en .articlediv.
  Zaanstad.nieuws  Newsifier (Next.js). De lijstpagina bevat per artikel kop,
                inleiding, url en published_at (UTC) in de ingebedde gegevens. Een
                artikel heeft de tekst in #article-blocks .paragraph-content. Er is
                ook een nieuws-sitemap (/sitemap/news.xml); die wordt als extra
                bron gebruikt als hij leesbaar is.
                De pagina's tonen ook landelijk nieuws (nieuws.nl, ANP): alleen
                artikelen op zaanstad.nieuws.nl zelf tellen.

"use strict";
```
