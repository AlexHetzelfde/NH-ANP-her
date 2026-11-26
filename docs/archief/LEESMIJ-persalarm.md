# ZANP persalarm: wat er veranderd is

Vervang/voeg toe in de repo met dezelfde paden als in deze zip. Niets raakt `data/*.json` of `bronnen.js`.

## Nieuw
- `scraper/bewijs-bronnen.js`, `scraper/bewijs.js`: Rodi (Zaanstad) en Zaanstad.nieuws.nl als bewijs van aandacht. Géén nieuwsberichten, géén agendapunten, geen AI-kop. Bewaard in `data/zanp-prioriteit/bewijs.json`.
- `scraper/prioriteit/verhalen.js`: stukken (agenda, nieuws, bewijs) in verhalen indelen.
- `scraper/prioriteit/routes.js`: de routes naar rood, elk met een eigen reden: Brekend, Uitkomst, Gepland moment, Breed opgepikt (+ Vervolg, alleen schaduw).
- `scraper/prioriteit/verhaal-ai.js`: de AI helpt losse stukken bij een verhaal te zoeken (alleen een nummer; de code telt).
- 5 nieuwe testbestanden + 4 fixtures (de echte pagina's, ingekort).

## Gewijzigd
- `gemini.js`, `wire.js`: AI-kop voor elk nieuwsbericht. Nieuwe modus `kop` voor berichten die nooit langs de AI gingen (moties, schriftelijke vragen, aanbestedingen); bestaande berichten zonder AI komen zolang ze in het venster vallen alsnog aan de beurt. Uitgezonderd: stroomstoringkaart en cameratoezicht (hun kop is al een vaste regel). Alle AI-modi met een kop geven ook het soort (incident / uitkomst / gepland / overig) met een bewijszin die letterlijk in de bron moet staan.
- `prioriteit/index.js`, `geheugen.js`, `instellingen.js`: verhalen en routes erin gehangen, `routelog.json`, route-rood + fases in het geheugen.
- `zanp.js`: bewijsbronnen ophalen vóór de prioriteit, AI-indeling meegeven.
- `script.js`: label (Brekend, Uitkomst, …) bij rood nieuws.
- `zanp-run.yml`: nieuwe variabelen (zie hieronder).
- `tests/geen-samenvatting.test.js`: verwachte promptversie bijgewerkt.

## Aanzetten (Settings → Variables)
| Variabele | Waarde | Effect |
|---|---|---|
| `ZANP_ROOD_ROUTES` | leeg = `schaduw` | rekenen en loggen in `routelog.json`, niets kleuren |
| | `aan` | alleen de routes kleuren; de oude formule kleurt dan niets |
| | `uit` | routes en bewijsbronnen uit |
| `ZANP_ROOD_AI_VETO` | `1` | AI mag route-rood tegenhouden (standaard alleen loggen) |
| `ZANP_VERHAAL_AI` | `0` | geen AI-hulp bij het indelen |
| `ZANP_BEWIJS` | `0` | Rodi en Zaanstad.nieuws niet ophalen |

AI werkt pas als het secret `GEMINI_API_KEY` is ingesteld.

## Hoe je de schaduwrun leest (`data/zanp-prioriteit/routelog.json`)
- `verhalen`: verhalen met een route of aandacht van 2+ media, met metingen (stukken, media, echo) en leden.
- `dagen.<dag>.nieuwRood`: wat rood zou worden, met reden. `zonderDoel`: een route ging af, maar er is geen eigen bericht om te kleuren (verhaal bestaat alleen uit andere media).
- Drempels staan in `ROUTES` (`instellingen.js`). Een andere drempel wist het schaduw-rood automatisch.

## Bekende beperkingen
- Rodi-RSS en de Zaanstad.nieuws-sitemap zijn niet gecontroleerd op echte data (de lijst- en artikelpagina's wel); beide hebben een terugval op de lijstpagina.
- Er zijn maar 3 lokale media (De Orkaan, Rodi, Zaanstad.nieuws): "Breed opgepikt" (3 media) is dus streng.
- Het soort (incident/uitkomst) bestaat alleen voor berichten die vanaf nu door de AI gaan; oude berichten hebben het niet (rubriek 112 telt wel als incident).
- Tests: 223 groen (was 172).
