# NativeTalk Call Center — Database Documentation

**Engine:** PostgreSQL 16  
**ORM:** Prisma  
**Schema file:** [apps/api/prisma/schema.prisma](../apps/api/prisma/schema.prisma)  
**Migrations:** `apps/api/prisma/migrations/`

---

## Design principles

### Multi-tenancy (row-level isolation)

Every business table carries a `tenantId` column. The API layer adds this to
every query automatically from the JWT payload — there is no way for one
tenant to read or write another tenant's data through the API.

The `Tenant` row is the root of the entire data hierarchy. Deleting a tenant
cascades to every related record.

### IDs: CUID

All primary keys use `cuid()` — collision-resistant, URL-safe, sortable by
creation time. Never expose auto-increment integers to clients.

### Soft vs hard deletes

Most records use an `active: Boolean` flag rather than hard deletes. This
preserves historical context (e.g. a deleted extension still appears in CDRs).
The `Dnc` (Do Not Call) table is an exception — entries are hard-deleted when
a number is removed from the list.

### Audit trail

Every state-changing operation writes an `AuditLog` row: who did it, what
entity was changed, and a JSON snapshot of the change. This is non-negotiable
for a contact center platform used in regulated industries.

### JSON columns

Some fields use `Json` type for structured data where the shape varies or
evolves (IVR options, ring group members, plan limits, branding). These are
always documented in schema comments and should be replaced with proper
relational columns when the shape stabilises.

---

## Entity map

```
Tenant
  ├── Account (unified account — agent, supervisor, admin all use this)
  │    └── Role (RBAC role — isSystem roles are protected)
  │
  ├── Cloud PBX
  │    ├── Extension (SIP device registration)
  │    ├── Trunk (carrier SIP gateway)
  │    ├── RingGroup (multiple extensions ring together)
  │    ├── InboundRoute (DID → destination)
  │    ├── Ivr (IVR menu)
  │    ├── Queue (ACD call queue)
  │    └── TimeCondition (business hours routing)
  │
  ├── Contact Center
  │    ├── Disposition (call outcome codes)
  │    ├── Dnc (Do Not Call list)
  │    ├── LeadGroup → Lead (prospect lists)
  │    ├── OutboundCampaign → CallAttempt (dialing history)
  │    └── Callback (scheduled follow-ups)
  │
  ├── Contact (customer record — used by campaigns and agents)
  │
  ├── Billing
  │    ├── Plan (subscription tier definition)
  │    ├── Subscription (tenant ↔ plan link)
  │    └── Invoice
  │
  ├── DataRecord (JSON holdall for future collections)
  └── AuditLog (immutable event log)
```

---

## Tables

---

### Tenant

The root entity. One row per customer organisation (or per NativeTalk itself
in the case of the super-admin tenant).

| Column | Type | Notes |
|---|---|---|
| `id` | String (CUID) | PK |
| `name` | String | Display name, e.g. "Acme Corp" |
| `slug` | String | URL-safe unique identifier, e.g. "acme-corp" |
| `active` | Boolean | false = suspended, cannot log in |
| `status` | String | `trial` / `active` / `suspended` |
| `planId` | String? | FK → Plan |
| `limits` | Json? | Override plan limits: `{ maxExtensions, maxConcurrentCalls, maxCampaigns }` |
| `branding` | Json? | `{ name, logoUrl, color }` — white-label customisation |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

**Relationships:** Has many of every other entity in the system.

---

### Role

A named set of permissions. One role can be shared by many accounts within
a tenant. Three system roles (`Admin`, `Supervisor`, `Agent`) are seeded
automatically on tenant creation and cannot be edited or deleted. Any system
role can be cloned to create a custom role.

| Column | Type | Notes |
|---|---|---|
| `id` | String (CUID) | PK |
| `tenantId` | String | FK → Tenant (cascade delete) |
| `name` | String | e.g. "Admin", "Supervisor", "QA Lead" |
| `isSystem` | Boolean | `true` = seeded system role (cannot be edited or deleted) |
| `permissions` | Json | Full permission map (see shape below) |
| `active` | Boolean | |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

**Unique constraint:** `(tenantId, name)`  
**Index:** `tenantId`

**System roles seeded on tenant creation:**

