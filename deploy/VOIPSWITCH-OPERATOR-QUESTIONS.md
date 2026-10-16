# Message to VoipSwitch operator

Context: we provision tenant SIP trunks on your platform (`37.9.63.182`) via the
PortalAdmin WebAPI, and register them from our FreeSWITCH. Account creation,
funding, suspend/reactivate, and **SIP registration all work**. Two carrier-side
items remain:

## 1. Outbound calls rejected with SIP 402 — the `3344` route is missing from AccordTariff
Test account `tesjt4903821010` (idClient `1978`, retail, **reseller 94 / Accord**, tariff
`93` AccordTariff, USD) is **registered**, **funded (USD 2,001)**, with a valid **caller-ID/ANI**
(`2349088999061`). Every outbound call to a Nigerian mobile returns **SIP 402** instantly — from
**both** FreeSWITCH and an independent softphone (so it is not our side).

We applied your instruction to set the **tech-prefix to `0->3344`** (confirmed stored). That
rewrites `08163261011` -> `33448163261011`. **But `AccordTariff (93)` has no rate/route for the
`3344` prefix** (checked `3344`, `334`, `33`, `3` — all zero). So the rewritten number can't be
priced/routed -> 402. (Dialing `3344...` directly returns `UNALLOCATED_NUMBER`, confirming no
`3344` route exists.)

We also tried to **replicate a working caller account** (e.g. `zola`: NGN, tariff `ST_12`,
`DP:0->234 OR 234->0`) but assigning that tariff failed with **"Tariff doesn't belong to
reseller!"** — those tariffs are owned by other resellers, not reseller 94.

**Questions:**
1. The `0->3344` tech-prefix is set — please **add the `3344` termination route/rate to
   `AccordTariff (93)`** (or tell us which reseller-94 tariff carries the outbound route + the
   exact tech-prefix). Today nothing on tariff 93 can route a `3344...` number.
2. Should our tenant trunks be under **reseller 94 / AccordTariff** at all, or under a
   reseller/tariff that already has Nigerian outbound termination (like the `ST_*` tariffs)?
3. Confirm the correct caller-ID format — working accounts use `CP:!0<national>` (e.g. `CP:!09088999061`).

## 2. Binding a DID to a customer for inbound
We can create/list DID numbers via the API (`admin.did.local.number.save`, etc.), and there
are ~32 **Available** numbers in the "Nigeria Nativetalk" pool (countryId 15). But the create/save
call has **no customer/client field**, and `AdminGetClientDIDs` returns empty for existing clients.

**Question:** how is a DID **bound to a specific customer** so that inbound calls to that number
route down the customer's trunk? Is it a "destination" set on the DID, a separate routing rule,
or a portal-only step?

---
(For reference, test accounts created during this work: 205, 1975 [suspended], 1976, 1978 [active].
The carrier admin password shared for testing should be rotated.)
