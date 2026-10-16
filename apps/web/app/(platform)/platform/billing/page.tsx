'use client';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Wallet, TrendingUp, TriangleAlert, Banknote, Send, Check } from 'lucide-react';
import { api } from '@/lib/api';
import {
  PageHead, Stat, Panel, Chip, Table, Th, Td, Empty, Trend, IfCapable,
  naira, compactNaira, num, day,
} from '@/components/platform/ui';

const FILTERS = ['all', 'overdue', 'open', 'paid'] as const;

// Revenue & Invoices. Platform Admins can read this to answer customer
// questions; only Super Admins can settle or write off an invoice.
export default function BillingPage() {
  const [rev, setRev] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [busy, setBusy] = useState('');

  const load = async () => {
    setRev(await api('/platform/revenue').catch(() => null));
    setInvoices(await api('/platform/invoices').catch(() => []));
  };
  useEffect(() => { load(); }, []);

  const shown = useMemo(
    () => (filter === 'all' ? invoices : invoices.filter((i) => i.status === filter)),
    [invoices, filter],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: invoices.length };
    for (const i of invoices) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [invoices]);

  const markPaid = async (i: any) => {
    setBusy(i.id);
    try { await api(`/platform/invoices/${i.id}/mark-paid`, { method: 'POST' }); toast.success(`${i.tenantName} settled`); load(); }
    catch { /* surfaced */ } finally { setBusy(''); }
  };
  const remind = async (i: any) => {
    setBusy(i.id);
    try {
      const r = await api<any>(`/platform/invoices/${i.id}/remind`, { method: 'POST' });
      toast.success(`Reminder sent to ${r.to}`);
    } catch { /* surfaced */ } finally { setBusy(''); }
  };

  if (!rev) return <div className="ploading">Loading revenue…</div>;

  return (
    <div className="ppage">
      <PageHead title="Revenue & Invoices" sub="What the platform earns, and who still owes." />

      <div className="pstat-grid">
        <Stat label="Monthly recurring revenue" Icon={Wallet} value={compactNaira(rev.mrr)}
          tone={rev.growthPct >= 0 ? 'good' : 'bad'} sub={`${rev.growthPct >= 0 ? '+' : ''}${rev.growthPct}% month on month`} />
        <Stat label="Annual run rate" Icon={TrendingUp} value={compactNaira(rev.arr)} sub="MRR × 12" />
        <Stat label="Outstanding" Icon={TriangleAlert} value={compactNaira(rev.outstanding)}
          tone={rev.overdueCount ? 'bad' : 'good'}
          sub={rev.overdueCount ? `${rev.overdueCount} overdue` : 'All current'} />
        <Stat label="Net churn" Icon={Banknote} value={`${rev.churnPct}%`}
          tone={rev.churnPct > 3 ? 'bad' : 'good'} sub="Of last month's MRR" />
      </div>

      <div className="pgrid-2">
        <Panel title="Monthly recurring revenue" sub="Last 12 months">
          <Trend data={rev.series} valueKey="mrr" height={180} />
        </Panel>
        <Panel title="Revenue by plan" sub="Where the money comes from" flush>
          <Table head={<><Th>Plan</Th><Th>Companies</Th><Th right>MRR</Th><Th right>Share</Th></>}>
            {rev.byPlan.map((p: any) => (
              <tr key={p.name}>
                <Td><b>{p.name}</b></Td>
                <Td>{num(p.tenants)}</Td>
                <Td right>{naira(p.mrr)}</Td>
                <Td right>{rev.mrr ? Math.round((p.mrr / rev.mrr) * 100) : 0}%</Td>
              </tr>
            ))}
            {!rev.byPlan.length && <tr><Td colSpan={4}><Empty title="No billable companies yet" /></Td></tr>}
          </Table>
        </Panel>
      </div>

      <Panel
        title="Invoices"
        sub="Every invoice raised across the platform"
        flush
        actions={
          <div className="ptabs is-compact">
            {FILTERS.map((f) => (
              <button key={f} className={`ptab ${filter === f ? 'is-on' : ''}`} onClick={() => setFilter(f)}>
                {f[0].toUpperCase() + f.slice(1)} <span className="ptab-count">{counts[f] ?? 0}</span>
              </button>
            ))}
          </div>
        }
      >
        {shown.length ? (
          <Table head={<>
            <Th>Company</Th><Th>Period</Th><Th>Issued</Th><Th>Due</Th>
            <Th>Status</Th><Th right>Amount</Th><Th right>Actions</Th>
          </>}>
            {shown.map((i) => (
              <tr key={i.id}>
                <Td><b>{i.tenantName}</b></Td>
                <Td className="pmuted">{i.period ?? '—'}</Td>
                <Td>{day(i.createdAt)}</Td>
                <Td>{day(i.dueAt)}</Td>
                <Td><Chip value={i.status} /></Td>
                <Td right><b>{naira(i.amount)}</b></Td>
                <Td right>
                  {i.status !== 'paid' ? (
                    <div className="prow-actions">
                      <button className="btn btn-sm" disabled={busy === i.id} onClick={() => remind(i)}>
                        <Send size={13} /> Remind
                      </button>
                      <IfCapable cap="billing.manage">
                        <button className="btn btn-sm btn-green" disabled={busy === i.id} onClick={() => markPaid(i)}>
                          <Check size={13} /> Mark paid
                        </button>
                      </IfCapable>
                    </div>
                  ) : <span className="pmuted">Settled</span>}
                </Td>
              </tr>
            ))}
          </Table>
        ) : <Empty title="No invoices here" sub="Try another filter." />}
      </Panel>
    </div>
  );
}
