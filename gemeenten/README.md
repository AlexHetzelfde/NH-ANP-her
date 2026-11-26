# gemeenten/

Hier staat per gemeente WAT er opgehaald wordt. De code staat in `kern/` en is voor alle
gemeenten hetzelfde. Alleen `kern/basis/gemeenten.js` weet hoe deze map is ingedeeld.

```
gemeenten/
  _regio/               bronnen die voor meerdere gemeenten gelden
    nieuws.json
    rubrieken.json
  zaanstad/
    gemeente.json       naam, plaatsen, iBabs-adres, bronvolgorde
    nieuws.json         nieuwsbronnen
    agenda.json         kalenderbronnen
    signalering.json    Orkaan (scrapers) en Rodi, Zaanstad.nieuws (bewijs)
    rubrieken.json      instellingen per bron + de lijst met rubrieken (tags)
    GESCHIEDENIS.md     welke bronnen er zijn gekomen en gegaan
```

Een map die met een underscore begint telt niet als gemeente. Een run neemt de bronnen van de
gemeente en van `_regio` mee. Velden die met een underscore beginnen (`_uitleg`, `_opmerking`) zijn
toelichting voor mensen en worden bij het inlezen weggelaten. Ze mogen overal staan.

## Welk bestand waarvoor

- **Nieuws van een site toevoegen?** `nieuws.json`, via de workflow "Bron toevoegen" of met de hand.
  Staat de bron voor meerdere gemeenten (provincie, veiligheidsregio, ...), zet hem dan in
  `_regio/nieuws.json`.
- **Agenda?** `agenda.json`, bronnen met `soort: "agenda"`: die leveren agendapunten.
- **Een medium dat alleen bewijs van aandacht levert?** `signalering.json`. Onder `bewijs` (Rodi,
  Zaanstad.nieuws) wordt het alleen door `signalering/bewijs.js` bekeken en wordt het geen bericht.
  Onder `scrapers` (De Orkaan) wordt het als gewone bron opgehaald; met `alleenAgenda: true` komen de
  artikelen nooit als nieuwsbericht in de nieuwsdienst, alleen als agendapunten en termijnen.
- **Een bron met een eigen scraper** (moties, camera, stroomstoringen, ...) staat gewoon in
  `nieuws.json`; het `type` verwijst naar een bestand in `kern/scrapers/`. "Bron herstellen" en de
  bronvalidatie laten zulke bronnen met rust (`EIGEN_SCRAPER_TYPES` in `kern/basis/gemeenten.js`).
- **Elke bron heeft ook een regel in `rubrieken.json`** (tag, herkomst, prioriteit), in dezelfde map
  als de bron. `node gereedschap/valideer-rubrieken.js` (in `kern/`) meldt het als die ontbreekt.

## De volgorde van de bronnen

`bronvolgorde` in `gemeente.json` bepaalt de volgorde waarin de bronnen in een run staan. Dat
doet ertoe: staat hetzelfde bericht (dezelfde url) in twee bronnen, dan wint de bron die eerder in
de lijst staat. Bronnen die er niet in staan komen daarna, in de volgorde van de bestanden. Een
bron die je toevoegt hoeft dus niet in `bronvolgorde`, tenzij hij boven een andere moet winnen.

## Een gemeente toevoegen

Maak `gemeenten/<id>/` met `gemeente.json` (naam, plaatsen, iBabs-adres, bronvolgorde), `nieuws.json`
en `rubrieken.json`. Zie "Wat nog NIET per gemeente is" in `docs/ARCHITECTUUR.md` voor wat daarna nog
nagelopen moet worden. De tests (`kern/tests/gemeenten.test.js`) laten zien dat een tweede gemeente
wordt opgepikt samen met `_regio`, zonder dat Zaanstad verandert.
