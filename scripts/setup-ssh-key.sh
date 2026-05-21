#!/bin/bash
# setup-ssh-key.sh — Einmaliges Setup: Public Key auf den Salon-Mac installieren.
# Danach läuft jedes Update ohne Passwort-Eingabe.
#
# Verwendung (einmalig, vom Dev-Mac aus):
#   bash scripts/setup-ssh-key.sh

set -euo pipefail

KEY_PATH="${HOME}/.ssh/oliver-roos-deploy"
PUB_KEY="${KEY_PATH}.pub"
CLIENT_USER="${OLIVER_CLIENT_USER:-Oli}"
CLIENT_HOST="${OLIVER_CLIENT_HOST:-100.109.12.48}"
SSH_CONFIG="${HOME}/.ssh/config"
ALIAS="oliver-client"

if [[ ! -f "${PUB_KEY}" ]]; then
  echo "❌ Public key fehlt: ${PUB_KEY}"
  echo "   Erst mit ssh-keygen erzeugen, dann dieses Script erneut starten."
  exit 1
fi

echo "════════════════════════════════════════════════════════"
echo "  SSH-Key Setup für Salon-Mac"
echo "════════════════════════════════════════════════════════"
echo "  User:    ${CLIENT_USER}"
echo "  Host:    ${CLIENT_HOST}"
echo "  Alias:   ${ALIAS} (im ~/.ssh/config)"
echo ""

# 1. Public Key auf den Client kopieren (verlangt EINMALIG das Passwort)
echo "▶ Public Key auf den Salon-Mac installieren ..."
echo "  (Passwort wird EINMAL abgefragt; danach nie wieder)"
PUB_CONTENT="$(cat "${PUB_KEY}")"
ssh -o StrictHostKeyChecking=accept-new "${CLIENT_USER}@${CLIENT_HOST}" \
  "mkdir -p ~/.ssh && chmod 700 ~/.ssh && \
   grep -qxF '${PUB_CONTENT}' ~/.ssh/authorized_keys 2>/dev/null || \
   echo '${PUB_CONTENT}' >> ~/.ssh/authorized_keys && \
   chmod 600 ~/.ssh/authorized_keys"
echo "✅ Public Key installiert"

# 2. SSH-Config-Alias setzen
mkdir -p "${HOME}/.ssh"
touch "${SSH_CONFIG}"
chmod 600 "${SSH_CONFIG}"

if grep -q "^Host ${ALIAS}\$" "${SSH_CONFIG}" 2>/dev/null; then
  echo "▶ SSH-Alias '${ALIAS}' bereits vorhanden — übersprungen"
else
  cat >> "${SSH_CONFIG}" <<EOF

# Oliver Roos Friseur — Salon-Mac
Host ${ALIAS}
    HostName ${CLIENT_HOST}
    User ${CLIENT_USER}
    IdentityFile ${KEY_PATH}
    IdentitiesOnly yes
    StrictHostKeyChecking accept-new
EOF
  echo "✅ SSH-Alias '${ALIAS}' hinzugefügt zu ${SSH_CONFIG}"
fi

# 3. Verbindung testen
echo ""
echo "▶ Teste passwortlose Verbindung ..."
if ssh -o BatchMode=yes -o ConnectTimeout=10 "${ALIAS}" 'echo "OK von $(hostname)"' 2>/dev/null; then
  echo "✅ Verbindung funktioniert ohne Passwort"
  echo ""
  echo "════════════════════════════════════════════════════════"
  echo "  Setup abgeschlossen!"
  echo ""
  echo "  Ab sofort kannst du verwenden:"
  echo "    ssh ${ALIAS}                       # einloggen"
  echo "    npm run deploy:client              # build + push + install"
  echo "════════════════════════════════════════════════════════"
else
  echo "⚠ Verbindungstest fehlgeschlagen — bitte manuell prüfen:"
  echo "    ssh ${ALIAS}"
  exit 1
fi
