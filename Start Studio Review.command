#!/bin/bash
# Dubbelklik om Studio Review te starten. Laat het venster open zolang je de app gebruikt.
# Stoppen: Ctrl+C in dit venster, het venster sluiten, of "Stop Studio Review.command".
cd "$(dirname "$0")" || exit 1
# Homebrew-mappen toevoegen: bij dubbelklikken staan die vaak niet in PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
ENVFILE=""; [ -f .env ] && ENVFILE="--env-file=.env"

wacht() { echo; read -r -p "Druk op Enter om dit venster te sluiten…" _; }

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is niet gevonden."
  echo "Installeer het eenmalig met Homebrew:  brew install node"
  echo "(of via https://nodejs.org, versie 22.13 of nieuwer)"
  wacht; exit 1
fi
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'; then
  echo "Node.js $(node -v) is te oud; versie 22.13 of nieuwer is nodig."
  echo "Werk bij met:  brew upgrade node"
  wacht; exit 1
fi
# Een nieuwe programmamap (ZIP) heeft nog geen onderdelen. npm haalt ze eerst uit de npm-cache op
# deze Mac (eerder gedownload) en downloadt alleen wat daar ontbreekt; dan is internet nodig.
if [ ! -d node_modules/express ] || [ ! -d node_modules/pdfkit ]; then
  echo "Onderdelen installeren (npm install)…"
  echo "Eerder gedownloade onderdelen komen uit de npm-cache; ontbreekt er iets, dan is internet nodig."
  echo "Zonder internet kan deze stap ruim een minuut duren voordat hij opgeeft."
  if ! npm install --omit=dev --no-audit --no-fund --prefer-offline; then
    echo
    echo "Installeren is mislukt: de onderdelen konden niet worden gedownload en staan niet in de npm-cache."
    echo "- Met internet: sluit dit venster en dubbelklik opnieuw op Start Studio Review.command."
    echo "- Zonder internet: kopieer de map node_modules uit je vorige programmamap naar deze map en start"
    echo "  opnieuw. Dat werkt alleen als beide versies dezelfde onderdelen gebruiken; zie UPDATEN.md."
    echo "Je gegevens zijn niet aangeraakt."
    wacht; exit 1
  fi
fi

node --disable-warning=ExperimentalWarning $ENVFILE scripts/launcher.js
code=$?
if [ "$code" -ne 0 ]; then wacht; fi
exit "$code"