| Role | isSystem | Default permissions |
|---|---|---|
| Admin | true | All permissions on |
| Supervisor | true | Softphone, contacts, live calls, queues, campaigns, recordings, analytics |
| Agent | true | Softphone, contacts only |

**Permissions JSON shape:**
```json
{
  "softphone":  { "enabled": true },
  "contacts":   { "enabled": true },
  "live":       { "enabled": true },
  "queues":     { "enabled": true },
  "campaigns":  { "enabled": true, "items": { "create": true, "delete": false } },
  "recordings": { "enabled": true },
  "analytics":  { "enabled": true },
  "pbx":        { "enabled": false },
  "users":      { "enabled": false },
  "billing":    { "enabled": false }
}
```

---

### Account

The single unified account model for everyone on the platform — agents,
supervisors, and admins all log in through this. What each person can see and
do is determined entirely by their `Role` permissions, not their account
type. There is no separate agent account model.

| Column | Type | Notes |
|---|---|---|
| `id` | String (CUID) | PK |
| `tenantId` | String | FK → Tenant (cascade delete) |
| `email` | String | Login email |
| `passwordHash` | String | bcrypt hash |
| `firstName` | String? | |
| `lastName` | String? | |
| `username` | String? | Optional display handle |
| `role` | String | `admin` / `supervisor` / `agent` — maps to a system role |
| `agentExtension` | String? | SIP extension number for agents taking calls |
| `roleId` | String? | FK → Role (set null on role delete) |
| `language` | String? | UI language preference |
| `allowMonitoring` | Boolean | Whether this account can be monitored by supervisors |
| `superAdmin` | Boolean | Cross-tenant platform operator flag |
| `active` | Boolean | false = cannot log in |
| `lastLoginAt` | DateTime? | Updated on each successful login |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

**Unique constraint:** `(tenantId, email)`  
**Index:** `tenantId`

---

### DataRecord

A JSON holding table for collections that don't yet have dedicated relational
models. Any new feature that stores structured data starts here; once the
schema stabilises it gets migrated to a proper table.

| Column | Type | Notes |
|---|---|---|
| `collection` | String | Logical name, e.g. "webforms", "canned-responses-v1" |
| `data` | Json | The record payload |

**Index:** `(tenantId, collection)`

---

## Cloud PBX tables

The Cloud PBX is the telephony infrastructure layer — everything needed to
register phones, connect to carriers, and route calls. When an admin creates
or modifies any of these records, the API generates FreeSWITCH XML
configuration from the database and applies it live (no server restart needed).
These tables define **how calls move** within the system — who can be reached,
through which carrier, and by what rules.

---

### Extension

A SIP device registration — the database record that FreeSWITCH's directory
XML is generated from. Each row corresponds to one entry in
`/etc/freeswitch/directory/default/<tenantId>/`.

| Column | Type | Notes |
|---|---|---|
| `id` | String (CUID) | PK |
| `tenantId` | String | FK → Tenant |
| `extension` | String | Dial number, e.g. `"1001"` |
| `password` | String | SIP registration password (stored plain — FreeSWITCH needs it in XML) |
| `displayName` | String? | Shown on phone screen |
| `context` | String | FreeSWITCH dialplan context, default `"default"` |
| `callerIdName` | String? | Outbound caller ID name |
| `callerIdNumber` | String? | Outbound caller ID number |
| `voicemail` | Boolean | Whether voicemail is enabled |
| `tollAllow` | String | Allowed call classes: `"domestic,local"` / `"international"` / etc. |
| `active` | Boolean | Inactive extensions are not written to the directory XML |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

**Unique constraint:** `(tenantId, extension)` — no two extensions can share
the same dial number within a tenant.  
**Index:** `tenantId`

> **Security note:** SIP passwords are stored in plaintext because FreeSWITCH's
> directory XML requires them readable. Ensure the database and FS config dir
> are protected by OS-level permissions.

---

### Trunk

An outbound SIP gateway to a carrier (Twilio, Vonage, local telco, etc.).
Multiple trunks per tenant are supported — failover routing between them is
handled in the dialplan.

