'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Building2, Wallet, PhoneCall, Radio, TriangleAlert, ArrowUpRight,
  Users, Timer, ShieldCheck, Activity,
} from 'lucide-react';
import { api, canPlatform, getPlatformRole, PLATFORM_ROLE_LABEL } from '@/lib/api';
import {
  PageHead, Stat, Panel, Chip, Meter, Empty, Table, Th, Td, Trend,
  naira, compactNaira, num, ago, day,
} from '@/components/platform/ui';

// Platform Overview. Super Admins get the commercial and infrastructure picture
// on top of operations; Platform Admins get the customer work queue without the
// revenue, capacity-control or security surfaces they can't act on anyway.
export default function PlatformOverviewPage() {
  const router = useRouter();
  const [d, setD] = useState<any>(null);
  const [role, setRole] = useState<'super_admin' | 'platform_admin' | null>(null);

  useEffect(() => {
    setRole(getPlatformRole());
    const load = () => api('/platform/overview').then(setD).catch(() => {});
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, []);

  const seesRevenue = canPlatform('billing.view');
  const seesInfra = canPlatform('infrastructure.view');
  const isSuper = role === 'super_admin';

  if (!d) return <div className="ploading">Loading platform overview…</div>;

  const t = d.tenants, r = d.revenue, cap = d.capacity;
  // Platform Admins don't act on infrastructure, so drop those rows from their queue.
  const attention = (d.attention ?? []).filter((a: any) => (a.scope === 'infrastructure' ? seesInfra : true));

  return (
    <div className="ppage">
      <PageHead
        title={`Good to see you${isSuper ? '' : ''} — platform overview`}
        sub={`${PLATFORM_ROLE_LABEL[role ?? 'platform_admin']} view · ${num(t.total)} companies on the platform · updated live`}
      >
        <Link href="/platform/tenants" className="btn btn-green">Manage companies</Link>
      </PageHead>

      {/* Headline numbers. Revenue is only meaningful to those who can act on it. */}
      <div className="pstat-grid">
        <Stat label="Active companies" Icon={Building2} value={num(t.active)}
          sub={`${t.trial} on trial · ${t.suspended} suspended`} />
        {seesRevenue && (
          <Stat label="Monthly recurring revenue" Icon={Wallet} value={compactNaira(r.mrr)}
            tone={r.growthPct >= 0 ? 'good' : 'bad'}
            sub={`${r.growthPct >= 0 ? '+' : ''}${r.growthPct}% vs last month · ${compactNaira(r.arr)} ARR`} />
        )}
        {seesRevenue && (
          <Stat label="Outstanding" Icon={TriangleAlert} value={compactNaira(r.outstanding)}
            tone={r.overdueCount ? 'bad' : 'good'}
            sub={r.overdueCount ? `${r.overdueCount} invoice${r.overdueCount === 1 ? '' : 's'} overdue` : 'Nothing overdue'} />
        )}
        <Stat label="Agents across platform" Icon={Users} value={num(d.usage.agents)}
          sub={`${num(d.usage.extensions)} extensions provisioned`} />
        <Stat label="Calls this period" Icon={PhoneCall} value={num(d.usage.callsThisPeriod)}
          sub={`${num(Math.round(d.usage.minutesThisPeriod / 60))} talk hours`} />
        {seesInfra && (
          <Stat label="Channel capacity" Icon={Radio} value={`${cap.utilisationPct}%`}
            tone={cap.utilisationPct >= 80 ? 'warn' : 'good'}
            sub={`${num(cap.channelsUsed)} of ${num(cap.channelCapacity)} · ${cap.nodesHealthy}/${cap.nodesTotal} nodes healthy`} />
        )}
      </div>

      <div className="pgrid-2">
        {/* The work queue — the reason anyone opens this console. */}
        <Panel
          title="Needs attention"
          sub="Ranked by urgency. Everything here is something a person has to decide."
          flush
        >
          {attention.length ? (
            <ul className="pqueue">
              {attention.slice(0, 8).map((a: any) => (
                <li key={a.id} className={`pqueue-row is-${a.severity}`}>
                  <span className="pqueue-mark" />
                  <div className="pqueue-body">
                    <div className="pqueue-title">
                      {a.title}
                      {a.tenantName && <span className="pqueue-tenant">{a.tenantName}</span>}
                    </div>
                    <div className="pqueue-detail">{a.detail}</div>
                  </div>
                  <button className="pqueue-action" onClick={() => router.push(a.href)}>
                    {a.action ?? 'Open'} <ArrowUpRight size={13} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Nothing needs attention" sub="No overdue payments, expiring trials or degraded services." />
          )}
        </Panel>

        <div className="pstack">
          {seesRevenue ? (
            <Panel title="Revenue trend" sub="Monthly recurring revenue, last 12 months">
              <Trend data={d.revenueSeries} valueKey="mrr" />
              <div className="prow-split">
                <div><span className="pmini-label">New MRR</span><b>{compactNaira(d.revenueSeries.at(-1)?.newMrr ?? 0)}</b></div>
                <div><span className="pmini-label">Churned</span><b>{compactNaira(d.revenueSeries.at(-1)?.churnedMrr ?? 0)}</b></div>
                <div><span className="pmini-label">Net churn</span><b>{r.churnPct}%</b></div>
              </div>
            </Panel>
          ) : (
            <Panel title="Portfolio mix" sub="How the companies you look after are distributed">
              <div className="pmix">
                {[
                  ['Active', t.active, 'good'], ['Trial', t.trial, 'info'],
                  ['Past due', t.pastDue, 'bad'], ['Suspended', t.suspended, 'muted'],
                ].map(([label, value, tone]: any) => (
                  <div key={label} className="pmix-row">
                    <span className={`pchip is-${tone}`}><span className="pchip-dot" />{label}</span>
                    <b>{value}</b>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <Panel title="Trials ending soon" sub="Convert before they lapse" flush>
            {d.trialsEnding?.length ? (
              <ul className="plist">
                {d.trialsEnding.map((x: any) => (
                  <li key={x.id}>
                    <div>
                      <div className="plist-title">{x.name}</div>
                      <div className="plist-sub">{x.usage.agents} agents · {x.plan}</div>
                    </div>
                    <span className={`pchip ${(x.trialDaysLeft ?? 0) <= 3 ? 'is-bad' : 'is-warn'}`}>
                      {Math.max(0, x.trialDaysLeft ?? 0)}d left
                    </span>
                  </li>
                ))}
              </ul>
            ) : <Empty title="No trials running" />}
          </Panel>
        </div>
      </div>

      <div className="pgrid-2">
        <Panel
          title={seesRevenue ? 'Largest accounts' : 'Busiest accounts'}
          sub={seesRevenue ? 'By monthly recurring revenue' : 'By calls handled this period'}
          flush
          actions={<Link href="/platform/tenants" className="plink">View all</Link>}
        >
          <Table head={<>
            <Th>Company</Th><Th>Plan</Th><Th>Status</Th>
            <Th>Seats</Th>{seesRevenue && <Th right>MRR</Th>}
          </>}>
            {d.topTenants.map((x: any) => (
              <tr key={x.id} className="is-clickable" onClick={() => router.push(`/platform/tenants?open=${x.id}`)}>
                <Td>
                  <div className="pcell-title">{x.name}</div>
                  <div className="pcell-sub">{x.region} · active {ago(x.lastActivityAt)}</div>
                </Td>
                <Td>{x.plan}</Td>
                <Td><Chip value={x.status} /></Td>
                <Td><Meter value={x.usage.extensions} max={x.limits?.maxExtensions ?? 0} /></Td>
                {seesRevenue && <Td right><b>{naira(x.mrr)}</b></Td>}
              </tr>
            ))}
          </Table>
        </Panel>

        <div className="pstack">
          {seesInfra && (
            <Panel title="Service health" sub="Live status of the platform's moving parts" flush
              actions={<Link href="/platform/infrastructure" className="plink">Infrastructure</Link>}>
              <ul className="plist">
                {d.services.map((s: any) => (
                  <li key={s.id}>
                    <div>
                      <div className="plist-title">{s.name}</div>
                      <div className="plist-sub">{s.detail}</div>
                    </div>
                    <div className="plist-right">
                      <Chip value={s.status} />
                      <span className="plist-metric">{s.latencyMs}ms</span>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Recent console activity" sub="Every change made above a customer workspace" flush
            actions={<Link href="/platform/audit" className="plink">Audit log</Link>}>
            <ul className="pfeed">
              {d.recentActivity.map((a: any) => (
                <li key={a.id}>
                  <span className={`pfeed-dot is-${a.severity}`} />
                  <div>
                    <div className="pfeed-line">
                      <b>{a.actorName}</b> <span className="pfeed-action">{a.action.replace(/[._]/g, ' ')}</span> {a.target}
                    </div>
                    <div className="pfeed-meta">{ago(a.at)} · {a.actorRole === 'super_admin' ? 'Super Admin' : 'Platform Admin'}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      {isSuper && (
        <Panel title="Governance" sub="Only Super Admins see this section">
          <div className="pgov">
            <div className="pgov-item">
              <ShieldCheck size={18} />
              <div><b>{d.staffCount}</b><span>people with console access</span></div>
              <Link href="/platform/staff" className="plink">Manage</Link>
            </div>
            <div className="pgov-item">
              <Activity size={18} />
              <div><b>{d.recentActivity.length}</b><span>changes in the last few days</span></div>
              <Link href="/platform/audit" className="plink">Review</Link>
            </div>
            <div className="pgov-item">
              <Timer size={18} />
              <div><b>{t.newThisMonth}</b><span>companies onboarded this month</span></div>
              <Link href="/platform/tenants" className="plink">Open</Link>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
