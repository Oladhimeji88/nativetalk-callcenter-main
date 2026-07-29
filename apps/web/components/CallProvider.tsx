'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Web } from 'sip.js';
import { toast } from 'sonner';
import { Phone, PhoneOff } from 'lucide-react';
import { api, getUser, hasPermission, API_BASE } from '@/lib/api';
import { DEMO } from '@/lib/demo';
import {
  playDtmf, unlockAudio, startRingback, stopRingback, stopAllTones, playCallEnded,
} from '@/lib/tones';

// Map a SIP final-response code to a plain-language reason an outbound call
// didn't connect. Falls back to a generic phrase for anything unmapped.
function failureReason(code: number | null): string {
  switch (code) {
    case 486: case 600: return 'the line was busy';
    case 480:           return "they're unavailable (offline or not registered)";
    case 404: case 604: return 'the number is not in service';
    case 603:           return 'the call was declined';
    case 408: case 487: return 'no answer';
    case 403:           return 'the call was not allowed';
    default:            return 'no answer or unreachable';
  }
}

export type Phase = 'offline' | 'connecting' | 'registered' | 'incoming' | 'outgoing' | 'incall';
export type Disposition = { name: string; code?: string; category?: string };

export const DEFAULT_DISPOSITIONS: Disposition[] = [
  { name: 'Answered — Spoke',   code: 'ANSWERED',  category: 'Success' },
  { name: 'No Answer',          code: 'NO_ANSWER', category: 'Retry' },
  { name: 'Busy',               code: 'BUSY',      category: 'Retry' },
  { name: 'Wrong Number',       code: 'WRONG',     category: 'Failure' },
  { name: 'Callback Requested', code: 'CALLBACK',  category: 'Callback' },
  { name: 'Do Not Call',        code: 'DNC',       category: 'DNC' },
];

type CallContextValue = {
  user: any;
  ext: string;
  phase: Phase;
  dest: string; setDest: (v: string | ((d: string) => string)) => void;
  peer: string;
  muted: boolean;
  held: boolean;
  seconds: number;
  err: string;
  reconnecting: boolean;
  dispositions: Disposition[];
  selectedDisp: string; setSelectedDisp: (v: string) => void;
  dispNotes: string; setDispNotes: (v: string) => void;
  custNotes: string; setCustNotes: (v: string) => void;
  contact: any;
  interactions: any[];
  notesSaved: boolean;
  wrapUp: boolean;
  callFailed: string; // set when an outbound call ended without ever connecting
  clearCallFailed: () => void;
  clearWrapUp: () => void;
  setActiveCampaign: (id: string | null) => void;
  demo: boolean;
  campaign: any;
  lead: any;
  previewLoading: boolean;
  previewDone: boolean;
  previewEmpty: boolean;
  startPreview: (campaignId: string) => void;
  nextLead: () => void;
  dialLead: () => void;
  skipLead: () => void;
  endPreview: () => void;
  connect: (ext?: string) => void;
  retryNow: () => void;
  placeCall: () => void;
  callNumber: (number: string) => void;
  answer: () => void;
  decline: () => void;
  hangup: () => void;
  toggleMute: () => void;
  toggleHold: () => void;
  dtmf: (k: string) => void;
  dialKey: (k: string) => void;
  transfer: () => void;
  submitDisposition: () => void;
  saveCustomerNotes: () => void;
  startDemo: () => void;
  stopDemo: () => void;
};

const CallContext = createContext<CallContextValue | null>(null);
export const useCall = () => {
  const c = useContext(CallContext);
  if (!c) throw new Error('useCall must be used within <CallProvider>');
  return c;
};

