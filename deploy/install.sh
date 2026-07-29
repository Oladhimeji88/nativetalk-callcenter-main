#!/usr/bin/env bash
#
# NativeTalk installer for Debian 12. Run as root from the project source dir:
#   sudo bash deploy/install.sh
#
# Idempotent: re-running updates the app code and rebuilds, but preserves .env.
set -euo pipefail

APP_DIR=/opt/nativetalk
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(which node)"

echo "==> Installing NativeTalk into $APP_DIR (from $SRC_DIR)"

# Create system user if it doesn't exist
if ! id nativetalk >/dev/null 2>&1; then
  echo "==> Creating system user 'nativetalk'"
  useradd --system --shell /bin/false --home-dir "$APP_DIR" --create-home nativetalk
fi

mkdir -p "$APP_DIR"

# Copy source, preserving .env if it already exists
echo "==> Syncing source code"
rsync -a \
  --exclude node_modules \
  --exclude .git \
  --exclude '*/dist' \
  --exclude '*/.next' \
  --exclude 'apps/api/.env' \
  "$SRC_DIR"/ "$APP_DIR"/

echo "==> Installing dependencies"
cd "$APP_DIR"
npm ci --omit=dev

echo "==> Building API"
npm run api:build

echo "==> Running database migrations"
npm run db:migrate:prod

# Create .env from template if first install
if [ ! -f "$APP_DIR/apps/api/.env" ]; then
  echo "==> Creating .env from template — YOU MUST EDIT IT before starting"
  cp "$APP_DIR/apps/api/.env.example" "$APP_DIR/apps/api/.env"
  echo "    --> Edit: $APP_DIR/apps/api/.env"
fi

echo "==> Setting ownership"
chown -R nativetalk:nativetalk "$APP_DIR"

echo "==> Installing systemd service"
cp "$APP_DIR/deploy/nativetalk.service" /etc/systemd/system/nativetalk.service
systemctl daemon-reload

cat <<EOF

Done. Next steps:
  1. Edit $APP_DIR/apps/api/.env    (DATABASE_URL, JWT_SECRET, FS_HOST, FS_PASSWORD)
  2. sudo systemctl enable --now nativetalk
  3. sudo systemctl status nativetalk          (confirm "active (running)")
  4. journalctl -u nativetalk -f               (tail logs)
  5. API available at http://<server-ip>:4000
EOF
