#!/bin/bash
# Voert de herindeling door. Draai dit in de hoofdmap van je lokale kopie van de repo,
# NADAT je de zip daar hebt uitgepakt (over de bestaande bestanden heen).
#
#   bash docs/toepassen.sh
#
# Wat het doet:
#   1. De nieuwste data van de live run (nog in data/) verhuist naar data/zaanstad/ en wint
#      van de momentopname die in de zip zat.
#   2. De oude bestanden die nu elders staan worden verwijderd (zowel uit de oorspronkelijke
#      indeling als uit de eerste herindelings-zip).
#   3. Alles wordt klaargezet voor een commit (git add -A). Committen en pushen doe je zelf.
set -e

if [ ! -d .git ] || [ ! -f kern/zanp.js ]; then
  echo "Draai dit in de hoofdmap van je repo, nadat je de zip hebt uitgepakt." >&2
  exit 1
fi

# 1. Data: de live bestanden uit data/ naar data/zaanstad/
mkdir -p data/zaanstad
verplaatst=0
for pad in data/*; do
  [ "$pad" = "data/zaanstad" ] && continue
  naam=$(basename "$pad")
  rm -rf "data/zaanstad/$naam"
  mv "$pad" "data/zaanstad/$naam"
  verplaatst=$((verplaatst + 1))
done
echo "Data: $verplaatst onderdeel/onderdelen van de live data naar data/zaanstad/ verplaatst."

# 2. Oude bestanden verwijderen
OUD=(
  "LEESMIJ-persalarm.md"
  "PLAN.md"
  "gemeenten/zaanstad/bewijs-bronnen.js"
  "gemeenten/zaanstad/bronnen.js"
  "gemeenten/zaanstad/zanp-bronnen.js"
  "scraper/aanbesteding-regels.js"
  "scraper/agenda-regels.js"
  "scraper/ai/brontrouw.js"
  "scraper/ai/gemini.js"
  "scraper/ai/spelling.js"
  "scraper/alert-regels.js"
  "scraper/besluitenlijst.js"
  "scraper/bewijs-bronnen.js"
  "scraper/bewijs.js"
  "scraper/bron-ontdekking.js"
  "scraper/bron-poort.js"
  "scraper/bron-rood.js"
  "scraper/bronbeheer/bron-ontdekking.js"
  "scraper/bronbeheer/bron-poort.js"
  "scraper/bronbeheer/bronnen-schrijver.js"
  "scraper/bronbeheer/gemini-recept-lus.js"
  "scraper/bronnen-schrijver.js"
  "scraper/bronnen.js"
  "scraper/brontrouw.js"
  "scraper/camera-reeks.js"
  "scraper/cluster.js"
  "scraper/dossiers.js"
  "scraper/feed-varianten.js"
  "scraper/functies/besluitenlijst.js"
  "scraper/functies/verslag.js"
  "scraper/gedeeld.js"
  "scraper/gemini-recept-lus.js"
  "scraper/gemini.js"
  "scraper/herstel-bronnen.js"
  "scraper/hulpmiddelen.js"
  "scraper/jubileum.js"
  "scraper/kern/gedeeld.js"
  "scraper/kern/gemeenten.js"
  "scraper/kern/hulpmiddelen.js"
  "scraper/kern/rubrieken.js"
  "scraper/kern/runlog.js"
  "scraper/koppel.js"
  "scraper/package.json"
  "scraper/patronen.js"
  "scraper/prioriteit/ai.js"
  "scraper/prioriteit/analyse.js"
  "scraper/prioriteit/beslis.js"
  "scraper/prioriteit/geheugen.js"
  "scraper/prioriteit/impact.js"
  "scraper/prioriteit/index.js"
  "scraper/prioriteit/instellingen.js"
  "scraper/prioriteit/regels.js"
  "scraper/prioriteit/routes.js"
  "scraper/prioriteit/score.js"
  "scraper/prioriteit/taal.js"
  "scraper/prioriteit/tekst.js"
  "scraper/prioriteit/verhaal-ai.js"
  "scraper/prioriteit/verhalen.js"
  "scraper/rubrieken.js"
  "scraper/rubrieken.json"
  "scraper/runlog.js"
  "scraper/samengesteld.js"
  "scraper/scraper-register.js"
  "scraper/scrapers/camera.js"
  "scraper/scrapers/feed-varianten.js"
  "scraper/scrapers/gemini-recept.js"
  "scraper/scrapers/generieke-lijst.js"
  "scraper/scrapers/ibabs-dashboard.js"
  "scraper/scrapers/ibabs-kalender.js"
  "scraper/scrapers/ibabs.js"
  "scraper/scrapers/json-api.js"
  "scraper/scrapers/json-ld.js"
  "scraper/scrapers/moties-tekst.js"
  "scraper/scrapers/moties.js"
  "scraper/scrapers/rss.js"
  "scraper/scrapers/schriftelijke-vragen.js"
  "scraper/scrapers/scraper-register.js"
  "scraper/scrapers/stroomstoringen.js"
  "scraper/scrapers/ted.js"
  "scraper/scrapers/tenderned.js"
  "scraper/scrapers/wordpress-html.js"
  "scraper/scrapers/wp-rest.js"
  "scraper/signalering/alert-regels.js"
  "scraper/signalering/bewijs.js"
  "scraper/signalering/bron-rood.js"
  "scraper/signalering/dossiers.js"
  "scraper/signalering/jubileum.js"
  "scraper/signalering/prioriteit/ai.js"
  "scraper/signalering/prioriteit/analyse.js"
  "scraper/signalering/prioriteit/beslis.js"
  "scraper/signalering/prioriteit/geheugen.js"
  "scraper/signalering/prioriteit/impact.js"
  "scraper/signalering/prioriteit/index.js"
  "scraper/signalering/prioriteit/instellingen.js"
  "scraper/signalering/prioriteit/regels.js"
  "scraper/signalering/prioriteit/routes.js"
  "scraper/signalering/prioriteit/score.js"
  "scraper/signalering/prioriteit/taal.js"
  "scraper/signalering/prioriteit/tekst.js"
  "scraper/signalering/prioriteit/verhaal-ai.js"
  "scraper/signalering/prioriteit/verhalen.js"
  "scraper/signalering/samengesteld.js"
  "scraper/spelling.js"
  "scraper/tags.js"
  "scraper/tekstarchief.js"
  "scraper/tekstopschoning.js"
  "scraper/tests/aanbesteding.test.js"
  "scraper/tests/agenda-regels.test.js"
  "scraper/tests/besluitenlijst.test.js"
  "scraper/tests/bewijs.test.js"
  "scraper/tests/bron-rood.test.js"
  "scraper/tests/camera.test.js"
  "scraper/tests/dossiers.test.js"
  "scraper/tests/fixtures/besluitenlijst-2026-11-10.txt"
  "scraper/tests/fixtures/newsifier-artikel.html"
  "scraper/tests/fixtures/newsifier-lijst.html"
  "scraper/tests/fixtures/rodi-artikel.html"
  "scraper/tests/fixtures/rodi-lijst.html"
  "scraper/tests/fixtures/stroomstoring-detail.html"
  "scraper/tests/fixtures/stroomstoring-provincie.html"
  "scraper/tests/fixtures/verslag-2026-11-10.txt"
  "scraper/tests/fixtures/vrzw-artikel.html"
  "scraper/tests/fixtures/vrzw-nieuws-lijst.html"
  "scraper/tests/geen-samenvatting.test.js"
  "scraper/tests/gemini-batch.test.js"
  "scraper/tests/gemini-herpoging.test.js"
  "scraper/tests/gemini-ketens.test.js"
  "scraper/tests/helpers.js"
  "scraper/tests/jubileum.test.js"
  "scraper/tests/kern-langer.test.js"
  "scraper/tests/kop-ai.test.js"
  "scraper/tests/koppel.test.js"
  "scraper/tests/log-fouten.test.js"
  "scraper/tests/orkaan-alleen-agenda.test.js"
  "scraper/tests/prioriteit.test.js"
  "scraper/tests/rekenkamer-nieuws.test.js"
  "scraper/tests/routes.test.js"
  "scraper/tests/runlog.test.js"
  "scraper/tests/samengesteld.test.js"
  "scraper/tests/schriftelijke-vragen.test.js"
  "scraper/tests/spelling.test.js"
  "scraper/tests/stroomstoringen.test.js"
  "scraper/tests/tekstarchief.test.js"
  "scraper/tests/tekstopschoning.test.js"
  "scraper/tests/veiligheidsregio.test.js"
  "scraper/tests/verhaal-ai.test.js"
  "scraper/tests/verhalen.test.js"
  "scraper/tests/verslag.test.js"
  "scraper/tests/wire.test.js"
  "scraper/tests/zanp.test.js"
  "scraper/valideer-bronnen.js"
  "scraper/valideer-rubrieken.js"
  "scraper/verslag.js"
  "scraper/verwerking/aanbesteding-regels.js"
  "scraper/verwerking/agenda-regels.js"
  "scraper/verwerking/camera-reeks.js"
  "scraper/verwerking/cluster.js"
  "scraper/verwerking/koppel.js"
  "scraper/verwerking/patronen.js"
  "scraper/verwerking/tags.js"
  "scraper/verwerking/tekstarchief.js"
  "scraper/verwerking/tekstopschoning.js"
  "scraper/verwerking/wire.js"
  "scraper/voeg-bron-toe.js"
  "scraper/wire.js"
  "scraper/zanp-bronnen.js"
  "scraper/zanp.js"
)
for p in "${OUD[@]}"; do
  git rm -rqf --ignore-unmatch -- "$p" 2>/dev/null || true
  rm -rf -- "$p"
done
# Lege oude mappen opruimen (scraper/ blijft staan als er nog een node_modules in zit)
if [ -d scraper ]; then
  find scraper -depth -type d -empty -delete 2>/dev/null || true
fi
if [ -d scraper ]; then
  echo "Let op: scraper/ bevat nog bestanden (waarschijnlijk node_modules). Die mag je weggooien."
fi

# 3. Klaarzetten
git add -A
echo
echo "Klaar. Dit staat nu klaar om te committen:"
git status --short | cut -c1-2 | sort | uniq -c | sed 's/^/  /'
echo
echo 'Volgende stap:  git commit -m "Herindeling: kern/, gemeenten/ en data per gemeente" && git push'
