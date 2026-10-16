'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2, X, Search, Download, ArrowUpDown } from 'lucide-react';
import { api, getUser } from '@/lib/api';
import { useConfirm } from '@/components/ConfirmProvider';

type Queue = {
  id: string; name?: string; number?: string; strategy?: string;
  members?: string[]; membersCount?: number; maxWaitSec?: number;
  slaTargetPct?: number; active?: boolean;
  waiting?: number; avgWaitSec?: number; health?: string;
};

// UI label -> raw mod_callcenter strategy stored on the queue.
const STRATEGIES: { value: string; label: string }[] = [
  { value: 'ring-all', label: 'Simultaneous' },
  { value: 'round-robin', label: 'Round Robin' },
  { value: 'longest-idle-agent', label: 'Longest Idle' },
  { value: 'top-down', label: 'Top Down' },
];
const strategyLabel = (v?: string) => STRATEGIES.find((s) => s.value === v)?.label ?? 'Longest Idle';

const EMPTY: Queue = { id: '', name: '', strategy: 'longest-idle-agent', members: [], slaTargetPct: 80, maxWaitSec: 300, active: true };
const PAGE_SIZE = 10;

type SortKey = 'name' | 'membersCount' | 'waiting' | 'slaTargetPct';

function fmtWait(sec?: number) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function healthStyle(h?: string): { dot: string; text: string; bg: string } {
  switch ((h || '').toLowerCase()) {
    case 'overloaded': return { dot: '#dc2626', text: '#991b1b', bg: '#fef2f2' };
    case 'busy':       return { dot: '#d97706', text: '#92400e', bg: '#fffbeb' };
    case 'idle':       return { dot: '#9ca3af', text: '#6b7280', bg: '#f3f4f6' };
    default:           return { dot: '#16a34a', text: '#166534', bg: '#f0fdf4' }; // Healthy
  }
}

