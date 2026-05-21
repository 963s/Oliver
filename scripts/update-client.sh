#!/bin/bash
# update-client.sh — Sicheres Update für den Salon-Mac (Oliver Roos Friseur)
# Verwendung (vom Salon-Mac aus, oder via SSH):
#   bash <(curl -fsSL https://raw.githubusercontent.com/963s/Oliver/main/scripts/update-client.sh)
# oder lokal:
#   bash update-client.sh
#
# Macht:
#   1. Backup von salon.db (mit Zeitstempel)
#   2. Lädt das richtige DMG (arm64 oder x64) von GitHub
#   3. Beendet die laufende App
#   4. Ersetzt /Applications/Oliver Roos Friseur.app
#   5. Entfernt Quarantine-Attribut (unsigned-App-Fix)
#   6. Startet die App
#   7. Prüft, dass sie sauber hochkommt

set -euo pipefail

APP_NAME="Oliver Roos Friseur"
APP_PATH="/Applications/${APP_NAME}.app"
USER_DATA="${HOME}/Library/Application Support/oliver-roos-friseur"
DB_FILE="${USER_DATA}/salon.db"
GH_LATEST_API="https://api.github.com/repos/963s/Oliver/releases/latest"
TMP_DIR="$(mktemp -d)"
trap "rm -rf ${TMP_DIR}" EXIT

log()  { echo "▶ $*"; }
ok()   { echo "✅ $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# ── 1. Architektur erkennen ─────────────────────────────────────────────
ARCH="$(uname -m)"
if [[ "${ARCH}" == "arm64" ]]; then
  DMG_PATTERN="arm64.dmg"
  log "Apple Silicon (arm64) erkannt"
else
  DMG_PATTERN="1.1.0.dmg"  # x64 build hat keine Architektur-Suffix
  log "Intel (x64) erkannt"
fi

# ── 2. Backup der Datenbank ─────────────────────────────────────────────
if [[ -f "${DB_FILE}" ]]; then
  BACKUP_DIR="${HOME}/oliver-roos-backups"
  mkdir -p "${BACKUP_DIR}"
  STAMP="$(date +%Y%m%d-%H%M%S)"
  BACKUP_FILE="${BACKUP_DIR}/salon-${STAMP}.db"
  cp "${DB_FILE}" "${BACKUP_FILE}"
  # WAL/SHM mitnehmen falls vorhanden
  [[ -f "${DB_FILE}-wal" ]] && cp "${DB_FILE}-wal" "${BACKUP_FILE}-wal"
  [[ -f "${DB_FILE}-shm" ]] && cp "${DB_FILE}-shm" "${BACKUP_FILE}-shm"
  ok "Backup: ${BACKUP_FILE} ($(du -h "${BACKUP_FILE}" | cut -f1))"
else
  log "Keine bestehende DB gefunden (${DB_FILE}) — neue Installation"
fi

# ── 3. DMG-URL ermitteln und herunterladen ──────────────────────────────
log "Frage GitHub nach aktuellem Release …"
RELEASE_JSON="$(curl -fsSL "${GH_LATEST_API}")"
LATEST_VERSION="$(echo "${RELEASE_JSON}" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"v?([^"]+)".*/\1/')"
DMG_URL="$(echo "${RELEASE_JSON}" \
  | grep -oE '"browser_download_url": *"[^"]*'"${DMG_PATTERN}"'"' \
  | head -n1 \
  | sed -E 's/.*"browser_download_url": *"([^"]+)".*/\1/')"

[[ -n "${LATEST_VERSION}" ]] || fail "Konnte Versionsnummer nicht ermitteln"
[[ -n "${DMG_URL}" ]]        || fail "Konnte DMG-URL nicht ermitteln (Pattern: ${DMG_PATTERN})"

log "Lade v${LATEST_VERSION} von:"
log "  ${DMG_URL}"

DMG_FILE="${TMP_DIR}/oliver-roos-${LATEST_VERSION}.dmg"
curl -fL --progress-bar -o "${DMG_FILE}" "${DMG_URL}"
ok "DMG heruntergeladen ($(du -h "${DMG_FILE}" | cut -f1))"

# ── 4. App beenden ──────────────────────────────────────────────────────
log "Beende laufende App …"
pkill -f "${APP_NAME}" || true
sleep 2
ok "App beendet"

# ── 5. DMG mounten, App kopieren, ejecten ──────────────────────────────
log "Montiere DMG …"
MOUNT_OUTPUT="$(hdiutil attach "${DMG_FILE}" -nobrowse -quiet)"
MOUNT_POINT="$(echo "${MOUNT_OUTPUT}" | grep '/Volumes/' | awk -F '\t' '{print $NF}')"
[[ -d "${MOUNT_POINT}" ]] || fail "Konnte DMG nicht mounten"
log "Gemountet auf: ${MOUNT_POINT}"

SRC_APP="${MOUNT_POINT}/${APP_NAME}.app"
[[ -d "${SRC_APP}" ]] || { hdiutil detach "${MOUNT_POINT}" -quiet; fail "App nicht im DMG gefunden"; }

# Alte App entfernen, neue kopieren
if [[ -d "${APP_PATH}" ]]; then
  log "Entferne alte App …"
  rm -rf "${APP_PATH}"
fi
log "Kopiere neue App nach ${APP_PATH} …"
cp -R "${SRC_APP}" "${APP_PATH}"

# DMG ejecten
hdiutil detach "${MOUNT_POINT}" -quiet
ok "Neue App installiert"

# ── 6. Quarantine entfernen (für unsignierte Apps) ──────────────────────
log "Entferne Quarantine-Attribut (für unsignierte App) …"
xattr -dr com.apple.quarantine "${APP_PATH}" || true
ok "Quarantine entfernt"

# ── 7. App starten ──────────────────────────────────────────────────────
log "Starte App …"
open "${APP_PATH}"
sleep 5

# ── 8. Verifizieren ─────────────────────────────────────────────────────
if pgrep -f "${APP_NAME}" > /dev/null; then
  ok "App läuft. Version: ${LATEST_VERSION}"
else
  fail "App startet nicht — bitte manuell prüfen"
fi

# Prüfe ob neue DB-Spalten da sind (Migration 0032)
sleep 3
if command -v sqlite3 > /dev/null && [[ -f "${DB_FILE}" ]]; then
  COLS="$(sqlite3 "${DB_FILE}" "PRAGMA table_info(clients);" 2>/dev/null | grep -c 'street\|postal_code\|city' || true)"
  if [[ "${COLS}" -ge 3 ]]; then
    ok "Migration 0032 erfolgreich (Adressfelder vorhanden)"
  else
    log "⚠ Migration 0032 noch nicht sichtbar — DB-Verbindung läuft evtl. noch hoch"
  fi
fi

echo ""
echo "════════════════════════════════════════"
echo "  Update abgeschlossen: v${LATEST_VERSION}"
echo "  Backup: ${BACKUP_FILE:-keine alte DB}"
echo "════════════════════════════════════════"
