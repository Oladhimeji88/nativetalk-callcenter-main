# Build Log — In Very Simple English

This is a running diary of the **enterprise rebuild**. Every meaningful step is
written here in everyday language, newest at the bottom, so you can follow along
without needing the technical details.

We are building **Phase 0 — the Foundations**: the strong base that every later
feature sits on. Think of it like the foundation and plumbing of a building,
before any rooms are added.

---

## What Phase 0 is (in plain words)

Right now the app keeps its information in simple text files and has **no login**
— anyone who opens it can do anything. Phase 0 fixes the base:

1. **A proper filing system (database).** Move from loose text files to a real
   database (PostgreSQL) — like moving from sticky notes to a proper, lockable
   filing cabinet that many people can use at once without losing anything.
2. **A login and permissions system.** You must sign in, and what you're allowed
   to do depends on your role. The "Manager Role" permissions you set up become
   *real* rules the system enforces, not just for show.
3. **A tidier engine room.** Reorganise the project so the website and the
   behind-the-scenes service are separate, well-structured programs — easier to
   grow and maintain.
4. **One steady phone-line connection.** Keep a single, always-on link to the
   phone engine (FreeSWITCH) instead of opening a new one for every call.
5. **Ready for many customers later.** Build everything so that, when you choose,
   the same system can serve many separate companies — each with their own walled-
   off data — without a rebuild.

None of Phase 0 needs the phone carrier, so we can build it all right now.

---

## Diary

### Start — checking the workshop
- Confirmed the tools on this PC: Node (the program runtime) and Docker (a way to
  run the database and helpers in neat, self-contained boxes) are both installed.
- The database (PostgreSQL) and the fast memory helper (Redis) were **not**
  installed — so we'll run them inside Docker boxes. This is the clean, standard
  way and means nothing extra has to be installed by hand.
- The current app keeps running untouched while we build the new base alongside it.

### Milestone 1 — Tidy new building layout (monorepo)
- Reorganised the project into clear sections under one roof:
  - `apps/api` — the new behind-the-scenes engine (the "brain").
  - `apps/web` — reserved for the new website (built in a later phase).
  - `apps/legacy` — the **old app, moved here untouched** so it still works while
    we build the new one. Nothing was thrown away.
- This is the professional "monorepo" layout: many parts, one well-organised home.

### Milestone 2 — The filing cabinet and the fast helper (database + Redis)
- Started **PostgreSQL** (the real database) and **Redis** (a fast helper for live
  information) inside Docker boxes. Both reported **healthy**.
- These run as separate services — exactly how the real, scalable version is meant
  to be set up — so they never fight the phone engine for resources later.

### Milestone 3 — The new brain (API) with a real database
- Built the new engine using **NestJS** (a sturdy, well-organised framework).
- Connected it to PostgreSQL through **Prisma**, and designed the **data model**:
  proper, related tables for companies (tenants), manager roles, managers, users,
  user groups, rules, and so on — every single table stamped with a "which company
  this belongs to" label, so the system is **ready to serve many companies** later
  without a rebuild (we run as one company for now).
- Created the database tables from that design (the first "migration").

### Milestone 4 — Moving your existing information across
- Wrote a careful importer and **moved all your existing data** out of the old
  text files and into the real database. Counted and confirmed: 2 manager roles,
  2 managers, 5 users, 3 user groups, 3 outgoing rules, plus all the contact-centre
  lists (8 dispositions, 3 outbound campaigns, the DNC list, webform, lead group,
  and the inbound/blended campaigns). **Nothing lost.**

### Milestone 5 — A real login and real permissions
- Added a proper **login system**. You sign in with an email and password; the
  system hands back a secure pass (a token) for the rest of your visit. Passwords
  are stored **scrambled** (hashed), never in plain text.
- Set up your **admin account**:
  - email: `admin@tech4mationlimited.com`
  - password: `Admin@12345`  *(please change this after first login)*
- Made the **Manager-Role permissions real**. In the old app these switches were
  just for show; now the engine **actually enforces them** on every request.

### Milestone 6 — One steady line to the phone engine
- The new engine keeps **one always-on connection** to FreeSWITCH (the phone
  system), instead of dialling a fresh one for every action like the old app did.
  This is faster and is the base for live, real-time call information later.

