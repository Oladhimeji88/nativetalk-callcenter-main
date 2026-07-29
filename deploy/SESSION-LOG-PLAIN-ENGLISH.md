# What we set up — in plain English

A record of everything done to get the **fs-hello** autodialer running on the
staging server, written so anyone (not just engineers) can follow it.

_Server: **72.61.18.174** · Dashboard: **http://72.61.18.174:3000**_

---

## The goal

Put the fs-hello app (a web dashboard that makes phone calls through
FreeSWITCH) onto the staging server, make sure the phone engine was running,
and make it easy for someone elsewhere to try the autodialer. Then connect a
real phone line so it can call real numbers.

## What we found at the start

- The app was **not** on the server yet.
- **FreeSWITCH** — the software that actually makes the calls — was **not even
  installed**. (We had assumed it was running; it wasn't.)
- The server is an Ubuntu machine with the public address 72.61.18.174.

## What we did, step by step

1. **Copied the app onto the server** and installed the bits of software it
   depends on.

2. **Built and installed FreeSWITCH from scratch.** Because it wasn't available
   as a ready-made package, we compiled it from source — first its four
   building-block libraries, then the main program, then the standard voice
   prompts (so it has audio to play). This is the big, time-consuming part.
   Result: **FreeSWITCH 1.10.12 is installed and running.**

3. **Configured FreeSWITCH safely:**
   - Gave it a proper password for its control channel and locked that channel
     to the server itself (so nobody on the internet can reach it). We caught
     and fixed a moment where it was briefly exposed with a default password.
   - Set it up to use the server's public address for calls.
   - Confirmed a ready-made **test phone extension: `1000`, password `1234`**
     (extensions `1000`–`1019` all exist).
   - Made it start automatically and stay running.

4. **Started the app as a background service** so it runs continuously and
   restarts on its own. It lives at `/opt/fs-hello` and serves the dashboard on
   port 3000.

5. **Made testing dead simple.** We added a **"🚀 Quick Autodialer Test"** box
   to the top of the dashboard: type one or more numbers (one per line or
   comma-separated), click one button, and watch each call's status live. It
   also shows whether FreeSWITCH is connected.

6. **Checked everything works from the outside:**
   - Dashboard (port 3000): reachable ✓
   - Phone registration (port 5060): reachable ✓
   - Control channel (port 8021): correctly blocked from outside ✓
   - The dashboard correctly sees FreeSWITCH and its 20 extensions.

7. **Connected the Nativetalk phone line (SIP trunk).** Using the credentials
   provided (server 37.9.63.182, user `testcall`), we added it to FreeSWITCH.
   It **registered successfully** — the line is live and reachable.

## How someone tests the autodialer (internal)

1. Install a softphone app (MicroSIP, Zoiper, or Linphone).
2. Sign in to: server **72.61.18.174**, username **1000**, password **1234**.
3. Open **http://72.61.18.174:3000**.
4. In the Quick Test box, enter **1000** and click **Start test call**.
5. Answer the softphone — you'll hear the welcome message. Done.

(Full instructions: see `deploy/REMOTE-TEST.md`.)

## Calling real external numbers

- The Nativetalk line is registered, so the dashboard can dial out: edit an
  Outbound Campaign, set its **Gateway** to `nativetalk`, add real numbers in
  international format, and start dialing.
- **We tried a live test call to +2348163261011.** The call went out through
  the line, but came back **"no answer."**

- **We then traced the call at the network level to find out why.** The result
  is clear-cut:
  - Our server **sends the call request (INVITE)** correctly and even **repeats
    it 5 times** over ~30 seconds.
  - The carrier **never answers the call request at all** — not even a
    "trying…" acknowledgement.
  - Yet the carrier **does answer** our login (registration) and our
    keep-alive checks (we see "200 OK" for both).

- **After the provider's answers, we fixed our side and tried again.** Using
  the confirmed **national format `08163261011`**, the carrier now **does
  respond** — big progress. We then also corrected the caller identity we send
  (it was going out as a meaningless `fs-hello`; now it correctly says
  `testcall`, the account name).

- **Where it stands now:** every call we send is now technically correct —
  right number format, right account identity, and properly signed in with the
  account's password. But the carrier answers with **"authentication required"**
  and then **refuses to connect the call** anyway. In other words, **logging in
  works, but the carrier is not letting this account actually place calls.**

- **This is now entirely on the provider's side.** What to ask Nativetalk:
  1. Is the **`testcall` account actually enabled to make outbound calls**, or
     is it login/test-only?
  2. Do they need to **authorize our server's IP (72.61.18.174)** for calling
     (many providers require this in addition to the password)?
  3. Is there a **specific caller-ID / number** we must be assigned before calls
     are allowed?
  We have the detailed call logs proving our side is correct if they need them.

### ⚠️ Security issue found during this work

While reading the logs we saw the server's public phone port is being
**constantly probed by attackers** on the internet (131+ scan attempts,
including hacking probes). Combined with the fact that the test phone
extensions use the weak password **1234**, this is a **real risk**: if the
phone line starts working, attackers could break in and run up **fraudulent
call charges**. Before going live we should:
- change the extension passwords from `1234` to strong ones,
- restrict the phone ports to known IP addresses (or install brute-force
  protection like fail2ban),
- keep the dashboard behind a login/VPN.

## Things to keep in mind

- **No password on the dashboard.** Anyone who can open port 3000 can start
  calls. Fine for staging, but put it behind a login/VPN before real use.
- **Real calls cost money** and are regulated (consent, do-not-call lists,
  allowed hours, honest caller-ID). Use responsibly.
- The test extension password `1234` is a default — change it for real use.
- Consider rotating the server login password that was shared in chat.

## Where things stand

| Item | Status |
| ---- | ------ |
| App running on server | ✅ live at port 3000 |
| FreeSWITCH installed & running | ✅ |
| Control channel secured | ✅ loopback + password |
| Easy one-click test (internal) | ✅ added to dashboard |
| Nativetalk line connected | ✅ registered / UP |
| Calling real external numbers | ⚠️ our side now fully correct (format `0816…`, identity `testcall`, authenticated); carrier still **refuses to connect the call** — Nativetalk must enable outbound / authorize our IP for the `testcall` account |
| SIP port security | ⚠️ public port under active attack; extensions use weak password `1234` — harden before going live |
