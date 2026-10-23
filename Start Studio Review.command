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
if [ ! -d node_modules/express ] || [ ! -d node_modules/pdfkit ]; then
  echo "Onderdelen installeren of bijwerken (npm install)…"
  if ! npm install --omit=dev --no-audit --no-fund; then
    echo "Installeren is mislukt. Voor deze eerste stap is internet nodig."
    wacht; exit 1
  fi
fi

node --disable-warning=ExperimentalWarning $ENVFILE scripts/launcher.js
code=$?
if [ "$code" -ne 0 ]; then wacht; fi
exit "$code"