### Milestone 7 — Proving it all works (not just claiming it)
I tested the new foundation end to end against the real services:
- Health check: **database OK, Redis OK, phone engine connected** ✓
- Trying to use the system **without** logging in → correctly **blocked** ✓
- Logging in with the right password → **works**; wrong password → **rejected** ✓
- An **admin** can see everything ✓
- A **limited manager** (given only "Contact Center" access) was correctly
  **allowed** into contact-centre data but **blocked** from Users and from the
  admin-only role screens ✓ — proof the permissions are genuinely enforced.
- Your migrated data reads back correctly through the new secure system ✓

---

## ✅ Phase 0 is complete

The strong base is built and proven: a real database with your data in it, a
proper login, **enforced** permissions, a tidy multi-part project, an always-on
link to the phone engine, and ready-for-many-companies design. The old app still
runs untouched throughout.

### How to run the new foundation (for reference)
1. Start the database + helper:  `docker compose up -d`  (from the project folder)
2. Start the new engine:         `npm run api:dev`        (serves on port 4000)
3. Old app (still available):    `npm run legacy:start`   (serves on port 3000)

> Note: the new engine (API) is the foundation only — the new **website** that
> people click around in is built in a later phase. For now the old app remains
> the visual one; the new engine is tested with direct requests.

### What's next (when you say go)
**Phase 1 — Cloud PBX**: extensions & SIP registration, trunks, call routing,
IVR menus, ring groups, and call queues — all configured from the platform.

---

# Phase 1 — Cloud PBX

Goal: let you build and run a real phone system from the platform — desk phones
(extensions), carrier lines (trunks), groups that ring together (ring groups),
and rules for where incoming calls go — and have the phone engine (FreeSWITCH)
**actually use** that setup.

### How it works (in plain words)
The platform stores all your phone settings in the database. When something
changes, it **writes the matching FreeSWITCH settings files and tells the phone
engine to reload** — so the live phone system always matches what you set on
screen. You never touch config files by hand.

### Milestone 8 — Phone-system settings, stored properly
- Added proper database tables for: **Extensions** (desk phones), **Trunks**
  (carrier lines), **Ring Groups**, **Inbound Routes** (where a dialled-in
  number goes), plus **IVR menus**, **Queues**, and **Time Conditions**.

### Milestone 9 — The "translator" to the phone engine
- Built the part that **turns your settings into FreeSWITCH's own language**
  (its XML config) and applies them:
  - Extensions → so softphones can register and be called.
  - Trunks → so the system can reach a carrier.
  - Ring Groups → dialling one number rings several phones at once (or in turn).
  - Inbound Routes → a number dialled in is sent to the right place.
- After any change the platform writes the files and runs a **reload**, so it
  takes effect immediately.

### Milestone 10 — Built the controls (API) + tested it
- Added the on/off-switch endpoints to create, edit, delete, list each of the
  above, plus a **"Sync"** button action that pushes everything to the engine and
  a **"Preview"** that shows exactly what config will be generated.
- **Tested for real:**
  - Created an extension, a trunk, a ring group, and an inbound rule. ✓
  - Checked the **generated FreeSWITCH config is correct** (matches the engine's
    expected format). ✓
  - Pushed the config to a writable location and confirmed the files were
    **actually written** and the engine accepted a **reload (+OK)**. ✓
  - Everything is **per-company** and **permission-protected**, like the rest. ✓

---

## 🚧 Blockers — what I need from you to finish/verify Phase 1 live

The building and the config-generation are done and tested. To make the phone
engine on **this Windows PC** actually load it (and to finish IVR/queues), I need:

1. **Write access to the phone engine's settings folder.**
   The engine's config lives in `C:\Program Files\FreeSWITCH\conf`, which Windows
   protects — our app can't write there without permission. To clear it, pick one:
   - **(Recommended)** Do this on the **Ubuntu server (72.61.18.174)** where the
     real system will live and the folder is writable — give me SSH access, or
   - run FreeSWITCH/our app **as administrator** on this PC, or
   - point the setting `FS_CONF_DIR` at a folder the engine reads and we can write.
   > Until then, the platform still generates and stores everything correctly and
   > shows a clear "couldn't apply — folder not writable" message instead of failing.

