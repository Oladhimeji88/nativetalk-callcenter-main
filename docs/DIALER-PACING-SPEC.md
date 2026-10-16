# Dialer pacing spec — Power & Predictive

Design for real over-dial pacing. Draft for review. No code yet.

## 1. Where we are today

The dialer loop (`dialer.service.ts` `loop()`) decides how many new calls to start
each tick:

- **Progressive** — `slots = freeAgents − callsInFlight`. One call per free agent.
  Never over-dials. Works well.
- **Power / Predictive** — `slots = concurrency − callsInFlight`. Keeps a **flat**
  number of simultaneous calls, ignoring how many agents are free. So with few
  agents it floods (many callers wait), with many it under-uses them. Predictive
  is currently identical to Power (no algorithm) and isn't even selectable in the
  wizard.
- **Abandon behaviour** — an answered call runs the `callcenter` app and enters the
  ACD queue. If no agent is free it **waits on hold**; it is not dropped. So today's
  real risk from over-dialing is *callers waiting*, not classic "abandoned" drops.

## 2. What we want

Tie over-dialing to the number of free agents, so we keep agents busy without
building a pile of waiting callers.

Terms used below:
- **F** = free agents (Available + Waiting; already computed by `availableAgents()`)
- **D** = calls currently dialing/ringing (not yet answered)
- **W** = answered calls waiting in the ACD queue (no agent yet)
- **C** = concurrency cap (campaign setting, further capped by the tenant plan)
- **R** = over-dial ratio (calls to start per free agent)
- **p** = live answer rate (answered ÷ dialed, this run)
- **A** = target maximum abandon rate (e.g. 3%)

"Effective free" capacity = `max(0, F − W)` — if callers are already waiting, agents
are effectively spoken for, so don't pile on more.

## 3. Power (fixed ratio)

The admin sets a fixed ratio **R** (e.g. 2.0 = dial 2 per free agent). Rationale: if
about half of dials are answered, dialing 2× the free agents yields ~1 connect each.

```
target   = round(R × max(0, F − W))
slots    = clamp(target − D, 0, C − D − W)
```

