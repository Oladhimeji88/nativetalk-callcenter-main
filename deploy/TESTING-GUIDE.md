# Phase 7 — Tenant SIP Trunk: Step-by-Step Testing Guide

How to test signup → trunk creation → outbound call → inbound call yourself.

## 0. Prerequisites (one-time)

- **FreeSWITCH bound to a REAL/public IP** (not `127.0.0.1`). This is essential — a
  loopback-bound profile reports every registration as a self-generated `503`.
  - Check: `fs_cli -x "sofia status"` → the `external` (or carrier) profile should show
    the machine's real/public IP, e.g. `sip:mod_sofia@<public-ip>:5080`, not `127.0.0.1`.
  - If it shows `127.0.0.1`: set `local_ip_v4` (and `external_sip_ip`/`external_rtp_ip`)
    in `conf/vars.xml` to the real/public IP, or bind the trunk profile with `sip-ip=auto`,
    then `fs_cli -x "sofia profile <name> restart reloadxml"`.
- **API env set** (`apps/api/.env`): the `VOIPSWITCH_*` block with the validated values
  (see `.env.example`): retail (`CLIENT_TYPE=32`), `RESELLER_ID=-1`, an `ST_*` `TARIFF_ID`,
  `TECH_PREFIX=DP:0->3344`, `DID_COUNTRY_ID=15`, a `STARTER_CREDIT`, real admin creds + proxy.
- **DB migrated**: `cd apps/api && npx prisma migrate deploy`.
- **API running** with the new build: `cd apps/api && npm run build && npm start` (or `start:dev`).

## 1. Test signup → trunk creation

Sign up a new company (either way):

- **Web:** open the app, go to `/register`, fill in company + email + password, submit.
- **API:**
  ```bash
  curl -X POST http://localhost:4000/signup -H "Content-Type: application/json" \
    -d '{"company":"Test Co","email":"test@example.com","password":"password123"}'
  ```

**Verify the trunk was created:**

- **In our DB:** the tenant should have a `Trunk` row —
  ```sql
  SELECT name, username, proxy, "callerId", provider, "providerClientId"
  FROM "Trunk" ORDER BY "createdAt" DESC LIMIT 1;
  ```
  Expect `provider = voipswitch`, a `providerClientId`, and a `callerId` (the allocated DID).
- **On the carrier:** the account should be retail / reseller -1 / `ST_*` tariff with techPrefix
  `CP:!<DID>;DP:0->3344` and the starter-credit balance. (Check in the VoipSwitch portal, or via
  the WebAPI `admin.retail.get`.)
- **API logs:** look for `provisioned voipswitch retail trunk <id> (login …, did …)`.

## 2. Test the trunk registers

```bash
fs_cli -x "sofia status gateway <login>"     # login = the trunk username, e.g. tk_testco
```
Expect **`State: REGED`, `Status: UP`**. If `TRYING`/`FAIL_WAIT`/`DOWN`:
- `REGED` never reached + carrier reachable → re-check the profile bind IP (step 0).
- `503` in `freeswitch.log` → profile still bound to loopback.
- Timeout/`TRYING` → SIP UDP path/firewall to the carrier (UDP 5060 must be open both ways).

## 3. Test an OUTBOUND call

From an agent softphone in the app, dial a real number — or test directly:
```bash
fs_cli -x "originate {origination_caller_id_number=<DID-national>}sofia/gateway/<login>/2348XXXXXXXXX &echo"
```
- Dial in any of national `0816…`, E.164 `2348…`, or bare 10-digit — the dial-plan normalizes it.
- **Expect:** the destination phone rings; answering the `&echo` test plays your voice back.
- The account must have **credit** (starter credit, or top it up) or calls return `402`.

## 4. Test an INBOUND call  (pending operator confirmation)

> Inbound requires the carrier to route the tenant's DID down its trunk. The DID→tenant
> binding step is **not yet confirmed** with the VoipSwitch operator (see
> `VOIPSWITCH-OPERATOR-QUESTIONS.md` Q2). Once confirmed:

1. Ensure the tenant's DID is routed to its client/trunk on the carrier.
2. Add an inbound route in the app (PBX → Inbound Routes) for that DID → an extension/IVR/queue.
3. From any phone, **call the DID**. Expect it to ring the configured destination.

## Notes
- Calls/registration need **SIP UDP 5060** open to the carrier and the FreeSWITCH RTP range for audio.
- Behind NAT, set `ext-sip-ip`/`ext-rtp-ip` (STUN) so media flows; on a public-IP server this is automatic.
- Suspending a tenant (`/platform/tenants/:id/suspend`) disables their carrier line; activate re-enables.
