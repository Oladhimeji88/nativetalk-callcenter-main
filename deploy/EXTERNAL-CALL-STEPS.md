# Placing an external test call (Nativetalk trunk) — manual steps

Working config (already set up):
- Gateway name: **`nativetalk`** (state must be `REGED`/`UP`)
- Number format: **national** — e.g. `08163261011` (NOT `+234…`)
- Caller-ID identity: **`testcall`**
- Audio played on answer: `ivr/ivr-welcome_to_freeswitch.wav`

---

## Method A — from the dashboard (normal use)

1. Open **http://72.61.18.174:3000**.
2. Left menu: **Contact Center → Outbound Campaign**.
3. Find the **OutNative** campaign (already points at the `nativetalk` gateway).
4. To change the number(s): click the **Edit** (pencil) icon → set **Phone
   Numbers** (national format, one per line or comma-separated) → **Save**.
5. Click the **Open dialer** (phone) icon on the OutNative row.
6. Click **Start dialing**. Watch each number go
   `queued → dialing → answered/failed`.

> The **Quick Test** box on the dashboard home dials *internal extensions only*
> (no trunk). For real external numbers, always use the **Outbound Campaign**
> dialer above.

---

## Method B — directly on the server (diagnostics)

SSH to the server, then place one call with FreeSWITCH's CLI:

```bash
/usr/local/freeswitch/bin/fs_cli -H 127.0.0.1 -P 8021 -p 'fsHello_ESL_2026' \
  -x "originate {origination_caller_id_number=testcall,origination_caller_id_name=testcall,ignore_early_media=true,originate_timeout=30}sofia/gateway/nativetalk/08163261011 &playback(ivr/ivr-welcome_to_freeswitch.wav)"
```

- `+OK <uuid>`  → call was placed/answered.
- `-ERR <cause>` → failed (e.g. `NO_ANSWER`, `USER_BUSY`, `CALL_REJECTED`).

Check the trunk is registered first:
```bash
/usr/local/freeswitch/bin/fs_cli -H 127.0.0.1 -P 8021 -p 'fsHello_ESL_2026' \
  -x "sofia status gateway nativetalk"        # expect State: REGED
```

Watch live SIP for troubleshooting:
```bash
/usr/local/freeswitch/bin/fs_cli -H 127.0.0.1 -P 8021 -p 'fsHello_ESL_2026' \
  -x "sofia global siptrace on"
tail -f /usr/local/freeswitch/log/freeswitch.log     # Ctrl-C to stop
# turn it off afterwards: ... -x "sofia global siptrace off"
```

---

## If a call fails
- `NO_ANSWER` after ~30s → nobody picked up, or carrier didn't complete.
- Confirm gateway is `REGED`; if not, `sofia profile external restart`.
- Re-confirm the number format with the provider (national vs international).
- Remember: real calls are **billable** and regulated (consent, DNC, hours).
