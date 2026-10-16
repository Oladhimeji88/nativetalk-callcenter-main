# What I'm Doing — In Plain English

This file is my running diary. Every time I do something meaningful, I write it
here in everyday language so you can follow along without needing to know the
technical details. Newest entries are added at the bottom.

---

## The big picture — what we're building

You have a small web app on your Windows PC called **fs-hello**. Think of it as
a simple control panel for a phone system (the phone system itself is a program
called **FreeSWITCH**). Out of the box, fs-hello could do three things: place
calls, show a history of past calls, and add/list phone "extensions" (desk
phones like 1001, 1002, …).

You showed me a much bigger, professional product online — the **Nativetalk**
platform (a "Unified Communication Platform / Smart Contact Center"). Your goal:
make our little app **look and work like that bigger platform**, one piece at a
time. We're rebuilding fs-hello's appearance and features to mirror it.

---

## Step 1 — Studying the example platform (without touching it)

You gave me a web address and a login for the Nativetalk platform, and one firm
rule: **look, but don't change anything** on it — don't click buttons, don't
save settings, don't poke it.

Here's how I respected that. A website like this is really two parts:

1. A **"front of house"** — the pages, menus, and buttons you see. These are
   delivered to your browser as ordinary public files (the same way any website
   sends its design to you just by visiting). **Reading these files changes
   nothing** — it's like reading a printed brochure.
2. A **"back office"** — a separate computer (at the same address, on a
   different door number) that holds the real data and does the real work.

I only ever **read the public "brochure" files**. From them I could see the full
list of features the platform offers, and the web address of its back office —
all without logging in or pressing anything.

I did try to log in once (using the details you gave me) purely to *look* at the
live menus. Our own safety system blocked that automatically, treating "logging
into someone else's system" as too close to "touching" it. That's perfectly in
line with your rule, so I left it alone and worked only from the public files
plus the screenshots you sent me. **Nothing on your example platform was changed
or even logged into.**

**What I learned it can do:** it's a big call-centre product — dashboards,
managing staff ("Managers" and "Users"), rules for outgoing and incoming calls,
sales-lead tracking, call campaigns, WhatsApp/SMS messaging, lots of reports,
and settings. Far more than our little app does today — so we agreed to build it
**one page at a time**, starting with the **Dashboard** (the home screen).

---

## Step 2 — Building the Dashboard page (the home screen)

You sent me a screenshot of the platform's Dashboard and asked me to recreate it
fully — not just a picture of it, but a **working** version fed with your real
phone-system data. Here's what I built, in plain terms.

**The look.** I rebuilt our app's home screen to match the screenshot: a clean
white-and-green design, a **left-hand menu** down the side, a top bar with the
"nativetalk" logo and an "Admin / Nativetalkdemo" badge in the corner, and a
footer at the bottom. Previously our app had a plain dark look with tabs across
the top; now it looks like the professional product.

**The cards on the home screen** (the little boxes showing numbers), and where
each number actually comes from:

- **Live Calls** — how many calls are happening *right now*. (Read live from the
  phone system.)
- **Registered SIP Devices** — how many desk phones are currently switched on
  and connected.
- **Total Successful Calls**, plus **Incoming** and **Outgoing** versions — how
  many calls connected and were answered. (Worked out from the call history.)
- **Missed Calls** and **Failed Outgoing Calls** — calls that rang but were never
  answered. (Also from the call history.)
- **Call Overview** — a little bar chart showing what hours of the day were
  busiest.
- **Top Users** — which extensions made/took the most calls.
- **Recently added Users** — the newest desk phones added to the system.

**The controls work too.** The "Today" drop-down lets you switch the whole page
between Today / Yesterday / This Week / This Month / All Time. The "Select User"
box narrows everything to one extension. The little refresh circles re-load the
latest numbers. When there's no data for the chosen period, the page politely
shows "Record Not Found" — exactly like the real platform does.

**Behind the scenes.** To feed all of this, I added one new "data tap" to our
app's back end: a single request the page can make to get every number above in
one go (it bundles together the live calls, the connected phones, and a tidy
summary of the call history). This keeps the home screen fast.

