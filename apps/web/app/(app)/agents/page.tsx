'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Ear, MessageSquare, Radio, Pause, Play, UserPlus, LayoutGrid, List } from 'lucide-react';
import { api, getUser, hasPermission, landingPath } from '@/lib/api';

// Supervisor monitoring modes. We eavesdrop the agent's own leg, so "whisper"
// reaches the agent only (coach) and "barge" bridges both parties.
const MODES = [
  { key: 'listen',  label: 'Listen', Icon: Ear,           tip: 'Listen silently. Neither the agent nor the customer hears you.' },
  { key: 'whisper', label: 'Coach',  Icon: MessageSquare, tip: 'Only the agent hears you. The customer does not.' },
  { key: 'barge',   label: 'Barge',  Icon: Radio,         tip: 'Join the call. Both the agent and the customer hear you.' },
] as const;
const MONITOR_VERB: Record<string, string> = { listen: 'Listening to', whisper: 'Coaching', barge: 'Barging into' };

type Agent = {
  ext: string;
  name: string;
  status: 'on-call' | 'available' | 'wrap-up' | 'away' | 'offline';
  calls: number;
  conn: number;
  aht: string;
};

// Demo data — live agent board renders this when FreeSWITCH/telephony isn't reachable.
const DEMO_AGENTS: Agent[] = [
  { ext: '1001', name: 'Chinedu Eze',    status: 'on-call',   calls: 42, conn: 28, aht: '4:12' },
  { ext: '1002', name: 'Fatima Bello',   status: 'available', calls: 38, conn: 24, aht: '3:48' },
  { ext: '1003', name: 'Tunde Adesina',  status: 'wrap-up',   calls: 45, conn: 30, aht: '4:55' },
  { ext: '1004', name: 'Ngozi Okafor',   status: 'available', calls: 29, conn: 17, aht: '3:21' },
  { ext: '1005', name: 'Samuel Idris',   status: 'away',      calls: 12, conn: 6,  aht: '2:58' },
  { ext: '1006', name: 'Blessing Uche',  status: 'on-call',   calls: 51, conn: 36, aht: '4:02' },
  { ext: '1007', name: 'Kelechi Nnamdi', status: 'offline',   calls: 0,  conn: 0,  aht: '0:00' },
  { ext: '1008', name: 'Hauwa Garba',    status: 'available', calls: 33, conn: 21, aht: '3:39' },
];

const STATUS: Record<Agent['status'], { label: string; cls: string }> = {
  'on-call':   { label: 'on-call',   cls: 'st-oncall' },
  'available': { label: 'available', cls: 'st-available' },
  'wrap-up':   { label: 'wrap-up',   cls: 'st-wrapup' },
  'away':      { label: 'away',      cls: 'st-away' },
  'offline':   { label: 'offline',   cls: 'st-offline' },
};

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