export function CallProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const audioRef = useRef<HTMLAudioElement>(null);
  const ringtoneRef = useRef<HTMLAudioElement>(null);
  const suRef = useRef<any>(null);
  const timer = useRef<any>(null);

  const playRingtone = () => {
    const a = ringtoneRef.current;
    if (!a) return;
    a.loop = true; a.volume = 0.9;
    try { a.currentTime = 0; } catch { /* ignore */ }
    a.play().catch(() => { /* blocked until a user gesture */ });
  };
  const stopRingtone = () => {
    const a = ringtoneRef.current;
    if (!a) return;
    a.pause();
    try { a.currentTime = 0; } catch { /* ignore */ }
  };

  const [user, setUser] = useState<any>(null);
  const [ext, setExt] = useState('');
  const [phase, setPhase] = useState<Phase>('offline');
  const [domain, setDomain] = useState('');
  const [dest, setDest] = useState('');
  const [peer, setPeer] = useState('');
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [err, setErr] = useState('');
  const [reconnecting, setReconnecting] = useState(false);

  const extRef = useRef('');
  const stoppedRef = useRef(false);
  const connectingRef = useRef(false);
  const reconnectRef = useRef<any>(null);
  const attemptRef = useRef(0);
  const genRef = useRef(0);

  const [dispositions, setDispositions] = useState<Disposition[]>(DEFAULT_DISPOSITIONS);
  const [campaignDispIds, setCampaignDispIds] = useState<string[] | null>(null); // per-campaign disposition allowlist (null = all)
  const [selectedDisp, setSelectedDisp] = useState('');
  const [dispNotes, setDispNotes] = useState('');
  const [custNotes, setCustNotes] = useState('');

  const [contact, setContact] = useState<any>(null);
  const [interactions, setInteractions] = useState<any[]>([]);
  const [notesSaved, setNotesSaved] = useState(false);
  const [wrapUp, setWrapUp] = useState(false); // after-call work: call ended, disposition pending
  const [callFailed, setCallFailed] = useState(''); // outbound call ended without connecting
  const clearCallFailed = () => setCallFailed('');
  // Dismiss the after-call (wrap-up) card and go back to the ready dialer.
  const clearWrapUp = () => {
    if (wrapUpTimerRef.current) { clearTimeout(wrapUpTimerRef.current); wrapUpTimerRef.current = null; }
    setWrapUp(false); setCallFailed('');
  };

  // Campaign preview mode: the agent works a campaign one lead at a time.
  const [campaign, setCampaign] = useState<any>(null);
  const [lead, setLead] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewDone, setPreviewDone] = useState(false);
  const [previewEmpty, setPreviewEmpty] = useState(false);
  const campaignRef = useRef<string | null>(null);
  const leadRef = useRef<any>(null);
  // The progressive/auto-dial campaign the agent is "played into" (set by the
  // Console). Calls bridged from its ACD queue are dispositioned against it.
  const activeCampaignRef = useRef<string | null>(null);
  const setActiveCampaign = (id: string | null) => { activeCampaignRef.current = id; };
  const campaignRecordingRef = useRef(false);
  const recordFileRef = useRef<string | null>(null);
  const lastDurationRef = useRef(0);
  const lastStatusRef = useRef<string>('completed');

  const peerRef = useRef('');
  const contactRef = useRef<any>(null);
  const callDirRef = useRef<'outbound' | 'inbound'>('outbound');
  const callStartRef = useRef<number>(0);
  const answeredAtRef = useRef<number | null>(null);
  const lastLogIdRef = useRef<string | null>(null);
  const previewLogIdRef = useRef<string | null>(null); // CallLog of the last preview attempt (updated on disposition)
  const failureCodeRef = useRef<number | null>(null); // SIP status of the last outbound reject (for a precise "didn't connect" reason)
  const disposingRef = useRef(false); // a disposition submit is mid-flight (don't double-log on the induced hangup)
  const hangupByRef = useRef<'agent' | null>(null); // set when the agent ends the call; else the customer (remote) did
  const wrapUpTimerRef = useRef<any>(null); // auto-clears wrap-up for ad-hoc (non-campaign) calls
  const demoCallRef = useRef<any>(null); // UI-only mode: pending "remote answered" timer
  const selectedDispRef = useRef('');
  const dispNotesRef = useRef('');
  useEffect(() => { selectedDispRef.current = selectedDisp; }, [selectedDisp]);
  useEffect(() => { dispNotesRef.current = dispNotes; }, [dispNotes]);

  async function loadCustomer(number: string) {
    setContact(null); contactRef.current = null; setInteractions([]); setCustNotes('');
    if (!number) return;
    const [c, rows] = await Promise.all([
      api(`/contacts/lookup?phone=${encodeURIComponent(number)}`).catch(() => null),
      api(`/call-logs?peer=${encodeURIComponent(number)}&exact=1&limit=20`).catch(() => []),
    ]);
    if (peerRef.current !== number) return;
    if (c) { setContact(c); contactRef.current = c; if (c.notes) setCustNotes(c.notes); }
    setInteractions(rows || []);
  }

  async function saveCustomerNotes() {
    const text = custNotes;
    const number = peerRef.current;
    if (!contactRef.current && !text.trim()) return;
    try {
      let c: any = null;
      if (contactRef.current?.id) {
        c = await api(`/contacts/${contactRef.current.id}`, { method: 'PATCH', body: JSON.stringify({ notes: text }) });
      } else if (number) {
        c = await api('/contacts', { method: 'POST', body: JSON.stringify({ phone: number, notes: text }) });
      }
      if (c) { setContact(c); contactRef.current = c; }
      setNotesSaved(true); setTimeout(() => setNotesSaved(false), 2000);
    } catch { /* ignore */ }
  }

  async function logCall(extra: Record<string, unknown> = {}) {
    const number = peerRef.current;
    if (!number) return null;
    const answered = answeredAtRef.current;
    const durationSec = answered ? Math.round((Date.now() - answered) / 1000) : 0;
    const status = answered ? 'completed' : (callDirRef.current === 'inbound' ? 'missed' : 'no-answer');
    // Who ended the call: the agent if they hung up/declined, otherwise the
    // customer (remote BYE) for a connected call. Unknown for a call that never
    // connected (no answer / failed).
    const disconnectedBy = hangupByRef.current === 'agent' ? 'agent' : (answered ? 'customer' : null);
    try {
      const log = await api('/call-logs', {
        method: 'POST',
        body: JSON.stringify({
          direction: callDirRef.current,
          peerNumber: number,
          durationSec,
          status,
          disconnectedBy,
          contactId: contactRef.current?.id ?? null,
          campaignId: activeCampaignRef.current ?? undefined,
          startedAt: new Date(callStartRef.current || Date.now()).toISOString(),
          disposition: selectedDispRef.current || undefined,
          notes: dispNotesRef.current || undefined,
          ...extra,
        }),
      });
      lastLogIdRef.current = log?.id ?? null;
      if (log && number === peerRef.current) setInteractions((prev) => [log, ...prev]);
      return log;
    } catch { return null; }
  }

  // Log a preview-campaign call attempt the moment it ends, so every dial shows
  // up in history even before the agent picks a disposition. The disposition
  // later updates this same record (via previewLogIdRef) rather than duplicating.
  async function logPreviewAttempt() {
    const cid = campaignRef.current;
    const number = peerRef.current;
    if (!cid || !number) return;
    const answered = answeredAtRef.current;
    const durationSec = answered ? Math.round((Date.now() - answered) / 1000) : 0;
    const status = answered ? 'completed' : 'no-answer';
    const disconnectedBy = hangupByRef.current === 'agent' ? 'agent' : (answered ? 'customer' : null);
    try {
      const log = await api(`/campaigns/${cid}/preview/log`, {
        method: 'POST',
        body: JSON.stringify({
          leadId: leadRef.current?.id,
          peerNumber: number,
          durationSec,
          status,
          disconnectedBy,
          contactId: contactRef.current?.id ?? null,
          recording: recordFileRef.current || undefined,
          startedAt: new Date(callStartRef.current || Date.now()).toISOString(),
        }),
      });
      previewLogIdRef.current = log?.id ?? null;
      if (log && number === peerRef.current) setInteractions((prev) => [log, ...prev]);
    } catch { /* ignore */ }
  }

  // Screen-pop the current lead into the Customer panel (contact + history)
  // without placing a call yet.
  function popLead(number: string, c: any) {
    setPeer(number); peerRef.current = number;
    setContact(c || null); contactRef.current = c || null;
    setCustNotes(c?.notes || '');
    api(`/call-logs?peer=${encodeURIComponent(number)}&exact=1&limit=20`).then((rows) => {
      if (peerRef.current === number) setInteractions(rows || []);
    }).catch(() => { /* ignore */ });
  }

  function clearScreenPop() {
    setPeer(''); peerRef.current = '';
    setContact(null); contactRef.current = null;
    setInteractions([]); setCustNotes('');
  }

  async function nextLead(campaignId?: string) {
    const cid = campaignId || campaignRef.current;
    if (!cid) return;
    setPreviewLoading(true);
    setSelectedDisp(''); setDispNotes(''); setWrapUp(false); setCallFailed('');
    try {
      const r = await api(`/campaigns/${cid}/preview/next`);
      campaignRef.current = cid;
      campaignRecordingRef.current = !!r?.campaign?.recording;
      recordFileRef.current = null;
      const dispIds: string[] = r?.campaign?.dispositionIds ?? [];
      setCampaignDispIds(dispIds.length ? dispIds : null);
      if (r?.campaign) setCampaign(r.campaign);
      if (r?.done || !r?.lead) {
        setPreviewDone(true); setPreviewEmpty((r?.total ?? 0) === 0);
        setLead(null); leadRef.current = null;
        clearScreenPop();
      } else {
        setPreviewDone(false); setPreviewEmpty(false);
        setLead(r.lead); leadRef.current = r.lead;
        popLead(r.lead.phone, r.contact);
      }
    } catch { /* ignore */ }
    finally { setPreviewLoading(false); }
  }

  const startPreview = async (campaignId: string) => {
    campaignRef.current = campaignId;
    try { localStorage.setItem('nt_preview_campaign', campaignId); } catch { /* ignore */ }
    setPreviewDone(false); setPreviewEmpty(false);
    await nextLead(campaignId);
  };

  const dialLead = () => { if (leadRef.current?.phone) placeCallTo(leadRef.current.phone); };

  const skipLead = async () => {
    const cid = campaignRef.current;
    if (!cid) return;
    try { await api(`/campaigns/${cid}/preview/skip`, { method: 'POST', body: JSON.stringify({ leadId: leadRef.current?.id }) }); } catch { /* ignore */ }
    await nextLead(cid);
  };

  const endPreview = () => {
    campaignRef.current = null; leadRef.current = null;
    try { localStorage.removeItem('nt_preview_campaign'); } catch { /* ignore */ }
    setCampaign(null); setLead(null); setPreviewDone(false); setPreviewEmpty(false);
    setCampaignDispIds(null);
    setSelectedDisp(''); setDispNotes(''); setWrapUp(false);
    clearScreenPop();
  };

  // Restore a preview session after a page refresh (client-paced, so it lives in
  // localStorage; the lead reservation is reclaimed server-side if stale).
  const previewRestoredRef = useRef(false);
  useEffect(() => {
    if (previewRestoredRef.current) return;
    previewRestoredRef.current = true;
    try {
      const saved = localStorage.getItem('nt_preview_campaign');
      if (saved && !campaignRef.current) startPreview(saved);
    } catch { /* ignore */ }
    // eslint-disable-next-line
  }, []);

  // Preview campaigns with recording on: start recording the agent's live call
  // server-side (the softphone call lives on FreeSWITCH). Stores the filename to
  // attach to the CallLog on disposition. Non-fatal — a failure just means no file.
  async function startPreviewRecording() {
    try {
      const r = await fetch(`${API_BASE}/telephony/record/start`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extension: extRef.current }),
      });
      if (r.ok) { const j = await r.json(); recordFileRef.current = j?.recording || null; }
    } catch { /* non-fatal */ }
  }

  const [demo, setDemo] = useState(false);
  const startDemo = () => { setDemo(true); setPeer('+234 802 555 0118'); startTimer(); };
  const stopDemo = () => { setDemo(false); setPeer(''); stopTimer(); setMuted(false); setHeld(false); };

  // Mount once (lives in the layout, so it persists across page navigation and
  // keeps the softphone registered + able to receive calls anywhere in the app).
  useEffect(() => {
    stoppedRef.current = false;
    const u = getUser();
    setUser(u);
    // Only register a softphone for users whose role grants the `softphone`
    // permission — the endpoint enforces it too, so skipping avoids a 403.
    const myExt = u?.agentExtension || (typeof window !== 'undefined' ? localStorage.getItem('ucp_ext') : '') || '';
    if (myExt && hasPermission('softphone')) { setExt(myExt); connect(myExt); }
    api('/dispositions').then((rows: any[]) => {
      const list = (rows || []).map((r) => r?.data ?? r).filter((d) => d?.name);
      if (list.length) setDispositions(list);
    }).catch(() => { /* keep defaults */ });
    return () => {
      stoppedRef.current = true;
      clearReconnect();
      stopAllTones(); stopRingtone();
      try { suRef.current?.disconnect(); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (demo) { stopAllTones(); stopRingtone(); return; }
    if (phase === 'outgoing') startRingback(); else stopRingback();
    if (phase === 'incoming') playRingtone(); else stopRingtone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, demo]);

  useEffect(() => {
    const prime = () => {
      unlockAudio();
      const a = ringtoneRef.current;
      if (a) {
        a.muted = true;
        a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
      }
      window.removeEventListener('pointerdown', prime);
      window.removeEventListener('keydown', prime);
    };
    window.addEventListener('pointerdown', prime);
    window.addEventListener('keydown', prime);
    return () => {
      window.removeEventListener('pointerdown', prime);
      window.removeEventListener('keydown', prime);
    };
  }, []);

  const startTimer = () => { setSeconds(0); timer.current = setInterval(() => setSeconds((s) => s + 1), 1000); };
  const stopTimer = () => { if (timer.current) clearInterval(timer.current); timer.current = null; };

  function clearReconnect() {
    if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null; }
  }

  function scheduleReconnect() {
    if (stoppedRef.current) return;
    clearReconnect();
    setReconnecting(true);
    setPhase('connecting');
    stopAllTones(); stopRingtone();
    const n = attemptRef.current++;
    const delay = Math.min(2000 * 2 ** n, 30000);
    reconnectRef.current = setTimeout(() => { connect(extRef.current); }, delay);
  }

  const retryNow = () => { attemptRef.current = 0; clearReconnect(); connect(); };

  async function connect(extArg?: string) {
    const useExt = extArg || ext;
    if (!useExt) return;
    if (connectingRef.current) return;
    connectingRef.current = true;
    extRef.current = useExt;
    const gen = ++genRef.current;
    const isCurrent = () => gen === genRef.current && !stoppedRef.current;
    setErr('');
    if (!reconnecting) setPhase('connecting');

    // UI-only mode: there is no SIP server to register against, so report the
    // extension as ready. The console, dialpad and call flow all still work —
    // the media leg is simulated below.
    if (DEMO) {
      try { localStorage.setItem('ucp_ext', useExt); } catch { /* ignore */ }
      setDomain('demo.nativetalk.local');
      setPhase('registered');
      setReconnecting(false);
      attemptRef.current = 0;
      clearReconnect();
      connectingRef.current = false;
      return;
    }

    try { await suRef.current?.disconnect(); } catch { /* ignore */ }

    try {
      const cfg = await api(`/telephony/softphone?extension=${encodeURIComponent(useExt)}`);
      setDomain(cfg.sipDomain);
      localStorage.setItem('ucp_ext', useExt);

      const su = new Web.SimpleUser(cfg.wsServer, {
        aor: cfg.uri,
        media: { remote: { audio: audioRef.current ?? undefined } },
        reconnectionAttempts: 0,
        userAgentOptions: {
          authorizationUsername: cfg.extension,
          authorizationPassword: cfg.password,
          displayName: cfg.displayName,
          sessionDescriptionHandlerFactoryOptions: {
            iceGatheringTimeout: 1000,
            peerConnectionConfiguration: { iceServers: cfg.iceServers ?? [] },
          },
        },
        delegate: {
          onCallReceived: async () => {
            if (!isCurrent()) return;
            unlockAudio(); setWrapUp(false); setCallFailed('');
            const p = currentPeer(su);
            setPeer(p); peerRef.current = p;
            callDirRef.current = 'inbound'; callStartRef.current = Date.now(); answeredAtRef.current = null; lastLogIdRef.current = null; hangupByRef.current = null;
            setPhase('incoming');
            loadCustomer(p);
          },
          onCallAnswered: () => {
            if (!isCurrent()) return;
            answeredAtRef.current = Date.now(); setPhase('incall'); startTimer();
            if (campaignRef.current && campaignRecordingRef.current) startPreviewRecording();
          },
          onCallHangup: () => {
            if (!isCurrent()) return;
            setPhase('registered'); setMuted(false); setHeld(false); stopTimer(); stopAllTones(); stopRingtone(); playCallEnded();
            setWrapUp(true); // after-call work begins
            // Preview campaigns hold wrap-up until the agent dispositions; ad-hoc
            // calls have no forced wrap-up, so auto-clear it after a short window
            // instead of leaving the "wrap-up" badge stuck forever.
            if (wrapUpTimerRef.current) clearTimeout(wrapUpTimerRef.current);
            if (!campaignRef.current) wrapUpTimerRef.current = setTimeout(() => setWrapUp(false), 25000);
            const answered = answeredAtRef.current;
            lastDurationRef.current = answered ? Math.round((Date.now() - answered) / 1000) : 0;
            lastStatusRef.current = answered ? 'completed' : (callDirRef.current === 'inbound' ? 'missed' : 'no-answer');
            // An outbound call that ends without ever being answered never connected
            // (no answer, busy, or the number/extension isn't reachable). Surface it
            // so the agent isn't left staring at a silent wrap-up.
            if (!answered && callDirRef.current === 'outbound') {
              setCallFailed(`Call to ${peerRef.current || 'the number'} didn't connect — ${failureReason(failureCodeRef.current)}.`);
            }
            // Log the ended call: preview-campaign attempts get their own record
            // now (disposition updates it later); ad-hoc calls log here too. When a
            // disposition submit induced this hangup, skip — that path owns the log.
            if (!disposingRef.current) {
              if (campaignRef.current) logPreviewAttempt();
              else logCall();
            }
            answeredAtRef.current = null;
          },
          onRegistered: () => { if (!isCurrent()) return; setPhase('registered'); setReconnecting(false); attemptRef.current = 0; clearReconnect(); },
          onServerDisconnect: () => { if (!isCurrent()) return; scheduleReconnect(); },
        },
      });
      suRef.current = su;
      await su.connect();
      await su.register();
      if (!isCurrent()) return;
      setPhase('registered');
      setReconnecting(false);
      attemptRef.current = 0;
      clearReconnect();
      await setStatus('Available', useExt);
    } catch (e: any) {
      if (isCurrent()) { setErr(e.message || 'Failed to connect'); scheduleReconnect(); }
    } finally {
      connectingRef.current = false;
    }
  }

  function currentPeer(su: any): string {
    try { return su.session?.remoteIdentity?.uri?.user ?? ''; } catch { return ''; }
  }

  async function setStatus(s: string, extArg?: string) {
    const useExt = extArg || ext;
    if (!useExt) return;
    try {
      await fetch(`${API_BASE}/telephony/agents/${encodeURIComponent(useExt)}/status`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: s }),
      });
    } catch { /* non-fatal */ }
  }

  // UI-only mode: end the simulated call and run the same wrap-up bookkeeping
  // the SIP `onCallHangup` delegate would (log the CDR, open after-call work).
  function endDemoCall() {
    if (demoCallRef.current) { clearTimeout(demoCallRef.current); demoCallRef.current = null; }
    const answered = answeredAtRef.current;
    setPhase('registered'); setMuted(false); setHeld(false);
    stopTimer(); stopAllTones(); stopRingtone(); playCallEnded();
    setWrapUp(true);
    lastDurationRef.current = answered ? Math.round((Date.now() - answered) / 1000) : 0;
    lastStatusRef.current = answered ? 'completed' : (callDirRef.current === 'inbound' ? 'missed' : 'no-answer');
    if (!answered && callDirRef.current === 'outbound') {
      setCallFailed(`Call to ${peerRef.current || 'the number'} didn't connect — ${failureReason(null)}.`);
    }
    if (!disposingRef.current) {
      if (campaignRef.current) logPreviewAttempt();
      else logCall();
    }
    answeredAtRef.current = null;
    if (wrapUpTimerRef.current) clearTimeout(wrapUpTimerRef.current);
    if (!campaignRef.current) wrapUpTimerRef.current = setTimeout(() => setWrapUp(false), 25000);
  }

  const placeCallTo = async (number: string) => {
    const n = (number || '').trim();
    if (!n) return;
    setErr(''); setCallFailed(''); unlockAudio(); setWrapUp(false); recordFileRef.current = null;
    setDest(n);
    setPeer(n); peerRef.current = n;
    callDirRef.current = 'outbound'; callStartRef.current = Date.now(); answeredAtRef.current = null; lastLogIdRef.current = null; previewLogIdRef.current = null; failureCodeRef.current = null; hangupByRef.current = null;
    loadCustomer(n);
    try {
      setPhase('outgoing');
      // UI-only mode: ring for a moment, then "connect" so the in-call controls,
      // timer and wrap-up flow can all be exercised.
      if (DEMO) {
        if (demoCallRef.current) clearTimeout(demoCallRef.current);
        demoCallRef.current = setTimeout(() => {
          demoCallRef.current = null;
          answeredAtRef.current = Date.now();
          setPhase('incall');
          startTimer();
          if (campaignRef.current && campaignRecordingRef.current) startPreviewRecording();
        }, 2200);
        return;
      }
      // Capture the SIP failure code so a rejected call reports a precise reason.
      await suRef.current.call(`sip:${n}@${domain}`, undefined, {
        requestDelegate: { onReject: (response: any) => { failureCodeRef.current = response?.message?.statusCode ?? null; } },
      });
    } catch (e: any) { setErr(e.message); setPhase('registered'); }
  };
  const placeCall = () => placeCallTo(dest);

  // Click-to-call from anywhere (e.g. the Contacts list). Dials immediately when
  // registered; otherwise just prefills the dialer so the agent can place it once
  // the softphone is ready.
  const callNumber = (number: string) => {
    const n = (number || '').trim();
    if (!n) return;
    if (phase === 'registered') placeCallTo(n);
    else setDest(n);
  };
  const answer = async () => {
    unlockAudio();
    if (DEMO) { answeredAtRef.current = Date.now(); setPhase('incall'); startTimer(); return; }
    try { await suRef.current.answer(); } catch (e: any) { setErr(e.message); }
  };
  const decline = async () => {
    hangupByRef.current = 'agent';
    if (DEMO) return endDemoCall();
    try { await suRef.current.decline(); setPhase('registered'); } catch (e: any) { setErr(e.message); }
  };
  const hangup = async () => {
    if (demo) return stopDemo();
    hangupByRef.current = 'agent';
    if (DEMO) return endDemoCall();
    try { await suRef.current.hangup(); } catch (e: any) { setErr(e.message); }
  };
  const toggleMute = () => { if (demo || DEMO) return setMuted((m) => !m); const su = suRef.current; if (muted) su.unmute(); else su.mute(); setMuted(!muted); };
  const toggleHold = async () => { if (demo || DEMO) return setHeld((h) => !h); const su = suRef.current; try { held ? await su.unhold() : await su.hold(); setHeld(!held); } catch (e: any) { setErr(e.message); } };
  const dtmf = (k: string) => { playDtmf(k); if (demo || DEMO) return; try { suRef.current.sendDTMF(k); } catch { /* ignore */ } };
  const dialKey = (k: string) => { unlockAudio(); playDtmf(k); setDest((d) => d + k); };
  const transfer = async () => {
    if (demo) return toast.success('Transfer (demo)');
    if (DEMO) {
      const target = prompt('Transfer to extension or number:');
      if (target) { toast.success(`Transferring to ${target}…`); endDemoCall(); }
      return;
    }
    const target = prompt('Transfer to extension or number:');
    if (!target) return;
    try { await suRef.current.session?.refer(`sip:${target}@${domain}`); toast.success(`Transferring to ${target}…`); }
    catch (e: any) { toast.error(e.message || 'Transfer not available'); }
  };

  const submitDisposition = async () => {
    if (!selectedDisp) { toast.error('Select a disposition first'); return; }
    if (demo) { toast.success(`Disposition saved: ${selectedDisp}`); setSelectedDisp(''); setDispNotes(''); return stopDemo(); }

    // Campaign preview: log server-side (tagged with campaign + lead) and advance.
    if (campaignRef.current) {
      const cid = campaignRef.current;
      const onCall = phase === 'incall' || phase === 'outgoing' || phase === 'incoming';
      const answered = answeredAtRef.current;
      const durationSec = answered ? Math.round((Date.now() - answered) / 1000) : lastDurationRef.current;
      const status = answered ? 'completed' : lastStatusRef.current;
      // If still on the call, hang up first — flag it so onCallHangup doesn't
      // create a second (un-dispositioned) log; this path owns the record.
      if (onCall) { disposingRef.current = true; try { await hangup(); } catch { /* ignore */ } }
      try {
        const res = await api(`/campaigns/${cid}/preview/disposition`, {
          method: 'POST',
          body: JSON.stringify({
            logId: previewLogIdRef.current || undefined, // update the attempt logged on hangup
            leadId: leadRef.current?.id,
            disposition: selectedDisp,
            notes: dispNotes,
            durationSec,
            status,
            peerNumber: peerRef.current,
            contactId: contactRef.current?.id ?? null,
            recording: recordFileRef.current || undefined,
            startedAt: new Date(callStartRef.current || Date.now()).toISOString(),
          }),
        });
        // Reflect the disposition on the already-shown history row.
        const lid = res?.logId || previewLogIdRef.current;
        if (lid) setInteractions((prev) => prev.map((i) => (i.id === lid ? { ...i, disposition: selectedDisp, notes: dispNotes } : i)));
        toast.success(`Saved: ${selectedDisp}`);
      } catch (e: any) {
        toast.error(e.message || 'Could not save disposition');
      }
      previewLogIdRef.current = null; disposingRef.current = false;
      setSelectedDisp(''); setDispNotes(''); setWrapUp(false);
      await nextLead(cid); // auto-advance to the next lead
      return;
    }

    // Progressive/auto-dial: the agent was bridged a call from the campaign's ACD
    // queue. Tag the disposition to the campaign lead by number so re-runs can
    // exclude it. The call itself is logged (with campaignId) on hangup.
    if (activeCampaignRef.current && peerRef.current) {
      const cid = activeCampaignRef.current;
      const number = peerRef.current;
      const onCall = phase === 'incall' || phase === 'outgoing' || phase === 'incoming';
      if (onCall) { disposingRef.current = true; try { await hangup(); } catch { /* ignore */ } }
      try {
        if (lastLogIdRef.current) {
          const updated = await api(`/call-logs/${lastLogIdRef.current}`, { method: 'PATCH', body: JSON.stringify({ disposition: selectedDisp, notes: dispNotes }) });
          if (updated) setInteractions((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
        }
        await api(`/campaigns/${cid}/call-disposition`, { method: 'POST', body: JSON.stringify({ number, disposition: selectedDisp, notes: dispNotes }) });
        toast.success(`Saved: ${selectedDisp}`);
      } catch (e: any) {
        toast.error(e.message || 'Could not save disposition');
      }
      disposingRef.current = false;
      setSelectedDisp(''); setDispNotes(''); setWrapUp(false);
      return;
    }

    const stillOnCall = phase === 'incall' || phase === 'outgoing' || phase === 'incoming';
    try {
      if (stillOnCall) {
        await hangup();
      } else if (lastLogIdRef.current) {
        const updated = await api(`/call-logs/${lastLogIdRef.current}`, { method: 'PATCH', body: JSON.stringify({ disposition: selectedDisp, notes: dispNotes }) });
        if (updated) setInteractions((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      } else {
        await logCall({ disposition: selectedDisp, notes: dispNotes });
      }
      toast.success(`Disposition saved: ${selectedDisp}`);
    } catch (e: any) {
      toast.error(e.message || 'Could not save disposition');
    }
    setSelectedDisp(''); setDispNotes(''); setWrapUp(false);
  };

  // In a campaign with a disposition allowlist, narrow the Console's menu to it.
  const visibleDispositions = campaignDispIds && campaignDispIds.length
    ? dispositions.filter((d) => campaignDispIds.includes((d as any).id ?? d.name))
    : dispositions;

  const value: CallContextValue = {
    user, ext, phase, dest, setDest, peer, muted, held, seconds, err, reconnecting,
    dispositions: visibleDispositions, selectedDisp, setSelectedDisp, dispNotes, setDispNotes, custNotes, setCustNotes,
    contact, interactions, notesSaved, wrapUp, callFailed, clearCallFailed, clearWrapUp, setActiveCampaign, demo,
    campaign, lead, previewLoading, previewDone, previewEmpty, startPreview, nextLead, dialLead, skipLead, endPreview,
    connect, retryNow, placeCall, callNumber, answer, decline, hangup, toggleMute, toggleHold, dtmf, dialKey,
    transfer, submitDisposition, saveCustomerNotes, startDemo, stopDemo,
  };

  const onConsole = pathname === '/agent';
  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <CallContext.Provider value={value}>
      {children}

      {/* Global audio — lives above the pages so calls keep working across nav. */}
      <audio ref={audioRef} autoPlay />
      <audio ref={ringtoneRef} src="/assets/incoming-ringtone.mp3" preload="auto" loop />

      {/* Incoming-call popup — shown anywhere except the console (which has its own UI). */}
      {!demo && phase === 'incoming' && !onConsole && (
        <div className="call-pop">
          <div className="call-pop-title">Incoming call</div>
          <div className="call-pop-name">{contact?.name || peer || 'Unknown caller'}</div>
          {contact?.name && <div className="call-pop-sub">{peer}</div>}
          <div className="call-pop-actions">
            <button className="call-pop-answer" onClick={() => { answer(); router.push('/agent'); }}><Phone size={18} /> Answer</button>
            <button className="call-pop-decline" onClick={decline}><PhoneOff size={18} /> Decline</button>
          </div>
        </div>
      )}

      {/* Active-call mini bar — shown while on a call but away from the console. */}
      {!demo && (phase === 'incall' || phase === 'outgoing') && !onConsole && (
        <button className="call-bar" onClick={() => router.push('/agent')} title="Open call console">
          <span className="call-bar-dot" />
          <span>{phase === 'outgoing' ? 'Calling' : 'On call'} · {contact?.name || peer}</span>
          {phase === 'incall' && <span className="call-bar-timer">{fmt(seconds)}</span>}
          <span className="call-bar-open">Open console →</span>
        </button>
      )}
    </CallContext.Provider>
  );
}
