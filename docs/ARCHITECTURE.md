# NativeTalk Call Center — Technical Architecture

## 1. System overview

NativeTalk is a multi-tenant Cloud PBX and Contact Center platform. It sits as
an application layer on top of FreeSWITCH, a battle-tested open-source media
server, and exposes a modern REST + WebSocket API consumed by a React SPA.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser / Agent                         │
│              Next.js SPA  ·  sip.js softphone (WebRTC)          │
└────────────────────────────┬───────────────────┬────────────────┘
                             │ HTTPS REST         │ WebSocket (Socket.io)
                             ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NestJS API  (port 4000)                       │
│  Auth · PBX · Dialer · Campaigns · Analytics · Realtime GW      │
│                      │                │                          │
│                 Prisma ORM        ioredis                        │
└──────────┬───────────┴────────────────┴──────────────────────────┘
           │ ESL (port 8021)       │ PostgreSQL      │ Redis
           ▼                       ▼                 ▼
┌─────────────────┐   ┌──────────────────┐  ┌──────────────────┐
│  FreeSWITCH     │   │  PostgreSQL 16   │  │  Redis 7         │
│  (separate VM)  │   │  (primary store) │  │  (state + jobs)  │
│  SIP · RTP      │   └──────────────────┘  └──────────────────┘
│  mod_callcenter │
│  mod_avmd       │
│  mod_verto/WSS  │
└─────────────────┘
```

FreeSWITCH runs on its own VM or dedicated server. It never shares a host with
the application tier. The API connects to it over ESL (Event Socket Layer) —
a persistent, auto-reconnecting TCP connection.

**Why separate servers?** FreeSWITCH and the API compete for CPU in fundamentally
different ways. When a campaign is dialing 50 concurrent calls, FreeSWITCH burns
CPU on audio processing — codecs, transcoding, recording, answering machine
detection. The API burns CPU on HTTP requests, database queries, and WebSocket
events. On a shared server, a busy dialing campaign will starve the API of CPU,
causing slow responses and dropped WebSocket connections exactly when supervisors
need the live dashboard most. Keeping them separate means each can be scaled
independently: FreeSWITCH scales with call volume (roughly 100–150 concurrent
calls per CPU core), the API scales with user and tenant count.

**In development and staging**, running both on the same server is fine and saves
cost. Only enforce separation in production.

---

## 2. Repository structure

```
nativetalk-callcenter/          ← monorepo root
├── apps/
│   ├── api/                  NestJS 11 backend
│   │   ├── src/
│   │   │   ├── auth/         Login, JWT strategy
│   │   │   ├── accounts/     Unified account CRUD (agents, supervisors, admins)
│   │   │   ├── roles/        Role management — system roles + custom role cloning
│   │   │   ├── pbx/          FreeSWITCH provisioning (XML generation + sync)
│   │   │   ├── freeswitch/   ESL connection + event subscriptions
│   │   │   ├── telephony/    High-level call operations (originate, transfer, etc.)
│   │   │   ├── dialer/       Progressive dialer engine
│   │   │   ├── contacts/     Customer contact records (used by agents + campaigns)
│   │   │   ├── recordings/   Recording storage, metadata, playback URLs
│   │   │   ├── realtime/     Socket.io gateway — live dashboard events
│   │   │   ├── billing/      Subscriptions, plans, invoices
│   │   │   ├── health/       /health endpoint
│   │   │   ├── metrics/      Prometheus /metrics endpoint
│   │   │   ├── redis/        Redis service wrapper
│   │   │   ├── prisma/       Prisma service + client
│   │   │   └── common/       Guards, decorators, exception filters
│   │   └── prisma/
│   │       ├── schema.prisma Full database schema
│   │       ├── migrations/   SQL migration history
│   │       └── seed.ts       3 system roles + admin account on first run
│   └── web/                  Next.js 15 frontend
│       ├── app/              App Router pages
│       │   ├── login/        Authentication
│       │   ├── register/     Self-service tenant signup
│       │   ├── agent/        Agent workspace (softphone)
│       │   ├── agents/       Team management — accounts + extensions (admin)
│       │   ├── contacts/     Customer contact directory
│       │   ├── live/         Live call monitoring (supervisor+)
│       │   ├── campaigns/    Campaign management (supervisor+)
│       │   ├── billing/      Subscription management (admin)
│       │   └── platform/     Cloud PBX configuration (admin)
│       ├── components/       Shared UI components (nav, call widget, etc.)
│       └── lib/
│           ├── api.ts        HTTP client (auth token + fetch wrapper)
│           └── realtime.ts   Socket.io client (connects to /realtime namespace)
├── packages/
│   └── types/                Shared TypeScript types
│       └── src/index.ts      API contracts, realtime events, domain enums
├── docs/                     Architecture, database, development, security docs
└── deploy/                   Operational scripts (install, backup, deploy)
```

---

## 3. Tech stack decisions

### Backend: NestJS + TypeScript

NestJS was chosen over plain Express because:
- Module system enforces clean separation of concerns at the framework level
- Built-in support for dependency injection, guards, interceptors, pipes — things
  a contact center platform needs (auth guards, validation, rate limiting)
- Native WebSocket module integrates Socket.io without extra wiring
- TypeScript first-class — shared types between modules and with the frontend

### Database: PostgreSQL + Prisma

PostgreSQL because relational integrity matters — a call attempt must reference
a real campaign, a queue must reference real extensions. Prisma ORM because:
- Type-safe queries (no runtime SQL injection surface)
- Migration history tracked in version control
- Schema is the single source of truth for the data model

### Cache and job queue: Redis

Redis serves two roles:
1. **Ephemeral state store** — agent status, active call map, queue snapshots.
   This data changes every few seconds; PostgreSQL is the wrong tool for it.
2. **Background job queue** — the progressive dialer runs as a Bull/BullMQ
   queue backed by Redis. Jobs survive API restarts.

### Real-time: Socket.io

Socket.io over WebSocket because:
- Automatic fallback to long-polling (handles corporate proxies/firewalls)
- Namespace support (`/realtime`) keeps events isolated from the REST surface
- Built-in room support for tenant isolation (each tenant gets its own room)

### Telephony: FreeSWITCH + ESL

FreeSWITCH is the industry-standard open-source media server. The ESL
(Event Socket Layer) is its TCP-based control protocol. The API maintains ONE
persistent ESL connection (not per-request sockets like the old prototype).
This is the foundation for:
- Real-time event subscription (`CHANNEL_CREATE`, `CHANNEL_ANSWER`, `CHANNEL_HANGUP`, etc.)
- Sending commands (`originate`, `uuid_kill`, `uuid_transfer`, etc.)
- Provisioning (`reloadxml`, `sofia rescan`)

### Browser calling: sip.js (WebRTC)

sip.js wraps the browser's WebRTC APIs and implements SIP over WebSocket,
allowing agents to make and receive calls directly in the browser without
installing a separate softphone. FreeSWITCH's `mod_verto` or `mod_sofia` with
WSS transport handles the server side.

---

## 4. Authentication and authorisation

### Authentication flow

```
POST /auth/login  { email, password }
  → bcrypt.compare(password, account.passwordHash)
  → JWT signed with HS256 (JWT_SECRET)
  → Set-Cookie: nativetalk_token=<jwt>; HttpOnly; Secure; SameSite=Strict
  → { user: { id, email, role, permissions, tenantId, superAdmin } }
