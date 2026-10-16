# How a remote user tests the autodialer (staging: 72.61.18.174)

The app, FreeSWITCH 1.10.12 (built from source), and a test SIP user are all
running on the staging box. A remote tester needs **two things**: a softphone
registered to the server (to receive the call) and the dashboard (to start it).

## Credentials & endpoints

| What            | Value                                  |
| --------------- | -------------------------------------- |
| Dashboard / API | http://72.61.18.174:3000               |
| SIP server/domain | `72.61.18.174` (port `5060`, UDP or TCP) |
| Test extension  | `1000` (also `1001`–`1019` available)  |
| SIP password    | `1234`                                 |

## Steps

1. **Install a softphone** — MicroSIP (Windows), Zoiper (any OS), or Linphone (mobile).

2. **Register an account:**
   - Domain / SIP server / host: `72.61.18.174`
   - Username / Auth ID: `1000`
   - Password: `1234`
   - Transport: UDP (or TCP — both are open)
   - The softphone should show **Registered / Online**.

3. **Open the dashboard:** browse to **http://72.61.18.174:3000**.
   On the dashboard, the **🚀 Quick Autodialer Test** card is at the top. The
   green **FreeSWITCH: connected** pill confirms the app is talking to FreeSWITCH.

4. **Run the test:** in the Quick Test card, leave the extension as **`1000`**
   (or whichever you registered) and click **Start test call**.

5. **Answer your softphone** when it rings. You'll hear the FreeSWITCH welcome
   prompt; the call then hangs up and the card shows **answered**.

That's the autodialer: it originated an outbound call through FreeSWITCH to your
registered endpoint and played audio on answer. The full campaign version lives
under **Contact Center → Outbound Campaign → Open dialer** (dial a list of
numbers one at a time).

## Multiple testers

Each tester can register a different extension (`1000`–`1019`, all password
`1234`) and Quick-Test their own.

## Troubleshooting

| Symptom | Cause / fix |
| ------- | ----------- |
| Softphone won't register | Confirm server `72.61.18.174:5060`, user/pass; try TCP transport. |
| Phone rings, but **no audio** / one-way | RTP media (UDP `16384–32768`) likely blocked by the cloud firewall/security group — open that UDP range to the tester's IP. |
| Card shows **FreeSWITCH: unreachable** | App can't reach ESL — `sudo systemctl status fs-hello freeswitch` on the server. |
| Call status = **failed** immediately | The dialed extension isn't registered (no softphone online) — finish step 2 first. |

## Security notes (staging only)

- The dashboard on port 3000 has **no authentication** — anyone who can reach it
  can trigger calls. Lock it down (VPN / IP allowlist / reverse-proxy auth)
  before any real use.
- ESL (8021) is bound to `127.0.0.1` only and uses a non-default password — it
  is **not** exposed publicly (verified).
- Extension password `1234` is the FreeSWITCH default — change it for real use.