2. **Two phone-engine add-ons, for the advanced bits.**
   - **`mod_callcenter`** — needed for proper **call queues with agents** (this PC
     doesn't have it; only a basic queue module is present).
   - **`mod_ivr`** (or we use the installed `mod_lua`) — for full **IVR menus**.
   These come with a standard FreeSWITCH install on the Ubuntu server; I just need
   them enabled there. On this PC they're absent, so IVR/Queue are built as
   settings-and-storage for now, with the live call-flow added once enabled.

### Where Phase 1 stands

| Feature | Build + config generation | Live on this PC |
| ------- | ------------------------- | --------------- |
| Extensions / SIP registration | ✅ done & tested | ⛔ needs blocker #1 |
| Trunks (carrier lines) | ✅ done & tested | ⛔ needs blocker #1 |
| Ring Groups | ✅ done & tested | ⛔ needs blocker #1 |
| Inbound Routes | ✅ done & tested | ⛔ needs blocker #1 |
| IVR menus | ✅ settings + storage | ⛔ needs blocker #1 + #2 |
| Call Queues (ACD) | ✅ settings + storage | ⛔ needs blocker #1 + #2 |
| Time Conditions | ✅ settings + storage | ⛔ needs blocker #1 |

---

## ✅ Blockers cleared — Phase 1 proven LIVE

You gave the platform write access to the phone engine's settings folder (a
one-time permission grant). With that in place we tested the whole thing **for
real against the live phone engine on this PC**:

### Milestone 11 — It actually works on the live phone engine
- The platform **wrote its settings into the engine's real config and reloaded**
  it — confirmed the files landed and the reload succeeded. ✓
- We created a desk phone (**extension 1051**) on the platform and then asked the
  phone engine directly *"do you know 1051?"* — it answered **yes**. A made-up
  number (9999) correctly came back **no**. So the platform genuinely provisions
  the phone system. ✓
- The **ring group** we created showed up in the engine's live call routing. ✓
- **Two advanced add-ons turned on:** the proper **call-queue engine
  (mod_callcenter)** and **answer-machine detection (mod_avmd)** are now loaded —
  so agent queues and smart dialing are available. The platform now **switches
  these on automatically** whenever it connects, so they survive restarts.

### What this means
Blocker #1 is **fully cleared**. Blocker #2 is **mostly cleared** — the two
important add-ons (queues + answer-machine detection) are live. The only piece
still missing on *this Windows PC* is the menu add-on (`mod_ivr`); IVR menus will
use a built-in workaround, and on the Ubuntu server this module is present anyway.

### Updated status

| Feature | Build + config | Live-verified on this PC |
| ------- | -------------- | ------------------------ |
| Extensions / SIP registration | ✅ | ✅ engine confirms the new extension |
| Trunks (carrier lines) | ✅ | ✅ applies + reloads (needs a real carrier to register) |
| Ring Groups | ✅ | ✅ present in live routing |
| Inbound Routes | ✅ | ✅ applied to live routing |
| Call Queues (ACD) | ✅ | ✅ queue engine loaded; call-flow wiring next |
| Answer-machine detection | ✅ available | ✅ module loaded |
| IVR menus | ✅ settings + storage | ⚠️ needs `mod_ivr` (Ubuntu) or built-in workaround |
| Time Conditions | ✅ settings + storage | ✅ applies (call-flow wiring next) |

**Still to do in Phase 1:** wire the *call-flow* generation for Queues and IVR
(the settings are stored; next we generate their live call routing). Everything
else in Phase 1 is built and proven live.

---

## ✅ Milestone 12 — Queues and IVR menus wired and proven live (Phase 1 complete)

The last two pieces are done and tested on the live engine:

- **Call Queues (ACD):** creating a queue on the platform now builds a real
  call-centre queue in the engine **and** signs its agents in. We created queue
  **2500** with agents **1051** and **1000**, hit Sync, and asked the engine: it
  reports the queue live with both agents tiered in and **"Ready"**. ✓
  - (Behind the scenes this meant teaching the engine where to find our queue
    list and adding the agents at runtime — all automatic now.)
- **IVR menus:** because this PC's menu add-on (`mod_ivr`) won't load, we built
  IVR a different way using the always-present toolkit — it **answers, plays the
  greeting, collects a keypress, and routes** to the chosen option. We created a
  menu (**3000**, "press 1 → queue, press 2 → ring group") and confirmed the
  engine loaded the menu and its options into live call routing. ✓
- **Time Conditions** (business-hours routing) also generate into live routing. ✓

