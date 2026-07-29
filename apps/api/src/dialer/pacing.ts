/**
 * Power / Predictive over-dial pacing: how many NEW calls to start this tick.
 *
 * Over-dial scales with free agents (ratio × effective-free), where effective-free
 * subtracts callers already waiting so we don't pile onto a saturated queue. Never
 * exceeds the concurrency cap (counting calls already dialing + waiting).
 *
 * Pure + deterministic (no I/O) so it can be unit-tested. ratio = 1 reduces to
 * progressive-style 1:1 pacing.
 */
export function computeOverdialSlots(p: { free: number; dialing: number; waiting: number; ratio: number; cap: number }): number {
  const free = Math.max(0, p.free);
  const waiting = Math.max(0, p.waiting);
  const effFree = Math.max(0, free - waiting);
  const target = Math.round(p.ratio * effFree);
  const byTarget = target - p.dialing;        // don't exceed the over-dial target
  const byCap = p.cap - p.dialing - waiting;   // never exceed the hard concurrency cap
  return Math.max(0, Math.min(byTarget, byCap));
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Predictive over-dial ratio: a simple feedback controller re-evaluated each tick.
 *
 * Aims to dial enough to keep agents busy (R ≈ 1 / answer-rate) while holding the
 * abandon rate at/under target. Above target → back off; well under → lean in;
 * otherwise hold steady. Result is clamped to [1, maxRatio] and fed to
 * computeOverdialSlots just like Power's fixed ratio.
 *
 * Warm-up: until `minSample` dials have resolved, the answer/abandon rates are too
 * noisy to trust, so we hold the previous (initial) ratio. Pure + deterministic.
 */
export function computePredictiveRatio(p: {
  dialed: number;           // resolved dial attempts this run (answered + failed)
  answered: number;         // dials that connected (reached the queue)
  abandoned: number;        // answered calls that left the queue without an agent
  prevRatio: number;        // the ratio in effect last tick (starts at the campaign's R)
  targetAbandonPct: number; // target max abandon rate, percent (e.g. 3)
  maxRatio: number;         // hard safety ceiling (e.g. 3)
  minSample?: number;       // dials required before the controller acts (default 8)
}): number {
  const prev = clamp(p.prevRatio || 1, 1, p.maxRatio);
  const dialed = Math.max(0, p.dialed);
  const answered = Math.max(0, p.answered);
  const abandoned = Math.max(0, p.abandoned);
  const minSample = p.minSample ?? 8;
  if (dialed < minSample) return prev; // not enough data yet — hold steady

  const A = Math.max(0, p.targetAbandonPct) / 100;
  const answerRate = clamp(answered / Math.max(dialed, 1), 0.1, 1); // floor avoids huge R
  const Rbase = 1 / answerRate;
  const abandonRate = abandoned / Math.max(answered, 1);

  let R: number;
  if (abandonRate > A) R = prev * 0.8;                           // too many drops → back off
  else if (abandonRate < A / 2) R = Math.min(Rbase, p.maxRatio); // headroom → lean in
  else R = prev;                                                 // steady
  return clamp(R, 1, p.maxRatio);
}
