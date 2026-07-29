'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, ArrowLeftRight, Play } from 'lucide-react';
import { api, getUser, API_BASE } from '@/lib/api';

type CallLog = {
  id: string; direction: string; agentExt?: string; agentName?: string; peerNumber: string;
  disposition?: string; notes?: string; status: string; durationSec: number; startedAt: string; recording?: string;
  disconnectedBy?: string | null;
  contactName?: string | null; campaignName?: string | null; fields?: { label: string; value: any }[];
};

// "Disconnected by" chip: who ended the call.
function EndedBy({ by }: { by?: string | null }) {
  if (by !== 'agent' && by !== 'customer') return <span className="muted">—</span>;
  const isAgent = by === 'agent';
  return <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, color: isAgent ? '#1d4ed8' : '#b45309', background: isAgent ? '#eff6ff' : '#fffbeb' }}>{isAgent ? 'Agent' : 'Customer'}</span>;
}

const fmtDur = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

function DirIcon({ direction, status }: { direction: string; status: string }) {
  let icon = <PhoneOutgoing size={15} color="var(--green)" />;
  let label = 'Outgoing';
  if (status === 'missed' || status === 'no-answer') {
    icon = <PhoneMissed size={15} color="var(--red)" />;
    label = direction === 'inbound' ? 'Missed' : 'No answer';
  } else if (direction === 'inbound') {
    icon = <PhoneIncoming size={15} color="var(--blue)" />;
    label = 'Incoming';
  } else if (direction === 'internal') {
    icon = <ArrowLeftRight size={15} color="var(--muted)" />;
    label = 'Internal';
  }
  return <span className="tip" data-tip={label} style={{ cursor: 'default' }} aria-label={label}>{icon}</span>;
}

export default function CallLogsPage() {
  const router = useRouter();
  const [list, setList] = useState<CallLog[]>([]);
  const [q, setQ] = useState('');

  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [loadingRec, setLoadingRec] = useState('');

  const load = async () => setList(await api('/call-logs?limit=500').catch(() => []));
  useEffect(() => { if (!getUser()) { router.replace('/login'); return; } load(); /* eslint-disable-next-line */ }, [router]);

  const filtered = q
    ? list.filter((c) => `${c.peerNumber ?? ''} ${c.agentName ?? ''} ${c.agentExt ?? ''} ${c.disposition ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    : list;

  const playRecording = async (c: CallLog) => {
    if (audioUrls[c.id]) return;
    setLoadingRec(c.id);
    try {
      const res = await fetch(`${API_BASE}/call-logs/${c.id}/recording`, { credentials: 'include' });
      if (!res.ok) throw new Error('unavailable');
      const blob = await res.blob();
      setAudioUrls((m) => ({ ...m, [c.id]: URL.createObjectURL(blob) }));
    } catch { alert('Recording could not be loaded (the file may not exist on the media server).'); }
    finally { setLoadingRec(''); }
  };

  return (
    <div className="page">
      <h2 style={{ margin: '0 0 14px' }}>Call Logs</h2>

      <div className="row" style={{ marginBottom: 12, justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <input placeholder="Search phone, agent or disposition…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360 }} />
        <span className="muted" style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em', whiteSpace: 'nowrap' }}>Total: {list.length} CDR{list.length === 1 ? '' : 's'}</span>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#f9fafb' }}><Th></Th><Th>Number / Contact</Th><Th>When</Th><Th>Agent</Th><Th>Duration</Th><Th>Ended by</Th><Th>Disposition</Th><Th>Lead details</Th><Th>Recording</Th><Th>Notes</Th></tr></thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <Td><DirIcon direction={c.direction} status={c.status} /></Td>
                <Td><b>{c.peerNumber || '—'}</b>{c.contactName && <div className="muted" style={{ fontSize: 12 }}>{c.contactName}</div>}</Td>
                <Td className="muted">{fmtWhen(c.startedAt)}</Td>
                <Td>
                  <div style={{ fontWeight: 600 }}>{c.agentName || (c.agentExt ? `Ext. ${c.agentExt}` : '—')}</div>
                  {c.agentName && c.agentExt && <div className="muted" style={{ fontSize: 12 }}>Ext. {c.agentExt}</div>}
                </Td>
                <Td>{c.durationSec ? fmtDur(c.durationSec) : '—'}</Td>
                <Td><EndedBy by={c.disconnectedBy} /></Td>
                <Td>{c.disposition || '—'}</Td>
                <Td>
                  {c.campaignName && <div style={{ fontSize: 12, fontWeight: 600 }}>{c.campaignName}</div>}
                  {(c.fields ?? []).length
                    ? <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 2 }}>{c.fields!.map((f) => <span key={f.label} className="tag" style={{ fontSize: 11 }}>{f.label}: {String(f.value)}</span>)}</div>
                    : (!c.campaignName && <span className="muted">—</span>)}
                </Td>
                <Td>
                  {c.recording
                    ? (audioUrls[c.id]
                        ? <audio controls autoPlay src={audioUrls[c.id]} style={{ height: 32, maxWidth: 200 }} />
                        : <button className="icon-btn" title="Play recording" onClick={() => playRecording(c)} disabled={loadingRec === c.id}><Play size={15} /></button>)
                    : <span className="muted">—</span>}
                </Td>
                <Td><span className="muted" style={{ display: 'inline-block', maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'bottom' }}>{c.notes || '—'}</span></Td>
              </tr>
            ))}
            {!filtered.length && <tr><Td colSpan={10}><span className="muted">No calls{q ? ' match your search' : ' logged yet'}.</span></Td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) { return <th style={{ textAlign: 'left', padding: '11px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{children}</th>; }
function Td({ children, colSpan, className }: { children?: React.ReactNode; colSpan?: number; className?: string }) { return <td colSpan={colSpan} className={className} style={{ padding: '9px 12px', fontSize: 13, borderBottom: '1px solid #f0f1f3' }}>{children}</td>; }