```

The JWT lives in an **httpOnly cookie**, not localStorage. `HttpOnly` means
JavaScript on the page cannot read it — `document.cookie` and `localStorage`
have no trace of the token. This eliminates the most common XSS token-theft
attack: even if a malicious script runs in the browser, it cannot extract the
session token.

The browser attaches the cookie automatically to every request to the API
domain. The frontend API client sends `credentials: 'include'` so the browser
includes the cookie on cross-origin requests. No `Authorization` header is
set by the client.

Non-sensitive profile data (display name, role label, tenant name) is stored in
`localStorage` for UI use only — it is never trusted by the API for access
control decisions. The JWT payload carries `tenantId` and the server re-reads
permissions from the database on every request (via the JWT strategy), so
permission changes take effect immediately without re-issuing the token.

**Logout** calls `POST /auth/logout`, which sets an expired cookie to clear it
server-side. The frontend also clears the localStorage profile.

### Single portal, one account type

Everyone — agents, supervisors, admins — logs into the same portal through the
same `Account` model. There is no separate agent login or agent-only app. What
each person sees and can do is entirely determined by the permissions attached
to their role. This means a supervisor can make calls, an admin can run a
campaign, and a custom "Analyst" role can be created that has analytics access
but no phone capability.

### Role-based access control (RBAC)

The platform ships with **three system roles** that are seeded on first startup.
They cannot be edited or deleted, but any of them can be cloned to create a
custom role.

| Permission | Admin | Supervisor | Agent |
|---|:---:|:---:|:---:|
| Softphone (make & receive calls) | ✓ | ✓ | ✓ |
| Contacts | ✓ | ✓ | ✓ |
| Live calls (monitor, whisper, barge) | ✓ | ✓ | ✗ |
| Queues | ✓ | ✓ | ✗ |
| Campaigns | ✓ | ✓ | ✗ |
| Recordings | ✓ | ✓ | ✗ |
| Analytics | ✓ | ✓ | ✗ |
| Cloud PBX (extensions, trunks, IVR, routing) | ✓ | ✗ | ✗ |
| User & role management | ✓ | ✗ | ✗ |
| Billing | ✓ | ✗ | ✗ |

> **Note:** The softphone is a permission, not a platform-level given. It is ON
> by default for all three system roles so that admins and supervisors can also
> make calls — but it can be turned OFF on any custom role (e.g. a "Billing
> Manager" or "Analyst" role that needs portal access but should never appear
> in a call queue).

**Super Admin** is orthogonal to the role system — it is a platform operator
flag (Tech4mation staff only) that grants cross-tenant access. Super admins are
not subject to tenant-level role permissions.

### Custom roles

Admins can create unlimited custom roles — either from scratch with a blank
permissions object, or by cloning an existing role as a starting point.
Each role stores a permissions JSON object:

```json
{
  "softphone":  { "enabled": true },
  "contacts":   { "enabled": true },
  "live":       { "enabled": true },
  "campaigns":  { "enabled": true, "items": { "create": true, "delete": false } },
  "analytics":  { "enabled": true },
  "pbx":        { "enabled": false },
  "users":      { "enabled": false },
  "billing":    { "enabled": false }
}
```

The `RbacGuard` in `apps/api/src/common/rbac.guard.ts` evaluates this against
the required permission declared on each controller method. The frontend reads
the same permissions object from the JWT to show or hide navigation items —
there is no separate frontend permission list to keep in sync.

---

## 5. FreeSWITCH integration

### ESL connection lifecycle

The API maintains a **single persistent TCP connection** to FreeSWITCH over
ESL (Event Socket Layer, port 8021). This is not a per-request connection —
it is opened once at startup and kept alive for the life of the process.

When the `FreeswitchModule` loads (before any HTTP request is handled),
`onModuleInit()` runs automatically:

1. Creates a TCP client configured with FreeSWITCH's host, port, and password
2. Opens the connection
3. On successful connect: saves a reference to the connection so the rest of
   the API can send commands through it; tells FreeSWITCH which modules to
   load (callcenter, AMD, verto); subscribes to all events so FreeSWITCH
   starts streaming call activity to the API in real time
4. On disconnect / error: clears the saved reference so nothing tries to use
   a dead connection, then waits for the library to reconnect automatically
   with exponential back-off (retries at 1s, 2s, 4s, 8s… up to a ceiling)

```
onModuleInit()
  → new FreeSwitchClient({ host, port, password })
  → client.connect()
  → on('connect', fs) → store fs handle, ensureModules(), subscribeEvents()
  → on('error' / 'reconnecting' / 'end') → mark disconnected, clear handle
  → library handles reconnect with exponential back-off automatically
