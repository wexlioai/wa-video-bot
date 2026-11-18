#!/usr/bin/env bash
# =====================================================================================
#  WhatsApp → video → YouTube bot: one-file installer for Oracle Cloud (Ubuntu 22.04/24.04)
#
#  Upload this file to the server and run:
#      bash setup-oracle.sh
#
#  It installs everything, then asks you only for your credentials (and explains where
#  to get each one). Safe to re-run: it updates the code and keeps your settings.
# =====================================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/wa-video-bot}"
B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; D=$'\e[2m'; N=$'\e[0m'
say()  { echo -e "\n${B}==> $*${N}"; }
ok()   { echo -e "${G}  ✔ $*${N}"; }
warn() { echo -e "${Y}  ! $*${N}"; }
die()  { echo -e "${R}  ✖ $*${N}"; exit 1; }

[[ $EUID -eq 0 ]] && die "Run as your normal user (e.g. ubuntu), not root. The script uses sudo when needed."
command -v sudo >/dev/null || die "sudo is required."
. /etc/os-release
[[ "${ID:-}" == "ubuntu" || "${ID_LIKE:-}" == *debian* ]] || die "This installer supports Ubuntu. Your image is '${PRETTY_NAME:-unknown}'. Create the OCI instance with an Ubuntu 22.04/24.04 image."

echo -e "${B}WhatsApp → video → YouTube bot installer${N}"
echo -e "${D}Install folder: $APP_DIR   CPU: $(uname -m), $(nproc) cores, $(free -g | awk '/Mem:/{print $2}') GB RAM${N}"
sudo -v

# ------------------------------------------------------------------ 1. project files
say "1/6 Unpacking the bot into $APP_DIR"
mkdir -p "$APP_DIR"
PAYLOAD_LINE=$(awk '/^__PAYLOAD_BELOW__$/{print NR + 1; exit 0;}' "$0")
tail -n +"$PAYLOAD_LINE" "$0" | base64 -d | tar -xz -C "$APP_DIR" --strip-components=1
ok "Code unpacked (your .env and data/ are kept)"

# ------------------------------------------------------------------ 2. system packages
say "2/6 Installing system packages (ffmpeg, pdf/docx tools, fonts, browser libraries)"
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y -qq ca-certificates curl git ffmpeg poppler-utils pandoc fonts-noto-core python3-venv python3-pip \
  libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libgbm1 libxrandr2 libxkbcommon0 libxfixes3 \
  libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 libcups2 iptables-persistent >/dev/null
sudo apt-get install -y -qq libasound2t64 >/dev/null 2>&1 || sudo apt-get install -y -qq libasound2 >/dev/null
sudo apt-get install -y -qq libreoffice-writer-nogui >/dev/null 2>&1 || warn "LibreOffice not installed (only needed for old .doc files)"
ok "System packages ready"

# ------------------------------------------------------------------ 3. Node, Docker, Claude Code
say "3/6 Installing Node.js 22, Docker and Claude Code"
if ! command -v node >/dev/null || [[ "$(node -v)" != v2[2-9]* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
  sudo apt-get install -y -qq nodejs >/dev/null
fi
ok "Node $(node -v)"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh >/dev/null
fi
sudo usermod -aG docker "$USER" || true
sudo systemctl enable --now docker >/dev/null
ok "Docker $(docker --version | awk '{print $3}' | tr -d ,)"
if ! command -v claude >/dev/null && [[ ! -x "$HOME/.local/bin/claude" ]]; then
  curl -fsSL https://claude.ai/install.sh | bash >/dev/null
fi
export PATH="$HOME/.local/bin:$PATH"
grep -q '.local/bin' "$HOME/.bashrc" || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
ok "Claude Code $(claude --version 2>/dev/null | head -1)"

# ------------------------------------------------------------------ 4. npm packages + browsers
say "4/6 Installing the bot's packages and headless browsers (takes a few minutes)"
(cd "$APP_DIR/orchestrator" && npm install --no-audit --no-fund --loglevel=error && npx --yes playwright install chromium >/dev/null)
(cd "$APP_DIR/video" && npm install --no-audit --no-fund --loglevel=error && npx --yes remotion browser ensure >/dev/null)
# free Microsoft neural voices (edge-tts) in a private Python environment
[[ -x "$APP_DIR/.venv/bin/python" ]] || python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/python" -m pip install -q --upgrade pip edge-tts
ok "Packages, browsers and free voices (edge-tts) installed"

# Let the Evolution container (Docker network) reach the bot on port 3000, nothing else.
sudo iptables -C INPUT -s 172.16.0.0/12 -p tcp --dport 3000 -j ACCEPT 2>/dev/null || \
  sudo iptables -I INPUT -s 172.16.0.0/12 -p tcp --dport 3000 -j ACCEPT
sudo netfilter-persistent save >/dev/null 2>&1 || true
ok "Firewall: Docker → bot allowed (port 3000 stays closed to the internet)"

# ------------------------------------------------------------------ 5. interactive wizard
say "5/6 Your settings and credentials"
cd "$APP_DIR/orchestrator"
if docker info >/dev/null 2>&1; then
  node scripts/wizard.js
else
  # this shell doesn't have the new docker group yet; run the wizard with it
  sg docker -c "node scripts/wizard.js"
fi

# ------------------------------------------------------------------ 6. run as a service
say "6/6 Starting the bot as a service (starts on boot, restarts if it crashes)"
sudo tee /etc/systemd/system/wa-video-bot.service >/dev/null <<EOF
[Unit]
Description=WhatsApp script-to-video bot
After=network-online.target docker.service
Wants=docker.service

[Service]
User=$USER
WorkingDirectory=$APP_DIR/orchestrator
ExecStart=$(command -v node) src/server.js
Restart=always
RestartSec=5
Environment=PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=HOME=$HOME

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable wa-video-bot >/dev/null 2>&1
sudo systemctl restart wa-video-bot
node scripts/wizard.js --test || warn "Self-test failed. See logs: journalctl -u wa-video-bot -n 50"

echo -e "\n${G}${B}All done!${N}
  • Send a script on WhatsApp to start. Send ${B}help${N} for commands.
  • Logs:            journalctl -u wa-video-bot -f
  • Change settings: cd $APP_DIR/orchestrator && node scripts/wizard.js && sudo systemctl restart wa-video-bot
  • Update the bot:  run this installer again"
exit 0
__PAYLOAD_BELOW__