- With R = 1 this is Progressive.
- As agents get busy (F falls), it dials less — self-limiting, unlike today's flat cap.
- `C` (and the plan's max concurrent calls) is still the hard ceiling.

## 4. Predictive (dynamic ratio)

Same shape as Power, but **R is computed live** and corrected by the abandon rate —
a simple feedback controller, re-evaluated each tick:

```
p       = clamp(answered / max(dialed, 1), 0.1, 1)     // floor 0.1 avoids huge R
Rbase   = 1 / p                                          // dial enough for ~1 connect/agent
abandon = abandoned / max(answered, 1)
R       = abandon > A  ? Rbase × 0.8                     // too many drops → back off
        : abandon < A/2 ? min(Rbase, Rmax)               // headroom → lean in
        : Rprev                                          // steady
R       = clamp(R, 1, Rmax)                              // Rmax e.g. 3
```

Then pace exactly as Power with this R. Notes:
- Needs volume to be meaningful. With 1–2 agents it naturally degrades toward Power.
- Start simple (answer-rate + abandon feedback). A later refinement can factor in
  average talk time and agents in wrap-up to predict who frees up during ring time.

## 5. Abandoned-call handling (maps to mod_callcenter)

Over-dialing means some answered calls arrive with no agent free. Two options:

- **Hold (today's behaviour)** — they wait in the ACD queue for the next agent.
  Fine if we pace so W stays small.
- **Drop with apology (classic predictive)** — set the queue's no-agent timeout so a
  caller who waits too long is removed, routed to a short apology message, and hung
  up. mod_callcenter supports `max-wait-time-with-no-agent` /
  `…-time-reached`; the callcenter.conf we serve via xml_curl would set these, and a
  small dialplan exit plays the apology and logs the call as **abandoned**.

Recommend: ship pacing with **hold** first (low risk), add **drop-with-apology** as a
second step once pacing is proven.

## 6. New data + metrics

Campaign fields (Prisma):
- `overdialRatio Float @default(1)` — Power's fixed R; Predictive's cap/initial.
- `abandonTargetPct Float @default(3)` — Predictive target A.
- add `Predictive` to the `dialMethod` options.

Run metrics (already tracked partly; extend the pulse + campaign report):
- dialed, answered (reached queue), bridged (reached agent), **abandoned**.
- answerRate = answered/dialed, abandonRate = abandoned/answered.
- Surface abandonRate live so Predictive's behaviour is visible and tunable.

## 7. UI (Campaign Wizard)

- Add **Predictive** to the mode list.
- **Power**: show "Over-dial ratio (calls per free agent)" (e.g. 1.5–3).
- **Predictive**: show "Target abandon rate (%)" (ratio is automatic).
- Both keep the existing "Concurrency (max simultaneous calls)" as the hard cap.
- Copy should warn that over-dialing can cause waiting/abandoned calls.

## 8. Testing & risk

- **Unit-test the pacing math**: given F, D, W, R, C → expected `slots`. Deterministic,
  no telephony. This is where correctness is proven.
- **Integration**: with 2–3 test agents + a small list, watch the existing LOOP /
  READY / DIAL trace to see over-dial behaviour and queue build-up.
- **Cannot fully validate** abandon rates without real answer patterns and several
  agents — predictive tuning is empirical.
- **Compliance**: many places cap abandon rate (~3–5%) and require an apology message
  when a call is abandoned. Predictive without drop-with-apology + a capped rate is a
  regulatory risk — factor this into whether/when to enable Predictive in production.

## 9. Suggested build order

1. **Power ratio pacing** — new `overdialRatio` field + the Power formula in `loop()`
   + wizard field. Unit tests. Lower risk, immediately useful. **[done]**
2. **Metrics** — track/pace on answered vs bridged vs abandoned; surface abandonRate. **[done]**
3. **Drop-with-apology** — queue no-agent timeout + apology exit + abandoned logging. **[done]**
4. **Predictive** — the dynamic-R controller on top of 1–3, plus wizard target field. **[done]**

### Stage 4 as built

- New pure controller `computePredictiveRatio` (pacing.ts, 8 unit cases): warm-up
  hold until 8 dials resolve, then `Rbase = 1/answerRate` corrected by abandon rate
  vs target A (above A → ×0.8; below A/2 → lean to Rbase; else steady), clamped
  to [1, `MAX_OVERDIAL_RATIO`=3].
- Campaign gains `abandonTargetPct` (default 3); `Predictive` added to `dialMethod`.
- `loop()` splits Power (fixed ratio) from Predictive (re-derives `curRatio` each
  tick from the run's resolved dials / answered / abandoned), then paces both via
  `computeOverdialSlots`. The live ratio is stored on the run and surfaced on the
  pulse + run monitor ("dial-ahead 1.80× (auto)").
- Wizard: Predictive option, self-tuning description, "starting ratio" relabel, and
  a "Target abandon rate (%)" field.

### Stage 3 as built

- Campaign queues carry a **45s `max-wait-time`** (`DIALER_MAX_WAIT_SEC` in
  `fs-xml.service`); the inbound `support` queue stays unbounded (`0`).
- The answered customer leg is originated into a served **`ccx-<campaignId>`**
  dialplan (not `&callcenter` directly): it joins the queue, and if the caller is
  released without ever reaching an agent (max-wait), the `callcenter` app returns
  on a still-live channel and we **play a short apology** (`ivr-im_sorry` +
  `ivr-thank_you_for_calling`) then hang up. On a successful bridge the channel is
  already gone when the agent ends, so the trailing actions are no-ops.
- Abandon counting is unchanged: a `member-queue-end` with no prior bridge is
  already counted as abandoned, so a max-wait drop is captured automatically.
- `loadQueue` now falls back to `callcenter_config queue reload` when the queue is
  already loaded, so config changes (like max-wait) take effect on the next run.