**I tested it.** With no calls logged, every box correctly shows 0 and the
chart shows "Record Not Found" — matching the demo. Then I fed in a few
pretend call records and confirmed the boxes added them up correctly (successful
vs. missed, incoming vs. outgoing), the busy-hours chart filled in, and the Top
Users / Recently added lists populated. So the page isn't just a pretty picture
— it genuinely reflects the phone system.

---

## Step 3 — Switching the app on

You asked me to run the app. When I did, I found an **old copy of fs-hello had
been left running since two days ago**, quietly holding onto the "door" (port
3000) that the new version needs. Confusingly, that old copy was happy to show
the *new* home-screen design (because the design is just a file it reads fresh),
but it didn't understand the *new* data tap I'd added — so the numbers wouldn't
load.

I shut down the stale old copy and started the current version cleanly. Now:

- The app is running at **http://localhost:3000** on your PC — open that in your
  browser to see it.
- It's already pulling **real data**: your phone system has **20 extensions**
  set up, and they show up in the "Recently added Users" list straight away.
- The call counters read 0 for *today* simply because there are no calls logged
  yet today — flip the "Today" box to "All Time" to pull in older calls.

> One heads-up: that old copy was started by hand two days ago. If something on
> your PC automatically restarts fs-hello, tell me — otherwise the version I
> started will stop when this work session ends, and you'd switch it back on
> with the command `node index.js`.

---

## Step 4 — Filling in the full side menu

You sent me a set of screenshots showing **every item in the left-hand menu**,
including the ones hidden inside each category. I copied that structure exactly
into our app, so our side menu now matches the platform's. Here's the full menu
(categories in **bold**, with their items beneath):