```

### Event subscription

On connect, the service subscribes to all FreeSWITCH events:
```
event plain ALL
```

Relevant events and their application-layer effects:

| FreeSWITCH event | Application effect |
|---|---|
| `CHANNEL_CREATE` | New channel appears in active calls map |
| `CHANNEL_ANSWER` | Call answered; update agent status → `connected` |
| `CHANNEL_BRIDGE` | Agent bridged to customer; start duration timer |
| `CHANNEL_HANGUP` | Call ended; write CDR record; trigger wrap-up state |
| `CHANNEL_UNBRIDGE` | Agent disconnected from customer (hold/transfer) |
| `CUSTOM callcenter::*` | Queue events: member joined, agent picked up, abandoned |
| `BACKGROUND_JOB` | Response to `bgapi` commands (used by the dialer) |
| `DTMF` | IVR digit presses |

### PBX provisioning

When an admin creates or modifies an extension, trunk, IVR, queue, or routing
rule, the API generates FreeSWITCH XML configuration from the database and
applies it:

```
Admin changes extension → pbx.service.sync(tenantId)
  → load full tenant config from Postgres
  → generate XML: directory users, sofia gateways, dialplan, queues
  → write XML to FS_CONF_DIR
  → api('reloadxml') + api('sofia rescan')
  → FreeSWITCH picks up new config live (no restart required)
