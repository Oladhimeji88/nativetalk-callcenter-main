# Tenants Table — Field Reference

The `tenants` table is the root of multi-tenancy in the platform. **One row = one
organization (a customer company).** Almost every other table carries a
`tenantId` pointing back here, which is how data is kept isolated between
companies.

This document explains every field defined on the `Tenant` model in
`apps/api/prisma/schema.prisma`.

> **Important distinction:** Only the **scalar columns** below physically exist as
> columns in the `tenants` table. The **relations** listed further down are *not*
> columns here — they are links Prisma exposes for convenience, but the actual
> foreign keys live on the other tables (each child row stores a `tenantId`).

---

## Actual columns in the `tenants` table

| Column | Type | Required | Default | What it means |
|---|---|---|---|---|
| `id` | String (CUID) | Yes | auto-generated | Primary key. A unique, collision-resistant ID created automatically when the organization is onboarded. Used everywhere as `tenantId`. |
| `name` | String | Yes | — | The organization's display name (e.g. "Acme Contact Centre"). Shown in the platform console and used as the default branding name. |
| `slug` | String | Yes (unique) | — | A URL-safe short identifier derived from the name (e.g. `acme-contact-centre`). Must be unique across all tenants. Used for per-tenant branding lookups on the login page and tenant-specific URLs. |
| `active` | Boolean | Yes | `true` | Master on/off switch for the organization. When `false`, the tenant is treated as disabled. Kept in sync with `status` (suspending sets this to `false`). |
| `status` | String | Yes | `"active"` | Lifecycle state of the account. Expected values: **`trial`** (evaluating), **`active`** (live, paying), **`suspended`** (disabled, e.g. for non-payment). Drives access and billing behaviour. |
| `planId` | String (nullable) | No | `null` | Foreign key to the `plans` table — which subscription plan this organization is on. `null` means no plan assigned yet. If the plan is deleted, this is set back to `null` (SetNull). |
| `limits` | JSON (nullable) | No | `null` | Per-tenant **overrides** of the plan's limits. Shape: `{ maxExtensions, maxConcurrentCalls, maxCampaigns }`. When set, these take precedence over the plan's defaults — used to give a specific customer a custom cap. `null` means "use the plan's limits". |
| `branding` | JSON (nullable) | No | `null` | White-label appearance for this organization. Shape: `{ name, logoUrl, color }`. Used to theme the login page and UI per tenant. Defaults to `{ name }` at onboarding. |
| `createdAt` | DateTime | Yes | now() | Timestamp the organization was created. Set automatically. |
| `updatedAt` | DateTime | Yes | auto | Timestamp of the last change to this row. Updated automatically on every write. |

---

## Relations (not columns on this table)

These appear on the `Tenant` model so you can navigate from a tenant to its
related records, but the foreign key (`tenantId`) is stored on the **child**
table, not here. They are listed for completeness.

| Relation | Points to | Meaning |
|---|---|---|
| `plan` | `plans` | The plan referenced by `planId` (the one real outbound FK). |
| `subscriptions` | `subscriptions` | Billing subscription history for this org. |
| `invoices` | `invoices` | Invoices generated for this org. |
| `managerRoles` | `manager_roles` | Named RBAC permission sets (roles) defined for this org. |
| `managers` | `managers` | Back-office / admin users of this org. |
| `userRoles` | `user_roles` | Roles assignable to agent-level users. |
| `userGroups` | `user_groups` | Groupings of users. |
| `users` | `users` | Agent-level user accounts. |
| `outgoingRules` | `outgoing_rules` | Outbound call routing rules. |
| `dataRecords` | `data_records` | Generic per-tenant data records. |
| `auditLogs` | `audit_logs` | Audit trail of actions in this org. |
| `extensions` | `extensions` | SIP/phone extensions provisioned for this org. |
| `trunks` | `trunks` | SIP trunks (carrier connections). |
| `ringGroups` | `ring_groups` | Groups of extensions that ring together. |
| `inboundRoutes` | `inbound_routes` | Rules mapping incoming numbers (DIDs) to destinations. |
| `ivrs` | `ivrs` | Interactive voice menus. |
| `queues` | `queues` | Call-centre queues. |
| `timeConditions` | `time_conditions` | Time-of-day routing conditions. |
| `dispositions` | `dispositions` | Call outcome / wrap-up codes. |
| `dncEntries` | `dnc` | Do-Not-Call list entries. |
| `leadGroups` | `lead_groups` | Groupings of dialer leads. |
| `leads` | `leads` | Outbound dialer leads. |
| `campaigns` | `outbound_campaigns` | Outbound dialing campaigns. |
| `callAttempts` | `call_attempts` | Individual outbound call attempts. |
| `callbacks` | `callbacks` | Scheduled callbacks. |
| `contacts` | `contacts` | CRM contacts. |
| `conversations` | `conversations` | Omnichannel inbox conversations. |
| `messages` | `messages` | Individual messages within conversations. |
| `cannedResponses` | `canned_responses` | Saved reply templates for the inbox. |

---

## How a tenant is created

New organizations are created by a platform super-admin via
`POST /platform/tenants` (`onboardTenant` in `billing.service.ts`), which sets
`name`, `slug`, `status: "active"`, an optional `planId`, and a default
`branding` of `{ name }`. It also creates the first "Administrator" role and the
first admin user for the organization.
