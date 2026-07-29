# NativeTalk — Prod Testing Runbook (prep, not yet live)

Goal: put the app somewhere other people can log in and test **Barge / Listen /
Coach** with real calls. This is the plan. Nothing here has been run yet.

## The two servers

- **App server** — the `x.x.x.36` box (this once ran FreeSWITCH). It sits
  **behind a NAT**, so it is not directly reachable from the internet.
- **FreeSWITCH server** — the public `102.209.224.37` box (SSH alias
  `nativetalk-fs`). This runs the phone system. It stays as it is.

The app (API + web) goes on `.36`. FreeSWITCH stays on `.37`. They must talk
both ways, and testers must reach the web app. The NAT makes both of these need
a little extra work (below).

## The NAT problem, and how we solve it

Two links are needed:

1. **App → FreeSWITCH** (the API reads/controls calls over ESL on port 8021,
   and pulls recordings over SSH). The app can call out to the public FS box, so
   this direction is easy.
2. **FreeSWITCH → App** (FreeSWITCH asks the API for config/dialplan over
   `xml_curl`, calling `http://127.0.0.1:4000`). FreeSWITCH is public and the app
   is behind NAT, so FreeSWITCH **cannot** reach the app directly.

Both links are already solved today by one SSH tunnel (it currently runs on the
Mac). In prod we run the **same tunnel on the `.36` box** and make it permanent:

```
# On the .36 app server, as a systemd service (autossh):
#   forward  : localhost:8021 on .36  ->  127.0.0.1:8021 on FS   (ESL)
#   reverse  : 127.0.0.1:4000 on FS   ->  localhost:4000 on .36  (xml_curl)
autossh -M 0 -N \
  -L 8021:127.0.0.1:8021 \
  -R 4000:127.0.0.1:4000 \
  nativetalk-fs
```

Then the API uses `FS_HOST=127.0.0.1` / `FS_PORT=8021`, exactly like now. This
keeps the working setup and just moves it off the Mac onto a real server.

