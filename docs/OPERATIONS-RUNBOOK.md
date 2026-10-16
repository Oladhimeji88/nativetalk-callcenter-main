# Operations Runbook — UCP Platform

How to deploy, run, monitor, back up, and recover the platform. Pairs with
[SECURITY-CHECKLIST.md](SECURITY-CHECKLIST.md) and the plain-English
[BUILD-LOG-PLAIN-ENGLISH.md](BUILD-LOG-PLAIN-ENGLISH.md).

## Architecture (Decision 5)
Four app pieces, each its own container, **plus FreeSWITCH on its own host**:

```
web (Next.js :3001) → api (NestJS :4000) → PostgreSQL + Redis
                                  └── ESL/WSS → FreeSWITCH (separate VM)
```

## Deploy

### Containers (recommended)
```bash
# 1. set secrets in an .env file next to docker-compose.full.yml
POSTGRES_PASSWORD=...        JWT_SECRET=<64+ random chars>
FS_HOST=<freeswitch-ip>      FS_PASSWORD=<esl-password>
WEB_ORIGIN=https://app.yourdomain.com
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
FS_WS_URL=wss://<freeswitch-host>:7443

# 2. build + run (api runs `prisma migrate deploy` automatically on start)
docker compose -f docker-compose.full.yml up -d --build
```

### Bare metal / dev
```bash
docker compose up -d                 # postgres + redis
npm --workspace @ucp/api run build && (cd apps/api && npx prisma migrate deploy && node dist/src/main.js)
npm --workspace @ucp/web run build && npm --workspace @ucp/web run start
```

## Required environment (API)
| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | PostgreSQL connection |
| `REDIS_URL` | Redis connection |
| `JWT_SECRET` | **must** be strong in prod (boot fails on `dev-secret`) |
| `WEB_ORIGIN` | allowed CORS origin(s), comma-separated |
| `FS_HOST` / `FS_PORT` / `FS_PASSWORD` | FreeSWITCH ESL |
| `FS_WS_URL` | browser softphone signaling (`wss://host:7443` in prod) |
| `FS_CONF_DIR` / `FS_RECORDINGS_DIR` | PBX provisioning + recordings (on the FS host) |
| `PAYMENT_PROVIDER` + `PAYSTACK_SECRET_KEY` / `FLUTTERWAVE_SECRET_KEY` | online payments (optional) |

## Monitoring
- **Liveness:** `GET /health/live` (process up) — orchestrator restart probe.
- **Readiness:** `GET /health/ready` (DB reachable) — load-balancer gate.
- **Full health:** `GET /health` (DB, Redis, FreeSWITCH).
- **Metrics:** `GET /metrics` (Prometheus). Scrape with Prometheus; chart in Grafana.
  Restrict network access to this endpoint (it's unauthenticated by design).
- **Logs:** structured to stdout — ship with your platform's log driver.

## Backups & recovery
- Nightly: cron [`deploy/backup-db.sh`](backup-db.sh) → gzip pg_dump, 14-day retention.
- Restore: `gunzip -c ucp-<stamp>.sql.gz | psql "$DATABASE_URL"`.
- Recordings live on the FreeSWITCH host's recordings dir — back that up too (or
  move to object storage; the recordings reader is a single swap-point).

## Scaling
- **API** is stateless → run N replicas behind a load balancer. Real-time uses
  Redis, so sessions/state aren't pinned to one instance.
- **DB/Redis** → managed/dedicated instances as load grows.
- **FreeSWITCH** → scale vertically first; add nodes with a SIP load balancer later.

## Common incidents
| Symptom | Check |
|---------|-------|
| Calls fail `USER_NOT_REGISTERED` | the destination softphone isn't registered |
| `GET /health` shows freeswitch:false | ESL host/port/password; FreeSWITCH up? |
| Login returns 429 | brute-force throttle (8/min/IP) — expected under attack |
| PBX changes don't apply | `FS_CONF_DIR` writable? check api logs for "conf not writable" |
| Queue/agent calls don't route | `mod_callcenter` loaded? (api auto-loads on connect) |

## Go-live checklist (depends on YOUR items)
- [ ] Carrier SIP trunk with **outbound enabled** + DIDs
- [ ] Domain + **TLS** (HTTPS for web, WSS for softphone)
- [ ] Strong `JWT_SECRET`, DB password, FreeSWITCH ESL password
- [ ] Extension passwords rotated off defaults; SIP ports firewalled / fail2ban
- [ ] Object storage for recordings (optional, at volume)
- [ ] Payment provider keys (if billing customers)
- [ ] Independent security review / pen-test
- [ ] Backups scheduled + a test restore performed
