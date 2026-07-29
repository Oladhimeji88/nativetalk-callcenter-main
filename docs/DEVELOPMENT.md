# NativeTalk Call Center — Development Guide

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | 20+ | Runtime for API and web |
| npm | 10+ | Package manager (ships with Node 20) |
| Docker Desktop | any recent | Runs Postgres + Redis locally |
| Git | any | Version control |
| FreeSWITCH | 1.10+ | Telephony engine (see below) |

**FreeSWITCH for local development:**  
You don't need a local FreeSWITCH installation to develop most features. The
API starts cleanly without a FreeSWITCH connection — it logs a warning and
the `/health` endpoint reports `freeswitch: disconnected`. Only telephony
features (call control, provisioning, live monitoring) require a live FS
connection. For those, point `FS_HOST` at a staging server over an SSH tunnel.

---

## First-time setup

### 1. Clone and install

```bash
git clone <repo-url> nativetalk-callcenter
cd nativetalk-callcenter
npm install
```

### 2. Start infrastructure

```bash
docker compose up -d
```

This starts:
- PostgreSQL 16 on `localhost:5432` (user: `nativetalk`, password: `nativetalk_dev`, db: `nativetalk`)
- Redis 7 on `localhost:6379`

### 3. Configure the API

```bash
cp apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env`. At minimum, set these:

```env
# Database (matches docker-compose defaults — change if you customised them)
DATABASE_URL="postgresql://nativetalk:nativetalk_dev@localhost:5432/nativetalk"

# Redis
REDIS_URL="redis://localhost:6379"

# JWT — generate with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_SECRET="your-generated-secret-here"
JWT_EXPIRES_IN="8h"

# FreeSWITCH — leave as-is if not using telephony locally
FS_HOST=127.0.0.1
FS_PORT=8021
FS_PASSWORD=ClueCon

# FreeSWITCH config dir (where XML provisioning is written)
FS_CONF_DIR="/etc/freeswitch/conf"

# Modules to auto-load on ESL connect
FS_REQUIRED_MODULES="mod_callcenter,mod_avmd"

# WebRTC — FreeSWITCH WebSocket URL for browser softphone
FS_WS_URL="wss://your-fs-server:7443"
FS_STUN_URL="stun:stun.l.google.com:19302"

# Where FreeSWITCH writes recording files
FS_RECORDINGS_DIR="/var/lib/freeswitch/recordings"

# CORS — URL of the web app
WEB_ORIGIN="http://localhost:3001"
```

### 4. Run database migrations

```bash
npm run db:migrate
```

This creates all tables and indexes. Safe to re-run — Prisma tracks which
migrations have already been applied.

### 5. Seed initial data

```bash
npm run db:seed
```

Creates:
- A default super admin account (check `apps/api/prisma/seed.ts` for credentials)
- Default subscription plans
- A demo tenant

### 6. Start development servers

In separate terminals (or use `npm run dev` with both together):

```bash
# Terminal 1 — API (hot-reload)
npm run api:dev
# → http://localhost:4000
# → WebSocket: ws://localhost:4000/realtime

# Terminal 2 — Web
npm run web:dev
# → http://localhost:3001
```

---

## Environment variables reference

### API (`apps/api/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `REDIS_URL` | Yes | — | Redis connection string |
| `JWT_SECRET` | Yes | — | Secret for signing JWTs. Must be set in production |
| `JWT_EXPIRES_IN` | No | `8h` | JWT expiry (e.g. `1h`, `8h`, `7d`) |
| `PORT` | No | `4000` | API listen port |
| `WEB_ORIGIN` | No | `http://localhost:3001` | CORS allowed origin |
| `FS_HOST` | No | `127.0.0.1` | FreeSWITCH ESL host |
| `FS_PORT` | No | `8021` | FreeSWITCH ESL port |
| `FS_PASSWORD` | No | `ClueCon` | FreeSWITCH ESL password |
| `FS_CONF_DIR` | No | — | Path where XML provisioning files are written |
| `FS_REQUIRED_MODULES` | No | `mod_callcenter,mod_avmd` | Comma-separated modules to auto-load |
| `FS_WS_URL` | No | — | FreeSWITCH WebSocket URL for WebRTC (`wss://host:7443`) |
| `FS_STUN_URL` | No | — | STUN server for WebRTC ICE |
| `FS_RECORDINGS_DIR` | No | — | Directory where FreeSWITCH writes recordings |

