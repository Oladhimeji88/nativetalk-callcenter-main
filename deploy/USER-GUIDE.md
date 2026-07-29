# nativetalk — User Guide & Application Tour

*A step-by-step guide for new teams: set up agents and handle live calls with customers.*

Welcome! This guide walks you through the platform from first sign-in to running a
live contact centre — creating agents, taking and making calls in your browser,
running outbound campaigns, supervising live, and handling messages. No technical
knowledge needed; just follow the steps.

---

## 1. What this platform is

It's an all-in-one **contact-centre and phone system that runs in your web
browser**. Your team can:

- Make and receive phone calls **directly in the browser** — no desk phone needed.
- Run **outbound campaigns** that dial lists of customers and connect answered
  calls to an available agent.
- Handle **SMS, WhatsApp, email and web-chat** in one shared **Inbox**.
- **Supervise live** — see every active call and agent in real time, and listen in.
- Track everything with **reports and call recordings**.

---

## 2. Signing in

1. Open your platform web address (during setup this is **http://localhost:3001**).
2. Enter your **email** and **password** and click **Sign in**.
3. You'll arrive in the app. Along the top you'll see the menu:

| Tab | What it's for |
|-----|---------------|
| **Phone** | Your personal softphone — make/take calls in the browser |
| **Agents** | Your team — create accounts (agents / managers / admins) and desk-phone extensions |
| **Inbox** | All customer conversations (SMS / WhatsApp / email / chat) |
| **Live** | Real-time dashboard — active calls, agents, queues |
| **Campaigns** | Create and run outbound dialler campaigns |
| **Billing** | Your plan, usage and invoices |
| **Platform** | *(owners only)* manage all companies on the platform |

> **Tip:** sessions last 12 hours. If you've been away and pages stop loading,
> you'll be returned to the sign-in screen automatically — just sign in again.

---

## 3. Part 1 — Create your team (accounts)

Everyone who signs in has one of **three account types**, chosen when you create
them:

| Account type | What they can do | Created by |
|--------------|------------------|------------|
| **Admin** | Everything for **your company** — team, campaigns, settings, billing | Created when your company is set up; an existing admin can add more admins |
| **Manager** | Only the permissions an admin grants them (e.g. reports, campaigns) | An admin |
| **Agent** | **Calls + contacts only** — make/take calls, manage contacts, set their status | An admin |

> There is also a platform **Super-Admin** (the platform owner / Nativetalk) who
> can see *all* companies. That account is not created here.

### Adding an account — the **Agents** tab → **Team accounts**

1. Go to the **Agents** tab. The top section is **Team accounts**.
2. Click **+ Add account** and pick the **Role**:
   - **Agent** — also enter their **Extension** (desk-phone number, e.g. `1051`)
     so they can take calls.
   - **Manager** — optionally pick a **Permission set** (what they're allowed to
     do); you can also assign this later.
   - **Admin** — full company access. *(Only an admin can create another admin.)*
3. Enter their **email**, a **temporary password**, and **first name**, then
   click **Create**.
4. Hand the person their email + temporary password — they sign in at your web
   address and see only what their role allows.

### Agents also need a desk phone (extension)

An agent makes and takes calls through an **extension**. Either:

- enter the extension when you create the agent account (step 2 above), **and/or**
- manage extensions in the **Desk phones (extensions)** section lower on the same
  page: click **+ Create extension**, give it a 3–6 digit number (e.g. `1007`)
  and a name. A SIP password is generated for you (click ↻ for a new one).

> Behind the scenes, creating an extension registers it in the phone engine
> instantly — no waiting, no manual configuration. The agent then registers that
> extension on the **Phone** tab (next section).

---

## 4. Part 2 — An agent comes online (the Phone tab)

Each agent does this on their own computer (a modern browser — Chrome or Edge):

1. Sign in, then open the **Phone** tab.
2. Enter your **extension number** (e.g. `1007`) and click **Go online**.
3. The browser asks to use your **microphone** — click **Allow** (required for calls).
4. You're now **Registered**. Set your status (top right):
   - **Available** — ready to receive calls.
   - **On Break** — temporarily not receiving calls.
   - **Logged Out** — signed off the queues.

That's it — the agent is live and can make and take calls.

---

## 5. Part 3 — Handling live calls

### Making a call (outbound)
1. On the **Phone** tab (while Registered), type the number or extension in the
   dial box — e.g. another agent `1000`, or a customer number.
2. Click **Call**. You'll hear it connect; a **call timer** starts.

### Receiving a call (inbound)
1. When a call comes in, a **screen-pop** shows who's calling.
2. Click **Answer** to take it, or **Reject** to decline.

### While on a call
You have full control on screen:

- **Mute / Unmute** — turn your microphone off/on.
- **Hold / Resume** — put the customer on hold.
- **Keypad** — press digits (e.g. to navigate an IVR or enter a reference).
- **Hang up** — end the call.

It works just like a phone, but entirely on screen.

---

## 6. Part 4 — Outbound campaigns (call lists of customers)

This is how you dial many customers and connect the answered ones to your agents.

1. Go to the **Campaigns** tab → **+ Create campaign**.
2. Fill in:
   - **Name** — e.g. *June Promo*.
   - **Dial method** — *Progressive* or *Power* dials several lines at once and
     connects answered calls to agents.
   - **Queue number** — the agent group that should receive answered calls
     (your setup includes a **Support** queue, number **2500**). Leave blank to
     just play a recorded message instead (voice broadcast).
   - **Phone numbers** — paste the customer numbers (one per line).
   - **Max attempts** — how many times to retry busy/no-answer numbers.
   - **Record calls** — tick to record.
3. Click **Create**.
4. On the campaign row, click **Dial** to open the dialer screen, then
   **Start dialing**.

As it runs you'll see each number's progress live — **dialing → answered /
failed**, attempt counts, and a **Disposition** dropdown to tag the outcome of
each call (Sale, Callback, No Answer, etc.). Numbers on your **Do-Not-Call** list
are skipped automatically.

> When a customer answers, they're connected to the next **Available** agent in
> the queue — so make sure agents are online and set to *Available* before you
> start dialing.

---

## 7. Part 5 — Supervising live (the Live tab)

Team leads and supervisors use the **Live** dashboard:

- **Top cards** — active calls, agents available, agents on call, agents on break.
- **Running campaigns** — progress of any dialer that's running.
- **Agents** — who's online and their current state.
- **Active calls** — every call happening right now. On each you can:
  - **Listen** — silently hear the call (the agent and customer don't hear you).
  - **Whisper** — speak only to the agent (the customer can't hear you) — great
    for coaching.
  - **Barge** — join the call so everyone hears you.

To monitor, click the button, enter your own extension when prompted, and your
phone will ring to connect you to the call.

The dashboard refreshes automatically every couple of seconds.

---

## 8. Part 6 — The Omnichannel Inbox

The **Inbox** brings every customer message into one place — SMS, WhatsApp,
email and web chat — handled like a help desk.

1. Open the **Inbox** tab. Conversations are listed on the left with a colour tag
   for the channel and the latest message.
2. Click a conversation to open the full thread on the right.
3. Type in the box and **Send** to reply to the customer.
4. Tick **Internal note** to leave a private note for teammates (the customer
   never sees these).
5. Use the **status** selector (top right of a conversation) to mark it
   *open / pending / snoozed / closed*.

> Sending on **SMS / WhatsApp / Email** becomes live once your provider accounts
> are connected. Until then those replies are safely queued and the system tells
> you which account is still needed. Voice and web-chat work right away.

---

## 9. Part 7 — Recordings & reports

- **Call recordings** (for campaigns set to record) are stored on your server and
  can be played back from the platform.
- **Reports** include a **Campaign Report** (dialled, answered, failed, sales per
  campaign), **Call Records (CDR)**, and **Agent Performance** (calls answered,
  talk time, status per agent) — all from your real call data.

---

## 10. Part 8 — Billing (and Platform for owners)

- **Billing** — see your current plan, this month's **usage** (extensions,
  campaigns, calls) against your plan limits, and your **invoices**. If online
  payments are enabled, pay an invoice with the **Pay** button.
- **Platform** *(visible only to the platform owner)* — onboard new companies,
  set their plan, suspend/reactivate them, and view usage across the whole
  platform.

---

## 11. A 5-minute "try it" walkthrough

1. **Agents** → create two agents, e.g. `1007` (Ada) and `1008` (Ben).
2. Open the **Phone** tab in two browser windows; sign `1007` into one and `1008`
   into the other; set both **Available** and allow the microphone.
3. From Ada's window, dial **1008** and click **Call** → Ben's window shows the
   incoming call → **Answer**. You're on a live call; try **Mute** and **Hold**.
4. Open the **Live** tab → see the active call and both agents; try **Listen**.
5. (Optional) **Campaigns** → create one using the **Support** queue (2500), paste
   a couple of numbers, **Dial**, and watch answered calls route to an Available
   agent.

---

## 12. Tips & troubleshooting

| Issue | What to do |
|-------|------------|
| Can't hear / no microphone | Make sure you clicked **Allow** for the mic; check the browser's site permissions |
| Pages stop loading | Your session expired (12h) — you'll be sent to sign in again |
| A call shows "USER_NOT_REGISTERED" | The person you dialled isn't online — they need to **Go online** on the Phone tab |
| Outbound calls to real numbers don't connect | A live carrier line must be enabled by your administrator |
| Agent isn't getting queue calls | Confirm they're online and set to **Available** |

---

*Need a feature switched on (SMS/WhatsApp/email, online payments, a live carrier
line for external calls)? These are quick to enable once the relevant account is
provided. Speak to your administrator.*