export default function QueuesPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const [list, setList] = useState<Queue[]>([]);
  const [editing, setEditing] = useState<Queue | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const rows = await api('/pbx/queues').catch(() => []);
    setList((rows || []).map((r: any) => r?.data ?? r).filter((d: any) => d?.id));
  };
  useEffect(() => { if (!getUser()) { router.replace('/login'); return; } load(); /* eslint-disable-next-line */ }, [router]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = list.filter((x) =>
      !needle || `${x.name} ${x.number} ${strategyLabel(x.strategy)}`.toLowerCase().includes(needle));
    const val = (x: Queue) => {
      switch (sort.key) {
        case 'membersCount': return x.membersCount ?? 0;
        case 'waiting': return x.waiting ?? 0;
        case 'slaTargetPct': return x.slaTargetPct ?? 0;
        default: return (x.name || '').toLowerCase();
      }
    };
    return [...rows].sort((a, b) => {
      const av = val(a), bv = val(b);
      return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
    });
  }, [list, q, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const toggleSort = (key: SortKey) => setSort((s) => s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 });

  const save = async () => {
    if (!editing || !editing.name?.trim()) return;
    const body = {
      name: editing.name.trim(),
      strategy: editing.strategy,
      slaTargetPct: editing.slaTargetPct,
      maxWaitSec: editing.maxWaitSec,
      members: editing.members || [],
      active: editing.active ?? true,
    };
    setSaving(true);
    try {
      if (editing.id) await api(`/pbx/queues/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await api('/pbx/queues', { method: 'POST', body: JSON.stringify(body) });
      setEditing(null); load();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  const remove = async (x: Queue) => {
    if (!(await confirm({ title: 'Delete queue?', message: `Remove "${x.name}"? Callers will no longer be routed to it.`, confirmLabel: 'Delete', danger: true }))) return;
    await api(`/pbx/queues/${x.id}`, { method: 'DELETE' }); load();
  };

  const exportCsv = () => {
    const head = ['Queue', 'Number', 'Strategy', 'Members', 'Waiting', 'Avg Wait (s)', 'SLA Target %', 'Health'];
    const rows = filtered.map((x) => [
      x.name || '', x.number || '', strategyLabel(x.strategy), x.membersCount ?? 0,
      x.waiting ?? 0, x.avgWaitSec ?? 0, x.slaTargetPct ?? 0, x.health || 'Healthy',
    ]);
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'queues.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  // Members are edited as a comma-separated list of agent extension numbers.
  const membersText = (editing?.members || []).join(', ');
  const setMembers = (text: string) =>
    editing && setEditing({ ...editing, members: text.split(',').map((s) => s.replace(/\D/g, '').trim()).filter(Boolean) });

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Queues</h2>
        <button className="btn btn-green" onClick={() => setEditing({ ...EMPTY })}>+ New Queue</button>
      </div>
      <p className="muted" style={{ margin: '0 0 14px' }}>
        Configure routing, ring strategies, and how long callers wait before overflow.
      </p>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', padding: '12px 12px', borderBottom: '1px solid var(--border)', gap: 10 }}>
          <div className="row" style={{ alignItems: 'center', gap: 8, flex: 1, maxWidth: 340 }}>
            <Search size={15} style={{ color: 'var(--muted)' }} />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search queues" style={{ flex: 1 }} />
          </div>
          <button className="btn" onClick={exportCsv} title="Download as CSV"><Download size={15} style={{ marginRight: 6 }} />Export</button>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <Th sortable onClick={() => toggleSort('name')}>Queue</Th>
              <Th>Strategy</Th>
              <Th sortable onClick={() => toggleSort('membersCount')}>Members</Th>
              <Th sortable onClick={() => toggleSort('waiting')}>Waiting</Th>
              <Th>Avg Wait</Th>
              <Th sortable onClick={() => toggleSort('slaTargetPct')}>SLA</Th>
              <Th>Health</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((x) => {
              const hs = healthStyle(x.health);
              return (
                <tr key={x.id}>
                  <Td>
                    <b>{x.name || '—'}</b>
                    {x.number && <span className="pill" style={{ marginLeft: 8 }}>{x.number}</span>}
                  </Td>
                  <Td>{strategyLabel(x.strategy)}</Td>
                  <Td>{x.membersCount ?? 0}</Td>
                  <Td>{x.waiting ?? 0}</Td>
                  <Td>{fmtWait(x.avgWaitSec)}</Td>
                  <Td>{x.slaTargetPct ?? 0}%</Td>
                  <Td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: hs.text, background: hs.bg, padding: '3px 9px', borderRadius: 999 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 999, background: hs.dot }} />{x.health || 'Healthy'}
                    </span>
                  </Td>
                  <Td>
                    <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <button className="icon-btn" title="Edit" onClick={() => setEditing({ ...EMPTY, ...x })}><Pencil size={15} /></button>
                      <button className="icon-btn" title="Delete" onClick={() => remove(x)}><Trash2 size={15} /></button>
                    </div>
                  </Td>
                </tr>
              );
            })}
            {!pageRows.length && <tr><Td colSpan={8}><span className="muted">No queues yet. Create one to start routing inbound callers to your agents.</span></Td></tr>}
          </tbody>
        </table>

        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
          <span className="muted" style={{ fontSize: 12 }}>{filtered.length} total · page {page + 1} of {pageCount}</span>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Prev</button>
            <button className="btn" disabled={page >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>Next</button>
          </div>
        </div>
      </div>

      {editing && (
        <div className="confirm-overlay" onClick={() => setEditing(null)}>
          <div className="confirm-box" onClick={(e) => e.stopPropagation()} style={{ width: 460 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>{editing.id ? 'Edit queue' : 'New queue'}</h3>
              <button className="drawer-x" onClick={() => setEditing(null)} aria-label="Close"><X size={20} /></button>
            </div>

            <Field label="Name">
              <input value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Support" autoFocus />
            </Field>
            <Field label="Ring strategy">
              <select value={editing.strategy} onChange={(e) => setEditing({ ...editing, strategy: e.target.value })}>
                {STRATEGIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Agent extensions">
              <input value={membersText} onChange={(e) => setMembers(e.target.value)} placeholder="e.g. 1002, 1003" />
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Comma-separated extension numbers of the agents who take these calls.</div>
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="SLA target (%)">
                <input type="number" min={0} max={100} value={editing.slaTargetPct ?? 80} onChange={(e) => setEditing({ ...editing, slaTargetPct: Number(e.target.value) })} />
              </Field>
              <Field label="Max wait (seconds)">
                <input type="number" min={0} value={editing.maxWaitSec ?? 300} onChange={(e) => setEditing({ ...editing, maxWaitSec: Number(e.target.value) })} />
              </Field>
            </div>

            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12, gap: 8 }}>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-green" onClick={save} disabled={saving || !editing.name?.trim()}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ children, sortable, onClick }: { children?: React.ReactNode; sortable?: boolean; onClick?: () => void }) {
  return (
    <th onClick={onClick} style={{ textAlign: 'left', padding: '11px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)', borderBottom: '1px solid var(--border)', cursor: sortable ? 'pointer' : 'default', userSelect: 'none' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{children}{sortable && <ArrowUpDown size={12} style={{ opacity: .5 }} />}</span>
    </th>
  );
}
function Td({ children, colSpan, className, style }: { children?: React.ReactNode; colSpan?: number; className?: string; style?: React.CSSProperties }) {
  return <td colSpan={colSpan} className={className} style={{ padding: '11px 12px', fontSize: 13, borderBottom: '1px solid #f0f1f3', ...style }}>{children}</td>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block', flex: 1, marginBottom: 12 }}><span className="muted" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>{label}</span>{children}</label>;
}