// Contact Center → Agents: live supervision board. Real-time status, workload,
// and monitor (listen/whisper/barge). Supervisors + admins.
export default function AgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [demo, setDemo] = useState(false);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [q, setQ] = useState('');
  const everReal = useRef(false);

  useEffect(() => {
    if (!getUser()) { router.replace('/login'); return; }
    if (!hasPermission('live')) { router.replace(landingPath()); return; }
    let alive = true;
    // Live agent board — poll so status (on-call, break, available) stays current.
    const load = () => api('/telephony/agents').then((rows: any[]) => {
      if (!alive) return;
      const mapped = (rows || []).map(normalizeAgent).filter(Boolean) as Agent[];
      if (mapped.length) { everReal.current = true; setAgents(mapped); setDemo(false); }
      else if (!everReal.current) { setAgents(DEMO_AGENTS); setDemo(true); }
    }).catch(() => { if (alive && !everReal.current) { setAgents(DEMO_AGENTS); setDemo(true); } });
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [router]);

  const myExt = (getUser() as any)?.agentExtension || '';

  const monitor = async (a: Agent, mode: string) => {
    const verb = MONITOR_VERB[mode] || 'Monitoring';
    if (demo) { toast.success(`${verb} ${a.name} (demo)`); return; }
    try {
      await api(`/telephony/agents/${a.ext}/monitor`, { method: 'POST', body: JSON.stringify({ mode }) });
      toast.success(`${verb} ${a.name}. Answer your softphone to connect.`);
    } catch (e: any) { toast.error(e.message || 'Could not start monitoring'); }
  };
  // Pause (On Break) / Resume (Available) toggle. Optimistically flip the card so
  // the button switches immediately; the poll confirms from FreeSWITCH.
  const toggleBreak = async (a: Agent) => {
    const resume = a.status === 'away';
    const status = resume ? 'Available' : 'On Break';
    const uiStatus: Agent['status'] = resume ? 'available' : 'away';
    const label = resume ? 'Resumed' : 'Paused';
    setAgents((prev) => prev.map((x) => (x.ext === a.ext ? { ...x, status: uiStatus } : x)));
    if (demo) { toast.success(`${label} ${a.name} (demo)`); return; }
    try {
      await api(`/telephony/agents/${a.ext}/status`, { method: 'POST', body: JSON.stringify({ status }) });
      toast.success(`${label} ${a.name}`);
    } catch (e: any) { toast.error(e.message || 'Could not update agent'); }
  };

  const filtered = agents.filter((a) => !q || a.name.toLowerCase().includes(q.toLowerCase()) || a.ext.includes(q));

  return (
    <div className="agent-page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Agents</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>Manage agents, statuses, and workload.</p>
        </div>
        <button className="btn btn-green" onClick={() => router.push('/users')}><UserPlus size={16} style={{ marginRight: 6, verticalAlign: '-3px' }} />Invite Agent</button>
      </div>

      {/* Toolbar: search + view toggle */}
      <div className="row" style={{ marginTop: 18, gap: 12 }}>
        <input style={{ maxWidth: 320 }} placeholder="Search by name or extension…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="view-toggle" style={{ marginLeft: 'auto' }}>
          <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')} aria-label="Grid view"><LayoutGrid size={16} /></button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} aria-label="List view"><List size={16} /></button>
        </div>
      </div>

      <div className="monitor-legend">
        {MODES.map((m) => { const Icon = m.Icon; return (
          <span key={m.key} className="muted"><Icon size={13} /> <b>{m.label}</b> — {m.key === 'listen' ? 'silent' : m.key === 'whisper' ? 'agent hears you' : 'both hear you'}</span>
        ); })}
      </div>

      {demo && <div className="agent-demo-banner" style={{ marginTop: 14 }}>Demo data. Live agent status appears here once telephony is connected.</div>}

      {view === 'grid' ? (
        <div className="agents-grid">
          {filtered.map((a) => (
            <div key={a.ext} className="agent-card">
              <div className="agent-card-head">
                <div className="agent-card-avatar">
                  {initials(a.name)}
                  <span className={`agent-dot ${STATUS[a.status].cls}`} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="agent-card-name">{a.name}</div>
                  <div className="muted" style={{ fontSize: 13 }}>Ext. {a.ext}</div>
                </div>
                <span className={`status-badge ${STATUS[a.status].cls}`}>{STATUS[a.status].label}</span>
              </div>

              <div className="agent-stats">
                <div className="agent-stats-cap">Today</div>
                <Stat v={a.calls} l="CALLS" /><Stat v={a.conn} l="CONN." /><Stat v={a.aht} l="AHT" />
              </div>

              <div className="agent-card-actions">
                {a.status === 'on-call' && a.ext !== myExt ? (
                  <div className="monitor-bar">
                    {MODES.map((m) => { const Icon = m.Icon; return (
                      <button key={m.key} className={`mon-btn${m.key === 'barge' ? ' mon-barge' : ''}`} title={m.tip} onClick={() => monitor(a, m.key)}><Icon size={14} />{m.label}</button>
                    ); })}
                  </div>
                ) : (
                  <span className="muted" style={{ flex: 1, fontSize: 12 }}>{a.ext === myExt ? 'This is you' : 'Not on a call'}</span>
                )}
                {a.status === 'away'
                  ? <button className="btn btn-ghost" onClick={() => toggleBreak(a)} aria-label="Resume agent" title="Resume (set Available)"><Play size={16} /></button>
                  : <button className="btn btn-ghost" onClick={() => toggleBreak(a)} aria-label="Pause agent" title="Pause (set On Break)"><Pause size={16} /></button>}
              </div>
            </div>
          ))}
          {!filtered.length && <p className="muted">No agents match.</p>}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 16 }}>
          <table className="data-table">
            <thead><tr><Th>Agent</Th><Th>Ext.</Th><Th>Status</Th><Th>Calls (today)</Th><Th>Conn. (today)</Th><Th>AHT (today)</Th><Th>Actions</Th></tr></thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.ext}>
                  <Td><b>{a.name}</b></Td>
                  <Td>{a.ext}</Td>
                  <Td><span className={`status-badge ${STATUS[a.status].cls}`}>{STATUS[a.status].label}</span></Td>
                  <Td>{a.calls}</Td><Td>{a.conn}</Td><Td>{a.aht}</Td>
                  <Td>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {a.status === 'on-call' && a.ext !== myExt
                        ? MODES.map((m) => { const Icon = m.Icon; return (
                            <button key={m.key} className={`btn btn-ghost btn-sm${m.key === 'barge' ? ' mon-barge' : ''}`} title={m.tip} onClick={() => monitor(a, m.key)}><Icon size={13} style={{ marginRight: 4, verticalAlign: '-2px' }} />{m.label}</button>
                          ); })
                        : <span className="muted" style={{ fontSize: 12 }}>{a.ext === myExt ? 'You' : 'Idle'}</span>}
                      <button className="btn btn-ghost btn-sm" onClick={() => toggleBreak(a)}>{a.status === 'away' ? 'Resume' : 'Pause'}</button>
                    </div>
                  </Td>
                </tr>
              ))}
              {!filtered.length && <tr><Td colSpan={7}><span className="muted">No agents match.</span></Td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Map a telephony agent record into the card shape (best-effort; shapes vary by backend).
function normalizeAgent(r: any): Agent | null {
  const ext = r?.extension || r?.ext || r?.agent;
  if (!ext) return null;
  const raw = (r?.state || r?.status || 'offline').toString().toLowerCase();
  const status: Agent['status'] =
    raw.includes('call') || raw.includes('talk') ? 'on-call'
    : raw.includes('wrap') ? 'wrap-up'
    : raw.includes('avail') ? 'available'
    : raw.includes('away') || raw.includes('break') ? 'away'
    : 'offline';
  return { ext: String(ext), name: r?.name || r?.displayName || `Ext ${ext}`, status, calls: r?.calls ?? 0, conn: r?.connected ?? r?.conn ?? 0, aht: r?.aht ?? '0:00' };
}

function Stat({ v, l }: { v: React.ReactNode; l: string }) {
  return <div className="agent-stat"><div className="agent-stat-v">{v}</div><div className="agent-stat-l">{l}</div></div>;
}
function Th({ children }: { children?: React.ReactNode }) { return <th style={{ textAlign: 'left', padding: '11px 14px', fontSize: 12, color: 'var(--muted)', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>{children}</th>; }
function Td({ children, colSpan }: { children?: React.ReactNode; colSpan?: number }) { return <td colSpan={colSpan} style={{ padding: '11px 14px', fontSize: 13, borderBottom: '1px solid #f0f1f3' }}>{children}</td>; }
