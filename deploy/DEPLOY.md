# NativeTalk — Deployment Guide (Debian 12)

## Architecture overview

```
Internet
    │
  nginx (TLS termination, reverse proxy)
    ├── :443/api → NativeTalk API  (port 4000, systemd)
    └── :443     → NativeTalk Web  (port 3001, systemd)

  PostgreSQL 16  (port 5432, local or managed)
  Redis 7        (port 6379, local)

  FreeSWITCH     (SEPARATE VM — never on the app server)
    └── ESL :8021 accessible from app server (private network only)
```

## Prerequisites on the server

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# PostgreSQL 16
apt-get install -y postgresql-16

# Redis 7
apt-get install -y redis-server

# nginx
apt-get install -y nginx

# rsync (used by installer)
apt-get install -y rsync
```

## 1. Copy the code to the server

From your local machine (or CI):

```bash
rsync -av --exclude node_modules --exclude .git --exclude '*/dist' --exclude '*/.next' \
  ./nativetalk-callcenter/ user@your-server:/tmp/nativetalk-callcenter/
```

Or clone directly on the server if the server has git access.

## 2. Run the installer

```bash
cd /tmp/nativetalk-callcenter
sudo bash deploy/install.sh
```

This:
- Creates the `nativetalk` system user
- Copies source to `/opt/nativetalk`
- Installs npm dependencies (production only)
- Builds the NestJS API (`dist/`)
- Runs database migrations
- Creates `/opt/nativetalk/apps/api/.env` from the template (first run only)
- Installs and reloads the systemd service

## 3. Configure the environment

```bash
sudo -e /opt/nativetalk/apps/api/.env
```

Minimum required values:

```env
DATABASE_URL="postgresql://nativetalk:<password>@localhost:5432/nativetalk"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="<generate with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\">"
JWT_EXPIRES_IN="8h"

FS_HOST=<your-freeswitch-server-ip>
FS_PORT=8021
FS_PASSWORD=<your-esl-password>
FS_WS_URL="wss://<your-freeswitch-domain>:7443"
FS_RECORDINGS_DIR="/var/lib/freeswitch/recordings"
FS_CONF_DIR="/path/to/freeswitch/conf"

WEB_ORIGIN="https://your-domain.com"
PORT=4000
```

## 4. Set up the database

```bash
# Create the database user and database
sudo -u postgres psql <<SQL
CREATE USER nativetalk WITH PASSWORD '<password>';
CREATE DATABASE nativetalk OWNER nativetalk;
SQL

# Migrations were run by the installer. Verify:
sudo -u nativetalk npx prisma migrate status --schema /opt/nativetalk/apps/api/prisma/schema.prisma
```

## 5. Seed initial data (first deploy only)

```bash
cd /opt/nativetalk
sudo -u nativetalk node apps/api/dist/prisma/seed.js
```

This creates the super admin account and default subscription plans.

## 6. Start the service

```bash
sudo systemctl enable --now nativetalk
sudo systemctl status nativetalk         # should show: active (running)
journalctl -u nativetalk -f              # tail live logs
```

The API is now running at `http://localhost:4000`.

## 7. Build and serve the web app

The web app can be served as a Next.js standalone server or as static files.
For production, run it as a second systemd service:

```bash
# Build (set the API URL at build time)
NEXT_PUBLIC_API_URL="https://your-domain.com/api" \
  npm --workspace @nativetalk/web run build
```

Copy `apps/web/.next/standalone` to the server and run with a `nativetalk-web.service`
mirroring the API service, pointing `ExecStart` at `node server.js`.

## 8. nginx reverse proxy

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # Web app
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }

    # API (REST + WebSocket)
    location /api/ {
        rewrite ^/api/(.*) /$1 break;
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Socket.io (realtime dashboard)
    location /socket.io/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
    }
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}
```

## Updating the application

```bash
# Sync new code from local
rsync -av --exclude node_modules --exclude .git --exclude '*/dist' --exclude '*/.next' \
  ./nativetalk-callcenter/ user@your-server:/tmp/nativetalk-callcenter/

# On the server — re-run installer (idempotent, preserves .env)
cd /tmp/nativetalk-callcenter
sudo bash deploy/install.sh
sudo systemctl restart nativetalk
```

## Common commands

```bash
sudo systemctl status nativetalk              # Service status
sudo systemctl restart nativetalk             # Restart after config change
journalctl -u nativetalk -f                   # Live logs
journalctl -u nativetalk --since "1h ago"     # Last hour of logs

# Database
sudo -u postgres psql -d nativetalk           # Postgres shell
redis-cli ping                                 # Redis health check

# Check FreeSWITCH ESL connectivity
telnet <FS_HOST> 8021
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `freeswitch: disconnected` in health | ESL not reachable | Check FS_HOST/PORT/PASSWORD; verify firewall |
| `P1001: Can't reach database` | Postgres not running | `systemctl status postgresql` |
| 502 from nginx | App not running | `systemctl status nativetalk` |
| JWT errors on login | JWT_SECRET mismatch | Check .env; secret must be consistent across restarts |
| CORS errors in browser | WEB_ORIGIN mismatch | Set WEB_ORIGIN to exact browser URL, no trailing slash |
| `NEXT_PUBLIC_API_URL` showing localhost | Built with wrong env | Rebuild with correct env var set at build time |
