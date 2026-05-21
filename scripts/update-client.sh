#!/bin/bash
# update-client.sh — Sicheres Update für den Salon-Mac (Oliver Roos Friseur)
#
# Verwendung (vom Salon-Mac aus, oder via SSH-Pipe):
#   ssh Oli@<ip> 'bash -s' < update-client.sh
# oder lokal:
#   bash update-client.sh
#
# Was es macht:
#   1. Findet die salon.db (auch wenn der User umbenannt wurde)
#   2. Migriert sie ggf. ins aktuelle Home-Verzeichnis
#   3. Backup mit Zeitstempel
#   4. Lädt das richtige DMG (arm64 oder x64) von GitHub
#   5. Beendet die laufende App
#   6. Ersetzt /Applications/Oliver Roos Friseur.app
#   7. Entfernt Quarantine (für unsignierte App)
#   8. Startet die App und prüft Migration 0032

set -euo pipefail

APP_NAME="Oliver Roos Friseur"
APP_PATH="/Applications/${APP_NAME}.app"
APP_DATA_DIR_NAME="Oliver Roos Friseur"   # Electron productName → userData-Folder
GH_LATEST_API="https://api.github.com/repos/963s/Oliver/releases/latest"
TMP_DIR="$(mktemp -d)"
trap "rm -rf ${TMP_DIR}" EXIT

