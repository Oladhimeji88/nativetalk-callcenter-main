'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getUser } from '@/lib/api';

const money = (n: number, cur: string) => `${cur} ${(n / 100).toLocaleString()}`;

export default function BillingPage() {
  const router = useRouter();
  const [me, setMe] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);

  const load = async () => {
    setMe(await api('/billing/me').catch(() => null));
    setInvoices(await api('/billing/invoices').catch(() => []));
  };
  useEffect(() => { if (!getUser()) { router.replace('/login'); return; } load(); }, [router]);

  const pay = async (id: string) => {
    try { const r = await api(`/billing/invoices/${id}/pay`, { method: 'POST' }); alert(r.status === 'redirect' ? `Redirecting to payment…` : r.detail || 'Marked for manual payment'); }
    catch (e: any) { alert(e.message); }
  };

  const bar = (used: number, max: number) => {
    const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
    return <div style={{ background: '#eef1f4', borderRadius: 6, height: 8, overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: pct > 90 ? 'var(--red)' : 'var(--green)' }} /></div>;
  };

  return (
    <div>
      <div className="page">
        <h2>Billing & Usage</h2>
        {!me ? <p className="muted">Loading…</p> : (
          <>
            <div className="card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div><div className="muted">Current plan</div><div style={{ fontSize: 22, fontWeight: 800 }}>{me.plan?.name ?? 'No plan'}</div></div>
                <div style={{ textAlign: 'right' }}><div className="muted">Monthly</div><div style={{ fontSize: 22, fontWeight: 800 }}>{me.plan ? money(me.plan.priceMonthly, me.plan.currency) : '—'}</div></div>
              </div>
            </div>
            <h3>Usage this month</h3>
            <div className="card">
              {[
                ['Extensions', me.usage.extensions, me.limits.maxExtensions],
                ['Concurrent calls (limit)', me.usage.callsThisPeriod ? '—' : 0, me.limits.maxConcurrentCalls],
                ['Campaigns', me.usage.campaigns, me.limits.maxCampaigns],
              ].map(([label, used, max]: any) => (
                <div key={label} style={{ marginBottom: 12 }}>
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                    <span>{label}</span><span className="muted">{used} / {max}</span>
                  </div>
                  {typeof used === 'number' && bar(used, max)}
                </div>
              ))}
              <div className="muted" style={{ fontSize: 12 }}>Calls this month: {me.usage.callsThisPeriod} · Agents: {me.usage.agents}</div>
            </div>

            <h3>Invoices</h3>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: '#f9fafb' }}><Th>Date</Th><Th>Amount</Th><Th>Status</Th><Th></Th></tr></thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id}>
                      <Td>{new Date(i.createdAt).toLocaleDateString()}</Td>
                      <Td>{money(i.amount, i.currency)}</Td>
                      <Td><span className={`pill ${i.status === 'paid' ? 'ok' : 'warn'}`}>{i.status}</span></Td>
                      <Td>{i.status === 'open' && <button className="btn btn-green" style={{ padding: '4px 10px', fontSize: 13 }} onClick={() => pay(i.id)}>Pay</button>}</Td>
                    </tr>
                  ))}
                  {!invoices.length && <tr><Td colSpan={4}><span className="muted">No invoices yet.</span></Td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
function Th({ children }: { children?: React.ReactNode }) { return <th style={{ textAlign: 'left', padding: '9px 12px', fontSize: 12, color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{children}</th>; }
function Td({ children, colSpan }: { children?: React.ReactNode; colSpan?: number }) { return <td colSpan={colSpan} style={{ padding: '9px 12px', fontSize: 13, borderBottom: '1px solid #f0f1f3' }}>{children}</td>; }
