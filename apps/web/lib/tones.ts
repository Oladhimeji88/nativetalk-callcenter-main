// Web Audio call tones for the softphone: DTMF key beeps, ringback (caller side
// while the far end rings) and ringtone (callee side on an incoming call).
// All tones are synthesised — no audio files to ship or preload.

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume().catch(() => { /* ignore */ });
  return ctx;
}

// Call from a user gesture (click Call/Answer/keypad) so the AudioContext is
// allowed to produce sound — browsers block audio until the user interacts.
export function unlockAudio() { ac(); }

// Standard DTMF dual-tone frequency pairs (low row, high column).
const DTMF: Record<string, [number, number]> = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
  '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
};

export function playDtmf(key: string, ms = 140): void {
  const c = ac();
  const pair = DTMF[key];
  if (!c || !pair) return;
  const now = c.currentTime;
  const end = now + ms / 1000;
  const gain = c.createGain();
  gain.connect(c.destination);
  // Short attack/release so it doesn't click.
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
  gain.gain.setValueAtTime(0.2, end - 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  for (const f of pair) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    o.connect(gain);
    o.start(now);
    o.stop(end + 0.02);
  }
}

type Stop = () => void;

// Repeating cadence: play `freqs` together for onMs, silent for offMs, repeat.
function toneLoop(freqs: number[], onMs: number, offMs: number, vol = 0.12): Stop {
  const c = ac();
  if (!c) return () => { /* noop */ };
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const burst = () => {
    if (stopped) return;
    const now = c.currentTime;
    const end = now + onMs / 1000;
    const gain = c.createGain();
    gain.connect(c.destination);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(vol, now + 0.02);
    gain.gain.setValueAtTime(vol, end - 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    for (const f of freqs) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(gain);
      o.start(now);
      o.stop(end + 0.02);
    }
    timer = setTimeout(burst, onMs + offMs);
  };
  burst();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

// Ringback (caller hears this while the callee's phone rings): 440+480 Hz,
// 2s on / 4s off — the classic call-progress cadence.
let stopRingbackFn: Stop | null = null;
export function startRingback(): void {
  if (stopRingbackFn) return;
  stopRingbackFn = toneLoop([440, 480], 2000, 4000, 0.11);
}
export function stopRingback(): void { stopRingbackFn?.(); stopRingbackFn = null; }

// Ringtone (callee hears this on an incoming call): a brisker, higher double-ring
// so it's clearly distinct from ringback.
let stopRingtoneFn: Stop | null = null;
export function startRingtone(): void {
  if (stopRingtoneFn) return;
  stopRingtoneFn = toneLoop([480, 620], 900, 700, 0.16);
}
export function stopRingtone(): void { stopRingtoneFn?.(); stopRingtoneFn = null; }

export function stopAllTones(): void { stopRingback(); stopRingtone(); }

// One-shot "call ended / declined" cue — three quick beeps (the familiar
// pam-pam-pam). Plays once, then stops on its own.
export function playCallEnded(): void {
  const c = ac();
  if (!c) return;
  const freqs = [480, 620];
  const beep = 0.18;  // seconds on
  const gap = 0.11;   // seconds between beeps
  let t = c.currentTime + 0.01;
  for (let i = 0; i < 3; i++) {
    const on = t;
    const off = t + beep;
    const gain = c.createGain();
    gain.connect(c.destination);
    gain.gain.setValueAtTime(0.0001, on);
    gain.gain.exponentialRampToValueAtTime(0.2, on + 0.01);
    gain.gain.setValueAtTime(0.2, off - 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, off);
    for (const f of freqs) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(gain);
      o.start(on);
      o.stop(off + 0.02);
    }
    t = off + gap;
  }
}
