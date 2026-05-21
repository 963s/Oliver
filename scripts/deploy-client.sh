#!/bin/bash
# deploy-client.sh — Ein-Befehl-Deployment: build + publish + Salon-Mac aktualisieren.
#
# Voraussetzungen:
#   - SSH-Key-Setup einmalig durchgeführt (scripts/setup-ssh-key.sh)
#   - GH_TOKEN env var oder im git remote URL (für electron-builder publish)
#
# Verwendung:
#   bash scripts/deploy-client.sh
#   oder: npm run deploy:client

set -euo pipefail

ALIAS="${OLIVER_CLIENT_ALIAS:-oliver-client}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "════════════════════════════════════════════════════════"
echo "  Oliver Roos Friseur — Full Deploy"
echo "════════════════════════════════════════════════════════"
echo ""

# ── 1. Build & Publish (über electron:release) ──────────────────────────
echo "▶ Schritt 1/3: Build & Publish nach GitHub ..."
cd "${PROJECT_ROOT}"
npm run electron:release
echo "✅ Release publiziert"

# ── 2. Sicherstellen, dass das Release nicht als Draft hängen bleibt ───
echo ""
echo "▶ Schritt 2/3: Release auf 'published' setzen (falls als Draft erstellt) ..."
VERSION="$(node -p "require('./package.json').version")"
TOKEN="${GH_TOKEN:-$(git config --get remote.origin.url | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')}"

if [[ -z "${TOKEN}" ]]; then
  echo "⚠ Kein GH_TOKEN gefunden — Release evtl. als Draft. Bitte manuell publizieren."
else
  python3 - <<PYEOF
import json, subprocess, sys
TOKEN = "${TOKEN}"
VERSION = "${VERSION}"
r = subprocess.run(["curl", "-s", "-H", f"Authorization: token {TOKEN}",
                    "https://api.github.com/repos/963s/Oliver/releases"],
                   capture_output=True, text=True)
data = json.loads(r.stdout)
for rel in data:
    if rel.get("draft") and VERSION in (rel.get("name") or "") + (rel.get("tag_name") or ""):
        rid = rel["id"]
        payload = {"tag_name": f"v{VERSION}", "name": f"Oliver Roos Friseur {VERSION}",
                   "draft": False, "prerelease": False}
        out = subprocess.run(["curl", "-s", "-X", "PATCH",
                              "-H", f"Authorization: token {TOKEN}",
                              "-H", "Content-Type: application/json",
                              f"https://api.github.com/repos/963s/Oliver/releases/{rid}",
                              "-d", json.dumps(payload)],
                             capture_output=True, text=True)
        print(f"  → Published as v{VERSION}")
        sys.exit(0)
print("  → Kein Draft mit dieser Version gefunden (evtl. schon publiziert).")
PYEOF
fi

# ── 3. Salon-Mac aktualisieren ──────────────────────────────────────────
echo ""
echo "▶ Schritt 3/3: Salon-Mac aktualisieren (${ALIAS}) ..."
echo ""
ssh "${ALIAS}" 'bash -s' < "${SCRIPT_DIR}/update-client.sh"

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Deploy abgeschlossen — v${VERSION} ist live"
echo "════════════════════════════════════════════════════════"
