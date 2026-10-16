# VoipSwitch Trunk Provisioning (Phase 7)

Auto-provisions **one registering SIP trunk per tenant** on the VoipSwitch carrier
at signup. Model: **one tenant = one VoipSwitch retail client = one trunk**,
authenticated by a unique SIP login/password (register auth).

## ✅ Validated working recipe (a live PSTN call completed end-to-end, 2026-06-30)

The exact configuration that produces a working trunk — all baked into the code and
`.env.example`:

| Ingredient | Value | Why |
|---|---|---|
| Account type | **retail** (`clientType 32`) | the registering type here (wholesale clients don't register) |
| Reseller | **`-1`** (master) | sub-resellers' tariffs lack outbound routes → `402` |
| Tariff | NGN `ST_*` (e.g. `ST_12`=40) | has live Nigerian termination routes |
| Tech-prefix | **`CP:!<DID national>;DP:0->3344`** | `CP` = caller-id; `0->3344` = carrier route selector |
| Dialing | **national `0…`** (FreeSWITCH normalises E.164→national) | the `0->3344` rule keys off the leading `0` |
| Auth | register (unique login/password) | |
| FreeSWITCH | profile bound to the **real/public IP** (not `127.0.0.1`) | a loopback bind reports every REGISTER as a self-generated `503` |

## Flow

```
Signup (registerTenant / onboardTenant)
  → VoipswitchService.provisionTrunk()         create registering retail trunk
      → admin.client.check.login               pick a free SIP login
      → admin.retail.create                    retail, reseller -1, ST_* tariff → { idClient }
      → admin.did.local.number.list/.save      allocate a DID from the pool (caller-id)
      → admin.client.techprefix.set            CP:!<DID>;DP:0->3344  (caller-id + route selector)
      → admin.client.ani.add                   authorise the DID as caller-id
      → admin.payment.add (if starter credit)  fund so trials can call immediately
  → prisma.trunk.create()                       store login/password/proxy/callerId + providerClientId
                                                (gateway NAME = login, unique per tenant)
  → PbxService.safeSync()                        write sofia gateway + outbound route → FS rescan
```

The outbound dialplan (FsProvisioningService) routes external numbers out via the
tenant's gateway, normalising E.164/00-intl/bare input to national `0…` form.

Suspend/activate a tenant (`/platform/tenants/:id/suspend|activate`) mirrors to the
carrier via `admin.client.status.set`.

**Best-effort by design:** a carrier or FreeSWITCH outage never fails signup — the
tenant is created without telephony and logged; an admin can re-provision later
(add a Trunk under PBX → Trunks, or re-run onboarding).

## API contract (PortalAdmin WebAPI — ServiceStack)

- Endpoint: `POST {VOIPSWITCH_API_URL}/json/syncreply/{operation}?format=json`
- Auth header: `Authorization: Basic base64( "{adminLogin}#admin" : SHA1hex({adminPassword}) )`
- Errors: ServiceStack returns a `responseStatus` object (`errorCode`, `message`).

| Operation | Request | Response |
|---|---|---|
| `admin.client.check.login` | `{login}` | `{isUsed}` |
| `admin.wholesale.clients.create` | `{login,password,webPassword,eMail,tariffId,accountState,iPs:[],callsLimit,callsPerSecondLimit,...}` | `{idClient,login,...}` |
| `admin.client.ani.add` | `{idClient,clientType,aniNumber:{phoneNumber,isDef}}` | `{aniNumbers}` |
| `admin.client.status.set` | `{active,clientId,clientType}` | — |
| `admin.tariffs.list` | `{name,currencyId,pageOffset,pageSize}` | `{tariffs:[{id,description,...}]}` |

## Configuration

See `apps/api/.env.example` (`VOIPSWITCH_*`). With these unset the feature is dormant.

## Live validation status (against 37.9.63.182, 2026-06-26)

Validated end-to-end with admin credentials by creating/operating a throwaway client:

| Item | Result |
|---|---|
| Admin auth encoding | ✅ **`SHA1hex(password)`** (lowercase hex) — as coded |
| `clientType` (wholesale) | ✅ **`0`** (retail clients are `32`) |
| `admin.client.check.login` | ✅ `{isUsed}` |
| `admin.wholesale.clients.create` | ✅ returns `{idClient}` |
| `admin.client.ani.add` / `ani.delete` | ✅ |
| `admin.client.status.set` (suspend/activate) | ✅ |
| `admin.payment.add` (starter credit) | ✅ DTO validated (`{money,paymentType:"PrePaid",idClient,clientType,addToInvoice,description}`); wired via `VOIPSWITCH_STARTER_CREDIT`. Live charge not run (needs explicit amount approval). |
| Default tariff | ✅ `VOIPSWITCH_TARIFF_ID=13` (ST_13.5, NGN) — a real id; `admin.tariffs.list` returns empty without a currency filter, so pull live ids from `admin.wholesale.clients.list` |

### ✅ RESOLVED — the "503 on REGISTER" was a FreeSWITCH binding bug, NOT the carrier

Long investigation; final root cause (2026-06-30):

- Symptom: every newly-created account got `503 Service Unavailable` when the FreeSWITCH
  gateway tried to REGISTER. Initially mis-attributed to the carrier.
- **Disproof of carrier theory:** a raw SIP REGISTER sent from this box's real network
  interface (and a softphone) got **`200 OK`** with the same account/credentials. Replicating
  every FreeSWITCH quirk (loopback Via/Contact, `gw+` contact user, FreeSWITCH UA, even a
  wrong digest realm) still got `200 OK`.
- **Actual root cause:** FreeSWITCH was bound to loopback — `vars.xml` had
  `local_ip_v4=127.0.0.1` and `external_sip_ip/rtp_ip=127.0.0.1`, and the external profile's
  `sip-ip=$${local_ip_v4}`. A SIP profile bound to `127.0.0.1` cannot send to a public carrier,
  so sofia failed internally and reported it as **503**. It was never the carrier, the account,
  account type, tariff, reseller, or account state (all tested and ruled out).
- **Fix (validated):** bind FreeSWITCH to a real IP. We created a dedicated `carrier` sofia
  profile (`conf/sip_profiles/carrier.xml`) with `sip-ip=auto` / `rtp-ip=auto`, port 5090, and
  the tenant gateway inline. Result: gateway **`REGED / UP`**, and the carrier shows the trunk
  registered from the public IP. (Note: this dev box roams networks — its LAN IP changed
  mid-test from `192.168.10.38`→`10.55.230.24` — so use `auto`, never a hardcoded IP.)
- **Production implication:** a normal server install of FreeSWITCH binds to its real/public IP
  already; this loopback setup was specific to this dev laptop. On prod (`72.61.18.174`), verify
  `local_ip_v4`/`external_sip_ip` point at the real/public IP (not `127.0.0.1`). Our provisioning
  code is correct — it only needs FreeSWITCH bound properly.

### ⛔ Outbound calls return SIP 402 — carrier-side billing/routing (operator action)

After registration was fixed, outbound calls **reach VoipSwitch** but are rejected instantly
with **`402 Payment Required`**. Eliminated from our side (all verified OK):
number format (`08…` and `234…` both 402), trunk registration (REGED), balance (funded
**2001 USD** via `admin.payment.add`), rate (tariff 93 prices `234`/`08`), currency (USD acct +
USD tariff), and a valid owned caller-ID/ANI (`2349088999061` from the Nativetalk DID pool).

**Confirmed carrier-side:** the same account dialing out from an independent **softphone** also
returns 402. So it is NOT FreeSWITCH or our code. Likely a missing **terminating route/LCR** for
the destination on tariff 93, or a required **package/plan** on the account. Operator question:
> A registered, funded (USD 2001), correctly-priced (tariff 93 has a `234` rate) account with a
> valid ANI gets SIP **402** instantly on every outbound call to a Nigerian mobile, from both
> FreeSWITCH and a softphone. What's missing for outbound termination — a terminating route/LCR
> for that destination on this tariff, or a required package/plan on the account?

### DID creation — supported by the API

`admin.did.local.country.save`, `admin.did.local.area.save`, `admin.did.local.number.save`, and
`admin.did.countries.import` create DID pools/areas/numbers. ~32 numbers are **Available** in the
"Nigeria Nativetalk" pool (countryId 15). Open item: these create numbers but carry no client-ID
field, so **binding a DID to a tenant for inbound routing** is a separate step to confirm with the
operator. (Outbound caller-ID works by adding the DID as the client's ANI via `admin.client.ani.add`.)

### Still open

1. **`admin.client.delete` returns `status: -1`** for the `Richard` admin (tried all flag
   combinations; balance was 0). Hard-delete appears disabled/unpermitted via the API.
   **Not used by this integration** — offboarding is **suspend** (`status.set active:false`,
   validated). If true deletion is ever needed, get the API user delete permission from the
   VoipSwitch operator, or delete in the portal. A leftover smoke-test client
   `tk_smoketest_001` (idClient 205) is **suspended** and should be deleted manually.
2. **`VOIPSWITCH_SIP_PROXY`** — set to the API host IP as a placeholder; confirm the real SIP
   registrar host with the operator. (`configured` requires it, so provisioning is dormant
   until it's correct.)
3. **DID/inbound** — `ani.add` sets outbound caller-id only. Decide how DIDs (inbound numbers)
   are allocated to a client and routed back down the trunk to the tenant.
4. **Server cert** — the box's HTTPS cert is expired; we call over HTTP. Restrict API
   reachability to the app server (IP allowlist / VPN) before production, and rotate the
   `Richard` admin password (it was shared during validation).

> NOTE — the "402 outbound" section above was **resolved**: it was caused by provisioning
> under a sub-reseller (Accord/94) whose `AccordTariff` has no termination route. Creating
> under reseller `-1` on an `ST_*` tariff with tech-prefix `0->3344` routes correctly (a live
> call completed). See the "Validated working recipe" at the top.

## Production deployment checklist

1. **FreeSWITCH must bind to the real/public IP, not `127.0.0.1`.** This was the entire "503"
   saga — a loopback-bound SIP profile can't reach the carrier and reports a self-generated 503.
   On the prod server (`72.61.18.174`) confirm `vars.xml` `local_ip_v4` / `external_sip_ip`
   resolve to the real/public IP (or bind the external/carrier profile with `sip-ip=auto`).
   Verify with `sofia status` (the profile should show the public IP, not `127.0.0.1`) and a
   gateway reaching `REGED`. If behind NAT, also set `ext-sip-ip`/`ext-rtp-ip` (STUN) for media.
2. **Set the `VOIPSWITCH_*` env** (see `.env.example`) with the validated values: retail
   (`CLIENT_TYPE=32`), `RESELLER_ID=-1`, an `ST_*` `TARIFF_ID`, `TECH_PREFIX=DP:0->3344`,
   `DID_COUNTRY_ID=15`, a `STARTER_CREDIT`, and the real admin creds + SIP proxy host.
3. **Run the migration** (`prisma migrate deploy`) for the Trunk `provider`/`providerClientId`
   columns.
4. **Smoke test:** sign up a tenant → confirm a `Trunk` row + carrier client are created, the
   gateway reaches `REGED`, and an outbound call to a real number completes.
5. **Still external / open:** inbound DID→tenant routing (operator must confirm the binding);
   rotate the shared `Richard` admin password; tidy carrier test accounts (205/1975/1976/1978).
