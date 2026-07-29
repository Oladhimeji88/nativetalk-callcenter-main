'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getUser, api } from '@/lib/api';
import { connectRealtime } from '@/lib/realtime';

const card = (label: string, value: any, color: string) => (
  <div className="card" key={label} style={{ flex: 1, minWidth: 150, borderLeft: `4px solid ${color}` }}>
    <div className="muted">{label}</div>
    <div style={{ fontSize: 30, fontWeight: 800 }}>{value}</div>
  </div>
);

export default function LivePage() {
  const router = useRouter();
  const [snap, setSnap] = useState<any>(null);
  const [connected, setConnected] = useState(false);
  const sock = useRef<any>(null);

  useEffect(() => {
    if (!getUser()) { router.replace('/login'); return; }
    const s = connectRealtime((data) => { setSnap(data); setConnected(true); });
    s.on('disconnect', () => setConnected(false));
    sock.current = s;
    return () => { s.close(); };
  }, [router]);

  const monitor = async (uuid: string, mode: string) => {
    const agent = prompt(`Supervisor extension to ring for ${mode}:`, '1051');
    if (!agent) return;
    try { await api(`/telephony/calls/${uuid}/monitor`, { method: 'POST', body: JSON.stringify({ mode, agent }) }); alert(`${mode}: ringing ${agent}…`); }
    catch (e: any) { alert(e.message); }
  };

  const s = snap?.summary ?? {};
  return (
    <div>
      <div className="page">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Live Dashboard</h2>
          <span className={`pill ${connected ? 'ok' : 'err'}`}>{connected ? 'live' : 'connecting…'}</span>
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
          {card('Active Calls', snap?.activeCalls ?? 0, '#2563eb')}
          {card('Agents Available', s.agentsAvailable ?? 0, '#16a34a')}
          {card('Agents on Call', s.agentsOnCall ?? 0, '#d97706')}
          {card('Agents on Break', s.agentsOnBreak ?? 0, '#dc2626')}
        </div>

        {!!(snap?.campaigns?.length) && (
          <>
            <h3>Running Campaigns</h3>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: '#f9fafb' }}><Th>Campaign</Th><Th>Mode</Th><Th>Status</Th><Th>Answered</Th><Th>Failed</Th><Th>Pending</Th></tr></thead>
                <tbody>{snap.campaigns.map((c: any) => (
                  <tr key={c.campaignId}><Td>{c.name}</Td><Td>{c.mode}</Td><Td>{c.status}</Td><Td>{c.answered}</Td><Td>{c.failed}</Td><Td>{c.pending}</Td></tr>
                ))}</tbody>
              </table>
            </div>
          </>
        )}

        <h3>Agents</h3>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f9fafb' }}><Th>Agent</Th><Th>Status</Th><Th>State</Th><Th>Answered</Th><Th>Talk (s)</Th></tr></thead>
            <tbody>
              {(snap?.agents ?? []).map((a: any) => (
                <tr key={a.name}><Td>{a.name}</Td><Td>{a.status}</Td><Td>{a.state}</Td><Td>{a.callsAnswered}</Td><Td>{a.talkTime}</Td></tr>
              ))}
              {!snap?.agents?.length && <tr><Td colSpan={5}><span className="muted">No agents signed in.</span></Td></tr>}
            </tbody>
          </table>
        </div>

        <h3>Active Calls</h3>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f9fafb' }}><Th>From</Th><Th>To</Th><Th>Direction</Th><Th>Monitor</Th></tr></thead>
            <tbody>
              {(snap?.calls ?? []).map((c: any) => (
                <tr key={c.uuid}>
                  <Td>{c.cid_num}</Td><Td>{c.dest}</Td><Td>{c.direction}</Td>
                  <Td>
                    <div style={{ display: 'flex', gap: 5 }}>
                      {['listen', 'whisper', 'barge'].map((m) => (
                        <button key={m} className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => monitor(c.uuid, m)}>{m}</button>
                      ))}
                    </div>
                  </Td>
                </tr>
              ))}
              {!snap?.calls?.length && <tr><Td colSpan={4}><span className="muted">No active calls.</span></Td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ textAlign: 'left', padding: '9px 12px', fontSize: 12, color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{children}</th>;
}
function Td({ children, colSpan }: { children: React.ReactNode; colSpan?: number }) {
  return <td colSpan={colSpan} style={{ padding: '9px 12px', fontSize: 13, borderBottom: '1px solid #f0f1f3' }}>{children}</td>;
}