| Column | Type | Notes |
|---|---|---|
| `name` | String | Sofia gateway name, used in dialplan: `sofia/gateway/<name>/` |
| `username` | String | Carrier account SIP username |
| `password` | String | Carrier SIP password |
| `proxy` | String | Carrier SIP host, e.g. `"sip.carrier.com"` |
| `realm` | String? | Authentication realm (if different from proxy) |
| `fromDomain` | String? | From header domain override |
| `register` | Boolean | Whether FreeSWITCH should register with this carrier |
| `callerId` | String? | Default outbound caller ID for this trunk |
| `active` | Boolean | |

**Unique constraint:** `(tenantId, name)`

---

### RingGroup

Dialling a ring group number causes multiple extensions to ring simultaneously
or sequentially. Common use: reception number that rings the whole front-desk team.

| Column | Type | Notes |
|---|---|---|
| `number` | String | The number callers dial to reach this group |
| `strategy` | String | `simultaneous` or `sequential` |
| `members` | Json | Array of extension numbers: `["1001", "1002", "1003"]` |
| `timeoutSec` | Int | Ring timeout per attempt |
| `failoverDest` | String? | Where to send the call if nobody answers |

**Unique constraint:** `(tenantId, number)`

---

### InboundRoute

Maps an inbound DID (Direct Inward Dialing number) to a destination.
This is the first decision point when a call arrives.

| Column | Type | Notes |
|---|---|---|
| `did` | String | The inbound number, e.g. `"+2348012345678"` |
| `destinationType` | String | `extension` / `ring-group` / `ivr` / `queue` / `voicemail` / `hangup` |
| `destination` | String? | Target number or name matching the destination type |

**Unique constraint:** `(tenantId, did)` — one DID maps to exactly one destination.

**Routing examples:**
```
+2348012345678 → ivr → "main-menu"
+2348087654321 → queue → "5000"
+2347011111111 → extension → "1001"
```

---

### Ivr

An IVR menu. The caller hears a greeting and presses a digit to be routed.

| Column | Type | Notes |
|---|---|---|
| `name` | String | Human label, e.g. "Main Menu" |
| `number` | String | Internal number used in routing rules |
| `greeting` | String | Path to the greeting audio file on the FS server |
| `timeoutSec` | Int | How long to wait for digit input |
| `options` | Json | Digit → destination map |
| `invalidDest` | String? | Where to send caller on invalid input |

**Options JSON shape:**
```json
{
  "1": { "type": "queue", "destination": "5000" },
  "2": { "type": "extension", "destination": "1005" },
  "0": { "type": "extension", "destination": "1000" }
}
```

---

### Queue

An ACD (Automatic Call Distribution) queue. Callers wait in the queue until
an available agent picks up. Backed by FreeSWITCH's `mod_callcenter`.

| Column | Type | Notes |
|---|---|---|
| `name` | String | e.g. "Sales Queue", "Support Tier 1" |
| `number` | String | Internal number used in routing |
| `strategy` | String | `ring-all` / `round-robin` / `longest-idle` / `sequential` |
| `moh` | String | Music on hold file or stream |
| `members` | Json | Array of agent extension numbers: `["1001", "1002"]` |
| `maxWaitSec` | Int | Maximum wait time before overflow/abandon |

**Ring strategies:**
- `ring-all` — all agents ring at once; first to answer gets the call
- `round-robin` — rotates through agents evenly
- `longest-idle` — routes to the agent who has been waiting the longest
- `sequential` — tries agents in order until one answers

---

### TimeCondition

Applies different routing based on time of day or day of week. Used to
implement business hours (send after-hours calls to voicemail or a message).

| Column | Type | Notes |
|---|---|---|
| `name` | String | e.g. "Business Hours" |
| `number` | String | Referenced in InboundRoute destinations |
| `ranges` | Json | Array of time windows |
| `matchDest` | String? | Destination when time matches (business hours) |
| `noMatchDest` | String? | Destination when time doesn't match (after hours) |

**Ranges JSON shape:**
```json
[
  { "wday": "2-6", "timeStart": "08:00:00", "timeEnd": "18:00:00" }
]
```
`wday` follows FreeSWITCH convention: 1 = Sunday, 7 = Saturday.

---

## Contact Center tables

