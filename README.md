# NativeTalk Platform

A multi-tenant Cloud PBX and Contact Center platform built on FreeSWITCH.
Replaces licensed third-party platforms (iCallify, PortSIP) with a fully
owned, self-hosted stack.

## What it does

- **Cloud PBX** — SIP extensions, trunks, IVR menus, ring groups, call routing, business hours, voicemail
- **Contact Center** — Inbound queues, outbound campaigns, progressive dialer, blended campaigns
- **Supervisor Tools** — Live call monitoring, listen/whisper/barge, real-time agent dashboard
- **Analytics** — CDR-driven reporting: contact rates, AHT, occupancy, queue metrics
- **Multi-tenant** — Full tenant isolation; one deployment serves multiple companies

## Repository structure

```
nativetalk-callcenter/
├── apps/
│   ├── api/          NestJS 11 backend — REST API + WebSocket gateway
│   └── web/          Next.js 15 frontend — agent/supervisor/admin UI
├── packages/
│   └── types/        Shared TypeScript types (API contracts, realtime events)
├── docs/             Architecture, database, development, security docs
├── deploy/           Deployment scripts and operational runbooks
├── docker-compose.yml            Dev infrastructure (Postgres + Redis)
└── docker-compose.full.yml       Full stack for staging/integration testing
```

## Quick start

**Prerequisites:** Node 20+, Docker, a running FreeSWITCH instance with `mod_event_socket` enabled.

```bash
# 1. Start infrastructure
docker compose up -d

# 2. Install dependencies
npm install

# 3. Configure the API
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env — set DATABASE_URL, JWT_SECRET, FS_HOST, FS_PASSWORD

# 4. Run database migrations
npm run db:migrate

# 5. Seed initial data (super admin + default plans)
npm run db:seed

# 6. Start the API and web in development mode
npm run api:dev      # http://localhost:4000
npm run web:dev      # http://localhost:3001
```

## Tech stack

| Layer | Technology |
|---|---|
| Backend framework | NestJS 11 (TypeScript) |
| Frontend | Next.js 15 / React 19 (TypeScript) |
| Database | PostgreSQL 16 (Prisma ORM) |
| Cache / queues | Redis 7 |
| Real-time | Socket.io |
| Telephony engine | FreeSWITCH (via ESL) |
| Browser calling | sip.js (WebRTC) |
| Auth | JWT + RBAC |
| Containerisation | Docker / Docker Compose |

## Documentation

| Document | Description |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Full technical architecture — services, data flow, realtime, security |
| [docs/DATABASE.md](docs/DATABASE.md) | Database schema, entity relationships, design patterns |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Local setup, environment variables, common dev tasks |
| [docs/OPERATIONS-RUNBOOK.md](docs/OPERATIONS-RUNBOOK.md) | Production operations, troubleshooting |
| [docs/SECURITY-CHECKLIST.md](docs/SECURITY-CHECKLIST.md) | Security hardening checklist |
| [deploy/DEPLOY.md](deploy/DEPLOY.md) | Server deployment guide (Debian 12 / systemd) |

## User roles

| Role | Access |
|---|---|
| **Agent** | Dashboard, agent workspace, contacts, assigned campaigns, recordings, call history |
| **Supervisor** | Everything Agent + live calls, queues, campaigns, analytics |
| **Admin** | Everything Supervisor + Cloud PBX config, user management, security settings |
| **Super Admin** | Full platform access + tenant management, infrastructure monitoring |