log()  { echo "▶ $*"; }
ok()   { echo "✅ $*"; }
warn() { echo "⚠ $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

echo "════════════════════════════════════════════════════════"
echo "  Oliver Roos Friseur — Update zu v1.1.0"
echo "════════════════════════════════════════════════════════"
echo "  Aktueller User: $(whoami)"
echo "  Home:           ${HOME}"
echo "  macOS:          $(sw_vers -productVersion 2>/dev/null || uname -r)"
echo "  Architektur:    $(uname -m)"
echo ""

# ── 1. Architektur erkennen ─────────────────────────────────────────────
ARCH="$(uname -m)"
if [[ "${ARCH}" == "arm64" ]]; then
  DMG_PATTERN="arm64\.dmg"
  log "Apple Silicon (arm64) erkannt"
else
  DMG_PATTERN="[0-9]\.dmg"
  log "Intel (x64) erkannt"
fi

# ── 2. salon.db finden (defensiv) ───────────────────────────────────────
log "Suche bestehende Datenbank ..."

CURRENT_DATA="${HOME}/Library/Application Support/${APP_DATA_DIR_NAME}"
CANDIDATES=("${CURRENT_DATA}/salon.db")

# Andere Home-Verzeichnisse durchsuchen (User wurde evtl. umbenannt)
for d in /Users/*/Library/Application\ Support/"${APP_DATA_DIR_NAME}"/salon.db; do
  [[ -f "${d}" ]] && CANDIDATES+=("${d}")
done

# Duplikate entfernen, nur existierende behalten
EXISTING_DBS=()
for c in "${CANDIDATES[@]}"; do
  if [[ -f "${c}" ]]; then
    # Skip wenn bereits in EXISTING_DBS
    skip=0
    for e in "${EXISTING_DBS[@]:-}"; do
      [[ "${e}" == "${c}" ]] && skip=1
    done
    [[ "${skip}" == "0" ]] && EXISTING_DBS+=("${c}")
  fi
done

if [[ ${#EXISTING_DBS[@]} -eq 0 ]]; then
  warn "Keine bestehende salon.db gefunden — wird als Erstinstallation behandelt"
  ACTIVE_DB=""
elif [[ ${#EXISTING_DBS[@]} -eq 1 ]]; then
  ACTIVE_DB="${EXISTING_DBS[0]}"
  log "Gefunden: ${ACTIVE_DB} ($(du -h "${ACTIVE_DB}" | cut -f1))"
else
  # Mehrere Treffer: nimm die neueste/größte
  log "Mehrere Datenbanken gefunden:"
  NEWEST=""
  NEWEST_TIME=0
  for db in "${EXISTING_DBS[@]}"; do
    SIZE="$(du -h "${db}" | cut -f1)"
    MTIME="$(stat -f %m "${db}")"
    log "  ${db}  (${SIZE}, mtime=${MTIME})"
    if [[ "${MTIME}" -gt "${NEWEST_TIME}" ]]; then
      NEWEST_TIME="${MTIME}"
      NEWEST="${db}"
    fi
  done
  ACTIVE_DB="${NEWEST}"
  ok "Nehme neueste: ${ACTIVE_DB}"
fi

# ── 3. Backup ───────────────────────────────────────────────────────────
BACKUP_FILE=""
if [[ -n "${ACTIVE_DB}" ]]; then
  BACKUP_DIR="${HOME}/oliver-roos-backups"
  mkdir -p "${BACKUP_DIR}"
  STAMP="$(date +%Y%m%d-%H%M%S)"
  BACKUP_FILE="${BACKUP_DIR}/salon-${STAMP}.db"
  cp "${ACTIVE_DB}" "${BACKUP_FILE}"
  [[ -f "${ACTIVE_DB}-wal" ]] && cp "${ACTIVE_DB}-wal" "${BACKUP_FILE}-wal"
  [[ -f "${ACTIVE_DB}-shm" ]] && cp "${ACTIVE_DB}-shm" "${BACKUP_FILE}-shm"
  ok "Backup: ${BACKUP_FILE} ($(du -h "${BACKUP_FILE}" | cut -f1))"
fi

# ── 4. DB ins aktuelle Home migrieren (falls in anderem Home liegt) ─────
if [[ -n "${ACTIVE_DB}" && "${ACTIVE_DB}" != "${CURRENT_DATA}/salon.db" ]]; then
  warn "DB liegt nicht im aktuellen Home (${HOME})"
  warn "Quelle: ${ACTIVE_DB}"
  warn "Ziel:   ${CURRENT_DATA}/salon.db"
  log "Migriere ins neue Home ..."
  mkdir -p "${CURRENT_DATA}"
  cp "${ACTIVE_DB}"      "${CURRENT_DATA}/salon.db"
  [[ -f "${ACTIVE_DB}-wal" ]] && cp "${ACTIVE_DB}-wal" "${CURRENT_DATA}/salon.db-wal"
  [[ -f "${ACTIVE_DB}-shm" ]] && cp "${ACTIVE_DB}-shm" "${CURRENT_DATA}/salon.db-shm"
  # Auch das AUTH_SECRET übernehmen wenn vorhanden
  OLD_SECRET="$(dirname "${ACTIVE_DB}")/.auth_secret"
  [[ -f "${OLD_SECRET}" ]] && cp "${OLD_SECRET}" "${CURRENT_DATA}/.auth_secret"
  ok "DB migriert. Alte Datei bleibt zur Sicherheit unter ${ACTIVE_DB}"
fi

# ── 5. DMG-URL ermitteln und herunterladen ──────────────────────────────
log "Frage GitHub nach aktuellem Release ..."
RELEASE_JSON="$(curl -fsSL "${GH_LATEST_API}")"
LATEST_VERSION="$(echo "${RELEASE_JSON}" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"v?([^"]+)".*/\1/')"

# Wähle das passende DMG: arm64 oder x64 (welches nicht arm64 ist)
if [[ "${ARCH}" == "arm64" ]]; then
  DMG_URL="$(echo "${RELEASE_JSON}" \
    | grep -oE '"browser_download_url": *"[^"]*arm64\.dmg"' \
    | head -n1 \
    | sed -E 's/.*"browser_download_url": *"([^"]+)".*/\1/')"