The Contact Center layer sits on top of the Cloud PBX and adds the business
logic of running a call center operation. While the PBX tables define how
calls move, these tables define **what agents do with those calls** — which
leads to dial, in what order, how outcomes are recorded, and how campaigns
progress over time. The progressive dialer engine reads and writes almost
exclusively from this group of tables.

---

### Disposition

A call outcome code. Agents select a disposition during wrap-up after each call.
Dispositions drive analytics (conversion rate, callback rate, etc.) and
campaign logic (retry rules, success tracking).

| Column | Type | Notes |
|---|---|---|
| `name` | String | e.g. "Sale Made", "Callback Requested", "Wrong Number" |
| `code` | String? | Short code for reporting, e.g. "SALE", "CB", "WN" |
| `category` | String? | `Success` / `Failure` / `Callback` / `Retry` / `DNC` / `Neutral` |
| `color` | String? | Hex color for UI display |
| `active` | Boolean | |

---

### Dnc

The Do Not Call list. Before the dialer places any outbound call, it checks
this table. A match means the number is skipped and the lead marked `dnc`.

| Column | Type | Notes |
|---|---|---|
| `number` | String | The number in E.164 format |
| `reason` | String? | Why this number was added |
| `createdAt` | DateTime | |

**Unique constraint:** `(tenantId, number)` — no duplicates per tenant.

---

### LeadGroup

A named collection of leads. Think of it as a contact list or upload batch.
Campaigns target a LeadGroup.

| Column | Type | Notes |
|---|---|---|
| `name` | String | e.g. "Q1 Renewals", "Lagos Cold List" |

---

### Lead

An individual prospect. Part of a LeadGroup, dialled as part of a campaign.

| Column | Type | Notes |
|---|---|---|
| `tenantId` | String | FK → Tenant |
| `leadGroupId` | String? | FK → LeadGroup |
| `name` | String? | Contact name |
| `phone` | String | The number to dial |
| `extra` | Json | Additional fields from the CSV upload: `{ company, email, custom1, … }` |
| `status` | String | `new` / `dialed` / `answered` / `done` / `dnc` |
| `attempts` | Int | Number of dial attempts made |
| `lastDisposition` | String? | Disposition code from the last call |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

**Index:** `(tenantId, leadGroupId)`

**Status lifecycle:**
```
new → dialed (call placed) → answered (call connected)
                           → done (max attempts reached or success disposition)
                           → dnc (agent marked DNC during wrap-up)
```

---

### OutboundCampaign

A dialing campaign. Defines who to call, how to call them, and what to do
with the result.

| Column | Type | Notes |
|---|---|---|
| `name` | String | Campaign name |
| `dialMethod` | String | `Manual` / `Preview` / `Progressive` / `Power` / `VoiceBroadcast` |
| `outgoingRule` | String? | Which OutgoingRule to use for this campaign's calls |
| `gateway` | String? | Specific trunk name to dial through |
| `callerId` | String? | Caller ID presented to the called party |
| `queue` | String? | ACD queue number — answered calls are bridged here |
| `audioFile` | String? | Audio to play (VoiceBroadcast mode only) |
| `leadGroupId` | String? | The lead group to dial |
| `numbers` | String | Raw pasted numbers (merged with lead group at runtime) |
| `maxAttempts` | Int | Max dial attempts per lead before marking done |
| `concurrency` | Int | Max simultaneous outbound calls (Progressive mode) |
| `recording` | Boolean | Whether to record all calls in this campaign |
| `amd` | Boolean | Enable Answering Machine Detection (skip voicemails) |
| `successDisposition` | String? | Disposition code that marks a lead as successfully converted |
| `active` | Boolean | |

**Campaign lifecycle:**
```
draft → active → paused → active (resumable) → completed → archived
```

**Dial methods:**
- `Manual` — agent clicks to call each lead manually
- `Preview` — agent previews lead info, then confirms the dial
- `Progressive` — system dials automatically when an agent is available (1:1 ratio)
- `Power` — system dials at a higher ratio (e.g. 2 calls per available agent)
- `VoiceBroadcast` — plays a recorded message, no agent required

---

### CallAttempt

One row per dial attempt on a lead. The historical record of all outbound
call activity, feeding campaign analytics.