### Web (`apps/web/.env.local`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | No | `http://localhost:4000` | API base URL. Must be set in production. |

> **Important:** `NEXT_PUBLIC_*` variables are baked into the Next.js build.
> If you change this value you must rebuild — it is not read at runtime.

---

## Project scripts (run from repo root)

```bash
# Infrastructure
npm run infra:up          # Start Postgres + Redis
npm run infra:down        # Stop Postgres + Redis

# Development
npm run api:dev           # Start API with hot-reload
npm run web:dev           # Start Next.js dev server
npm run dev               # Start both together (requires concurrently)

# Build
npm run api:build         # Build API for production
npm run web:build         # Build web for production

# Database
npm run db:migrate        # Run pending Prisma migrations (dev)
npm run db:seed           # Seed initial data

# API-specific (run from apps/api/ or with --workspace)
npm --workspace @nativetalk/api run prisma:generate    # Regenerate Prisma client
npm --workspace @nativetalk/api run prisma:migrate     # Create + apply migration
npm --workspace @nativetalk/api run prisma:deploy      # Apply migrations (prod)
```

---

## Adding a new API module

The standard pattern for a new NestJS feature module:

```
apps/api/src/<feature>/
├── <feature>.module.ts
├── <feature>.controller.ts
├── <feature>.service.ts
└── dto/
    ├── create-<feature>.dto.ts
    └── update-<feature>.dto.ts
```

1. Generate the module:
   ```bash
   cd apps/api
   npx nest g module <feature>
   npx nest g controller <feature>
   npx nest g service <feature>
   ```

2. Import the module in `apps/api/src/app.module.ts`.

3. Apply guards on the controller:
   ```typescript
   @UseGuards(JwtAuthGuard, RbacGuard)
   @RequirePermission('campaigns', 'create')
   @Post()
   create(@Req() req, @Body() dto: CreateCampaignDto) { ... }
   ```

4. Add new shared types to `packages/types/src/index.ts`.

---

## Adding a new database model

1. Edit `apps/api/prisma/schema.prisma` — add the new model.
2. Create a migration:
   ```bash
   npm --workspace @nativetalk/api run prisma:migrate
   # Prisma prompts for a migration name, e.g. "add_phone_numbers_table"
   ```
3. Regenerate the Prisma client (happens automatically with `migrate dev`):
   ```bash
   npm --workspace @nativetalk/api run prisma:generate
   ```
4. Update `packages/types/src/index.ts` if the new model needs shared types.

---

## Connecting to a remote FreeSWITCH for local dev

If you need to test telephony features against a staging FS server:

```bash
# Open an SSH tunnel from local 8021 to the staging FS server's ESL port
ssh -L 8021:localhost:8021 user@your-staging-server -N &

# Then in apps/api/.env:
FS_HOST=127.0.0.1
FS_PORT=8021
FS_PASSWORD=<staging-esl-password>
```

The API will connect over the tunnel as if FS were local. Do not use the
staging server's ESL port directly from your machine — always tunnel through
SSH so the ESL port is never exposed to the internet.

---

## Useful Prisma Studio

Prisma ships with a GUI for browsing and editing the database:

```bash
cd apps/api
npx prisma studio
# → http://localhost:5555
```

Use this during development to inspect data, debug campaign state, check
call attempts, etc.

---

## Troubleshooting

**`Error: FreeSWITCH is not connected`**  
Expected when FS is not running or reachable. The API works for all
non-telephony features. If you need FS, check the SSH tunnel (above) or
point `FS_HOST` at your staging server.

