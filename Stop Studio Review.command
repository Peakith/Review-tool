#!/bin/bash
# Dubbelklik om de Studio Review van deze map te stoppen. Je gegevens blijven bewaard.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
ENVFILE=""; [ -f .env ] && ENVFILE="--env-file=.env"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is niet gevonden. Sluit het startvenster (Terminal) om de app te stoppen."
else
  node --disable-warning=ExperimentalWarning $ENVFILE scripts/stop.js
fi
echo
read -r -p "Druk op Enter om dit venster te sluiten…" _