| Column | Type | Notes |
|---|---|---|
| `campaignId` | String? | FK → OutboundCampaign |
| `leadId` | String? | FK → Lead |
| `number` | String | The number that was dialled |
| `direction` | String | `outbound` (always for campaigns; `inbound` for future use) |
| `status` | String | `queued` / `dialing` / `answered` / `failed` / `skipped` / `machine` / `stopped` |
| `cause` | String? | FreeSWITCH hangup cause, e.g. `NORMAL_CLEARING`, `NO_ANSWER`, `USER_BUSY` |
| `disposition` | String? | Disposition code submitted by agent during wrap-up |
| `attempt` | Int | Which attempt number this is (1st, 2nd, etc.) |
| `agent` | String? | Extension or name of the agent who handled the call |
| `recording` | String? | Path or URL to the recording file |
| `durationSec` | Int | Total call duration in seconds |
| `startedAt` | DateTime | When the dial was initiated |
| `endedAt` | DateTime? | When the call ended |

**Index:** `(tenantId, campaignId)`

**Status meanings:**
- `queued` — waiting to be dialled by the progressive dialer
- `dialing` — FreeSWITCH originate command has been sent
- `answered` — the called party picked up
- `failed` — call failed to connect (busy, no answer, network error)
- `skipped` — skipped by AMD (answering machine detected)
- `machine` — answered by a machine but not skipped (left voicemail)
- `stopped` — campaign was paused while this call was queued

---

### Callback

A scheduled follow-up call created when a lead requests a callback.
The dialer prioritises callbacks over new leads when their `scheduledAt` time arrives.

| Column | Type | Notes |
|---|---|---|
| `campaignId` | String? | FK → OutboundCampaign |
| `number` | String | Number to call back |
| `scheduledAt` | DateTime | When the callback should be placed |
| `agent` | String? | Specific agent the lead requested (if any) |
| `notes` | String? | Agent notes for the callback |
| `done` | Boolean | Marked true once the callback has been dialled |

**Index:** `(tenantId, scheduledAt)` — dialer queries by time.

---

### Contact

A customer record. Used by agents for click-to-call and by campaigns as the
target of outbound dials.

| Column | Type | Notes |
|---|---|---|
| `name` | String? | Customer name |
| `phone` | String? | Primary phone number |
| `email` | String? | Email address |

**Index:** `tenantId`

---

## Billing tables

The billing layer handles NativeTalk's SaaS model — each company (tenant)
subscribes to a plan that determines what features and limits they get.
These tables are managed by the super admin for plan definitions, and by
the self-service signup and payment flows for subscriptions and invoices.
They have no relationship to call routing or agent operations — they exist
purely to model the commercial relationship between NativeTalk and its customers.

---

### Plan

A subscription tier available on the platform. Defined by the super admin.

| Column | Type | Notes |
|---|---|---|
| `name` | String (unique) | e.g. "Starter", "Professional", "Enterprise" |
| `priceMonthly` | Int | Price in minor currency units (kobo/cents) |
| `currency` | String | `NGN` / `USD` / etc. |
| `limits` | Json | `{ maxExtensions: 10, maxConcurrentCalls: 5, maxCampaigns: 3 }` |
| `features` | Json | Array of feature flags: `["progressive-dialer", "recording", "analytics"]` |
| `active` | Boolean | Inactive plans can't be subscribed to (but existing subscriptions continue) |

---

### Subscription

Links a tenant to a plan for a billing period.

| Column | Type | Notes |
|---|---|---|
| `tenantId` | String | FK → Tenant |
| `planId` | String | FK → Plan |
| `status` | String | `trialing` / `active` / `past_due` / `canceled` |
| `periodStart` | DateTime | Billing period start |
| `periodEnd` | DateTime | Billing period end (renewal date) |

**Index:** `tenantId`

---

### Invoice

One invoice per billing period per tenant.

| Column | Type | Notes |
|---|---|---|
| `periodStart` | DateTime | |
| `periodEnd` | DateTime | |
| `amount` | Int | Total in minor units |
| `currency` | String | |
| `status` | String | `open` / `paid` / `void` |
| `lineItems` | Json | Array of `{ description, quantity, unitPrice, amount }` |
| `provider` | String? | `paystack` / `flutterwave` |
| `providerRef` | String? | Payment gateway transaction ID |

