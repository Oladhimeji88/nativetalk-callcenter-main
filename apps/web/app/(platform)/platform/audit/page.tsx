'use client';
import { useEffect, useMemo, useState } from 'react';
import { Search, Download } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHead, Panel, Table, Th, Td, Empty, when, ago } from '@/components/platform/ui';

const SEVERITIES = ['all', 'critical', 'warning', 'info'] as const;

const readable = (action: string) =>
  action.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

// Audit log. Every action taken above a customer workspace, attributable to a
// person. This is what makes impersonation and plan changes defensible.
export default function AuditPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [severity, setSeverity] = useState<string>('all');
  const [q, setQ] = useState('');

  useEffect(() => {
    const params = new URLSearchParams();
    if (severity !== 'all') params.set('severity', severity);
    if (q.trim()) params.set('q', q.trim());
    const id = setTimeout(() => { api(`/platform/audit?${params}`).then(setRows).catch(() => setRows([])); }, 150);
    return () => clearTimeout(id);
  }, [severity, q]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.severity] = (c[r.severity] ?? 0) + 1;
    return c;
  }, [rows]);

  const exportCsv = () => {
    const head = ['When', 'Actor', 'Role', 'Action', 'Target', 'Severity', 'IP'];
    const body = rows.map((r) => [when(r.at), r.actorName, r.actorRole, r.action, r.target, r.severity, r.ip]);
    const csv = [head, ...body].map((line) => line.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'platform-audit-log.csv';
    a.click();
  };

  return (
    <div className="ppage">
      <PageHead title="Audit Log" sub="Who did what, above which customer, and when.">
        <button className="btn" onClick={exportCsv}><Download size={15} /> Export CSV</button>
      </PageHead>

      <div className="ptoolbar">
        <div className="ptabs">
          {SEVERITIES.map((s) => (
            <button key={s} className={`ptab ${severity === s ? 'is-on' : ''}`} onClick={() => setSeverity(s)}>
              {s[0].toUpperCase() + s.slice(1)}
              {severity === 'all' && <span className="ptab-count">{counts[s] ?? 0}</span>}
            </button>
          ))}
        </div>
        <div className="psearch">
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search person, action or company…" />
        </div>
      </div>

      <Panel title={`${rows.length} recorded ${rows.length === 1 ? 'event' : 'events'}`} sub="Newest first. Entries are never edited or removed." flush>
        {rows.length ? (
          <Table head={<><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Target</Th><Th>Severity</Th><Th right>Source IP</Th></>}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td>
                  <div className="pcell-title">{ago(r.at)}</div>
                  <div className="pcell-sub">{when(r.at)}</div>
                </Td>
                <Td>
                  <div className="pcell-title">{r.actorName}</div>
                  <div className="pcell-sub">{r.actorRole === 'super_admin' ? 'Super Admin' : r.actorRole === 'platform_admin' ? 'Platform Admin' : 'Workspace user'}</div>
                </Td>
                <Td><code className="pcode">{readable(r.action)}</code></Td>
                <Td>{r.target}</Td>
                <Td><span className={`pchip is-${r.severity === 'critical' ? 'bad' : r.severity === 'warning' ? 'warn' : 'muted'}`}><span className="pchip-dot" />{r.severity}</span></Td>
                <Td right><span className="pmuted pmono">{r.ip}</span></Td>
              </tr>
            ))}
          </Table>
        ) : <Empty title="Nothing recorded" sub="No events match this filter." />}
      </Panel>
    </div>
  );
}
