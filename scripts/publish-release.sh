#!/bin/bash
# publish-release.sh — publiserer en signert versjon av Luna 3D til lunaeco.no.
#
# Forutsetninger:
#   - Privat signing-nøkkel ligger på ~/.tauri/luna3d-updater.key (tom passord)
#   - scripts/.env satt opp (kopier fra scripts/.env.example)
#   - Versjonen er bumpet: npm run bump -- patch|minor|major
#
# Bruk (Git Bash):
#   ./scripts/publish-release.sh "Kort beskrivelse av endringen"
#
# Scriptet:
#   1. Leser versjon fra package.json
#   2. Bygger signert installer (hvis ikke allerede gjort)
#   3. Laster opp installer + .sig og skriver latest.json
#   4. Verifiserer at manifestet er publisert
#
# Tauri lager «Luna 3D_X.Y.Z_x64-setup.exe» (mellomrom fra productName). På serveren
# heter den «Luna3D_X.Y.Z_x64-setup.exe» så URL-en blir ren — signaturen gjelder
# innholdet, ikke filnavnet.

set -euo pipefail

NOTES=${1:-"Ny versjon"}

REPO_ROOT=$(git rev-parse --show-toplevel)
BUNDLE_DIR="$REPO_ROOT/src-tauri/target/release/bundle/nsis"
KEY_FILE="$HOME/.tauri/luna3d-updater.key"
ENV_FILE="$REPO_ROOT/scripts/.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: Mangler $ENV_FILE"
    echo "Kopier scripts/.env.example til scripts/.env og fyll inn verdiene."
    exit 1
fi

# shellcheck disable=SC1090
. "$ENV_FILE"

: "${SERVER:?SERVER ikke satt i scripts/.env}"
: "${REMOTE_DIR:?REMOTE_DIR ikke satt i scripts/.env}"
: "${PUBLIC_BASE:?PUBLIC_BASE ikke satt i scripts/.env}"

VERSION=$(node -p "require('$REPO_ROOT/package.json').version")
LOCAL_EXE="$BUNDLE_DIR/Luna 3D_${VERSION}_x64-setup.exe"
LOCAL_SIG="$LOCAL_EXE.sig"
EXE_NAME="Luna3D_${VERSION}_x64-setup.exe"

if [ ! -f "$KEY_FILE" ]; then
    echo "ERROR: Finner ikke privat signing-nøkkel: $KEY_FILE"
    exit 1
fi

if [ ! -f "$LOCAL_EXE" ] || [ ! -f "$LOCAL_SIG" ]; then
    echo "-> Bygger signert versjon $VERSION..."
    cd "$REPO_ROOT"
    TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_FILE")" \
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
    npm run tauri build -- --bundles nsis
fi

if [ ! -f "$LOCAL_EXE" ] || [ ! -f "$LOCAL_SIG" ]; then
    echo "ERROR: Bygg fullført, men finner ikke installer eller .sig:"
    echo "  $LOCAL_EXE"
    echo "  $LOCAL_SIG"
    exit 1
fi

SIGNATURE=$(cat "$LOCAL_SIG")
PUB_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
NOTES_JSON=$(node -p "JSON.stringify(process.argv[1])" "$NOTES")

echo ""
echo "-> Versjon: $VERSION"
echo "-> Notes: $NOTES"
echo "-> Installer: $(du -h "$LOCAL_EXE" | cut -f1)"
echo ""
echo "-> Laster opp..."

# releases/ eies av app-brukeren lunachat; deploy-brukeren har ikke skrivetilgang.
# Last opp til staging, flytt på plass som lunachat via sudo.
STAGING="/tmp/luna3d-release-$VERSION"
TMP_JSON=$(mktemp)
ssh "$SERVER" "mkdir -p $STAGING"
scp "$LOCAL_EXE" "$SERVER:$STAGING/$EXE_NAME"
scp "$LOCAL_SIG" "$SERVER:$STAGING/$EXE_NAME.sig"

cat > "$TMP_JSON" <<JSON
{
  "version": "$VERSION",
  "notes": $NOTES_JSON,
  "pub_date": "$PUB_DATE",
  "platforms": {
    "windows-x86_64": {
      "signature": "$SIGNATURE",
      "url": "$PUBLIC_BASE/$EXE_NAME"
    }
  }
}
JSON

scp "$TMP_JSON" "$SERVER:$STAGING/latest.json"
rm -f "$TMP_JSON"

ssh "$SERVER" "sudo mkdir -p $REMOTE_DIR && sudo chown lunachat:lunachat $REMOTE_DIR \
    && sudo install -o lunachat -g lunachat -m 644 \
       $STAGING/$EXE_NAME $STAGING/$EXE_NAME.sig $STAGING/latest.json $REMOTE_DIR/ \
    && rm -rf $STAGING"

echo ""
echo "-> Verifiserer..."

VERIFY_VERSION=$(curl -fsS "$PUBLIC_BASE/latest.json?nc=$RANDOM" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).version))")

if [ "$VERIFY_VERSION" = "$VERSION" ]; then
    echo "OK: Luna 3D $VERSION er publisert."
    echo "    $PUBLIC_BASE/latest.json"
    echo "    $PUBLIC_BASE/$EXE_NAME"
    echo ""
    echo "Installerte Luna 3D-er ser oppdateringen ved oppstart eller innen en halvtime (linje under tittellinja)."
else
    echo "WARN: latest.json viser '$VERIFY_VERSION', forventet '$VERSION'."
    echo "Sjekk: curl $PUBLIC_BASE/latest.json"
    exit 1
fi
