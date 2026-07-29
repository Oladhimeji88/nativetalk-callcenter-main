'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Users, Radio, Megaphone, Wallet, PhoneCall, TrendingUp, Clock, ArrowUpRight, Cable,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Stat, Panel, Chip, Meter, Empty, Table, Th, Td, Trend, naira, num, day } from '@/components/platform/ui';

const fmtDur = (s: number) => `${String(Math.floor((s || 0) / 60)).padStart(2, '0')}:${String((s || 0) % 60).padStart(2, '0')}`;

// Company Admin dashboard — the health of *this* workspace: what the plan
// allows versus what the team is using, and what the admin needs to fix.
export default function AdminDashboard() {
  const router = useRouter();
  const [d, setD] = useState<any>(null);

  useEffect(() => {
    const load = () => api('/dashboard/admin').then(setD).catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  if (!d) return <div className="ploading">Loading workspace…</div>;
  const k = d.kpis;

  return (
    <div className="ppage">
      <div className="ppage-head">
        <div>
          <h1 className="ppage-title">{d.workspace.name}</h1>
          <p className="ppage-sub">
            Workspace overview · {d.workspace.plan} plan · renews {day(d.workspace.renewsAt)}
          </p>
        </div>
        <div className="ppage-actions">
          <Link href="/users" className="btn">Manage users</Link>
          <Link href="/campaigns" className="btn btn-green">Campaigns</Link>
        </div>
      </div>

      <div className="pstat-grid">
        <Stat label="Seats in use" Icon={Users} value={`${d.seats.used} / ${d.seats.limit}`}
          tone={d.seats.used / d.seats.limit >= 0.9 ? 'warn' : 'good'}
          sub={<Meter value={d.seats.used} max={d.seats.limit} label={`${Math.round((d.seats.used / d.seats.limit) * 100)}% of plan`} />} />
        <Stat label="Concurrent channels" Icon={Radio} value={`${d.channels.peak} / ${d.channels.limit}`}
          sub={<Meter value={d.channels.peak} max={d.channels.limit} label="Peak today" />} />
        <Stat label="Campaigns" Icon={Megaphone} value={`${d.campaignQuota.used} / ${d.campaignQuota.limit}`}
          sub={`${d.campaigns.filter((c: any) => c.active).length} running now`} />
        <Stat label="This month" Icon={Wallet} value={naira(d.spend.thisMonth)}
          tone={d.spend.invoiceStatus === 'overdue' ? 'bad' : 'good'}
          sub={<>Invoice <Chip value={d.spend.invoiceStatus} dot={false} /></>} />
        <Stat label="Calls handled" Icon={PhoneCall} value={num(k.calls)} sub={`${k.contactRate}% contact rate`} />
        <Stat label="Avg handle time" Icon={Clock} value={fmtDur(k.avgHandleSec)} sub={`${k.recordingHours}h recorded`} />
      </div>

      <div className="pgrid-2">
        <Panel title="Needs your attention" sub="Things only an administrator can resolve" flush>
          {d.attention?.length ? (
            <ul className="pqueue">
              {d.attention.map((a: any, i: number) => (
                <li key={i} className={`pqueue-row is-${a.severity}`}>
                  <span className="pqueue-mark" />
                  <div className="pqueue-body">
                    <div className="pqueue-title">{a.title}</div>
                    <div className="pqueue-detail">{a.detail}</div>
                  </div>
                  <button className="pqueue-action" onClick={() => router.push(a.href)}>Open <ArrowUpRight size={13} /></button>
                </li>
              ))}
            </ul>
          ) : <Empty title="Everything looks healthy" sub="No limits reached, queues stable, invoices settled." />}
        </Panel>

        <Panel title="Call volume" sub="Last 14 days across the workspace">
          <Trend data={d.callsSeries} valueKey="calls" height={180} />
          <div className="prow-split">
            <div><span className="pmini-label">Agents online</span><b>{k.agentsOnline} / {k.agentsTotal}</b></div>
            <div><span className="pmini-label">Waiting now</span><b>{k.queuesWaiting}</b></div>
            <div><span className="pmini-label">Contact rate</span><b>{k.contactRate}%</b></div>
          </div>
        </Panel>
      </div>

      <div className="pgrid-2">
        <Panel title="Team" sub={`${d.team.length} accounts in this workspace`} flush
          actions={<Link href="/users" className="plink">Manage</Link>}>
          <Table head={<><Th>Name</Th><Th>Role</Th><Th>Ext.</Th><Th right>Status</Th></>}>
            {d.team.map((m: any) => (
              <tr key={m.id}>
                <Td>
                  <div className="pcell-title">{m.name}</div>
                  {!m.active && <div className="pcell-sub">disabled</div>}
                </Td>
                <Td className="pmuted">{m.role}</Td>
                <Td>{m.ext || '—'}</Td>
                <Td right><Chip value={m.status === 'available' ? 'active' : m.status} /></Td>
              </tr>
            ))}
          </Table>
        </Panel>

        <div className="pstack">
          <Panel title="Queues" sub="Inbound routing health" flush actions={<Link href="/queues" className="plink">Configure</Link>}>
            <Table head={<><Th>Queue</Th><Th>Members</Th><Th>Waiting</Th><Th right>Health</Th></>}>
              {d.queues.map((q: any) => (
                <tr key={q.id}>
                  <Td><b>{q.name}</b></Td>
                  <Td>{q.membersCount}</Td>
                  <Td>{q.waiting}</Td>
                  <Td right><Chip value={String(q.health).toLowerCase()} /></Td>
                </tr>
              ))}
            </Table>
          </Panel>

          <Panel title="Carrier trunks" sub="Where outbound calls leave" flush actions={<Link href="/trunks" className="plink">Manage</Link>}>
            <ul className="plist">
              {d.trunks.map((t: any) => (
                <li key={t.id}>
                  <div>
                    <div className="plist-title"><Cable size={13} /> {t.name}</div>
                    <div className="plist-sub">{t.proxy}</div>
                  </div>
                  <Chip value={t.active ? 'active' : 'suspended'} />
                </li>
              ))}
              {!d.trunks.length && <li><Empty title="No trunks configured" /></li>}
            </ul>
          </Panel>
        </div>
      </div>

      <Panel title="Campaign performance" sub="Contact rate per campaign" flush
        actions={<Link href="/campaigns" className="plink">All campaigns</Link>}>
        <Table head={<><Th>Campaign</Th><Th>Mode</Th><Th>Leads</Th><Th>Status</Th><Th right>Contact rate</Th></>}>
          {d.campaigns.map((c: any) => (
            <tr key={c.id}>
              <Td><b>{c.name}</b></Td>
              <Td className="pmuted">{c.dialMethod}</Td>
              <Td>{num(c.contactsCount)}</Td>
              <Td><Chip value={c.active ? 'active' : 'draft'} /></Td>
              <Td right><b className="pgreen">{c.contactRate}%</b></Td>
            </tr>
          ))}
          {!d.campaigns.length && <tr><Td colSpan={5}><Empty title="No campaigns yet" /></Td></tr>}
        </Table>
      </Panel>

      <div className="pfootnote">
        <TrendingUp size={14} />
        Looking for live queue and agent monitoring? That is the <Link href="/agents">Agents</Link> board.
      </div>
    </div>
  );
}
