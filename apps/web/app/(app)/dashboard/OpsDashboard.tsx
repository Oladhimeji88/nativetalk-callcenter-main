'use client';
import { useEffect, useRef, useState } from 'react';
import { Phone, Users, PhoneCall, TrendingUp, Clock, ListOrdered } from 'lucide-react';
import { api } from '@/lib/api';

const fmtDur = (s: number) => `${String(Math.floor((s || 0) / 60)).padStart(2, '0')}:${String((s || 0) % 60).padStart(2, '0')}`;

// Colour a live-call or agent status chip.
function chipStyle(status: string): React.CSSProperties {
  const map: Record<string, [string, string]> = {
    connected: ['#dcfce7', '#15803d'], 'on-call': ['#dbeafe', '#1d4ed8'],
    ringing: ['#dbeafe', '#1d4ed8'], 'on-hold': ['#fef3c7', '#b45309'],
    available: ['#dcfce7', '#15803d'], 'wrap-up': ['#fef3c7', '#b45309'],
    away: ['#f1f5f9', '#64748b'], offline: ['#f1f5f9', '#94a3b8'],
  };
  const [bg, color] = map[status] || ['#f1f5f9', '#64748b'];
  return { background: bg, color, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' };
}

// Supervisor view: live floor operations — who is on a call, what is queueing,
// and how campaigns are converting right now.
export default function OpsDashboard() {
  const [d, setD] = useState<any>(null);
  const [range, setRange] = useState('24h');
  const timer = useRef<any>(null);
  const rangeRef = useRef(range);
  rangeRef.current = range;

  useEffect(() => {
    const load = async () => { try { setD(await api(`/dashboard/ops?range=${rangeRef.current}`)); } catch { /* keep last */ } };
    load();
    timer.current = setInterval(load, 4000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);
  // Reload immediately when the range changes.
  useEffect(() => { api(`/dashboard/ops?range=${range}`).then(setD).catch(() => {}); }, [range]);

  const RANGE_LABELS: Record<string, string> = { '1h': 'Last hour', '24h': 'Last 24h', '7d': 'Last 7 days', '30d': 'Last 30 days' };

  const k = d?.kpis ?? {};
  const live = d?.liveCalls ?? [];
  const agents = d?.agents ?? [];
  const series = d?.contactRateSeries ?? [];
  const perf = d?.campaignPerformance ?? [];

  const exportCsv = () => {
    const rows = [['Caller', 'Agent', 'Campaign', 'Queue', 'Duration', 'Status'],
      ...live.map((c: any) => [c.caller, c.agent || '', c.campaign || '', c.queue || '', fmtDur(c.durationSec), c.status])];
    const csv = rows.map((r: any[]) => r.map((x: any) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'live-calls.csv'; a.click();
  };

  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Operations Dashboard</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>Live overview of contact center traffic, agents, and campaign health.</p>
        </div>
        <div className="page-actions">
          <select className="btn btn-ghost" value={range} onChange={(e) => setRange(e.target.value)} style={{ cursor: 'pointer' }}>
            {Object.entries(RANGE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button className="btn btn-green" onClick={exportCsv}>Export</button>
        </div>
      </div>

      {/* KPI cards — real-time (no delta) + windowed (delta vs previous window) */}
      <div className="dashboard-kpi-grid">
        <Kpi label="Active Calls" value={k.activeCalls ?? 0} Icon={Phone} />
        <Kpi label="Available Agents" value={`${k.agentsAvailable ?? 0} / ${k.agentsTotal ?? 0}`} Icon={Users} />
        <Kpi label={`Calls · ${RANGE_LABELS[range]}`} value={(k.calls ?? 0).toLocaleString()} Icon={PhoneCall}
          delta={k.callsDelta} deltaFmt={(d: number) => `${d > 0 ? '+' : ''}${d}%`} deltaGood={(d: number) => d >= 0} />
        <Kpi label="Contact Rate" value={`${k.contactRate ?? 0}%`} Icon={TrendingUp}
          delta={k.contactRateDelta} deltaFmt={(d: number) => `${d > 0 ? '+' : ''}${d} pts`} deltaGood={(d: number) => d >= 0} />
        <Kpi label="Avg Handle Time" value={fmtDur(k.avgHandleSec ?? 0)} Icon={Clock}
          delta={k.avgHandleDelta} deltaFmt={(d: number) => `${d > 0 ? '+' : ''}${d}s`} deltaGood={(d: number) => d <= 0} />
        <Kpi label="Calls Waiting" value={k.callsWaiting ?? 0} Icon={ListOrdered} />
      </div>

      {/* Live calls + Agent status */}
      <div className="dashboard-main-grid">
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="card-head">
            <div>
              <h3 className="card-title">Live Calls</h3>
              <span className="muted" style={{ fontSize: 13 }}>{live.length} active session{live.length === 1 ? '' : 's'}</span>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr style={{ background: '#f9fafb' }}>
                {['Caller', 'Agent', 'Campaign', 'Queue', 'Duration', 'Status'].map((h) => <Th key={h}>{h}</Th>)}
              </tr></thead>
              <tbody>
                {live.map((c: any, i: number) => (
                  <tr key={i}>
                    <Td><b>{c.caller || 'unknown'}</b></Td>
                    <Td>{c.agent || <span className="muted">—</span>}</Td>
                    <Td className="muted">{c.campaign || '—'}</Td>
                    <Td className="muted">{c.queue || '—'}</Td>
                    <Td>{fmtDur(c.durationSec)}</Td>
                    <Td><span style={chipStyle(c.status)}><Dot /> {c.status}</span></Td>
                  </tr>
                ))}
                {!live.length && <tr><Td colSpan={6}><span className="muted">No active calls right now.</span></Td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="card-head">
            <div>
              <h3 className="card-title">Agent Status</h3>
              <span className="muted" style={{ fontSize: 13 }}>{agents.length} team member{agents.length === 1 ? '' : 's'}</span>
            </div>
          </div>
          <div>
            {agents.map((a: any) => (
              <div key={a.ext} className="row" style={{ justifyContent: 'space-between', padding: '10px 18px', borderTop: '1px solid #f0f1f3' }}>
                <div className="row" style={{ gap: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#e8f5e9', color: '#15803d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
                    {a.name.split(' ').map((s: string) => s[0]).slice(0, 2).join('').toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{a.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>Ext. {a.ext}</div>
                  </div>
                </div>
                <span style={chipStyle(a.status)}><Dot /> {a.status}</span>
              </div>
            ))}
            {!agents.length && <div className="muted" style={{ padding: 18 }}>No agents.</div>}
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="dashboard-chart-grid">
        <div className="card">
          <h3 style={{ margin: '0 0 2px' }}>Daily contact rate</h3>
          <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Last 14 days</div>
          <AreaChart data={series} />
        </div>
        <div className="card">
          <h3 style={{ margin: '0 0 12px' }}>Campaign performance</h3>
          <BarChart data={perf} />
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, Icon, delta, deltaFmt, deltaGood }: {
  label: string; value: any; Icon: React.ComponentType<{ size?: number }>;
  delta?: number | null; deltaFmt?: (d: number) => string; deltaGood?: (d: number) => boolean;
}) {
  const hasDelta = delta !== undefined && delta !== null && Number.isFinite(delta);
  const good = hasDelta && deltaGood ? deltaGood(delta as number) : true;
  return (
    <div className="card kpi-card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span className="kpi-label">{label}</span>
        <span className="kpi-icon"><Icon size={18} /></span>
      </div>
      <div className="kpi-value">{value}</div>
      {hasDelta
        ? <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4, color: good ? '#15803d' : '#dc2626' }}>{deltaFmt ? deltaFmt(delta as number) : delta} <span className="muted" style={{ fontWeight: 400 }}>vs previous</span></div>
        : <div style={{ height: 18, marginTop: 4 }} />}
    </div>
  );
}

function AreaChart({ data }: { data: { label: string; rate: number }[] }) {
  const W = 520, H = 180, P = 24;
  if (!data.length) return <div className="muted" style={{ height: H }}>No data yet.</div>;
  const max = Math.max(60, ...data.map((d) => d.rate));
  const x = (i: number) => P + (i * (W - 2 * P)) / Math.max(1, data.length - 1);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const pts = data.map((d, i) => `${x(i)},${y(d.rate)}`).join(' ');
  const area = `${P},${H - P} ${pts} ${x(data.length - 1)},${H - P}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      {[0, 15, 30, 45, 60].map((g) => (
        <g key={g}><line x1={P} x2={W - P} y1={y(g)} y2={y(g)} stroke="#eef0f2" /><text x={4} y={y(g) + 3} fontSize="9" fill="#94a3b8">{g}</text></g>
      ))}
      <polygon points={area} fill="#22c55e" opacity="0.12" />
      <polyline points={pts} fill="none" stroke="#22c55e" strokeWidth="2.5" />
      {data.map((d, i) => (i % 2 === 0 ? <text key={i} x={x(i)} y={H - 6} fontSize="8" fill="#94a3b8" textAnchor="middle">{d.label}</text> : null))}
    </svg>
  );
}

function BarChart({ data }: { data: { name: string; rate: number }[] }) {
  const W = 520, H = 200, P = 28;
  if (!data.length) return <div className="muted" style={{ height: H }}>No campaign data yet.</div>;
  const max = Math.max(60, ...data.map((d) => d.rate));
  const bw = (W - 2 * P) / data.length;
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      {[0, 15, 30, 45, 60].map((g) => (
        <g key={g}><line x1={P} x2={W - P} y1={y(g)} y2={y(g)} stroke="#eef0f2" /><text x={4} y={y(g) + 3} fontSize="9" fill="#94a3b8">{g}</text></g>
      ))}
      {data.map((d, i) => {
        const h = H - P - y(d.rate);
        return (
          <g key={i}>
            <rect x={P + i * bw + bw * 0.2} y={y(d.rate)} width={bw * 0.6} height={Math.max(0, h)} fill="#22c55e" rx="4" />
            <text x={P + i * bw + bw / 2} y={H - 8} fontSize="9" fill="#64748b" textAnchor="middle">{(d.name || '').slice(0, 10)}</text>
          </g>
        );
      })}
    </svg>
  );
}

const Dot = () => <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />;
function Th({ children }: { children: React.ReactNode }) { return <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{children}</th>; }
function Td({ children, colSpan, className }: { children: React.ReactNode; colSpan?: number; className?: string }) { return <td colSpan={colSpan} className={className} style={{ padding: '11px 14px', fontSize: 13, borderBottom: '1px solid #f0f1f3' }}>{children}</td>; }
