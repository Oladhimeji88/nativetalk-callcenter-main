'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mic, MicOff, Pause, Play, PhoneForwarded, PhoneOff, Phone, User, Delete } from 'lucide-react';
import { toast } from 'sonner';
import { CampaignRowIcon, LastContactIcon, NotesIcon } from '@/components/icons';
import { api, hasPermission, landingPath } from '@/lib/api';
import { useCall, type Phase } from '@/components/CallProvider';

const fmtWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDur = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const fmt = fmtDur;

// Badge color by disposition category.
function badgeClass(cat?: string) {
  switch ((cat || '').toLowerCase()) {
    case 'success':  return 'disp-badge disp-badge-green';
    case 'callback': return 'disp-badge disp-badge-blue';
    case 'failure':
    case 'dnc':      return 'disp-badge disp-badge-red';
    default:         return 'disp-badge disp-badge-amber';
  }
}

export default function CallConsolePage() {
  const {
    user, ext, phase, dest, setDest, peer, muted, held, seconds, err, reconnecting,
    dispositions, selectedDisp, setSelectedDisp, dispNotes, setDispNotes, custNotes, setCustNotes,
    contact, interactions, notesSaved, wrapUp, demo,
    campaign, lead, previewLoading, previewDone, previewEmpty, callFailed, startPreview, dialLead, skipLead, endPreview,
    connect, retryNow, placeCall, callNumber, answer, decline, hangup, toggleMute, toggleHold, dtmf, dialKey,
    transfer, submitDisposition, saveCustomerNotes, startDemo, stopDemo, clearWrapUp, setActiveCampaign,
  } = useCall();

  // All campaigns the agent can work: Preview (paced one lead at a time) and
  // auto-dial (Progressive/Power — the agent plays in to receive bridged calls).
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [pick, setPick] = useState('');
  const [joinedId, setJoinedId] = useState(''); // auto-dial campaign the agent is playing in
  const [pulse, setPulse] = useState<any>(null); // live pulse of the joined campaign
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  // The Call Console needs the softphone permission. Send others to their landing.
  useEffect(() => { if (!hasPermission('softphone')) router.replace(landingPath()); }, [router]);
  useEffect(() => {
    Promise.all([
      api('/campaigns/mine').catch(() => []),
      api('/campaigns/joinable').catch(() => []),
    ]).then(([m, j]) => {
      const list = [...(m || []), ...(j || [])];
      setCampaigns(list);
      // Remember the last picked campaign in the dropdown across refresh / nav —
      // default to it if it's still a campaign the agent can work.
      try {
        const saved = localStorage.getItem('nt_picked_campaign');
        if (saved && list.some((c: any) => c.id === saved)) setPick(saved);
      } catch { /* ignore */ }
    });
    // Restore the "on campaign" state after a refresh: the backend still has this
    // agent tiered in, so re-attach the Console to it instead of showing idle.
    api('/campaigns/joined').then((r: any) => { if (r?.campaignId) setJoinedId(r.campaignId); }).catch(() => {});
  }, []);

  const choosePick = (v: string) => { setPick(v); try { v ? localStorage.setItem('nt_picked_campaign', v) : localStorage.removeItem('nt_picked_campaign'); } catch { /* ignore */ } };

  // One Play button, action depends on the selected campaign's type: Preview
  // starts lead-by-lead dialing; auto-dial modes join the campaign queue.
  const onPlay = async () => {
    const c = campaigns.find((x) => x.id === pick);
    if (!c) return;
    if (/preview/i.test(c.dialMethod)) { startPreview(c.id); return; }
    setBusy(true);
    try { await api(`/campaigns/${c.id}/join`, { method: 'POST' }); setJoinedId(c.id); }
    catch (e: any) { alert(e.message || 'Could not join'); }
    finally { setBusy(false); }
  };
  const takeBreak = async () => {
    const id = joinedId; if (!id) return;
    setBusy(true);
    try { await api(`/campaigns/${id}/leave`, { method: 'POST' }); setJoinedId(''); }
    catch { /* ignore */ }
    finally { setBusy(false); }
  };

  // Let the softphone know which progressive campaign is active, so a bridged
  // call's disposition is tagged to that campaign's lead (for re-run exclusion).
  useEffect(() => { setActiveCampaign(joinedId || null); /* eslint-disable-next-line */ }, [joinedId]);

  // While playing in, watch for the campaign finishing (all leads worked) or the
  // run being stopped, and take the agent off automatically.
  useEffect(() => {
    if (!joinedId) { setPulse(null); return; }
    const t = setInterval(async () => {
      try {
        const p = await api(`/campaigns/${joinedId}/participation`);
        setPulse(p?.pulse ?? null);
        if (!p?.joined || ['done', 'stopped', 'error'].includes(p?.status)) {
          setJoinedId(''); setPulse(null);
          toast.success(p?.status === 'done' ? 'Campaign finished. All leads worked.' : 'You were taken off the campaign.');
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(t);
  }, [joinedId]);

  const viewPhase: Phase = demo ? 'incall' : phase;
  const inCall = viewPhase === 'incall' || viewPhase === 'outgoing' || viewPhase === 'incoming';
  const connected = demo || phase === 'registered' || inCall;
  const showConsole = connected;
  const connLabel = connected ? 'Connected' : reconnecting ? 'Reconnecting…' : phase === 'connecting' ? 'Connecting…' : 'Disconnected';
  const name = user?.name || user?.email || 'Agent';
  const notesDirty = (custNotes || '') !== (contact?.notes || '');

  const sfStatus = viewPhase === 'incall' ? 'CONNECTED'
    : viewPhase === 'outgoing' ? 'CALLING…'
    : viewPhase === 'incoming' ? 'INCOMING'
    : viewPhase === 'connecting' ? 'CONNECTING…'
    : viewPhase === 'registered' ? 'READY' : '';

  // Campaign pulse strip label. The agent's OWN call state wins over the dialer's
  // progress (so it reads "On a call", not "Wrapping up", while you're on a call).
  const pulseLabel = viewPhase === 'incoming' ? 'Incoming call…'
    : inCall ? 'On a call'
    : (pulse?.dialing ?? 0) > 0 ? `Dialing (${pulse.dialing})`
    : pulse?.status === 'running' ? ((pulse?.remaining ?? 0) > 0 ? 'Waiting for a free line' : 'All numbers dialed')
    : (pulse?.status ?? 'receiving calls');
  const pulseLive = viewPhase === 'incoming' || inCall || (pulse?.dialing ?? 0) > 0;

  // After an ad-hoc (non-preview) call ends, show a "call ended" summary instead
  // of snapping straight back to the dialer, so it's clear the disposition/notes
  // belong to the call that just finished.
  const callEnded = !demo && wrapUp && !campaign && viewPhase === 'registered';
  // The Disposition panel is only meaningful with a call to wrap up — during a
  // live call or right after one. Idle (READY, nothing dialed) shows a hint.
  const showDisposition = demo || inCall || wrapUp;

  return (
    <div className="agent-page">
      {/* Header */}
      <div className="agent-header">
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Call Console</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {connected ? `Ext. ${ext}` : 'Offline'} · {name}
          </p>
        </div>
        <span className={`agent-conn ${connected ? 'on' : 'off'}`}>
          <span className="dot" /> {connLabel}
        </span>
      </div>

      {/* Status card — shown while connecting/reconnecting, on a hard failure,
          or when there's no extension. */}
      {!showConsole ? (
        <div className="card" style={{ maxWidth: 420, margin: '32px auto' }}>
          {reconnecting ? (
            <>
              <h3 style={{ margin: '0 0 4px' }}>Reconnecting…</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                Lost the connection to the server. Reconnecting Ext. {ext} automatically. No need to refresh.
              </p>
              <button className="btn btn-green" style={{ width: '100%', marginTop: 16 }} onClick={retryNow}>
                Retry now
              </button>
            </>
          ) : phase === 'connecting' ? (
            <>
              <h3 style={{ margin: '0 0 4px' }}>Connecting…</h3>
              <p className="muted" style={{ marginTop: 0 }}>Registering Ext. {ext}.</p>
            </>
          ) : ext ? (
            <>
              <h3 style={{ margin: '0 0 4px' }}>Couldn't go online</h3>
              <p className="muted" style={{ marginTop: 0 }}>Your softphone (Ext. {ext}) failed to register.</p>
              {err && <div className="err">{err}</div>}
              <button className="btn btn-green" style={{ width: '100%', marginTop: 16 }} onClick={() => connect()}>
                Retry
              </button>
            </>
          ) : (
            <>
              <h3 style={{ margin: '0 0 4px' }}>No extension assigned</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                Your account has no extension. Ask an admin to add one in <b>Users</b>.
              </p>
            </>
          )}
          <button className="btn btn-ghost" style={{ width: '100%', marginTop: 10 }} onClick={startDemo}>
            Preview console (demo)
          </button>
        </div>
      ) : (
        <div className="agent-grid">
          {demo && (
            <div className="agent-demo-banner">
              Demo preview. No live call. <button onClick={stopDemo}>Exit preview</button>
            </div>
          )}
          {!demo && !campaign && !joinedId && !inCall && campaigns.length > 0 && (
            <div className="agent-campaign-picker">
              <CampaignRowIcon size={16} />
              <span className="muted">Work a campaign</span>
              <select value={pick} onChange={(e) => choosePick(e.target.value)}>
                <option value="">Select a campaign…</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} · {c.directionType || 'Outbound'}{c.dialMethod ? ` · ${c.dialMethod}` : ''}</option>
                ))}
              </select>
              <button className="play-round" disabled={!pick || busy} onClick={onPlay} aria-label="Start campaign" title="Start">
                <Play size={22} fill="currentColor" style={{ marginLeft: 2 }} />
              </button>
            </div>
          )}
          {campaign && !demo && (
            <div className="agent-campaign-banner">
              <span><b>Preview dialing:</b> {campaign.name}</span>
              <button onClick={endPreview}>End preview</button>
            </div>
          )}
          {joinedId && !demo && (
            <div className="agent-campaign-banner" style={{ background: '#ecfdf5', borderColor: '#a7f3d0', color: '#047857' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <span><b>On campaign:</b> {campaigns.find((c) => c.id === joinedId)?.name || 'campaign'}</span>
                {pulse ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 14, fontSize: 13, fontWeight: 500 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span className={`pulse-dot ${pulseLive ? 'live' : ''}`} />
                      {pulseLabel}
                    </span>
                    <span style={{ opacity: 0.85 }}>{pulse.remaining} left to dial</span>
                    <span style={{ opacity: 0.85 }}>{pulse.done} dialed</span>
                    <span style={{ opacity: 0.85 }}>{pulse.agentsOn} agent{pulse.agentsOn === 1 ? '' : 's'} on</span>
                  </span>
                ) : <span style={{ opacity: 0.85 }}>· receiving calls</span>}
              </span>
              <button onClick={takeBreak} disabled={busy}>Take a break</button>
            </div>
          )}
          {/* ---------- Customer ---------- */}
          <section className="card agent-col">
            <h3 className="agent-col-title">Customer</h3>
            <div className="cust-head">
              <div className="cust-avatar"><User size={22} /></div>
              <div>
                <div style={{ fontWeight: 700 }}>{demo ? 'Adaobi Nwosu' : (contact?.name || peer || (inCall ? 'Unknown caller' : 'No active call'))}</div>
                {!demo && contact?.company ? <div className="muted">{contact.company}{peer ? ` · ${peer}` : ''}</div>
                  : (!demo && (contact?.name) && peer) ? <div className="muted">{peer}</div>
                  : demo ? <div className="muted">+234 802 555 0118</div> : null}
              </div>
            </div>

            <div className="cust-row"><CampaignRowIcon size={16} /><span className="muted">Campaign</span><b>{demo ? 'Q4 Retention' : (campaign?.name || '—')}</b></div>
            <div className="cust-row"><LastContactIcon size={16} /><span className="muted">Last contact</span><b>{demo ? 'Oct 18 · 11:42' : (interactions[0] ? fmtWhen(interactions[0].startedAt) : '—')}</b></div>

            <div className="cust-label"><NotesIcon size={15} /> Contact notes</div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
              About this contact, kept across every call.
            </div>
            <textarea
              className="cust-notes"
              placeholder={peer ? 'e.g. prefers afternoon calls, speaks Yoruba…' : 'Available during a call'}
              value={custNotes}
              onChange={(e) => setCustNotes(e.target.value)}
              disabled={!peer && !contact}
            />
            {(peer || contact) && (
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
                <button
                  className={`btn ${notesSaved ? 'btn-green' : 'btn-ghost'}`}
                  style={{ padding: '5px 14px', fontSize: 13 }}
                  onClick={saveCustomerNotes}
                  disabled={notesSaved || !notesDirty}
                >
                  {notesSaved ? 'Saved ✓' : 'Save notes'}
                </button>
              </div>
            )}

            <div className="cust-recent">
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Recent interactions</div>
              {demo ? (
                <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--muted)' }}>
                  <li>Oct 18 · Answered, 4:21</li>
                  <li>Oct 10 · Callback, 1:02</li>
                  <li>Oct 02 · Answered, 7:38</li>
                </ul>
              ) : interactions.length ? (
                <ul className="cust-recent-list" style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {interactions.slice(0, 20).map((it) => (
                    <li key={it.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 0 }}>
                      <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
                        <span>{fmtWhen(it.startedAt)}</span>
                        <span className="muted">
                          {it.disposition || (it.status === 'completed' ? 'No disposition' : it.status)}
                          {it.durationSec ? ` · ${fmtDur(it.durationSec)}` : ''}
                        </span>
                      </div>
                      {it.notes && <span className="cust-recent-note">“{it.notes}”</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted" style={{ margin: 0 }}>
                  {peer ? 'No previous interactions with this number.' : 'No active call. History appears here during a call.'}
                </p>
              )}
            </div>
          </section>

          {/* ---------- Softphone ---------- */}
          <section className="softphone">
            <div className="sf-head">
              <span>Softphone</span>
              {viewPhase === 'incall' && <span className="sf-rec"><span className="dot" /> Recording</span>}
            </div>

            {viewPhase === 'connecting' ? (
              <div className="sf-body" style={{ paddingTop: 40, paddingBottom: 40 }}>
                <div className="sf-status">CONNECTING…</div>
                <div className="muted" style={{ color: 'rgba(255,255,255,.8)', marginTop: 12, textAlign: 'center' }}>Registering Ext. {ext}</div>
              </div>
            ) : viewPhase === 'registered' && campaign ? (
              <div className="sf-body">
                <div className="sf-status">{previewDone ? (previewEmpty ? 'NO LEADS' : 'CAMPAIGN DONE') : wrapUp ? 'CALL ENDED' : 'PREVIEW'}</div>
                {previewLoading ? (
                  <div className="muted" style={{ color: 'rgba(255,255,255,.85)', marginTop: 30, textAlign: 'center' }}>Loading next lead…</div>
                ) : previewDone ? (
                  <>
                    <div className="sf-number" style={{ fontSize: 20 }}>{previewEmpty ? 'No leads in this campaign' : 'All leads worked 🎉'}</div>
                    {previewEmpty && (
                      <div className="muted" style={{ color: 'rgba(255,255,255,.85)', marginTop: 8, textAlign: 'center', fontSize: 13 }}>
                        Add contacts, a contact group, or phone numbers to this campaign.
                      </div>
                    )}
                    <div className="sf-controls" style={{ marginTop: 24 }}>
                      <button className="sf-textbtn" onClick={endPreview}>End preview</button>
                    </div>
                  </>
                ) : wrapUp ? (
                  <>
                    <div className="sf-number">{lead?.name || lead?.phone}</div>
                    {lead?.name && <div style={{ color: 'rgba(255,255,255,.8)', marginTop: 2 }}>{lead?.phone}</div>}
                    {callFailed && <div className="sf-callfailed">{callFailed}</div>}
                    <div className="sf-wrap-hint">Pick a disposition on the right to save this call and move to the next lead.</div>
                    <div className="sf-controls" style={{ marginTop: 18 }}>
                      <button className="sf-call" onClick={dialLead} aria-label="Redial lead"><Phone size={26} /></button>
                    </div>
                    <div className="sf-redial-cap">Redial</div>
                    <div className="row" style={{ justifyContent: 'center', gap: 10, marginTop: 14 }}>
                      <button className="sf-textbtn" onClick={skipLead}>Skip</button>
                      <button className="sf-textbtn" onClick={endPreview}>End preview</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="sf-number">{lead?.name || lead?.phone}</div>
                    {lead?.name && <div style={{ color: 'rgba(255,255,255,.8)', marginTop: 2 }}>{lead?.phone}</div>}
                    <div className="sf-controls" style={{ marginTop: 22 }}>
                      <button className="sf-call" onClick={dialLead} aria-label="Dial lead"><Phone size={26} /></button>
                    </div>
                    <div className="row" style={{ justifyContent: 'center', gap: 10, marginTop: 16 }}>
                      <button className="sf-textbtn" onClick={skipLead}>Skip</button>
                      <button className="sf-textbtn" onClick={endPreview}>End preview</button>
                    </div>
                  </>
                )}
              </div>
            ) : callEnded ? (
              <div className="sf-body">
                <div className="sf-status">CALL ENDED</div>
                <div className="sf-number">{contact?.name || peer || 'Call'}</div>
                {contact?.name && peer && <div style={{ color: 'rgba(255,255,255,.8)', marginTop: 2 }}>{peer}</div>}
                {callFailed
                  ? <div className="sf-callfailed">{callFailed}</div>
                  : <div className="sf-timer" style={{ marginTop: 10 }}>{fmt(seconds)}</div>}
                <div className="sf-wrap-hint">
                  {dispositions.length ? 'Wrap up on the right, then start a new call.' : 'Call logged. Start a new call when ready.'}
                </div>
                <div className="sf-controls" style={{ marginTop: 18 }}>
                  {peer && <button className="sf-call" onClick={() => callNumber(peer)} aria-label="Redial"><Phone size={26} /></button>}
                </div>
                {peer && <div className="sf-redial-cap">Redial</div>}
                <div className="row" style={{ justifyContent: 'center', gap: 10, marginTop: 14 }}>
                  <button className="sf-textbtn" onClick={clearWrapUp}>New call</button>
                </div>
              </div>
            ) : viewPhase === 'registered' ? (
              <div className="sf-body">
                <div className="sf-status">READY</div>
                {callFailed && <div className="sf-callfailed">{callFailed}</div>}
                <input className="sf-dial-input" value={dest} onChange={(e) => setDest(e.target.value)} placeholder="Enter number or extension" onKeyDown={(e) => e.key === 'Enter' && placeCall()} />
                <Dialpad onPress={dialKey} />
                <div className="sf-controls">
                  <span style={{ width: 44 }} />
                  <button className="sf-call" onClick={placeCall} aria-label="Call"><Phone size={26} /></button>
                  <button className="sf-backspace" onClick={() => setDest((d) => d.slice(0, -1))} disabled={!dest} aria-label="Delete">
                    <Delete size={22} />
                  </button>
                </div>
              </div>
            ) : viewPhase === 'incoming' ? (
              <div className="sf-body">
                <div className="sf-status">INCOMING</div>
                <div className="sf-number">{peer || 'unknown'}</div>
                <div className="sf-controls">
                  <button className="sf-call" onClick={answer} aria-label="Answer"><Phone size={26} /></button>
                  <button className="sf-end" onClick={decline} aria-label="Reject"><PhoneOff size={26} /></button>
                </div>
              </div>
            ) : (
              <div className="sf-body">
                <div className="sf-status">{sfStatus}</div>
                <div className="sf-number">{peer}</div>
                <div className="sf-timer">{viewPhase === 'incall' ? fmt(seconds) : '00:00'}</div>
                <Dialpad onPress={dtmf} />
                <div className="sf-controls sf-controls-call">
                  <SfBtn label="MUTE" active={muted} onClick={toggleMute} icon={muted ? <MicOff size={20} /> : <Mic size={20} />} />
                  <SfBtn label="HOLD" active={held} onClick={toggleHold} disabled={viewPhase !== 'incall'} icon={held ? <Play size={20} /> : <Pause size={20} />} />
                  <SfBtn label="TRANSFER" onClick={transfer} disabled={viewPhase !== 'incall'} icon={<PhoneForwarded size={20} />} />
                  <button className="sf-end" onClick={hangup} aria-label="End call"><PhoneOff size={24} /></button>
                </div>
              </div>
            )}
          </section>

          {/* ---------- Disposition ---------- */}
          <section className="card agent-col">
            <h3 className="agent-col-title">Disposition</h3>
            <p className="muted" style={{ margin: '0 0 14px' }}>
              {showDisposition ? (wrapUp && !inCall ? 'Wrap up the call that just ended' : 'Wrap up this call') : 'No active call'}
            </p>

            {showDisposition ? (
              <>
                <div className="disp-list">
                  {dispositions.map((d) => (
                    <button
                      key={d.name}
                      className={`disp-row ${selectedDisp === d.name ? 'disp-row-on' : ''}`}
                      onClick={() => setSelectedDisp(d.name)}
                    >
                      <span className="disp-radio" />
                      <span className="disp-name">{d.name}</span>
                      {d.code && <span className={badgeClass(d.category)}>{d.code}</span>}
                    </button>
                  ))}
                </div>

                <div className="cust-label" style={{ marginTop: 16 }}>Call notes</div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Notes for this call, saved with the disposition.</div>
                <textarea className="cust-notes" placeholder="What happened on this call…" value={dispNotes} onChange={(e) => setDispNotes(e.target.value)} />

                <button className="btn btn-green" style={{ width: '100%', marginTop: 14 }} onClick={submitDisposition} disabled={!selectedDisp}>
                  Submit Disposition
                </button>
              </>
            ) : (
              <div className="disp-empty muted">
                <p style={{ margin: 0 }}>Nothing to wrap up yet.</p>
                <p style={{ margin: '6px 0 0', fontSize: 13 }}>Dispositions appear here during a call and right after it ends.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Dialpad({ onPress }: { onPress: (k: string) => void }) {
  return (
    <div className="sf-keypad">
      {['1','2','3','4','5','6','7','8','9','*','0','#'].map((k) => (
        <button key={k} onClick={() => onPress(k)}>{k}</button>
      ))}
    </div>
  );
}

function SfBtn({ label, icon, onClick, active, disabled }: { label: string; icon: React.ReactNode; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button className={`sf-ctrl ${active ? 'sf-ctrl-on' : ''}`} onClick={onClick} disabled={disabled}>
      {icon}
      <span>{label}</span>
    </button>
  );
}
