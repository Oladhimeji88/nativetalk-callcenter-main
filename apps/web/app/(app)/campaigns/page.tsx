'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Play, Pause, Trash2, Activity, ClipboardList, Copy, RotateCcw, MoreVertical, PhoneOutgoing, PhoneIncoming, PhoneCall, History } from 'lucide-react';

// Auto-dial modes run from the dialer (server originates + bridges to agents),
// unlike Preview which the agent works from the Call Console.
const AUTO_DIAL = (m?: string) => /progressive|power|predict|broadcast/i.test(m || '');
import { api, getUser, API_BASE } from '@/lib/api';
import { useConfirm } from '@/components/ConfirmProvider';
import { CampaignWizard } from '@/components/CampaignWizard';

const DONE = new Set(['done', 'stopped', 'error']);

export default function CampaignsPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const [list, setList] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [dispositions, setDispositions] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null); // null=closed, {}=new, {...}=edit
  const [run, setRun] = useState<any>(null);
  const [running, setRunning] = useState<any>(null); // campaign being dialed
  const [history, setHistory] = useState<any>(null); // { campaign, counts, calls } when the history view is open
  const [runs, setRuns] = useState<any>(null); // { campaign, list } when the run-history view is open
  const [runDetail, setRunDetail] = useState<any>(null); // { campaign, run, items } when a single run is opened
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState<{ c: any; x: number; y: number } | null>(null); // open row actions menu
  const poll = useRef<any>(null);

  const openMenu = (e: React.MouseEvent, c: any) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ c, x: r.right, y: r.bottom + 6 });
  };

  const openRuns = async (c: any) => {
    setRuns({ campaign: { id: c.id, name: c.name }, list: null, loading: true });
    try { setRuns({ campaign: { id: c.id, name: c.name }, list: await api(`/campaigns/${c.id}/runs`) }); }
    catch { setRuns({ campaign: { id: c.id, name: c.name }, list: [] }); }
  };

  const openRunDetail = async (campaign: any, r: any) => {
    setRunDetail({ campaign, run: r, items: null, loading: true });
    try {
      const d = await api(`/campaigns/${campaign.id}/runs/${r.id}/calls`);
      setRunDetail({ campaign, run: d.run ?? r, items: d.items ?? [] });
    } catch { setRunDetail({ campaign, run: r, items: [] }); }
  };

  const openHistory = async (c: any) => {
    setHistory({ campaign: { id: c.id, name: c.name }, counts: {}, calls: null, loading: true });
    try { setHistory(await api(`/campaigns/${c.id}/calls`)); }
    catch { setHistory({ campaign: { id: c.id, name: c.name }, counts: {}, calls: [] }); }
  };
  const playRec = async (id: string) => {
    if (audioUrls[id]) return;
    try {
      const res = await fetch(`${API_BASE}/call-logs/${id}/recording`, { credentials: 'include' });
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob());
      setAudioUrls((m) => ({ ...m, [id]: url }));
    } catch { alert('Recording not available yet.'); }
  };
  const pendingEditIdRef = useRef<string | null>(null); // ?campaign=<id> to reopen once the list loads

  // Keep the wizard open across a page refresh by mirroring its state in the URL
  // (?campaign=new | <id>). Buttons update the URL; these restore from it.
  const openEditor = (c: any | null) => {
    setEditing(c ? cleanCampaign(c) : {});
    router.push(`/campaigns?campaign=${c ? c.id : 'new'}`);
  };
  const closeEditor = (reload = false) => {
    setEditing(null);
    pendingEditIdRef.current = null;
    router.push('/campaigns');
    if (reload) load();
  };

  const toggleActive = async (c: any) => {
    try { await api(`/campaigns/${c.id}`, { method: 'PATCH', body: JSON.stringify({ active: !c.active }) }); load(); }
    catch { /* ignore */ }
  };
  const removeCampaign = async (c: any) => {
    if (!(await confirm({ title: 'Delete campaign?', message: `Delete "${c.name}"? This can't be undone.`, confirmLabel: 'Delete', danger: true }))) return;
    await api(`/campaigns/${c.id}`, { method: 'DELETE' }); load();
  };
  const duplicate = async (c: any) => {
    try { await api(`/campaigns/${c.id}/duplicate`, { method: 'POST' }); load(); }
    catch (e: any) { alert(e.message || 'Could not duplicate'); }
  };
  const resetProgress = async (c: any) => {
    if (!(await confirm({
      title: 'Reset progress?',
      message: `Clear every lead's disposition on "${c.name}" so it re-dials the whole list again. Call history and recordings are kept — this only re-opens the leads.`,
      confirmLabel: 'Reset', danger: true,
    }))) return;
    try { await api(`/campaigns/${c.id}/reset`, { method: 'POST' }); load(); }
    catch (e: any) { alert(e.message || 'Could not reset'); }
  };

  const load = async () => setList(await api('/campaigns/overview').catch(() => []));

  useEffect(() => {
    if (!getUser()) { router.replace('/login'); return; }
    load();
    api('/dispositions').then(setDispositions).catch(() => {});
    // Restore an open wizard after a refresh from ?campaign=new|<id>.
    const param = new URLSearchParams(window.location.search).get('campaign');
    if (param === 'new') setEditing({});
    else if (param) pendingEditIdRef.current = param; // opened once the list arrives
    return () => { if (poll.current) clearInterval(poll.current); };
  }, [router]);

  // Once the campaign list loads, open the wizard for a ?campaign=<id> refresh.
  useEffect(() => {
    const id = pendingEditIdRef.current;
    if (!id || editing) return;
    const c = list.find((x) => x.id === id);
    if (c) { pendingEditIdRef.current = null; setEditing(cleanCampaign(c)); }
  }, [list, editing]);

  const startPoll = (id: string) => {
    if (poll.current) clearInterval(poll.current);
    poll.current = setInterval(async () => {
      try { setRun(await api(`/campaigns/${id}/run`)); }
      catch { setRun(null); } // no run yet (nobody's joined) — keep polling
    }, 1500);
  };
  const openRunner = async (c: any) => {
    setRunning(c); setRun(null);
    try { setRun(await api(`/campaigns/${c.id}/run`)); } catch { /* no run yet */ }
    startPoll(c.id); // live-monitor; dialing is driven by agents joining
  };
  const setDispo = async (number: string, disposition: string) => {
    try { await api(`/campaigns/${running.id}/disposition`, { method: 'POST', body: JSON.stringify({ number, disposition }) }); }
    catch (e: any) { alert(e.message); }
  };

  if (editing) {
    return (
      <div className="page">
        <CampaignWizard
          initial={editing}
          onClose={() => closeEditor()}
          onSaved={() => closeEditor(true)}
        />
      </div>
    );
  }

  if (running) {
    const items = run?.items ?? [];
    const count = (s: string) => items.filter((i: any) => i.status === s).length;
    return (
      <div>
        <div className="page">
          <button className="btn btn-ghost" onClick={() => { if (poll.current) clearInterval(poll.current); setRunning(null); }}>← Back</button>
          <h2 style={{ margin: '14px 0 4px' }}>Monitor: {running.name}</h2>
          <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>Live view of the current run. For the full persisted record, open Call history.</p>
          <div className="row" style={{ marginBottom: 12, gap: 10, alignItems: 'center' }}>
            <span className="pill">{/broadcast/i.test(running.dialMethod || '') ? 'broadcast (plays audio)' : `${running.dialMethod} · bridges to agents`}</span>
            {run ? <span className="pill ok">{run.status}</span> : <span className="pill">waiting for an agent to play in</span>}
            {run && /power|predict/i.test(running.dialMethod || '') && run.ratio != null && (
              <span className="pill" title={/predict/i.test(running.dialMethod || '') ? 'Live dial-ahead ratio, tuned automatically from the answer and abandon rates' : 'Fixed dial-ahead ratio'}>
                dial-ahead {Number(run.ratio).toFixed(2)}× {/predict/i.test(running.dialMethod || '') ? '(auto)' : ''}
              </span>
            )}
            {run && <span className="muted">agents on: {run.joinedAgents?.length ?? 0} · answered {count('answered')} · bridged {run.bridged ?? 0} · abandoned {run.abandoned ?? 0}{(run.bridged ?? 0) + (run.abandoned ?? 0) > 0 ? ` (${Math.round((run.abandoned / (run.bridged + run.abandoned)) * 1000) / 10}%)` : ''} · failed {count('failed')} · pending {count('queued') + count('dialing')}</span>}
          </div>
          <div className="wiz-note" style={{ marginBottom: 12 }}>Dialing is agent-driven: it runs while the campaign is active and agents have played in from their Console. This is a live monitor.</div>
          {run?.note && <div className="wiz-note" style={{ marginBottom: 12, color: 'var(--amber-d, #92400e)', background: '#fffbeb', borderColor: '#fde68a' }}>{run.note}</div>}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#f9fafb' }}><Th>#</Th><Th>Number</Th><Th>Status</Th><Th>Try</Th><Th>Disposition</Th><Th>Cause</Th></tr></thead>
              <tbody>
                {items.map((it: any, i: number) => (
                  <tr key={it.number}>
                    <Td><span className="muted">{i + 1}</span></Td><Td><b>{it.number}</b></Td><Td><StatusBadge status={it.status} /></Td><Td>{it.attempts}</Td>
                    <Td>
                      {(() => {
                        const catalogCat = (dispositions.find((d) => d.name === it.disposition)?.category || '').toLowerCase();
                        const cat = DISP_STYLE[catalogCat] ? catalogCat : inferDispCategory(it.disposition);
                        const c = DISP_STYLE[cat];
                        return (
                          <select value={it.disposition ?? ''} onChange={(e) => setDispo(it.number, e.target.value)}
                            title="Set or override this call's disposition"
                            style={{ padding: '3px 8px', fontSize: 12, fontWeight: c ? 700 : 400, borderRadius: 999,
                              border: `1px solid ${c ? c.bd : 'var(--border)'}`, background: c ? c.bg : '#fff', color: c ? c.fg : 'var(--muted)', cursor: 'pointer' }}>
                            <option value="">— set —</option>
                            {it.disposition && !dispositions.some((d) => d.name === it.disposition) && <option value={it.disposition}>{it.disposition}</option>}
                            {dispositions.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
                          </select>
                        );
                      })()}
                    </Td>
                    <Td><span className="muted" style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>{it.cause || '—'}</span></Td>
                  </tr>
                ))}
                {!items.length && <tr><Td colSpan={6}><span className="muted">No run yet. Press Start dialing.</span></Td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  if (runDetail) {
    const items = runDetail.items ?? [];
    const r = runDetail.run ?? {};
    const durS = Math.max(0, Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 1000));
    const res = (r.bridged || 0) + (r.abandoned || 0);
    const abandonPct = res ? Math.round((r.abandoned / res) * 1000) / 10 : 0;
    return (
      <div className="page">
        <button className="btn btn-ghost" onClick={() => setRunDetail(null)}>← Back to runs</button>
        <h2 style={{ margin: '14px 0 4px' }}>Run detail: {runDetail.campaign?.name}</h2>
        <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>Every number this run dialed and how it ended.</p>
        <div className="row" style={{ marginBottom: 12, gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="pill">{new Date(r.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          <span className="pill">{r.dialMethod}</span>
          <StatusBadge status={r.status} />
          <span className="muted">dialed {r.dialed ?? 0} · connected {r.connected ?? 0} · bridged {r.bridged ?? 0} · abandoned {r.abandoned ?? 0} ({abandonPct}%) · failed {r.failed ?? 0} · {Math.floor(durS / 60)}m {durS % 60}s</span>
        </div>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f9fafb' }}><Th>#</Th><Th>Number</Th><Th>Status</Th><Th>Try</Th><Th>Disposition</Th><Th>Cause</Th></tr></thead>
            <tbody>
              {runDetail.loading && <tr><Td colSpan={6}><span className="muted">Loading…</span></Td></tr>}
              {!runDetail.loading && items.map((it: any, i: number) => {
                const catalogCat = (dispositions.find((d) => d.name === it.disposition)?.category || '').toLowerCase();
                const cat = DISP_STYLE[catalogCat] ? catalogCat : inferDispCategory(it.disposition);
                const c = DISP_STYLE[cat];
                return (
                  <tr key={`${it.number}_${i}`}>
                    <Td><span className="muted">{i + 1}</span></Td>
                    <Td><b>{it.number}</b></Td>
                    <Td><StatusBadge status={it.status} /></Td>
                    <Td>{it.attempts}</Td>
                    <Td>{it.disposition
                      ? <span style={{ padding: '3px 10px', fontSize: 12, fontWeight: 700, borderRadius: 999, border: `1px solid ${c ? c.bd : 'var(--border)'}`, background: c ? c.bg : '#fff', color: c ? c.fg : 'var(--muted)' }}>{it.disposition}</span>
                      : <span className="muted">—</span>}</Td>
                    <Td><span className="muted" style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>{it.cause || '—'}</span></Td>
                  </tr>
                );
              })}
              {!runDetail.loading && !items.length && <tr><Td colSpan={6}><span className="muted">No per-call records were kept for this run.</span></Td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (runs) {
    const list = runs.list ?? [];
    const dur = (r: any) => { const s = Math.max(0, Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 1000)); return `${Math.floor(s / 60)}m ${s % 60}s`; };
    const rate = (r: any) => { const res = (r.bridged || 0) + (r.abandoned || 0); return res ? Math.round((r.abandoned / res) * 1000) / 10 : 0; };
    return (
      <div className="page">
        <button className="btn btn-ghost" onClick={() => setRuns(null)}>← Back</button>
        <h2 style={{ margin: '14px 0 6px' }}>Run history: {runs.campaign?.name}</h2>
        <p className="muted" style={{ margin: '0 0 18px', fontSize: 13 }}>Each finished dialing run and its outcome. Click a run to see every call it made. Abandon rate = answered calls that never reached an agent (higher = over-dialing too hard).</p>
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f9fafb' }}>
              <Th>Started</Th><Th>Mode</Th><Th>Status</Th><Th>Dialed</Th><Th>Connected</Th><Th>Bridged</Th><Th>Abandoned</Th><Th>Abandon rate</Th><Th>Duration</Th>
            </tr></thead>
            <tbody>
              {runs.loading && <tr><Td colSpan={9}><span className="muted">Loading…</span></Td></tr>}
              {!runs.loading && list.map((r: any) => (
                <tr key={r.id} onClick={() => openRunDetail(runs.campaign, r)} title="See every call this run made"
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#f9fafb')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '')}>
                  <Td>{new Date(r.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Td>
                  <Td>{r.dialMethod}</Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td>{r.dialed}</Td>
                  <Td>{r.connected}</Td>
                  <Td>{r.bridged}</Td>
                  <Td>{r.abandoned}</Td>
                  <Td><b style={{ color: rate(r) > 5 ? 'var(--red)' : 'var(--green-d)' }}>{rate(r)}%</b></Td>
                  <Td>{dur(r)}</Td>
                </tr>
              ))}
              {!runs.loading && !list.length && <tr><Td colSpan={9}><span className="muted">No finished runs yet. Runs appear here once a Progressive / Power / Predictive / VoiceBroadcast campaign completes a dialing run.</span></Td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (history) {
    const calls = history.calls ?? [];
    const badge = (cat?: string) => {
      const d = dispositions.find((x) => x.name === cat);
      return d?.category?.toLowerCase();
    };
    return (
      <div className="page">
        <button className="btn btn-ghost" onClick={() => setHistory(null)}>← Back</button>
        <h2 style={{ margin: '14px 0 6px' }}>Call history: {history.campaign?.name}</h2>
        <p className="muted" style={{ margin: '0 0 6px', fontSize: 13 }}>Every call this campaign made — connected calls plus dials that never reached an agent.</p>
        <div className="row" style={{ gap: 16, marginBottom: 18 }}>
          <span className="muted">{history.counts?.total ?? 0} calls</span>
          <span className="muted">· {history.counts?.answered ?? 0} answered</span>
          <span className="muted">· {history.counts?.dispositioned ?? 0} dispositioned</span>
          <span className="muted">· {history.counts?.recorded ?? 0} recorded</span>
        </div>
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f9fafb' }}>
              <Th>When</Th><Th>Number</Th><Th>Agent</Th><Th>Duration</Th><Th>Status</Th><Th>Disposition</Th><Th>Notes</Th><Th>Recording</Th>
            </tr></thead>
            <tbody>
              {history.loading && <tr><Td colSpan={8}><span className="muted">Loading…</span></Td></tr>}
              {!history.loading && calls.map((c: any) => (
                <tr key={c.id}>
                  <Td>{new Date(c.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Td>
                  <Td><b>{c.name || c.number}</b>{c.name && <div className="muted" style={{ fontSize: 12 }}>{c.number}</div>}</Td>
                  <Td>{c.agent || <span className="muted">—</span>}</Td>
                  <Td>{c.durationSec ? `${String(Math.floor(c.durationSec / 60)).padStart(2, '0')}:${String(c.durationSec % 60).padStart(2, '0')}` : '—'}</Td>
                  <Td><span title={c.cause || ''} style={{ textTransform: 'capitalize' }}>{c.status}</span>{c.cause && <div className="muted" style={{ fontSize: 11 }}>{c.cause}</div>}</Td>
                  <Td>{c.disposition ? <span className={`disp-badge disp-badge-${badge(c.disposition) === 'success' ? 'green' : badge(c.disposition) === 'callback' ? 'blue' : badge(c.disposition) === 'dnc' || badge(c.disposition) === 'failure' ? 'red' : 'amber'}`}>{c.disposition}</span> : <span className="muted">—</span>}</Td>
                  <Td>{c.notes ? <span title={c.notes} style={{ display: 'inline-block', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>{c.notes}</span> : <span className="muted">—</span>}</Td>
                  <Td>
                    {c.kind === 'log' && c.recording
                      ? (audioUrls[c.id]
                          ? <audio controls autoPlay src={audioUrls[c.id]} style={{ height: 30, maxWidth: 200 }} />
                          : <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => playRec(c.id)}>▶ Play</button>)
                      : <span className="muted">—</span>}
                  </Td>
                </tr>
              ))}
              {!history.loading && !calls.length && <tr><Td colSpan={8}><span className="muted">No calls recorded for this campaign yet.</span></Td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const filtered = q
    ? list.filter((c) => `${c.name} ${c.description ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    : list;

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <input placeholder="Search campaigns…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 380 }} />
        <button className="btn btn-green" onClick={() => openEditor(null)}>+ New Campaign</button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="camp-table">
          <thead>
            <tr>
              <Th>Campaign Name</Th><Th>Status</Th><Th>Contacts Count</Th><Th>Staff Agents</Th>
              <Th>Contact Rate</Th><Th>Goal Objective</Th><Th style={{ textAlign: 'right' }}>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <Td>
                  <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 700 }}>{c.name}</span>
                    <DirectionBadge type={c.directionType} />
                  </div>
                  {c.description && <div className="muted" style={{ fontSize: 12, marginTop: 2, maxWidth: 380 }}>{c.description}</div>}
                </Td>
                <Td><span className={`camp-status ${c.active ? 'on' : 'off'}`}>{c.active ? 'ACTIVE' : 'PAUSED'}</span></Td>
                <Td>{c.contactsCount ?? 0}</Td>
                <Td>{c.agentCount ?? 0} Assigned</Td>
                <Td>
                  <b style={{ color: 'var(--green-d)' }}>{c.contactRate ?? 0}%</b>
                  {c.runCount > 0 && <div className="muted" style={{ fontSize: 11 }} title="Share of answered calls that never reached an agent, across all runs">abandon {c.abandonRate ?? 0}%</div>}
                </Td>
                <Td><span className="muted">{c.goal || '—'}</span></Td>
                <Td>
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <button className="icon-btn" title="Actions" onClick={(e) => openMenu(e, c)}><MoreVertical size={18} /></button>
                  </div>
                </Td>
              </tr>
            ))}
            {!filtered.length && <tr><Td colSpan={7}><span className="muted">No campaigns{q ? ' match your search' : ' yet'}.</span></Td></tr>}
          </tbody>
        </table>
      </div>

      {menu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="row-menu" style={{ position: 'fixed', top: menu.y, left: Math.max(8, menu.x - 216), zIndex: 41 }}>
            {AUTO_DIAL(menu.c.dialMethod) && <MenuItem icon={<Activity size={15} />} label="Monitor run" onClick={() => { openRunner(menu.c); setMenu(null); }} />}
            {AUTO_DIAL(menu.c.dialMethod) && <MenuItem icon={<History size={15} />} label="Run history" onClick={() => { openRuns(menu.c); setMenu(null); }} />}
            <MenuItem icon={<ClipboardList size={15} />} label="Call history" onClick={() => { openHistory(menu.c); setMenu(null); }} />
            <MenuItem icon={<RotateCcw size={15} />} label="Reset progress" onClick={() => { resetProgress(menu.c); setMenu(null); }} />
            <MenuItem icon={<Copy size={15} />} label="Duplicate" onClick={() => { duplicate(menu.c); setMenu(null); }} />
            <MenuItem icon={<Pencil size={15} />} label="Edit" onClick={() => { openEditor(menu.c); setMenu(null); }} />
            <MenuItem icon={menu.c.active ? <Pause size={15} /> : <Play size={15} />} label={menu.c.active ? 'Pause' : 'Activate'} onClick={() => { toggleActive(menu.c); setMenu(null); }} />
            <div className="menu-sep" />
            <MenuItem icon={<Trash2 size={15} />} label="Delete" danger onClick={() => { removeCampaign(menu.c); setMenu(null); }} />
          </div>
        </>
      )}
    </div>
  );
}

function DirectionBadge({ type }: { type?: string }) {
  const t = type === 'Inbound' || type === 'Blended' ? type : 'Outbound';
  const map: Record<string, { bg: string; color: string; Icon: React.ComponentType<{ size?: number }> }> = {
    Inbound: { bg: '#dbeafe', color: '#1d4ed8', Icon: PhoneIncoming },
    Outbound: { bg: '#dcfce7', color: '#15803d', Icon: PhoneOutgoing },
    Blended: { bg: '#f3e8ff', color: '#7c3aed', Icon: PhoneCall },
  };
  const s = map[t];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: s.bg, color: s.color, padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
      <s.Icon size={12} /> {t}
    </span>
  );
}
function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button className={`menu-item ${danger ? 'danger' : ''}`} onClick={onClick}>
      <span style={{ display: 'inline-flex', width: 18 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function cleanCampaign(c: any) {
  return {
    id: c.id,
    name: c.name ?? '',
    directionType: c.directionType ?? 'Outbound',
    description: c.description ?? '',
    goal: c.goal ?? '',
    contactGroupId: c.contactGroupId ?? '',
    numbers: c.numbers ?? '',
    dialMethod: c.dialMethod ?? 'Preview',
    concurrency: c.concurrency ?? 1,
    overdialRatio: c.overdialRatio ?? 2,
    maxAttempts: c.maxAttempts ?? 1,
    recording: !!c.recording,
    amd: !!c.amd,
    audioFile: c.audioFile ?? '',
    assignedAgentIds: c.assignedAgentIds ?? [],
    queue: c.queue ?? '',
    gateway: c.gateway ?? '',
    callerId: c.callerId ?? '',
    // DateTime → yyyy-mm-dd for the date inputs
    scheduleStart: c.scheduleStart ? String(c.scheduleStart).slice(0, 10) : '',
    scheduleEnd: c.scheduleEnd ? String(c.scheduleEnd).slice(0, 10) : '',
    callWindowStart: c.callWindowStart ?? '',
    callWindowEnd: c.callWindowEnd ?? '',
    timezone: c.timezone ?? '',
    dispositionIds: c.dispositionIds ?? [],
    excludeDispositionIds: c.excludeDispositionIds ?? [],
  };
}
// Colour a call/run status so the tables read at a glance.
const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  answered: { bg: '#dcfce7', fg: '#15803d' }, done: { bg: '#dcfce7', fg: '#15803d' },
  bridged:  { bg: '#dcfce7', fg: '#15803d' },
  failed:   { bg: '#fee2e2', fg: '#b91c1c' }, error: { bg: '#fee2e2', fg: '#b91c1c' },
  abandoned:{ bg: '#ffedd5', fg: '#c2410c' },
  dialing:  { bg: '#fef3c7', fg: '#92400e' },
  queued:   { bg: '#e0e7ff', fg: '#3730a3' },
  skipped:  { bg: '#f3f4f6', fg: '#6b7280' }, stopped: { bg: '#f3f4f6', fg: '#6b7280' },
};
function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] || { bg: '#f3f4f6', fg: '#6b7280' };
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: s.bg, color: s.fg, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{status}</span>;
}
// Colour a disposition by its category (matches the disp-badge palette).
const DISP_STYLE: Record<string, { bg: string; fg: string; bd: string }> = {
  success:  { bg: '#dcfce7', fg: '#166534', bd: '#86efac' },
  callback: { bg: '#dbeafe', fg: '#1d4ed8', bd: '#93c5fd' },
  dnc:      { bg: '#fee2e2', fg: '#b91c1c', bd: '#fca5a5' },
  failure:  { bg: '#fee2e2', fg: '#b91c1c', bd: '#fca5a5' },
};
// System dispositions (Answered / Failed / No Answer …) aren't in the catalog, so
// infer a category from the name when the catalog has none. Check failure first so
// "No Answer" doesn't match the "answer" success rule.
function inferDispCategory(name?: string): string {
  const n = (name || '').toLowerCase();
  if (!n) return '';
  if (/no[\s-]?answer|fail|busy|declin|unreach|absent|voicemail|machine|dnc|do not|reject|invalid/.test(n)) return 'failure';
  if (/callback|call[\s-]?back/.test(n)) return 'callback';
  if (/answer|success|sale|complet|connect|interest|resolved|won/.test(n)) return 'success';
  return '';
}

function Th({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <th style={{ textAlign: 'left', padding: '12px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', color: 'var(--muted)', borderBottom: '1px solid var(--border)', ...style }}>{children}</th>;
}
function Td({ children, colSpan }: { children: React.ReactNode; colSpan?: number }) {
  return <td colSpan={colSpan} style={{ padding: '13px 14px', fontSize: 13, lineHeight: 1.45, verticalAlign: 'middle', borderBottom: '1px solid #f0f1f3' }}>{children}</td>;
}
