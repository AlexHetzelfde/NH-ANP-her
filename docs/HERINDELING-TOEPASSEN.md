# De herindeling doorvoeren

Deze zip bevat het complete project in de nieuwe indeling. De indeling zelf staat in
`ARCHITECTUUR.md`. Hier staat hoe je hem doorvoert. Het kan vanuit de oorspronkelijke repo en
ook vanuit de staat na de eerste herindelings-zip.

## Wat er veranderd is

- De code is verhuisd van `scraper/` naar `kern/`, in mappen per rol.
- De bronnen staan per gemeente in `gemeenten/` (en `_regio/`), als JSON.
- De data staat per gemeente in `data/zaanstad/`. De website leest dat pad.
- De werking van de scrapers, de AI en de prioriteit is niet aangeraakt.
- Nieuw: `.gitignore` (zodat een lokale `node_modules` nooit wordt meegecommit), tests voor de
  gemeentenstructuur en de bronschrijver, en een stap `npm test` in `controle.yml`.
- Niet verplaatst: `index.html`, `script.js`, `style.css` en `gemeenten.json` (het menu van de
  website). Een map `site/` kan pas als de Pages-instelling daarvoor is aangepast.

## Zo voer je het door

1. Doe het kort nadat de uurlijkse run klaar is (die start om :07 en duurt een paar minuten).
   Zet anders `zanp-run.yml` even uit via Actions.
2. In je lokale kopie van de repo: `git pull`, daarna een tag om op terug te kunnen vallen:
   `git tag voor-herindeling && git push --tags`
3. Pak de zip uit **in de hoofdmap van die kopie**, over de bestaande bestanden heen. Let op:
   `.github` is een verborgen map. Zorg dat die ook wordt meegekopieerd (op een Mac toon je
   verborgen mappen in Finder met Cmd+Shift+punt).
4. Draai het script: `bash docs/toepassen.sh`. Dat verplaatst de nieuwste live data naar
   `data/zaanstad/` (die wint van de momentopname uit de zip), verwijdert de oude bestanden en zet
   alles klaar.
5. `git commit -m "Herindeling: kern/, gemeenten/ en data per gemeente" && git push`
6. Controleer:
   - Bij Actions moet "Controleer JS-bestanden" groen worden (dat draait nu ook alle tests).
   - Start één keer handmatig "ZANP-run" en kijk of die slaagt en `data/zaanstad/` wordt bijgewerkt.
   - Open de website. Toont die niets, ververs dan hard (Cmd+Shift+R): een oude `script.js` kan
     tot ongeveer 10 minuten in de browser blijven staan en zoekt dan nog op het oude pad.

Gaat er iets mis: `git revert` van die ene commit, of terug naar de tag `voor-herindeling`.

## Als je liever zonder script werkt

Het script doet drie dingen: de bestanden in `data/` (behalve `data/zaanstad/`) naar
`data/zaanstad/` verplaatsen, de oude bestanden verwijderen en `git add -A`. De lijst van oude
bestanden staat bovenin het script (`OUD=( ... )`).