- **Dashboard** (the home screen — the one that's fully built)
- **Managers** → Manager Role, Manager
- **Users** → User, User Group, User Role, SIP Device
- **Outgoing Rules** *(sub-items not shown yet)*
- **Incoming Rules** *(sub-items not shown yet)*
- **Lead Management** → Lead, Lead Group, Follow Up, Custom Field
- **Contact Center** → Inbound Campaign, Outbound Campaign, Blended Campaign,
  Disposition, DNC, Webform
- **Broadcasting** → Voice Broadcasting
- **Omnichannel** → WhatsApp, SMS & MMS *(each of these opens a further
  sub-menu, whose items weren't in the screenshots yet)*
- **Reports** → CDRs, Live Call, Missed Call, Realtime Report, Lead Report,
  Campaign Report, VoiceBroadcast Report, User Performance, Login Logout Report,
  Callback Queue Summary
- **Settings** → Audio Prompt, Email SMTP, Lead Status, Telecom Circle,
  Break Code
- **Integration** → Webhook

The menu expands and collapses just like the real one — click a category to open
its list, click again to close it. The categories that can hold a deeper
sub-menu (Omnichannel's WhatsApp and SMS & MMS) open up another level.

**An honest note on the gaps.** For two categories — **Outgoing Rules** and
**Incoming Rules** — and for the two Omnichannel sub-menus (**WhatsApp**,
**SMS & MMS**), the screenshots didn't reveal what's inside. (You've since sent
the **Users** items — User, User Group, User Role, SIP Device — and those are
now filled in.) I
deliberately did **not** make up items to fill them, because guessing would make
our app *look* finished while quietly being wrong. Instead, opening one of those
shows a small grey "— sub-items not provided yet —" note. Send me a screenshot
of those opened, and I'll slot the real items straight in.

**What the menu items do for now.** Only the **Dashboard** is a fully working
page. Every other menu item is present and clickable, but opening it shows a
friendly "This section isn't built yet" placeholder. That's intentional: we're
building real pages one at a time, in the order you choose. Just send the next
screenshot when you're ready.

---

## Step 5 — Building the "Manager Role" page (first real list page)

You sent a screenshot of the **Manager Role** page (found under **Managers → Manager
Role**) and asked me to build it for real. This is the first of many pages that
all share the same shape: a **table with a list of records**, plus buttons to
add, edit, delete, and switch things on/off. Because so many pages look like
this, I built it as a **reusable template** — so the next ones (Manager, User,
Disposition, and the rest) will be quick to add.

**What the page looks like and does** — exactly like the screenshot:

- A **"+ Create Manager Role"** button (green) and a **"Delete"** button (red).
- A **search box** ("Search by Keyword") and a **Filters** button.
- A **table** with tick-boxes, a **Name** column you can sort, a **Status**
  on/off switch, and **Action** buttons (edit ✏️, duplicate, delete 🗑️) on each row.
- A footer showing **"Showing 1 to 2 of 2 entries"**, a page-size chooser, a
  refresh button, a round green **+** button, and **Previous / Next** paging.

**It all genuinely works** (it's not a fake picture):

- **Create** opens a small pop-up to type a name and set it active; saving adds a
  real row.
- The **on/off switch** saves instantly.
- **Edit** (pencil) re-opens the pop-up to rename; **duplicate** makes a copy;
  **delete** removes the row (with a confirm prompt). Ticking several boxes and
  pressing the red **Delete** removes them all at once.
- **Search** filters as you type, the **Name** heading sorts the list, and
  **paging** kicks in when there are lots of rows.

**Where the data lives.** FreeSWITCH (the phone engine) has no idea what a
"Manager Role" is — that's a people/permissions concept, not a phone one. So our
app now keeps its own simple records in a small file on your PC (in a `data`
folder). Everything you create or change there is saved and will still be there
next time. To make the page look right the moment you open it, it starts with the
same two sample rows as the demo ("Manager Role" and "test man") — both fully
editable or deletable.

**A safety note.** The part of the app that stores these records only accepts a
fixed, approved list of record types. It can't be tricked into reading or writing
random files on your computer — I tested that a made-up record type is firmly
refused.

I tested the whole cycle — create, rename, switch on/off, duplicate, delete (one
and many) — and confirmed each one saves correctly. Refresh the app and open
**Managers → Manager Role** to use it.

---

## Step 6 — Making a safe backup copy on GitHub

You asked me to put the whole project onto **GitHub** (an online service that
safely stores copies of code and keeps a history of every change). Think of it
as a cloud backup plus a time machine for the app.

Before uploading, I did a quick safety sweep to make sure no private information
would go online — passwords, secret keys, that sort of thing. The only
"password" in the project is the well-known factory-default one that every
FreeSWITCH ships with (it's published in their manual), so nothing sensitive
left your PC. I also made sure the upload skips throwaway files and your local
data folder.

The project is now safely stored online at your **Tech4mation/fs-hello** space.
From here on, each meaningful change can be saved there too, so there's always a
recoverable copy.

---

## Step 7 — Trimming the side menu to what you actually use

You told me which menu categories to keep and to remove the rest. So the long
list from Step 4 is now slimmed down to the essentials: **Dashboard, Managers,
Users, Outgoing Rules, Incoming Rules, Contact Center, Reports, and Settings**.
I took out Lead Management, Broadcasting, Omnichannel, and Integration. (You then
asked me to keep **Dashboard** at the top, so it stays as the home button.)

Nothing was lost permanently — these are just hidden from the menu, and any of
them can be brought back in seconds if you change your mind.

---

## Step 8 — Turning "Create Manager Role" into a real permissions page

The first version of Manager Role (Step 5) used a tiny pop-up that only asked
for a name. You then sent a screenshot of the platform's **full** "Create
Manager Role" screen, which is much richer — so I rebuilt it as a proper
full-page form, matching the screenshot.

It now has:

- A **Role Name** box.
- **Status** (Enable / Disable) and **Admin Access** (Enable / Disable)
  switches.
- A list of **permission areas** — Users, Outgoing Rules, Incoming Rules,
  Contact Center, Reports, Settings — each with a tick-box. The ones that have
  sub-sections (like Users) **expand** with a **+** button to reveal finer
  tick-boxes (User, User Group, User Role, SIP Device, and so on). Ticking the
  big box ticks everything under it; ticking some shows a "partly selected"
  state.

When you save, the app remembers exactly which permissions you switched on for
that role. The permission list is wired to the side menu, so if we add or rename
a section later, this page updates itself automatically. I tested creating and
re-opening a role and confirmed the permission choices are saved and restored.

---

## Step 9 — Building the "Manager" page (the people)

Next you asked for the **Manager** page itself (the actual staff accounts, found
under **Managers → Manager**). It has a table listing each manager — **First
Name, Last Name, Username, Email, Manager Role, SIP Device, Status** — with the
usual add / edit / delete / search controls.

The **Create Manager** screen is a full form (matching your screenshot) with
First/Last name, Username, Email, a **Password box with a show/hide eye**, a
**Manager Role** drop-down, a Language choice, and **Allow Monitoring** /
**Status** switches. The clever bit: the Manager Role drop-down is filled
**live** from the Manager Role page you built in Step 8 — so the two pages stay
in step. I seeded it with the two sample managers from your screenshot, and
tested that creating a new one saves every field.

---

## Step 10 — Building the "User" page (agents / desk users)

Then the **Users → User** page. Same idea, bigger form. The table shows **Name,
Username, User Group, User Role, Default SIP Device, Call Recording, Status**,
and the **Create User** screen has the full 14-field layout from your
screenshot: name, username, email, password, a default time-out, **User Role**
and **User Group** drop-downs, Zoho ID, SIP username, plus **Call Recording** and
**Status** switches.

A few of the drop-downs on the platform's form (WhatsApp Setting, SMS Setting,
Caller ID Number) belong to features this app doesn't have yet, so for now they
show their "Select…" prompt and stay empty — ready to wire up later. The User
Role and User Group drop-downs, though, are real and pull from their own lists. I
seeded the five sample users from your screenshot and confirmed create/save
works.

---

## Step 11 — Building the "User Group" page

The **Users → User Group** page followed the same pattern: a table (**Name,
Outgoing Rule, Status**) and a **Create User Group** form with an **Outgoing
Rule** drop-down, Language, Status, and a few placeholder drop-downs for features
that don't exist yet (Campaigns, WhatsApp, SMS, Caller ID Group).

To make the Outgoing Rule drop-down meaningful, I created a small new list of
outgoing rules behind the scenes (Default, Nativetalk, QATest) — so it shows real
choices instead of being empty. I seeded the three sample groups from your
screenshot.

---

## Step 12 — The call history report ("CDRs")

Under **Reports → CDRs** ("CDR" = Call Detail Record, the phone world's word for
a call-history line). Unlike the pages above, this one is **read-only** — you
don't create or delete anything, you just look. It reads the phone system's own
call-log file and shows each call: **Date, Caller ID Number, Phone Number, User,
Duration, Hangup Cause, Direction**, with a search box.

When there are no calls it shows the same friendly "No data found?" magnifying-
glass screen the real platform uses. Your PC already had about 20 logged calls,
so they show up straight away. One honest caveat: the log file doesn't actually
record whether a call was incoming or outgoing, so the **Direction** column is a
sensible guess based on the phone numbers involved.

---

## Step 13 — The rest of the Reports section

You sent screenshots of seven report pages at once. We agreed on a sensible
split: the ones that can show **real** data from your phone system, I wired up
for real; the ones that need a call-campaign system this app doesn't have, I
built as faithful **empty layouts** (correct columns and the "No data found?"
screen) ready to fill in later.

**Wired to real data:**

- **Live Call** — the calls happening *right now*, with a **Hang up** button on
  each, and it **auto-refreshes** every 30 seconds (you can pick 10/30/60) with a
  little countdown.
- **Missed Call** — pulled from the call history, showing calls that were never
  answered.
- **User Performance** — adds up each extension's calls from the history
  (inbound/outbound counts, talk time, average call length). The agent-specific
  columns the platform tracks (login time, break time, etc.) show as zeros,
  because this app doesn't track agent shift activity.

**Built as empty layouts (no made-up data):** Realtime Report, Lead Report,
Campaign Report, and VoiceBroadcast Report. The **Realtime Report** does show its
row of summary cards, and two of those — *Active Calls* and *Missed Calls* — show
real live numbers; the rest stay at zero.

---

## Step 14 — The Outbound Campaign autodialer (the big one)

This is the first feature that *does* something active rather than just showing
information. You asked for an **autodialer**: give it a list of phone numbers and
it calls them automatically.

First the **Outbound Campaign** page (under **Contact Center**): a table of
campaigns (**Name, Dial Method, Outgoing Rule, Status**) and a **Create Outbound
Campaign** form. The form has the usual settings plus a big **box where you paste
your phone numbers** (one per line, or comma-separated), a **Gateway** (which
phone line/trunk to dial out through), and an **Audio File** to play.

We agreed on two important choices about how it behaves:

1. **When someone answers, it plays a recorded audio message**, then hangs up —
   like an announcement or voice broadcast. (No live agent is involved.)
2. **It dials strictly one number at a time** — it finishes one call before
   starting the next. Safest and easiest to follow.

Each campaign row has a **dialer button** that opens a **live control screen**:
a **Start dialing** button, a **Stop** button, and a table that updates in real
time showing each number's progress — *queued → dialing → answered / failed* —
along with running totals. Before it starts, it asks you to confirm, because this
places **real outbound phone calls**.

**An important safety point:** real calls only happen when the phone system
(FreeSWITCH) is switched on and connected. Right now it's off, so I tested the
whole machine safely: I gave it a few numbers, pressed start, and watched it work
through them one by one in order — correctly skipping an invalid entry, marking
each as "failed" with the reason "can't reach the phone system" (exactly right,
since it's off), and finishing cleanly. The moment FreeSWITCH is running, those
same steps will place actual calls and play your audio.

---

## Step 15 — Building out the whole Contact Center (deep dive)

You asked me to look at the live Nativetalk platform again and "build it out
completely." I read the platform's own code (the public files its website sends
to your browser) and from that pulled the **full list of everything it does** —
over 200 separate functions. It's a big professional call-centre product, far
too much to clone in one sitting, so together we picked a direction: build the
**Contact Center** — the part that actually makes and manages calls — properly
and deeply, on **your own** phone system (not plugged into theirs).

Here's what I added, in plain terms:

**New pages in the Contact Center menu**

- **Disposition** — the list of call outcomes (Sale, Callback, Not Interested,
  No Answer, Busy, etc.). These are the labels your campaigns tag each call with.
- **DNC (Do Not Call)** — a blocklist of numbers that must never be dialled. You
  can paste in many numbers at once. The autodialer now **automatically skips**
  any number on this list.
- **Inbound Campaign** — settings for handling *incoming* calls (which number
  they arrive on, where they're routed, the greeting, recording).
- **Blended Campaign** — a mix of incoming and outgoing in one campaign; it can
  also auto-dial a list of numbers, just like the outbound one.
- **Webform** — a little "call me back" form you can paste into any website.
  When a visitor enters their number, your system rings your agent and connects
  them to the visitor. Each form comes with a ready-to-copy snippet, and there's
  a "test callback" button to try it.

**The autodialer got much smarter.** It used to just dial each number once and
play a message. Now it also:

- **skips Do-Not-Call numbers** automatically,
- **retries** numbers that didn't answer or were busy, up to a limit you set,
- can **dial several lines at once** (for the faster "Auto/Power" methods),
- can **record** the calls,
- can pull its numbers from a saved **Lead Group** as well as the paste box,
- gives **every call a disposition** (you can also set it by hand from the live
  dialer screen), and
- **saves the results**, which now feed the **Campaign Report** and
  **VoiceBroadcast Report** with real numbers instead of empty tables.

**Supervisor monitoring.** On the **Live Call** report, each ongoing call now has
**Listen / Whisper / Barge** buttons — a supervisor can silently listen, speak
only to the agent, or fully join the call.

**I tested all of it against the real phone engine.** It turned out **FreeSWITCH
is actually running on this PC**, so these weren't pretend tests: I created a
campaign, started it, and watched it correctly **skip the DNC number**, **retry**
the right ones, place real call attempts, report the genuine reason each call
ended (e.g. "USER_NOT_REGISTERED" — because no desk phone was logged in to
answer), tag each with a disposition, and roll the totals into the Campaign
Report. The webform callback, the monitoring buttons, and the blended dialer all
fired real commands to the phone engine too.

> Honest note: the calls "failed" only because no softphone was signed in to
> receive them — the dialer itself did everything correctly. Sign a softphone in
> (extension 1000, as in Step 3) and the same run will connect and play audio.

---

## Where things stand & a recurring heads-up

The app now has a working Dashboard, the People pages (Manager Role, Manager,
User, User Group), the Reports section, and the Outbound Campaign autodialer —
all built to match the screenshots you sent, and all fed by real data wherever
the data exists.

The same heads-up from Step 3 still applies: the app runs while we're working
(at **http://localhost:3000**). If it ever stops, switch it back on with
`node index.js` from the project folder. And anything that places or shows live
calls needs **FreeSWITCH** to be running.