```

> **Note:** the push model above (writing XML files into `FS_CONF_DIR`) is
> being phased out. It requires the API to have local filesystem access to the
> FreeSWITCH box, which doesn't hold in a decoupled/remote setup. The current
> architecture is the **pull model** described next.

### Config source: mod_xml_curl (pull model)

Instead of the API pushing XML files onto the FreeSWITCH box, FreeSWITCH
**pulls** config from the API on demand. `mod_xml_curl` is bound (in the
static `xml_curl.conf.xml`, `bindings="directory|dialplan|configuration"`) to
fetch three XML sections over HTTP whenever it needs them:

- **`directory`** — who an extension is: its auth password and its
  tenant/context. Fetched on REGISTER and on each authenticated request.
- **`dialplan`** — given a dialed number in a context, how to route it.
  Fetched at call time.
- **`configuration`** — only `callcenter.conf` is served dynamically (the
  progressive dialer's ACD queues, one `cc-<campaignId>@default` per
  agent-mode campaign). Every other config request returns "not found" so
  FreeSWITCH falls back to its static file. Fetched when the dialer issues
  `callcenter_config queue load` at run start (see the queue-lifecycle flow
  below).

Everything else stays **static** on the FreeSWITCH box and rarely changes:
the SIP profiles (`sofia.conf.xml` / `sip_profiles/internal.xml`), the RTP
port range (`switch.conf.xml`), module loads, and the `xml_curl` binding
itself. SIP profiles are *not* generated per-call — one `internal` profile
serves all tenants; the tenant is distinguished by domain/context, which
flows in through the directory and dialplan lookups.

This split is deliberate: FreeSWITCH executes **mechanism** (registration,
bridging, media) while the API owns **policy** (who exists, how to route).
Moving to production is then just pointing a fresh FreeSWITCH box at the
production API URL — all identities and routing come from the database.

**Three independent links** connect the API and FreeSWITCH (do not conflate
them — only one carries audio, and none of them is "the call" plus "the
config" together):

| Link | Direction | Transport | Carries |
|---|---|---|---|
| `mod_xml_curl` HTTP | FS → API | HTTPS | Config pulls (directory + dialplan XML) |
| ESL | API → FS | TCP 8021 | Commands (originate, status, events) |
| WSS + RTP | Browser ↔ FS | direct to FS public IP | SIP signaling + audio |

In local development the HTTP link runs through a `cloudflared` tunnel
(FS on a public box can't otherwise reach an API on a laptop), and ESL runs
through an SSH `-L` tunnel. In production both are direct. The browser's WSS
signaling and RTP audio always go straight to the FreeSWITCH public IP — they
never traverse either tunnel.

### Trunks / SIP gateways (the one thing xml_curl can't serve)

Everything the API feeds FreeSWITCH is pulled over xml_curl — **except SIP
trunks (Sofia gateways).** Gateways live in the **external SIP profile**, loaded
from **files** (`sip_profiles/external/*.xml`) via an `X-PRE-PROCESS include`
that FreeSWITCH resolves at config-parse time. xml_curl never sees that include,
so a trunk **must exist as a file on the FS box** and is (re)loaded with
`sofia profile external rescan`.

Because the API is on a **separate box**, it can't just write that file locally.
So whenever a tenant provisions or edits a trunk (auto-provisioned at signup, or
via **Administration → Trunks**), the API:

1. regenerates the tenant's gateway XML from the `Trunk` rows in Postgres,
2. **pushes it to the FS box over SSH** (`sudo tee`, gated on `FS_SSH_TARGET`;
   co-located deployments write locally instead), and
3. **rescans** the external profile over ESL.

Two multi-tenant safeguards:
- The file is **per-tenant**: `zzz_ucp_gw_<tenantId>.xml` (the profile includes
  `external/*.xml`), so one tenant's sync never clobbers another's gateways.
- The gateway **name is globally unique**: user-named trunks are namespaced with
  the tenant slug (`<slug>_<name>`) on create, and the name is immutable
  afterwards — because a Sofia gateway name must be unique across the whole box.

A tenant's gateway file looks like this (one `<gateway>` per trunk):

```xml
<include>
  <gateway name="tk_tech4mation">
    <param name="username" value="tk_tech4mation"/>
    <param name="password" value="•••"/>
    <param name="proxy"    value="37.9.63.182"/>
    <param name="register" value="true"/>
    <param name="caller-id-in-from" value="true"/>
  </gateway>
</include>
```

Outbound routing then bridges external numbers to
`sofia/gateway/<trunk.name>/<0-normalised number>` with the trunk's caller ID
(the xml_curl dialplan handles the number normalisation and CID). The carrier
side (route/tech-prefix, e.g. `0->3344`, and destination termination) is
configured once on the provider, not per tenant.

### Progressive dialer: per-campaign ACD queue lifecycle

When the dialer connects answered outbound calls to live agents (progressive/
power/predictive modes), each campaign gets its **own** ACD queue,
`cc-<campaignId>@default`, so concurrent campaigns never share agents or calls.
mod_callcenter queues cannot be created at runtime by command, so the API
serves them through the `configuration` xml_curl binding and the dialer loads
them on demand. The queue is **per-campaign** (not per-agent) and **ephemeral**
— it exists only while a run is active.

**The relationship is lazy: nothing exists on FreeSWITCH until a run starts.**

1. **Campaign created / configured** — Postgres only. No queue on FreeSWITCH.
   The API is merely *ready* to describe the queue if asked (it appears in the
   dynamically-served `callcenter.conf`).

2. **Run start → queue created.** `DialerService.start` resolves the queue name
   `cc-<campaignId>@default`, then over ESL:
   - `callcenter_config queue load cc-<id>@default` — FreeSWITCH doesn't know
     this queue, so it fetches `callcenter.conf` from the API over xml_curl,
     finds the `<queue cc-<id>@default>` block, and instantiates it. **This
     `queue load` is the exact moment FreeSWITCH learns the queue exists; it
     never polls.**
   - `callcenter_config tier add cc-<id>@default <agent>` for each of the
     campaign's assigned agents — attaching them to the queue.

3. **During the run.** The dialer paces on free agents (Available + Waiting),
   dialing only when one is idle. On answer it originates into the queue
   (`&callcenter(cc-<id>@default)`); the queue's strategy (longest-idle) bridges
   the call to a free tiered agent. The API is **not** in the per-call path —
   the queue config was fetched once at load.

4. **Run stop → queue torn down.** Triggered by Stop, all leads worked, the
   call window closing, or an error. In a `finally` (crash-safe), the dialer:
   - `callcenter_config tier del …` for each tier it added (pre-existing tiers
     are left alone), then
   - `callcenter_config queue unload cc-<id>@default` — removing the runtime
     queue. The Postgres campaign is untouched; starting again recreates it.

Properties: lazy (created at run start), ephemeral (gone at run stop), isolated
(one queue per campaign), and file-free (served from the API, never written to
disk on the box). Edge cases: a campaign with no assigned agents loads the queue
but adds no tiers (answered calls wait, logged); a failed `queue load` (API
unreachable) is logged and no bridge target exists.

### Call flow: 1001 → 1002

The full sequence for one extension calling another, showing exactly where the
config-pull link fires versus where signaling/media go direct:

**Registration (on page load, before any call):**
```
1. Browser 1001 ──WSS──► FS internal profile: "REGISTER 1001"
2. FS doesn't know 1001 → ──HTTP (mod_xml_curl)──► API: section=directory, user=1001
3. API returns 1001's directory XML: auth password + context (tenant slug)
4. FS validates the REGISTER auth and stores 1001's live WSS contact in its
   registration table.  (1002 registers the same way.)
```

**The call:**
```
5.  Browser 1001 ──WSS──► FS: "INVITE 1002"
6.  INVITE lands in the profile's context (the tenant slug, set from the
    directory lookup in step 3)
7.  FS asks how to route → ──HTTP (mod_xml_curl)──► API: section=dialplan,
    destination_number=1002, context=<tenant slug>
8.  API dialplan() resolves in priority order
    (extension → queue → ring group → IVR → inbound DID → outbound trunk).
    1002 is an extension → returns: <action application="bridge"
    data="user/1002@domain"/>
9.  FS executes the bridge → looks up 1002 in its registration table (step 4)
    → finds 1002's live WSS contact
10. FS ──WSS──► Browser 1002: "INVITE"
11. 1002 answers → SDP negotiated → RTP (audio) flows Browser↔FS↔Browser
    directly over the FreeSWITCH public IP and RTP port range.
```

The HTTP config-pull link fires only at **steps 2, 3, 7, 8** — pure config
lookups. The INVITE, the bridge, and the audio are all direct browser↔FS. The
API is a *config oracle*, never a media path.

---

### Browser softphone & Call Console (client architecture)

The agent's softphone is a **SIP.js `Web.SimpleUser`** that registers over WSS
directly to FreeSWITCH's internal profile (see the call flow above). Its
lifecycle is deliberately **hoisted out of any page** into a global
`CallProvider` (React context) mounted in the authenticated app layout
(`app/(app)/layout.tsx`), *above* the routed pages.

Why: an agent must stay **registered and reachable on every page**, not only
while the Call Console is open. If the softphone lived in the Call Console page
component, navigating away would unmount it and tear down the SIP registration —
incoming calls would be missed. Because the layout persists across route changes
within the group, the provider mounts once and the registration survives
navigation.

The provider owns everything call-related and exposes it via `useCall()`:

- **Registration + reconnection supervisor.** Registers on mount; on transport
  drop it auto-reconnects with capped exponential backoff (2s→30s) and
  re-registers — self-healing after an API restart, tunnel blip, or laptop wake,
  with no manual refresh. A generation counter ignores events from superseded
  SimpleUser instances.
- **Deterministic SIP domain.** The softphone config comes from
  `GET /telephony/softphone`; the SIP domain is pinned via `FS_SIP_DOMAIN` so a
  momentary ESL blip can't fall back to `127.0.0.1` and silently break routing.
- **Call tones** (Web Audio): DTMF key beeps, ringback (caller), ringtone
  (callee, an mp3), and a call-ended cue. Audio is unlocked on first user
  gesture (browsers block autoplay otherwise). ICE gathering is capped at ~1s
  (`iceGatheringTimeout`) so answer/setup isn't delayed ~5s by Chrome.
- **Global call UI, rendered by the provider (so it works on any page):**
  - an **incoming-call popup** (name/number + Answer/Decline) shown on every
    page *except* the Console, which has its own in-call UI;
  - an **active-call mini-bar** shown while on a call away from the Console,
    linking back to it.
  This is why there is no separate "campaign call" popup — a campaign call
  arriving at an agent is just an inbound call and reuses this same UI.
- **Screen-pop data.** When a call starts, the provider looks up the `Contact`
  by number and loads recent `CallLog` history in parallel (guarded against a
  newer call superseding the lookup), populating the Console's Customer panel.

The **Call Console page** (`app/(app)/agent`) is now a thin *consumer* of
`useCall()` that renders the three-column UI (Customer / Softphone /
Disposition). Click-to-call from elsewhere (e.g. Contacts) calls the provider's
`callNumber()` action directly rather than round-tripping through storage.

### Contacts & call history

- **`Contact`** — a customer identity (name, phone, company, and a persistent
  `notes` field shown on every call). Looked up from the Console by number:
  exact match for extensions, last-9-digit suffix match for real phone numbers
  (never a substring match, so "10" doesn't match "1002").
- **`ContactGroup`** — a named list/segment ("Lagos SMEs"). Membership is
  many-to-many via `Contact.groupIds` (a contact can be in several groups),
  managed on the Contacts page. Campaigns can target a group as their lead
  source (below).
- **`CallLog`** — one row per call, written when the call ends. Powers the Call
  Logs page and the Console's Recent Interactions / Last contact. Carries the
  per-call disposition + agent notes (distinct from the Contact's persistent
  notes). Currently written **client-side** (the browser posts on hangup);
  reliable for attended calls. A server-side FreeSWITCH `CHANNEL_HANGUP` CDR hook
  is a planned follow-up for authoritative logging + recording capture, and to
  unify with the dialer's `CallAttempt` records.

### Supervisor monitoring: Listen, Coach, Barge

A supervisor can join a live agent call in one of three ways, from the Agents
page (each on-call agent shows the three buttons):

- **Listen** — the supervisor hears both sides but says nothing. Neither the
  agent nor the customer knows.
- **Coach** (also called whisper) — the supervisor can talk to the **agent
  only**. The customer does not hear the supervisor. Used to guide the agent
  mid-call.
- **Barge** — the supervisor joins fully. **Both** the agent and the customer
  hear the supervisor. It becomes a three-way call.

How it works: FreeSWITCH's `eavesdrop` app does all three. The API finds the
agent's live channel, then rings the **supervisor's own softphone** (the
extension they're logged in with) and drops it onto that channel. The supervisor
answers their phone and they're in.

The trick that makes Coach and Barge work is **which channel we eavesdrop**. We
always eavesdrop the *agent's* leg. With that, `eavesdrop_whisper_aleg` sends the
supervisor's voice to the agent (Coach), and bridging both legs sends it to
everyone (Barge). Plain eavesdrop with no whisper is silent (Listen).

Endpoint: `POST /telephony/agents/:ext/monitor { mode }` (`mode` = `listen` |
`whisper` | `barge`). Supervisor-only — the global RBAC guard blocks agents.
The supervisor's softphone is already registered everywhere in the app (the
`CallProvider`, see above), so no extra setup is needed to receive the call.

## 6. Progressive dialer

The dialer is a **background worker** — it has nothing to do with HTTP routes.
It runs on a continuous loop powered by a Bull/BullMQ job queue backed by
Redis. When an admin activates a campaign, a job is pushed onto the queue and
a worker picks it up immediately.

The worker loop runs until the campaign is paused, completed, or all leads
are exhausted:

1. Checks the campaign is still active (an admin may have paused it)
2. Checks how many agents are currently free (reads from Redis agent state)
3. Picks the next lead that hasn't been dialled yet (or is due a retry)
4. Checks the number against the DNC (Do Not Call) list — skips if matched
5. Sends an `originate` command to FreeSWITCH over ESL — this is a raw
   FreeSWITCH instruction that tells it to dial the number and, when a human
   answers, bridge them to a free agent's extension
6. Waits for FreeSWITCH events:
   - Human answers → marks the lead as answered, updates agent status to connected
   - Machine answers (AMD detection) → skips or leaves a voicemail depending on config
   - No answer / busy → schedules a retry after the configured interval
   - Max attempts reached → marks the lead as done, moves on
7. When the call ends, writes a `CallAttempt` record to Postgres and loops back

```
Campaign activated
  → enqueue DialerJob { campaignId }
  → worker loop:
       1. Check campaign is still active
       2. Count available agents (Redis agent state map)
       3. Check DNC list
       4. Pick next lead (status = 'new' or retryable, ordered by priority)
       5. originate {campaign_vars}sofia/gateway/<trunk>/<number>
              &bridge({agent_vars}user/<agent_extension>)
       6. On CHANNEL_ANSWER: mark lead 'answered', agent status → 'connected'
       7. On CHANNEL_HANGUP: write CallAttempt record, agent → 'wrap-up'
       8. If AMD detected machine: skip or leave voicemail (config flag)
       9. If no-answer/busy: schedule retry after retry_interval
      10. If max_attempts reached: mark lead 'done'
  → loop until campaign paused/completed/all leads exhausted
```

Concurrency is controlled by the campaign's `concurrency` field — the dialer
never places more simultaneous calls than that number.

> **Status:** the progressive worker above is partially built and currently
> keeps run state **in-memory** (lost on API restart). It is being reworked to
> sit on the shared lead lifecycle + `CallLog` described below.

### Preview dialing (agent-paced) — built first

Preview is the **agent-paced sibling** of the progressive dialer: instead of the
system auto-dialing, the agent works a campaign **one lead at a time** — the
system hands them the next lead, they review it, click **Dial**, talk,
disposition, and get the next. It was built first because it shares all the
foundation progressive needs, at much lower telephony risk (the agent's own
softphone places the call, so no server-side originate/bridge is required yet).

**Campaign lead source.** A campaign draws its targets from any combination of:
a **`ContactGroup`** (`contactGroupId` → the group's contacts), a legacy
`LeadGroup`, and **manually pasted `numbers`**. These are merged and
de-duplicated on materialisation. Campaigns are created/edited through a
**full-page multi-step wizard** (`CampaignWizard`: Information → Contacts →
Dialing → Agents → Queue → Caller ID → Schedule → Dispositions → Review) rather
than a modal. The wizard is mode-aware: only tabs/fields relevant to the dial
method show (Caller ID, Concurrency, AMD and Schedule are auto-dialer concerns,
so they hide for Preview/Manual). Per-campaign `dispositionIds` **are enforced**:
`preview/next` returns them and the Console narrows the agent's wrap-up menu to
that subset (empty means all). The Schedule (`scheduleStart/End`, `callWindow*`,
`timezone`) is captured but not yet enforced; that lands with the progressive
dialer.

**Lead lifecycle (shared with progressive).** A campaign's pasted `numbers`,
contact-group members, and lead-group members are **materialised into
campaign-scoped `Lead` rows** the first time it's worked (`ensureLeads`). Each lead has a `status`:
`new → dialing (reserved) → done | dnc`, with retryable outcomes sent back to
`new` until `maxAttempts`. Reservation (`new → dialing`) is what stops two agents
working the same campaign from getting the same lead.

**Agent-facing endpoints** (`CampaignPreviewController`, `@Roles('agent')`):
- `GET /campaigns/:id/preview/next` — atomically reserve and return the next
  lead + a matched `Contact` (for screen-pop) + how many remain.
- `POST /campaigns/:id/preview/disposition` — write the `CallLog`
  (tagged `campaignId` + `leadId`) and advance the lead based on the
  disposition's **category** (Retry → back to queue, DNC → `dnc`, else `done`).
- `POST /campaigns/:id/preview/skip` — release a reserved lead without calling.

**Client flow (Call Console + `CallProvider`).** From the Campaigns page,
"Preview dial" calls `startPreview(campaignId)` and opens the Console. The
provider fetches the next lead, **screen-pops** it into the Customer panel
(contact, notes, recent interactions) and the softphone shows a **Dial** button
for that number instead of the manual keypad. Dialing places a normal outbound
call; on wrap-up, **Submit Disposition** posts to the preview endpoint (so
campaign calls are logged server-side, tagged with the campaign/lead — the
provider skips its usual client-side `CallLog` write for campaign calls) and
**auto-advances** to the next lead. `Skip` / `End preview` exit the loop.

**Campaign metadata + assignment.** A campaign carries a `description` and
free-text `goal` (shown in the list), and `assignedAgentIds` — the `Account`s
assigned to work it. Assignment is set in the campaign form (multi-select of
accounts that have an extension). Preview doesn't enforce assignment yet
(any agent can work any campaign), but **progressive will dial only for a
campaign's assigned, available agents** — which is why the field exists now.

**Campaigns list stats** come from `GET /campaigns/overview`
(`DialerService.campaignsOverview`), which enriches each campaign with:
`contactsCount` (materialised leads, or the configured numbers + lead-group
size before it's worked), `contactRate` (% of contacts reached = distinct
numbers with a completed `CallLog` ÷ contactsCount), and the resolved assigned
`agents`. Status is the `active` boolean (Active / Paused), toggled from the
list.

**How progressive builds on this (next):** progressive reuses the same lead
lifecycle, screen-pop, and `CallLog` tagging; it only replaces "agent clicks
Dial" with "system dials the next lead when an agent is free and bridges the
answered call to that agent." That needs a live **agent-availability** signal
(the Console already reports presence via `POST /telephony/agents/:ext/status`)
and a server-side originate→bridge, plus moving run state off the in-memory map.

**One known limitation of preview today:** because the agent's own softphone
dials (through the dialplan's default outbound route), a campaign's specific
**trunk/caller-ID is not yet applied per call**. Progressive's server-side
originate will honour them; preview will adopt the same path when it lands.

**Preview call recording.** When a preview campaign has recording enabled, the
softphone call is recorded **server-side** (the call lives on FreeSWITCH, not the
browser): on answer the client calls `POST /telephony/record/start {extension}`,
which finds the agent's active channel over ESL (`show channels`) and issues
`uuid_record <uuid> start <recordings_dir>/preview_<ext>_<ts>.wav`. The filename
is returned and attached to the `CallLog` on disposition; recording auto-stops at
hangup. **Playback is a follow-up** in the decoupled dev setup — the file is
written on the FreeSWITCH box, so serving it back needs a fetch from that box
(SFTP/HTTP) or shared storage; only the path is stored for now.

**Wizard is mode-aware.** The campaign form shows only the tabs/fields relevant
to the selected dial method (e.g. Concurrency/AMD/Queue appear only for
Progressive/Power; VoiceBroadcast drops Agents/Queue/Dispositions and adds an
audio-message field; Preview hides Concurrency/AMD).

---

## 7. Real-time data flow

The live dashboard (agent statuses, active calls, queue depth) stays current
without the browser polling. The flow is entirely event-driven:

1. A call event happens in FreeSWITCH (e.g. an agent answers a call)
2. FreeSWITCH sends that event to the API over the persistent ESL connection
3. The API updates Redis — writes the agent's new status and updates the
   active call map. Redis is used here instead of Postgres because call state
   can change many times per second; hitting the database on every event would
   be slow and wasteful
4. The API builds a **snapshot** — a complete picture of all agents, calls,
   and queue stats for that tenant right now — and broadcasts it over Socket.io
5. Every browser connected to that tenant's live dashboard receives the snapshot
   and re-renders immediately, with no page refresh

```
FreeSWITCH event (e.g. CHANNEL_ANSWER)
  → FreeswitchService.onEvent()
  → Update Redis state:
       - agents:<tenantId>:<agentId>  { status: 'connected', callUuid, statusSince }
       - calls:<tenantId>             SET of active call UUIDs
  → RealtimeGateway.broadcastSnapshot(tenantId)
  → Socket.io: emit('snapshot', RealtimeSnapshot) to room `tenant:<tenantId>`
  → All connected browsers in that tenant receive the update
```

The frontend connects to the `/realtime` Socket.io namespace when the page
loads, joins its tenant's room, and re-renders whenever a new snapshot arrives.
The snapshot replaces the previous one entirely — the frontend never has to
merge partial updates.

### Analytics & metric definitions

Two persisted call records feed analytics, and it matters which one a metric uses:

- **`CallAttempt`** — written **server-side by the dialer** for *every* dial it
  makes, including retries and instant failures (e.g. `SUBSCRIBER_ABSENT`). Has
  `status` (`answered` / `failed` / `skipped` / `stopped`), `cause`, `campaignId`,
  `recording` (server filename). This is the source of truth for *dialing* volume.
- **`CallLog`** — written **by the agent's browser** when a call ends (and by the
  Preview flow). Has the agent's talk `durationSec`, `disposition`, `notes`,
  `recording`, `campaignId` (tagged on create, or inferred from the matching
  recent `CallAttempt` if the client didn't send it). This is the source of truth
  for *what the agent did* on a connected call.

**Operations Dashboard** (`GET /dashboard/ops?range=1h|24h|7d|30d`, polled every 4s):

| KPI | Definition | Source | Window |
|-----|-----------|--------|--------|
| Active Calls | count of live bridged calls | FS `show calls` | now |
| Available Agents | `x / y` = registered+Available agents / total agent accounts | FS agent list ∩ `show registrations` | now |
| Calls (range) | `CallLog` count | `CallLog` | selected range |
| Contact Rate | `answered∪completed attempts ÷ all attempts × 100` | `CallAttempt` | selected range |
| Avg Handle Time | mean `durationSec` of completed calls (>0s) | `CallLog` | selected range |
| Calls Waiting | ACD queue members in `Waiting`/`Trying` state across live campaign queues | FS `callcenter_config queue list members` | now |

- **Deltas** on the three windowed KPIs compare the current window to the
  *immediately preceding equal-length window*; percentage change for Calls,
  point change for Contact Rate, second change for Avg Handle Time (Avg Handle's
  colour is inverted — lower is better). Null when the prior window has no data.
- **Available/agent status** is derived from **SIP registration**, not
  mod_callcenter status — the latter stays "Available" after a softphone closes,
  so an unregistered agent shows *offline*.

**Charts** (not affected by the range selector — fixed trends):
- *Daily contact rate* — per-day contact rate over the last **14 days** from `CallAttempt`.
- *Campaign performance* — per-campaign **contact rate**, **all-time**, from
  `CallAttempt` grouped by `campaignId`. It is a *connect rate*, not an outcome/
  conversion rate.

**Caveats worth knowing:**
- Contact Rate (and Campaign performance) are **per-attempt**: a number dialed 3×
  (2 fail, 1 answer) = 33%, so retries dilute the rate. Not a per-unique-contact
  reach rate.
- **Campaign call history** (`GET /campaigns/:id/calls`) is a **union** of the
  campaign's `CallLog`s (connected calls, with agent/disposition/notes/recording)
  and its terminal `CallAttempt`s that never produced a log (failed/skipped/
  stopped) — so every dial shows, not just the ones that reached an agent.
- **Recording duration** in the Recordings library is the *actual audio length*
  (measured with `soxi -D` on the media box, cached), **not** the agent talk time
  — a missed-but-recorded call has 0 talk time but a real recording. Recording
  filenames are per-call (`ucp_<campaign>_<number>_<ts>.wav`) so repeat calls to
  the same number don't overwrite each other.

---

## 8. Security

- **JWT HS256** — tokens are stateless and expire (configurable, default 8h)
- **Helmet** — sets secure HTTP headers (HSTS, CSP, X-Frame-Options, etc.)
- **CORS** — restricted to `WEB_ORIGIN` env var (no wildcard in production)
- **Rate limiting** — 120 requests/minute globally; 10/minute on `/auth/login`
- **bcrypt** — all passwords hashed with bcrypt (cost factor 10+)
- **Tenant isolation** — every DB query is scoped to the JWT's `tenantId`
- **RBAC guards** — controllers declare required permissions; the guard enforces
- **Audit log** — every state-changing action is written to `AuditLog`
- **ESL password** — stored in env var, never in code or database

### Permission-first access (a role is just a group of permissions)

There is **no role tier**. A role is simply a named set of permission switches:
softphone, contacts, live calls, queues, campaigns, recordings, analytics, cloud
PBX, user & role management, billing, manage a team, restrict to own team. A menu
item shows, and an endpoint opens, only if the person's role has the matching
switch on — the **same rule for everyone**. "Admin", "Supervisor", "Agent" are
just the three default groups: Admin has every switch on, Supervisor most of them,
Agent a few. You can make any other group you like.

Example: the **Call Console** needs the `softphone` switch. An admin, a
supervisor, or an agent all get it if (and only if) their role grants it. Nobody
is special-cased by rank.

The API guard (`RbacGuard`, global) works the same way:

- **`@Public()`** — no login needed (login, signup, health).
- **`superAdmin`** — the platform operator (cross-tenant); the only blanket
  bypass. This is separate from tenant roles.
- **`@AllowAuthenticated()`** — any signed-in user; for routes that only read the
  caller's own context (e.g. `/auth/me`, the dispositions list).
- **`@Permissions('x')`** — the caller's role must grant `x`. Because "admin" is
  just the role with everything on, admins pass these naturally — there is no
  admin bypass.
- **anything else** — denied.

After login the user lands on the first page their permissions allow. The badge
shows their role's name.

See [SECURITY-CHECKLIST.md](SECURITY-CHECKLIST.md) for the full hardening list.

---

## 9. Deployment topology

### Development

```
Local machine:
  docker compose up -d        → Postgres + Redis
  npm run api:dev             → NestJS hot-reload (port 4000)
  npm run web:dev             → Next.js dev server (port 3001)

FreeSWITCH: separate VM / staging server
  ESL port 8021 accessible from local machine (SSH tunnel if needed)
```

### Production

```
App server (Debian 12, systemd):
  nativetalk-api.service      → NestJS (port 4000, behind nginx)
  nativetalk-web.service      → Next.js (port 3001, behind nginx)
  PostgreSQL 16               → local or managed (RDS / Supabase)
  Redis 7                     → local or managed (Upstash / ElastiCache)

FreeSWITCH server (separate):
  SIP/RTP ports open          → carrier-facing
  ESL port 8021               → private network only (never public internet)
  mod_event_socket enabled
  mod_callcenter loaded
  mod_avmd loaded
  mod_verto loaded (WebRTC)
```

nginx reverse-proxies both services and handles TLS termination.
The FreeSWITCH ESL port must be on a private network — exposing it to the
internet is a serious security risk.

---

## 10. Scaling path

The current architecture is designed to scale vertically first, then
horizontally when justified by real load.

**Vertical (now):** A single app server with Postgres and Redis handles
hundreds of concurrent agents without changes. FreeSWITCH scales independently
(media is the bottleneck, not the API).

**Horizontal (later):**
- API: stateless NestJS nodes behind a load balancer. Socket.io needs Redis
  adapter (`@socket.io/redis-adapter`) to sync events across nodes — this is
  a one-line config change.
- Dialer: Bull workers can run on separate processes/nodes.
- Database: read replicas for analytics queries.
- FreeSWITCH: multiple nodes managed by the Super Admin infrastructure
  dashboard (already modelled in the PRD).

---

## 11. Key design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Repo structure | Monorepo (npm workspaces) | API and web share types; coordinated deploys |
| Database | PostgreSQL + Prisma | Relational integrity; type-safe queries; migration history |
| Ephemeral state | Redis | Agent status changes every second; Postgres is wrong for this |
| Auth | JWT in httpOnly cookie | Stateless + XSS-safe; JS cannot read the token |
| Telephony control | Persistent ESL | One connection handles all events; per-request sockets don't scale |
| Browser calling | WebRTC (sip.js) | No softphone install required; works in any modern browser |
| FreeSWITCH isolation | Separate VM | Media servers are resource-intensive; keep them off the app server |
| Multi-tenancy | Row-level (tenantId) | Simple, no schema-per-tenant complexity; tenant isolation enforced in API layer |
| Account model | Single unified account | Everyone (agent, supervisor, admin) logs into the same portal; role determines what they see |
| Role system | Permission-based RBAC | 3 protected system roles; unlimited custom roles by cloning; softphone is a permission not a given |
| Progressive dialer queues | Dedicated per-campaign ACD queue served via xml_curl | mod_callcenter queues can't be created at runtime, so the API serves `callcenter.conf` dynamically (one `cc-<campaignId>@default` per agent-mode campaign); the dialer `queue load`s it on demand and wires the campaign's assigned agents as tiers over ESL. Isolates concurrent campaigns without editing files on the FS box |

---

## 12. Glossary (telephony terms & abbreviations)

Plain-language definitions of the terms and acronyms used across this system.
Grouped by area.

### Call distribution
- **ACD (Automatic Call Distribution)** — the mechanism that routes a live call
  to an agent automatically instead of a human transferring it. An "ACD queue"
  bundles a waiting line of calls with the agents who serve it and a rule for
  picking the next agent.
- **Queue** — a named waiting line for live calls plus the agents assigned to
  it (e.g. `support@default`). Classically used for inbound calls; the
  progressive dialer reuses it as the hand-off point for answered outbound
  calls. Distinct from a **campaign**: a campaign is the outbound work list
  (who to call and why); a queue is the routing mechanism (how a live call
  reaches a free agent).
- **Agent** — a person who can take/place calls, registered in FreeSWITCH's
  mod_callcenter. Has a **status** (Available, On Break, Logged Out) and a
  **state** (Waiting = ready, Receiving, In a queue call). "Ready" = Available
  + Waiting.
- **Tier** — the mapping that assigns an agent to a queue. Without a tier, a
  queue has no agents serving it. Tiers can carry priority levels (try senior
  agents first, overflow to others).
- **Distribution strategy** — how the queue picks the next agent:
  `longest-idle-agent` (fairest), round-robin, ring-all, etc.
- **AMD (Answering Machine Detection)** — detecting whether a human or a
  voicemail/machine answered, so the dialer can skip machines. In FreeSWITCH
  this needs `mod_avmd` plus a dialplan step (not a simple flag). *Not yet
  enforced.*

### Dial methods
- **Preview** — the agent sees each contact then clicks to dial from their own
  Console. Agent-paced, no automation, no queue needed.
- **Progressive** — the system auto-dials the next contact **when an agent is
  free** and hands the answered call to them via the queue. Paced by free-agent
  count.
- **Power** — like progressive but **over-dials** (more calls than free agents)
  to cut agent wait time; may drop a call if no agent is free when it answers.
- **Predictive** — power dialing with statistical pacing that predicts agent
  availability. *Future work.*
- **Voice Broadcast** — no agents; auto-dials a list and plays a recorded
  message.
- **Disposition** — the outcome label an agent (or the dialer) assigns to a call
  (Answered, No Answer, Busy, Callback, Do Not Call). Its **category** drives
  what happens to the lead afterwards (retry, retire, requeue).
- **DNC (Do Not Call)** — numbers that must never be dialled; skipped at run
  start and enforceable per tenant.
- **Lead** — a single campaign-scoped record to be worked (a phone number, its
  attempts, status, and last disposition). Materialised from the campaign's
  pasted numbers, lead group, or contact group.

### Telephony plumbing
- **FreeSWITCH (FS)** — the open-source telephony/media server that actually
  places, bridges, and records calls.
- **ESL (Event Socket Library)** — the persistent socket the API uses to send
  commands to FreeSWITCH (`fs.api(...)`) and receive call events.
- **mod_xml_curl (pull model)** — the FreeSWITCH module that, instead of reading
  config from local XML files, fetches XML from an HTTP URL on demand. Lets the
  API serve identity/routing/config live from the database rather than pushing
  files onto the box.
- **XML section** — a top-level category of FreeSWITCH XML: `directory` (users
  and domains), `dialplan` (call routing), `configuration` (every module's
  config file, e.g. `callcenter.conf`), plus `phrases`/`chatplan`. Every XML
  lookup belongs to one section.
- **xml_curl binding** — a rule in `xml_curl.conf.xml` that says "for these
  sections, ask this URL instead of reading the file." The
  `bindings="directory|dialplan|configuration"` value is a pipe-separated list
  of the sections routed to the API. A section not in the list is read from the
  static file; a section in the list is fetched over HTTP, and if the API
  returns a "not found" document FreeSWITCH falls back to the file for that
  lookup. Adding `configuration` is what lets the API serve `callcenter.conf`
  (per-campaign ACD queues) while deferring all other module configs back to
  their files.
- **SIP (Session Initiation Protocol)** — the signalling protocol that sets up,
  manages, and tears down calls. SIP response codes carry the outcome (e.g.
  480 = unavailable/unregistered, 486 = busy, 603 = declined).
- **Registration** — a SIP endpoint (a softphone) telling FreeSWITCH "I'm here
  at this address." A call to an **unregistered** extension has nowhere to land
  and fails immediately.
- **WebRTC** — the browser standard that lets the in-app softphone (sip.js) make
  real calls with no desktop software.
- **Originate** — the FreeSWITCH command that places an outbound call, then
  bridges it somewhere (into a queue, or to play audio).
- **CDR (Call Detail Record)** — the logged record of a call (who, when, how
  long, outcome). Stored as `CallLog` / `CallAttempt` rows.
- **Extension** — a short internal number (e.g. 1002) identifying an
  agent/endpoint within a tenant.
- **Gateway / Trunk** — the connection to an external carrier that lets calls
  reach real phone numbers (PSTN) instead of only internal extensions.
- **Screen-pop** — automatically surfacing the caller's contact record and
  history on the agent's screen when a call starts.
- **Wrap-up (ACW, After-Call Work)** — the post-call state where the agent logs
  the disposition and notes before moving to the next call.