### Phase 1 — DONE

| Feature | Live-verified on the engine |
| ------- | --------------------------- |
| Extensions / SIP registration | ✅ |
| Trunks (carrier lines) | ✅ (registers once a real carrier is set) |
| Ring Groups | ✅ |
| Inbound Routes | ✅ |
| IVR menus | ✅ (via built-in workaround) |
| Call Queues (ACD) + agents | ✅ |
| Answer-machine detection | ✅ module loaded (used later by the dialer) |
| Time Conditions | ✅ |

**One honest note / small future refinement:** when you *delete* a queue, the
platform stops generating it, but the engine keeps the already-loaded queue/agents
in memory until it restarts (our sync currently *adds* live call-centre state but
doesn't *remove* it). Harmless, and easy to tighten later.

**Demo data left in place:** extension **1051**, ring group **2000**, inbound
route **08001234567**, queue **2500**, and IVR **3000** are real, working examples
you can keep, edit, or delete from the platform.

**Phases 0 and 1 are complete.** Next up (when you say so) is **Phase 2**: the
in-browser softphone and the agent workspace.

---

# Phase 2 — In-browser softphone + Agent workspace

Goal: let an agent **make and take calls inside the web app itself** — no separate
desk-phone program — with a proper agent screen (status, dial pad, answer/hang-up,
mute, hold, keypad). This is the feature that turns the product from "a settings
panel" into a real contact-centre agent experience.

### How it works (in plain words)
Modern browsers can carry phone calls directly (the same tech behind Google Meet /
WhatsApp web). The agent's browser talks to the phone engine over a secure web
connection; when they click **Call** or **Answer**, the audio flows through the
browser. The platform hands the browser everything it needs to "log its phone in"
(which extension, the engine's address), so the agent just enters their extension
and clicks **Go online**.

### Milestone 13 — The phone engine is ready for browser calls
- Checked the engine and found it's **already listening for browser phone
  connections** (on the web-call ports). No change needed.
- **Proved it for real:** opened a live web connection to the engine from a test
  and it completed the handshake speaking the phone language ("sip"). So the path
  the agent's browser will use is confirmed open and working. ✓

### Milestone 14 — The platform hands the browser its phone details
- Built the part of the platform that, for a signed-in agent, returns exactly what
  their browser needs to register their extension (which line, the engine address,
  the secure settings). Tested: asking for extension **1051** returns correct,
  complete details. ✓
- Built **agent status** controls — an agent can set themselves **Available**, **On
  Break**, or **Logged Out**, and this updates the live call-queue engine. Tested:
  set 1051 to Available → the queue engine shows 1051 and 1000 **Available /
  Waiting**, ready to receive queued calls. ✓
- Built **supervisor monitoring** (listen / whisper / barge) into the new backend.

### Milestone 15 — The actual web app (new, modern front-end)
- Started the **new web application** using the agreed modern toolkit
  (**Next.js / React**) — this is the proper, maintainable front-end that will grow
  into the full platform.
- Built a **Sign-in page** and the **Agent Workspace** screen with a working
  **softphone**: enter your extension → **Go online** (registers your phone in the
  browser) → set your status, **dial** any number/queue/IVR, **answer** incoming
  calls (with a screen-pop showing who's calling), and during a call use
  **mute, hold, a dial-pad (DTMF), and hang-up**, with a live call timer.
- **Verified:** the whole web app **builds cleanly** and **runs** — the sign-in
  page loads and works, and all screens compile. ✓

### What still needs a human to confirm (and one production note)
- **The actual two-way audio call** can only be confirmed by a person: open the
  app in a browser, allow the microphone, go online as 1051, and call another
  extension/queue (with someone/something on the other end). The plumbing is all
  built and the connection path is proven; a real voice test just needs hands +ears.
- **Production note (a "you provide" item):** browsers only allow in-page calls on
  **secure (HTTPS)** sites. On this PC `localhost` counts as secure, so it works
  for testing now. On the real server you'll need a **domain name + security
  certificate (HTTPS/WSS)** — already on the list of things only you can provide.

### How to try it now (manual test)
1. Make sure the API (port 4000) and web app (port 3001) are running, and a few
   extensions exist (1051 is set up).
2. Open **http://localhost:3001**, sign in with your admin email + password.
3. On the Agent screen, enter extension **1051**, click **Go online**, allow the
   microphone.
4. Dial **1000** (or **2500** for the queue, **3000** for the IVR) and connect a
   second softphone/extension on the other side to talk.

### Phase 2 status

| Piece | Status |
| ----- | ------ |
| Engine ready for browser calls (WS) | ✅ verified (live handshake) |
| Softphone config handed to browser | ✅ verified |
| Agent status (Available/Break/Logout) | ✅ verified against queue engine |
| Supervisor listen/whisper/barge | ✅ built |
| New web app (Next.js/React) + sign-in | ✅ builds & runs |
| Agent softphone (call/answer/mute/hold/DTMF) | ✅ built; ⏳ needs a human voice test |
| SIP fallback (desk softphones still work) | ✅ unchanged from Phase 1 |
| Production HTTPS/WSS | ⛔ needs your domain + certificate |

---

# Phase 3 — Contact Center & Dialer (depth)

Goal: turn the old "play-a-recording" dialer into a **real contact centre** where
the system phones a list of people and, **when a person answers, connects them to
a live, available agent** — plus do-not-call protection, automatic retries,
call outcomes (dispositions), and proper records for reporting. All rebuilt on
the new, enterprise stack (database-backed, not text files).

### Milestone 16 — Proper database tables for the contact centre
- Added real, first-class tables for **Dispositions** (call outcomes),
  **Do-Not-Call list**, **Lead Groups** and **Leads** (the people to call),
  **Outbound Campaigns** (with full dialer settings), **Call Attempts** (a record
  of every dial — the basis for reporting), and **Callbacks**. Everything is
  per-company.

### Milestone 17 — The new dialer engine (the big upgrade)
Built a brand-new dialer on the new stack. What it does on each number:
- **Skips Do-Not-Call numbers** automatically.
- **Phones the number**, and on answer either **connects the person to a live
  agent via the call-queue** (the new "agent mode" — real contact-centre
  behaviour) **or** plays a recording (the old "broadcast mode") — depending on
  the campaign.
- **Retries** numbers that were busy / no-answer, up to a limit.
- **Records** the call (optional), assigns an **outcome (disposition)**, and
  **saves every attempt to the database** for reporting.
- Dials **several lines at once** for the faster methods (progressive/power).

**Tested live against the phone engine:**
- Built a "Progressive" campaign pointed at queue **2500**, with a DNC number and
  two extensions, then started it. The engine confirmed: **agent mode** active,
  the **DNC number skipped**, an unregistered extension correctly **failed**
  ("USER_NOT_REGISTERED"), a no-answer correctly **scheduled a retry**, and **every
  attempt was saved to the database**. ✓

### Milestone 18 — Reports now read real data
- The **Campaign Report** and **Call Records (CDR)** now read straight from the
  saved call attempts. Tested: the report correctly showed the test campaign with
  its dialled count, attempts, and failures. ✓

### What's done vs. still to come in Phase 3

| Piece | Status |
| ----- | ------ |
| Contact-centre database tables | ✅ |
| Dialer: DNC, retries, dispositions, recording | ✅ live-verified |
| Dialer: connect answered calls to a live agent (ACD) | ✅ live-verified (command + mode); full voice path needs a registered agent to answer |
| Save every attempt to the database | ✅ |
| Campaign Report + CDR from the database | ✅ |
| Real-time dashboard (live agents/queues/campaign) | ✅ live WebSocket, verified |
| Recordings: store & play back from the app | ✅ stored on the server + playable in-app (object storage later) |
| Agent-performance report | ✅ live per-agent stats |
| Contact-centre screens in the new web app | ✅ Live dashboard + Campaigns (dialer runner) |

> **Note:** as with earlier phases, a *full* live voice test (a real person
> answering and being connected to an agent) needs a registered softphone on the
> other end — the engine commands and call flow are built and proven; only the
> human voice leg remains.

> **Demo data left in place:** a "Phase3 Progressive" campaign and a DNC entry,
> so the reports show real numbers. Delete anytime.

### Milestone 19 — Live dashboard, agent performance & contact-centre screens (Phase 3 complete)

- **Live dashboard (real-time):** built a constant live feed from the phone engine
  — a supervisor screen that updates every couple of seconds showing **active
  calls, agents (with status), queues, and any running campaigns**, plus
  **listen / whisper / barge** buttons on each live call. Proven: a test client
  connected and received live snapshots; an unauthorised client was correctly
  refused. ✓
- **Agent-performance report:** live per-agent figures (calls answered, talk time,
  status) straight from the queue engine. Tested. ✓
- **New web screens:** added to the modern web app — a **Live Dashboard** page and
  a **Campaigns** page where you create a campaign, press **Dial**, and watch each
  number progress in real time (status, attempts, outcome) with a dropdown to set
  the call's disposition. The whole app **builds and serves** cleanly. ✓

### Phase 3 — DONE

Everything in Phase 3 is built and verified to the extent the local setup allows
(the only thing needing a human is a real two-way voice call with someone
answering). Contact-centre tables, the agent-bridging dialer, DNC/retries/
dispositions, recordings on the server, reports from real data, the real-time
dashboard, and the new web screens are all in place.

**Next (Phase 4):** the Omnichannel Inbox foundation (SMS / WhatsApp / email in
one conversation view).

---

# Phase 4 — Omnichannel Inbox (foundation)

Goal: one shared **inbox** where every customer conversation lives — whether it
came in by **SMS, WhatsApp, email, web chat, or voice** — handled by agents like
a help-desk (the "Intercom" part of the vision). The plan was to build the
**channel-agnostic core now** and switch each channel on as its provider account
arrives.

### Milestone 20 — One inbox for every channel
- Added the shared building blocks: **Contacts** (the customer), **Conversations**
  (a thread on any channel), **Messages** (each reply or internal note), and
  **Canned Responses** (saved quick replies). Everything per-company.
- Built the inbox engine: **list conversations**, **open a thread**, **reply**,
  **add internal notes** (only staff see these), **assign** a conversation to a
  teammate, and **change its status** (open / pending / snoozed / closed).
- Built a **"front door" for incoming messages** (a webhook): when a provider
  delivers an inbound message it finds-or-creates the customer and drops the
  message into the right conversation. (This is also how we test it today.)

### Milestone 21 — The "plug in a channel later" design
- Each channel plugs into a common **socket** (adapter). **Web chat / internal**
  work fully now. **SMS, WhatsApp and email** are wired as **placeholders**: if an
  agent sends on one of those before its account is connected, the message is
  **safely queued** (never lost) with a clear note saying which account is still
  needed — exactly the "build now, light up when you provide the account" plan.

### Milestone 22 — The Inbox screen
- Added an **Inbox page** to the web app: conversation list on the left
  (with a colour tag per channel), the full thread on the right, a reply box with
  an **internal-note** toggle, and a status selector — a clean help-desk layout.

### Tested (for real)
- Simulated an **inbound SMS** → it created the customer "Ada" and a new
  conversation. ✓
- Agent **replied** → because SMS isn't connected yet, it was correctly **queued**
  with the note "SMS provider not connected (provide a Termii/Twilio account)". ✓
- **Internal note**, **assign**, and **status change** all worked; the thread shows
  the full timeline. ✓
- The web app **builds** and the Inbox page **serves**. ✓

### What you must provide to switch channels on (only you can)
| Channel | Needs |
| ------- | ----- |
| SMS | an SMS gateway account (e.g. **Termii** or **Twilio**) |
| WhatsApp | **WhatsApp Business API** approval (Meta) — slow, start early |
| Email | **SMTP / email provider** credentials |

Once you hand over any of these, switching that channel from "queued" to "live
sending" is a small, contained change — the inbox, threads, and screens stay the
same.

### Phase 4 status

| Piece | Status |
| ----- | ------ |
| One inbox model (contacts/conversations/messages) | ✅ |
| Reply, internal notes, assign, status | ✅ verified |
| Incoming-message webhook (find/create conversation) | ✅ verified |
| Channel "plug-in" design (adapters) | ✅ web chat live; SMS/WhatsApp/email queue |
| Inbox screen in the web app | ✅ builds & serves |
| SMS / WhatsApp / email actually sending | ⛔ needs your provider accounts |

---

# Phase 5 — Multi-tenant SaaS (activation)

Goal: turn the platform from "one company's system" into a **product you can sell
to many companies**, each with its own walled-off data — plus the business plumbing
to run it: **plans, billing, usage limits, branding, and a platform control room**.
(The foundation was already built tenant-aware in Phase 0, so this switches it on.)

### Milestone 23 — A control room for you (the platform owner)
- Added a **super-admin** level (above all companies) — that's you, Tech4mation.
- Built **tenant onboarding**: create a new customer company in one step — it spins
  up the company, its first admin login, and an admin role automatically.
- Built **suspend / re-activate** for any company, and a **plan picker** per company.

### Milestone 24 — Plans, usage & billing
- **Plans** (e.g. Starter, Business) each with a monthly price and **limits**
  (how many extensions, how many simultaneous calls, how many campaigns).
- **Usage metering**: the system counts each company's real usage (extensions,
  agents, campaigns, calls this month).
- **Invoices**: generate a monthly invoice from a company's plan.
- **Payments**: built the **payment "socket"** (Paystack / Flutterwave). Until you
  connect a payment account, an invoice can be paid **manually**; once you add the
  keys, the same Pay button takes the customer to real online checkout.
- **Limits are enforced**: e.g. a campaign can't dial more lines at once than the
  company's plan allows (we cap it automatically).

### Milestone 25 — Branding & the web screens
- Each company has its own **branding** (name, colour) — the app reads it and
  themes itself (so a customer sees their own brand, not "nativetalk").
- New web screens: a **Platform** console (only you see it) listing every company
  with status, plan, and usage, plus an **Onboard tenant** button; and a **Billing**
  page (for each company) showing their plan, usage bars, and invoices.

### Tested (for real)
- Created two plans, **onboarded a brand-new company "Acme Calls"** with its own
  admin and the Business plan. ✓
- **Acme's admin can log in** and sees **only Acme's data** (0 extensions) while
  Tech4mation sees its own — proper isolation. ✓
- **Acme's admin is correctly blocked** from the platform control room (that's
  super-admin only); Tech4mation is allowed. ✓
- Billing showed Acme on the Business plan with the right limits & usage; an
  **invoice generated (₦50,000)**, and "Pay" correctly fell back to **manual**
  with the note "Paystack not connected". ✓
- The web app builds; the **Platform** and **Billing** pages serve, and login now
  tells the app whether you're a super-admin. ✓

### What you must provide to take payments (only you can)
- A **Paystack** or **Flutterwave** merchant account (API keys). Drop them in and
  online checkout goes live with no other change.

### Phase 5 status

| Piece | Status |
| ----- | ------ |
| Super-admin + tenant onboarding | ✅ verified |
| Tenant isolation (separate data per company) | ✅ verified |
| Plans + usage metering + limits enforcement | ✅ verified |
| Invoices | ✅ verified |
| Payments (online checkout) | ⛔ needs your Paystack/Flutterwave keys (manual works now) |
| Per-tenant branding | ✅ app themes from it |
| Platform console + Billing screens | ✅ build & serve |

**That completes Phases 0–5** — the platform is now a multi-tenant, voice-first
unified-communications product with a cloud PBX, contact centre, omnichannel
inbox, and SaaS billing. Remaining before going live is mostly **your** items
(carrier trunk for real outbound, domain + HTTPS, provider accounts) and
**Phase 6 hardening** (security review, monitoring, separated infrastructure).

---

# Phase 6 — Hardening & go-live prep

Goal: make the platform safe, observable, and easy to deploy/operate — the
"ready for the real world" pass.

### Milestone 26 — Locking it down (security)
- **Brute-force protection:** login is limited to 8 tries a minute (and the whole
  API to 120/min) per address — attackers can't hammer passwords.
- **Security headers** added to every response (the browser-protection headers
  professional sites use).
- **Locked the doors (CORS):** the API now only accepts requests from your own web
  address, not any website.
- **No leaks:** errors return a clean message; internal details/stack traces are
  never shown to users in production (but are logged for you).
- **Safety catch:** the app **refuses to start in production** if the security key
  (JWT secret) was left at the insecure default.
- Tested: rapid logins correctly got blocked (rate-limited), and all the security
  headers are present. ✓

### Milestone 27 — Seeing what's happening (observability)
- **Metrics:** a `/metrics` feed (industry-standard Prometheus format) tracking
  request counts/speeds and system health — plug into a dashboard (Grafana).
- **Health probes:** `/health/live` (is it up?) and `/health/ready` (can it serve?)
  so an orchestrator can auto-restart/route correctly.
- Tested: metrics feed and both probes respond correctly. ✓

### Milestone 28 — Easy, repeatable deployment
- **Containerised** both the API and the web app (Docker), plus a **one-command
  full stack** (`docker-compose.full.yml`) that brings up database, cache, API and
  web together — with FreeSWITCH kept on its own machine (as planned). The API
  even runs database migrations automatically on start.
- Verified the stack definition is valid. ✓

### Milestone 29 — Backups & the operator's manual
- **Nightly database backup** script (keeps 14 days) + restore instructions.
- **Operations Runbook** — how to deploy, the settings to set, monitoring, scaling,
  backups, and a "what to check when X breaks" table.
- **Security Checklist** — what's already handled vs. the steps only you can do
  before launch.

### What only you can do to finish go-live
- An **independent penetration test / security review**.
- **Domain + TLS certificate** (HTTPS for the site, WSS for in-browser calls).
- **Rotate all secrets** to strong values; **firewall the SIP ports** (your logs
  showed active scanning).
- **Cloud accounts** for the separated production servers + managed database, and
  schedule the backup + do a test restore.

### Phase 6 status

| Piece | Status |
| ----- | ------ |
| Rate limiting / brute-force protection | ✅ verified |
| Security headers (Helmet) + CORS lockdown | ✅ verified |
| Clean error handling (no leaks) + prod secret check | ✅ |
| Metrics (/metrics) + health probes | ✅ verified |
| Dockerfiles + full-stack compose | ✅ valid |
| Backup script + Runbook + Security Checklist | ✅ |
| Pen-test, TLS, secret rotation, prod infra | ⛔ your items (documented) |

**Phases 0–6 are complete.** The platform is feature-complete and hardened; what
remains to actually launch is the set of external/business items above (carrier,
domain, certificates, accounts, pen-test) — the things only you can provide.

---

# User roles & access (four account types)

Goal: make the platform enforce **four kinds of users**, each seeing only what
they should:

| Role | Who | Can do |
| ---- | --- | ------ |
| **Super-Admin** | Tech4mation (you) only | Everything, **including** the multi-company control room |
| **Admin** | The person who signs a company up (and anyone they promote) | Everything for **their own company**; can create agents, managers, and other admins; **no** multi-company access |
| **Manager** | Created by an admin | Exactly the permissions the admin grants them — nothing more |
| **Agent** | Company front-line staff | **Calls + contacts only** — make/receive calls, manage company contacts, set their own status; **blocked** from settings, campaigns, billing, team management, and anything multi-company |

### Milestone 30 — Real role-based access

- Added a proper **role** to every login account (agent / manager / admin), with
  **super-admin** as a separate cross-company flag.
- The system now **enforces** access on **every** request:
  - **Agents** are locked down to their allowed features (calls + contacts) and
    refused everything else.
  - **Managers** get exactly what an admin granted them.
  - **Admins** get everything for their own company.
  - **Super-admins** also get the multi-company control room.
  - **Only admins can create admins.**
- The **menu adapts to the role** — an agent sees just **Phone, Inbox, Contacts**;
  an admin sees the full menu; only a super-admin sees **Platform**. After signing
  in, agents land on the Phone screen, everyone else on the live dashboard.
- New **Contacts** screen (agents + everyone) and a backend for admins to create
  accounts of any role. (The existing **Agents** screen manages desk-phone
  extensions; an agent needs both a login **and** an extension to take calls.)

### Tested (for real) — the access matrix

Created **two test accounts for each role** and checked every route. Results were
exactly right:

| Route | Agent | Manager | Admin | Super |
| ----- | :---: | :-----: | :---: | :---: |
| Contacts / Softphone | ✅ | ✅ | ✅ | ✅ |
| Campaigns / Reports / Billing | ⛔ | ✅ | ✅ | ✅ |
| Team accounts | ⛔ | ⛔ | ✅ | ✅ |
| Platform (multi-company) | ⛔ | ⛔ | ⛔ | ✅ |

### Test logins (password for all: `Test@12345`)
- **Super-Admin:** `superadmin1@nativetalk.test`, `superadmin2@nativetalk.test`
- **Admin:** `admin1@test.test`, `admin2@test.test`
- **Manager:** `manager1@test.test`, `manager2@test.test`
- **Agent:** `agent1@test.test` (ext 1051), `agent2@test.test` (ext 1000)

(The original `admin@tech4mationlimited.com` / `Admin@12345` remains the main
super-admin.)