---

## AuditLog

Immutable event log. Never updated or deleted — append-only.

| Column | Type | Notes |
|---|---|---|
| `tenantId` | String | FK → Tenant |
| `actorId` | String? | Account ID who performed the action |
| `actorEmail` | String? | Denormalised (survives account deletion) |
| `action` | String | Verb, e.g. `"campaign.created"`, `"extension.deleted"`, `"trunk.updated"` |
| `entity` | String? | Model name, e.g. `"OutboundCampaign"` |
| `entityId` | String? | The affected record's ID |
| `meta` | Json? | Before/after snapshot or relevant context |
| `createdAt` | DateTime | |

**Index:** `(tenantId, createdAt)` — the audit log UI sorts and paginates by time.

**Action naming convention:** `<entity>.<verb>` in lowercase snake_case:
```
manager.created
manager.password_reset
campaign.activated
campaign.paused
extension.created
extension.deleted
trunk.updated
ivr.updated
user.disabled
```

---

## Key indexes

| Table | Index columns | Purpose |
|---|---|---|
| All tables | `tenantId` | Tenant isolation — every query filters by this |
| `Role` | `(tenantId, name)` | Unique + lookup by name |
| `Account` | `(tenantId, email)` | Unique + login lookup |
| `Extension` | `(tenantId, extension)` | Unique + SIP directory lookup |
| `Trunk` | `(tenantId, name)` | Unique + provisioning lookup |
| `Queue` | `(tenantId, number)` | Unique + routing lookup |
| `InboundRoute` | `(tenantId, did)` | Unique + inbound routing |
| `Dnc` | `(tenantId, number)` | Unique + pre-dial DNC check |
| `Lead` | `(tenantId, leadGroupId)` | Dialer batch load |
| `CallAttempt` | `(tenantId, campaignId)` | Campaign analytics |
| `Callback` | `(tenantId, scheduledAt)` | Dialer time-based priority |
| `AuditLog` | `(tenantId, createdAt)` | Audit log pagination |
| `DataRecord` | `(tenantId, collection)` | Collection queries |

---

## Migration history

Migrations are tracked in `apps/api/prisma/migrations/` and applied in order:

| Migration | Description |
|---|---|
| `20260623134447_init` | Foundation: Tenant, Account, Role, DataRecord, AuditLog (originally named Manager/ManagerRole) |
| `20260623141133_pbx` | Cloud PBX: Extension, Trunk, RingGroup, InboundRoute, Ivr, Queue, TimeCondition |
| `20260623162525_contact_center` | Contact Center: Disposition, Dnc, LeadGroup, Lead, OutboundCampaign, CallAttempt, Callback |
| `20260623180100_omnichannel` | Contact table |
| `20260626161317_remove_omnichannel` | Drop Conversation, Message, CannedResponse tables |
| `20260623185002_saas_billing` | Billing: Plan, Subscription, Invoice |

**Run migrations:**
```bash
npm run db:migrate        # dev (creates migration files + applies)
npm run db:migrate:prod   # production (applies existing migrations only)
```

---

## Common query patterns

### Tenant-scoped list with pagination
```typescript
const campaigns = await prisma.outboundCampaign.findMany({
  where: { tenantId, active: true },
  orderBy: { createdAt: 'desc' },
  skip: (page - 1) * limit,
  take: limit,
});
```

### Pre-dial DNC check
```typescript
const blocked = await prisma.dnc.findUnique({
  where: { tenantId_number: { tenantId, number } },
});
if (blocked) { /* skip lead */ }
```

### Campaign analytics aggregation
```typescript
const stats = await prisma.callAttempt.groupBy({
  by: ['status'],
  where: { tenantId, campaignId },
  _count: { id: true },
  _avg: { durationSec: true },
});
```

### Next lead for progressive dialer
```typescript
const lead = await prisma.lead.findFirst({
  where: {
    tenantId,
    leadGroupId: campaign.leadGroupId,
    status: { in: ['new', 'dialed'] },
    attempts: { lt: campaign.maxAttempts },
  },
  orderBy: [
    { status: 'asc' },   // 'new' before 'dialed' (retries)
    { updatedAt: 'asc' }, // oldest first
  ],
});
```