> Later we can drop the tunnel by letting the app reach FS ESL directly (open
> 8021 to the app's IP only) and giving FreeSWITCH a real URL to reach the app.
> For first testing, the tunnel is the least risky.

## How testers reach the web app (NAT again)

The `.36` box is behind NAT, so pick one:

- **Cloudflare Tunnel (recommended for testing).** No router changes. Install
  `cloudflared` on `.36`, point a hostname (e.g. `app.nativetalk...`) at
  `localhost:3001`. Gives HTTPS for free. Easiest for a quick test with others.
- **Port-forward on the NAT router.** Forward public `443` to `.36:443`, run
  nginx + a real TLS cert. More control, needs router access.

Either way the browser must load the app over **HTTPS**, because the softphone
needs a secure WebSocket (see TLS below).

## Step 0 — Harden first (do BEFORE anyone outside logs in)

fail2ban is already installed on the FS box. Still open, in rough priority:

1. **Change the dev secrets.** These are still on defaults:
   - `xml_curl` gateway secret is `dev-fs-xml-secret-change-me` (in
     `/etc/freeswitch/autoload_configs/xml_curl.conf.xml` on the box, and
     `FS_XML_SECRET` in the API env). Pick a strong value, set both sides.
   - Confirm the ESL password and all SIP/extension passwords are off any
     default. (ESL password is already a long random string.)
2. **Lock the `public` context so it can never reach the trunk.** Today the
   external profile has `auth-calls=false` and `context=public`, so
   unauthenticated inbound (and SIP scanners) land in the `public` dialplan. The
   `public` context must only allow safe destinations (ring an extension / play
   a greeting) and must **never** route to the outbound gateway. This is the
   real toll-fraud fix, more important than fail2ban.
   - Note: authenticated softphones route via `user_context=default` (set
     per-extension in the directory), so this change should not affect logged-in
     users — **but test a real call after changing it** (1001 -> 1002, and one
     outbound) before letting others on.
3. **SIP ACL.** Restrict who may send SIP to the box (e.g. allow only the
   VoipSwitch trunk peer `37.9.63.182` on the external profile, plus registered
   users). `apply-inbound-acl` on the profile.
4. Re-check the full list in `docs/SECURITY-CHECKLIST.md`.

Because these touch the **live** phone box, do them one at a time and place a
test call after each. Do not batch them.

## Step 1 — App server setup (.36)

Follow `deploy/DEPLOY.md`. In short:

- Install Node 20, PostgreSQL 16, Redis 7, nginx.
- `rsync` the repo to `.36` (exclude `node_modules`, `.git`, `dist`, `.next`).
- `sudo bash deploy/install.sh` (creates the `nativetalk` user, builds the API,
  runs migrations, installs the systemd service).
- Create the DB user + database, run the seed once.
- Install the autossh tunnel service (above) so ESL + xml_curl work.

## Step 2 — Environment (watch the build-time trap)

The web bundle **bakes `NEXT_PUBLIC_API_URL` at build time**. If it is left as
`http://localhost:4000`, every tester's browser will call *their own* machine and
all logins fail. This exact mistake caused a login outage on the other product.

- Build the web with the **public** API URL, e.g.
  `NEXT_PUBLIC_API_URL="https://app.nativetalk.../api" npm --workspace @nativetalk/web run build`.
- After build, verify nothing localhost leaked:
  `grep -rl "localhost:4000" apps/web/.next` should return nothing.
- API env: `FS_HOST=127.0.0.1`, `FS_PORT=8021` (via the tunnel),
  `FS_WS_URL="wss://nativetalkfs.tech4mationlimited.com:7443"`,
  `WEB_ORIGIN` = the public web URL, strong `JWT_SECRET`, real `FS_XML_SECRET`.

## Step 3 — TLS (the softphone needs it)

Browsers on an HTTPS page can only open a **secure** WebSocket (`wss://`). So:

- The web app must be served over HTTPS (Cloudflare Tunnel gives this, or a real
  cert via nginx).
- FreeSWITCH is already listening on `102.209.224.37:7443` (wss) and `:5066`
  (ws). **Verify the 7443 certificate is valid and trusted** for
  `nativetalkfs.tech4mationlimited.com`, and that DNS for that name points to
  `.37`. If the cert is self-signed or the name does not match, browsers reject
  the softphone connection silently and calls just never ring. This is the most
  common cause of "it works on my machine but not for testers."
  - Quick check from a laptop: open
    `https://nativetalkfs.tech4mationlimited.com:7443` in a browser and confirm
    no certificate warning.

## Pre-flight checklist (all must be true before inviting testers)

- [ ] Step 0 hardening done, and a test call still works after each change
- [ ] `xml_curl` secret + `FS_XML_SECRET` changed off the dev default (matching)
- [ ] Public dialplan context cannot reach the outbound trunk
- [ ] SIP ACL restricts inbound to the trunk peer + registered users
- [ ] autossh tunnel service is up on `.36` (ESL reachable, xml_curl reachable)
- [ ] Web built with the **public** `NEXT_PUBLIC_API_URL` (no localhost in
      `.next`)
- [ ] Web served over HTTPS; `WEB_ORIGIN` matches
- [ ] `wss://nativetalkfs...:7443` cert is valid and trusted; DNS points to `.37`
- [ ] Log in as a supervisor (1004) and confirm the softphone shows
      **registered** (top bar), not "connecting"
- [ ] One agent on a live call; supervisor Listen / Coach / Barge each work
- [ ] Recordings play back (SSH pull from `.37` works from `.36`)

## What to test with people (the point of all this)

Barge / Listen / Coach only differ with three real people:

- **Listen** — supervisor hears both, says nothing. Ask the agent and the
  "customer": you should not hear the supervisor at all.
- **Coach** — supervisor talks; only the **agent** hears them. The customer
  should hear nothing new.
- **Barge** — supervisor talks; **both** hear them. It becomes a 3-way call.

Have the supervisor (1004) open **Agents Status**, and use the three buttons on
the on-call agent's card.
