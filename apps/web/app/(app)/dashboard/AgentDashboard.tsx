'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PhoneCall, PhoneMissed, Clock, Target, Trophy, PhoneForwarded, Headphones } from 'lucide-react';
import { api } from '@/lib/api';
import { Stat, Panel, Chip, Empty, Table, Th, Td, num, when } from '@/components/platform/ui';

const fmtDur = (s: number) => `${String(Math.floor((s || 0) / 60)).padStart(2, '0')}:${String((s || 0) % 60).padStart(2, '0')}`;
const hours = (s: number) => `${Math.floor((s || 0) / 3600)}h ${Math.round(((s || 0) % 3600) / 60)}m`;

const DISP_TONE: Record<string, string> = { Success: 'good', Callback: 'info', Retry: 'warn', Failure: 'bad', DNC: 'bad' };

// Agent dashboard — one person's own day. Deliberately shows no workspace-wide
// figures: an agent should see their work, not their colleagues' performance
// beyond a simple leaderboard.
export default function AgentDashboard() {
  const [d, setD] = useState<any>(null);

  useEffect(() => {
    const load = () => api('/dashboard/me').then(setD).catch(() => {});
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, []);

  if (!d) return <div className="ploading">Loading your day…</div>;
  const t = d.today;
  const maxHour = Math.max(1, ...d.hourly.map((h: any) => h.calls));

  return (
    <div className="ppage">
      <div className="ppage-head">
        <div>
          <h1 className="ppage-title">Hello, {String(d.agent.name).split(' ')[0]}</h1>
          <p className="ppage-sub">
            Extension {d.agent.ext} · <Chip value={d.agent.status === 'available' ? 'active' : d.agent.status} /> · your day so far
          </p>
        </div>
        <div className="ppage-actions">
          <Link href="/agent" className="btn btn-green"><Headphones size={15} /> Open Call Console</Link>
        </div>
      </div>

      <div className="pstat-grid">
        <Stat label="Calls handled" Icon={PhoneCall} value={num(t.calls)} sub={`${t.connected} connected`} />
        <Stat label="Contact rate" Icon={Target} value={`${t.contactRate}%`}
          tone={t.contactRate >= 60 ? 'good' : t.contactRate >= 40 ? 'warn' : 'bad'} sub="Answered of dialled" />
        <Stat label="Talk time" Icon={Clock} value={hours(t.talkSec)} sub={`${fmtDur(t.avgHandleSec)} average`} />
        <Stat label="Missed" Icon={PhoneMissed} value={num(t.missed)}
          tone={t.missed > 3 ? 'warn' : 'good'} sub="Inbound you didn't reach" />
      </div>

      <div className="pgrid-2">
        <Panel title="Today's goal" sub={`${d.goal.achieved} of ${d.goal.target} connected calls`}>
          <div className="pgoal">
            <div className="pgoal-ring" style={{ ['--pct' as any]: `${d.goal.pct}%` }}>
              <span>{d.goal.pct}%</span>
            </div>
            <div className="pgoal-copy">
              <b>{d.goal.achieved} / {d.goal.target}</b>
              <span>
                {d.goal.pct >= 100
                  ? 'Target met — anything else today is a bonus.'
                  : `${d.goal.target - d.goal.achieved} more connected calls to hit today's target.`}
              </span>
            </div>
          </div>

          <div className="phours">
            {d.hourly.map((h: any) => (
              <div key={h.label} className="phour" title={`${h.calls} calls at ${h.label}`}>
                <div className="phour-bar" style={{ height: `${Math.round((h.calls / maxHour) * 100)}%` }} />
                <span>{h.label.replace(':00', '')}</span>
              </div>
            ))}
          </div>
        </Panel>

        <div className="pstack">
          <Panel title="Your outcomes" sub="How your calls ended" flush>
            {d.dispositionBreakdown.length ? (
              <ul className="plist">
                {d.dispositionBreakdown.map((x: any) => (
                  <li key={x.name}>
                    <div>
                      <div className="plist-title">{x.name}</div>
                      <div className="plist-sub">{x.category}</div>
                    </div>
                    <div className="plist-right">
                      <span className={`pchip is-${DISP_TONE[x.category] ?? 'muted'}`}><span className="pchip-dot" />{x.count}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <Empty title="No dispositions yet" sub="Wrap up a call and it appears here." />}
          </Panel>

          <Panel title="Team leaderboard" sub={`You are #${d.ranking.position} of ${d.ranking.of}`} flush>
            <ul className="pleader">
              {d.ranking.leaderboard.map((a: any, i: number) => (
                <li key={a.ext} className={a.ext === d.agent.ext ? 'is-me' : ''}>
                  <span className={`pleader-rank ${i === 0 ? 'is-first' : ''}`}>{i === 0 ? <Trophy size={13} /> : i + 1}</span>
                  <span className="pleader-name">{a.name}{a.ext === d.agent.ext && <span className="ptag">you</span>}</span>
                  <b>{a.connected}</b>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <div className="pgrid-2">
        <Panel title="Callbacks to make" sub="Customers who asked you to ring back" flush>
          {d.callbacks.length ? (
            <ul className="plist">
              {d.callbacks.map((c: any) => (
                <li key={c.id}>
                  <div>
                    <div className="plist-title">{c.name}</div>
                    <div className="plist-sub">{c.phone} · asked {when(c.at)}</div>
                  </div>
                  <Link href="/agent" className="btn btn-sm"><PhoneForwarded size={13} /> Call</Link>
                </li>
              ))}
            </ul>
          ) : <Empty title="No callbacks pending" sub="Nice — nobody is waiting on you." />}
        </Panel>

        <Panel title="Your campaigns" sub="Lists assigned to you" flush
          actions={<Link href="/agent" className="plink">Work a campaign</Link>}>
          {d.campaigns.length ? (
            <ul className="plist">
              {d.campaigns.map((c: any) => (
                <li key={c.id}>
                  <div>
                    <div className="plist-title">{c.name}</div>
                    <div className="plist-sub">{c.dialMethod}</div>
                  </div>
                  <span className="plist-metric">{c.contactRate}%</span>
                </li>
              ))}
            </ul>
          ) : <Empty title="No campaigns assigned" sub="Your supervisor assigns these." />}
        </Panel>
      </div>

      <Panel title="Your recent calls" sub="The last calls you handled" flush
        actions={<Link href="/call-logs" className="plink">Full history</Link>}>
        <Table head={<><Th>When</Th><Th>Number</Th><Th>Contact</Th><Th>Duration</Th><Th right>Outcome</Th></>}>
          {d.recent.map((c: any) => (
            <tr key={c.id}>
              <Td className="pmuted">{when(c.startedAt)}</Td>
              <Td><b>{c.peerNumber}</b></Td>
              <Td>{c.contactName || <span className="pmuted">—</span>}</Td>
              <Td>{c.durationSec ? fmtDur(c.durationSec) : '—'}</Td>
              <Td right>{c.disposition || <span className="pmuted">{c.status}</span>}</Td>
            </tr>
          ))}
          {!d.recent.length && <tr><Td colSpan={5}><Empty title="No calls yet today" /></Td></tr>}
        </Table>
      </Panel>
    </div>
  );
}