**`P1001: Can't reach database server`**  
Docker isn't running or `infra:up` wasn't run. Check: `docker ps`

**`Invalid nesting` / Prisma client not generated**  
Run: `npm --workspace @nativetalk/api run prisma:generate`

**CORS errors in browser**  
Check `WEB_ORIGIN` in `apps/api/.env` matches the URL your browser is using
(including port). It must be an exact match, no trailing slash.

**`NEXT_PUBLIC_API_URL` showing localhost in production**  
This variable must be set at build time for Next.js. Set it in your CI/CD
environment variables before running `npm run web:build`. Changing it at
runtime has no effect.

**Port conflicts**  
Default ports: API `4000`, Web `3001`, Postgres `5432`, Redis `6379`.
Override with `PORT=` in `.env` and `-p` flags in docker compose if needed.

---

## NestJS core concepts

A quick reference for the patterns used throughout the API — so you don't have
to dig through framework docs every time.

### Modules

A module is a self-contained feature unit — its own folder with its own
controller, service, and any other classes it needs. NestJS won't know a module
exists until it's listed in `AppModule.imports`. Think of it like Django's
app-level `urls.py` that has to be included in the project-level `urls.py`
before those routes are reachable.

```
AppModule.imports = [AuthModule, PbxModule, DialerModule, ...]
                          ↑
              if it's not here, its routes don't exist
```

Some modules are registered with `isGlobal: true` (e.g. `ConfigModule`). This
means their providers are available everywhere without each module having to
import them individually. Only truly cross-cutting concerns should be global —
config, database client, Redis.

### Providers and dependency injection

A provider is any class that NestJS creates once at startup and manages for
the lifetime of the application. Services, guards, repositories — they are all
providers. NestJS creates **one instance** and reuses it everywhere (singleton),
which is the same concept as a DI container in Spring (Java/Kotlin) or
Dagger/Hilt (Android).

Instead of a controller manually creating its dependencies:
```ts
// without DI — a new DB connection on every request
const prisma = new PrismaClient();
const auth = new AuthService(prisma, jwt);
```

You declare what you need in the constructor and NestJS injects the shared
instance automatically:
```ts
// with DI — one shared instance for the whole app
constructor(private prisma: PrismaService, private auth: AuthService) {}
```

For a provider to be injectable into other classes, it must be listed in a
module's `providers` array. For it to be usable by *other* modules, it must
also be in that module's `exports` array.

### Guards

A guard is a gatekeeper — code that runs before a controller method and decides
whether the request should proceed or be blocked. It implements one method:
`canActivate()`, which returns `true` (allow) or throws an exception (block).

Guards registered with the `APP_GUARD` token in `AppModule.providers` run
automatically on **every route** in the application:

```ts
// app.module.ts — order matters: runs top to bottom on every request
{ provide: APP_GUARD, useClass: ThrottlerGuard },  // 1. rate limit
{ provide: APP_GUARD, useClass: JwtAuthGuard },    // 2. who are you?
{ provide: APP_GUARD, useClass: RbacGuard },       // 3. are you allowed?
```

Guards differ from Express middleware in one important way: they have access to
the full execution context, meaning they can read decorators placed on the
specific controller method about to run. That's how `RbacGuard` reads
`@Permissions('campaigns')` from the route and checks it against the user's
role — plain middleware can't do that.

### Decorators used in this codebase

| Decorator | Where | What it does |
|---|---|---|
| `@Public()` | Controller / method | Skips JWT + RBAC guards entirely |
| `@Roles('agent')` | Method | Explicitly allows this role (agents are blocked everywhere else) |
| `@Permissions('x')` | Method / class | Requires `permissions.x.enabled = true` on the user's role |
| `@Permissions('x:y')` | Method | Requires `permissions.x.items.y = true` |
| `@CurrentUser()` | Method param | Injects the authenticated `AuthUser` from the request |
| `@Throttle(...)` | Method | Overrides the global rate limit for this specific route |