else
  # x64: das DMG ohne "arm64" im Namen
  DMG_URL="$(echo "${RELEASE_JSON}" \
    | grep -oE '"browser_download_url": *"[^"]*\.dmg"' \
    | grep -v 'arm64' \
    | grep -v 'blockmap' \
    | head -n1 \
    | sed -E 's/.*"browser_download_url": *"([^"]+)".*/\1/')"
fi

[[ -n "${LATEST_VERSION}" ]] || fail "Konnte Versionsnummer nicht ermitteln"
[[ -n "${DMG_URL}" ]]        || fail "Konnte DMG-URL nicht ermitteln"

log "Lade v${LATEST_VERSION}:"
log "  ${DMG_URL}"

DMG_FILE="${TMP_DIR}/oliver-roos-${LATEST_VERSION}.dmg"
curl -fL --progress-bar -o "${DMG_FILE}" "${DMG_URL}"
ok "DMG heruntergeladen ($(du -h "${DMG_FILE}" | cut -f1))"

# ── 6. App beenden ──────────────────────────────────────────────────────
log "Beende laufende App ..."
osascript -e "tell application \"${APP_NAME}\" to quit" 2>/dev/null || true
sleep 2
pkill -f "${APP_NAME}" 2>/dev/null || true
sleep 1
ok "App beendet"

# ── 7. DMG mounten, App kopieren, ejecten ──────────────────────────────
log "Montiere DMG ..."
MOUNT_OUTPUT="$(hdiutil attach "${DMG_FILE}" -nobrowse -quiet)"
MOUNT_POINT="$(echo "${MOUNT_OUTPUT}" | grep '/Volumes/' | awk -F '\t' '{print $NF}' | head -n1)"
[[ -d "${MOUNT_POINT}" ]] || fail "Konnte DMG nicht mounten"
log "Gemountet auf: ${MOUNT_POINT}"

SRC_APP="${MOUNT_POINT}/${APP_NAME}.app"
[[ -d "${SRC_APP}" ]] || { hdiutil detach "${MOUNT_POINT}" -quiet; fail "App nicht im DMG gefunden"; }

# Alte App entfernen, neue kopieren
if [[ -d "${APP_PATH}" ]]; then
  log "Entferne alte App ..."
  rm -rf "${APP_PATH}"
fi
log "Kopiere neue App nach ${APP_PATH} ..."
cp -R "${SRC_APP}" "${APP_PATH}"

hdiutil detach "${MOUNT_POINT}" -quiet
ok "Neue App installiert"

# ── 8. Quarantine entfernen (unsignierte App) ───────────────────────────
log "Entferne Quarantine-Attribut ..."
xattr -dr com.apple.quarantine "${APP_PATH}" 2>/dev/null || true
ok "Quarantine entfernt"

# ── 9. App starten ──────────────────────────────────────────────────────
log "Starte App ..."
open "${APP_PATH}"
sleep 6

# ── 10. Verifizieren ────────────────────────────────────────────────────
if pgrep -f "${APP_NAME}" > /dev/null; then
  ok "App läuft. Version: ${LATEST_VERSION}"
else
  warn "App startet nicht automatisch — bitte manuell prüfen"
fi

# Prüfe Migration 0032 (neue Spalten)
sleep 3
LIVE_DB="${CURRENT_DATA}/salon.db"
if command -v sqlite3 > /dev/null && [[ -f "${LIVE_DB}" ]]; then
  COLS="$(sqlite3 "${LIVE_DB}" "PRAGMA table_info(clients);" 2>/dev/null | grep -cE 'street|postal_code|city' || true)"
  if [[ "${COLS}" -ge 3 ]]; then
    ok "Migration 0032 erfolgreich (Adressfelder + usage_type)"
  else
    warn "Migration 0032 noch nicht erkannt — App-Start dauert evtl. länger"
  fi
fi

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Update abgeschlossen: v${LATEST_VERSION}"
echo "  Backup: ${BACKUP_FILE:-keine alte DB}"
echo "  Live-DB: ${LIVE_DB}"
echo "════════════════════════════════════════════════════════"
