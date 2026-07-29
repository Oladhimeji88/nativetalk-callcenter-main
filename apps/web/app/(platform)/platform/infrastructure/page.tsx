'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Server, Radio, Activity, CircleGauge } from 'lucide-react';
import { api, canPlatform } from '@/lib/api';
import { useConfirm } from '@/components/ConfirmProvider';
import {
  PageHead, Stat, Panel, Chip, Meter, Table, Th, Td, Empty, IfCapable, num,
} from '@/components/platform/ui';

// Infrastructure. Everyone in the console can see health so they can answer
// "is it us or them?"; only Super Admins can take a node in or out of service.
export default function InfrastructurePage() {
  const confirm = useConfirm();
  const [d, setD] = useState<any>(null);
  const canManage = canPlatform('infrastructure.manage');

  const load = () => api('/platform/infrastructure').then(setD).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, []);

  const drain = async (n: any) => {
    const ok = await confirm({
      title: `Drain ${n.name}?`,
      message: 'New calls stop being routed here. Calls already in progress finish normally. Use this before maintenance.',
      confirmLabel: 'Drain node', danger: true,
    });
    if (!ok) return;
    try { await api(`/platform/nodes/${n.id}/drain`, { method: 'POST' }); toast.success(`${n.name} is draining`); load(); }
    catch { /* surfaced */ }
  };
  const enable = async (n: any) => {
    try { await api(`/platform/nodes/${n.id}/enable`, { method: 'POST' }); toast.success(`${n.name} back in service`); load(); }
    catch { /* surfaced */ }
  };

  if (!d) return <div className="ploading">Loading infrastructure…</div>;
  const c = d.capacity;
  const headroom = c.channelCapacity - c.channelsUsed;

  return (
    <div className="ppage">
      <PageHead title="Infrastructure" sub="The media and signalling layer every customer's calls run through." />

      <div className="pstat-grid">
        <Stat label="Channel utilisation" Icon={Radio} value={`${c.utilisationPct}%`}
          tone={c.utilisationPct >= 80 ? 'bad' : c.utilisationPct >= 65 ? 'warn' : 'good'}
          sub={`${num(c.channelsUsed)} of ${num(c.channelCapacity)} concurrent channels`} />
        <Stat label="Headroom" Icon={CircleGauge} value={num(headroom)}
          tone={headroom < 200 ? 'warn' : 'good'} sub="Channels still available right now" />
        <Stat label="Nodes healthy" Icon={Server} value={`${c.nodesHealthy} / ${c.nodesTotal}`}
          tone={c.nodesHealthy < c.nodesTotal ? 'warn' : 'good'} sub="Media + signalling" />
        <Stat label="Services operational" Icon={Activity}
          value={`${d.services.filter((s: any) => s.status === 'operational').length} / ${d.services.length}`}
          tone={d.services.some((s: any) => s.status !== 'operational') ? 'warn' : 'good'}
          sub="API, database, realtime, storage" />
      </div>

      <Panel
        title="Nodes"
        sub={canManage ? 'Drain a node before maintenance, then put it back in service.' : 'Read-only — a Super Admin takes nodes in and out of service.'}
        flush
      >
        <Table head={<>
          <Th>Node</Th><Th>Role</Th><Th>Region</Th><Th>Status</Th>
          <Th>Channels</Th><Th>CPU</Th><Th>Memory</Th><Th>Version</Th><Th right>Actions</Th>
        </>}>
          {d.nodes.map((n: any) => (
            <tr key={n.id}>
              <Td>
                <div className="pcell-title">{n.name}</div>
                <div className="pcell-sub">{n.tenantsServed} companies · up {Math.round(n.uptimeHours / 24)}d</div>
              </Td>
              <Td className="pmuted">{n.role}</Td>
              <Td>{n.region}</Td>
              <Td><Chip value={n.status} /></Td>
              <Td><Meter value={n.channelsUsed} max={n.channelCapacity} /></Td>
              <Td><span className={n.cpuPct >= 80 ? 'pnum is-bad' : 'pnum'}>{n.cpuPct}%</span></Td>
              <Td><span className={n.memPct >= 80 ? 'pnum is-bad' : 'pnum'}>{n.memPct}%</span></Td>
              <Td className="pmuted">{n.version}</Td>
              <Td right>
                <IfCapable cap="infrastructure.manage">
                  {n.status === 'draining'
                    ? <button className="btn btn-sm btn-green" onClick={() => enable(n)}>Return to service</button>
                    : <button className="btn btn-sm" onClick={() => drain(n)}>Drain</button>}
                </IfCapable>
                {!canManage && <span className="pmuted">—</span>}
              </Td>
            </tr>
          ))}
          {!d.nodes.length && <tr><Td colSpan={9}><Empty title="No nodes registered" /></Td></tr>}
        </Table>
      </Panel>

      <Panel title="Services" sub="Everything the API depends on" flush>
        <Table head={<><Th>Service</Th><Th>Status</Th><Th>Latency</Th><Th>Uptime (30d)</Th><Th>Detail</Th></>}>
          {d.services.map((s: any) => (
            <tr key={s.id}>
              <Td><b>{s.name}</b></Td>
              <Td><Chip value={s.status} /></Td>
              <Td><span className={s.latencyMs > 300 ? 'pnum is-bad' : 'pnum'}>{s.latencyMs}ms</span></Td>
              <Td>{s.uptimePct}%</Td>
              <Td className="pmuted">{s.detail}</Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}
