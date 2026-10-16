'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Download, Trash2 } from 'lucide-react';
import { api, getUser, API_BASE } from '@/lib/api';
import { useConfirm } from '@/components/ConfirmProvider';

type Rec = {
  id: string; peerNumber: string; agentExt?: string; agentName?: string; campaignName?: string;
  disposition?: string; durationSec: number; recordingSec?: number | null; startedAt: string; recording?: string;
};

const fmtDur = (s: number) => `${Math.floor(s / 60)}m ${s % 60}s`;
const fmtWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function RecordingsPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const [list, setList] = useState<Rec[]>([]);
  const [q, setQ] = useState('');
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');

  const load = async () => setList(await api('/call-logs?hasRecording=1&limit=500').catch(() => []));
  useEffect(() => { if (!getUser()) { router.replace('/login'); return; } load(); /* eslint-disable-next-line */ }, [router]);

  const filtered = q
    ? list.filter((c) => `${c.peerNumber ?? ''} ${c.agentName ?? ''} ${c.agentExt ?? ''} ${c.campaignName ?? ''} ${c.disposition ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    : list;

  const play = async (c: Rec) => {
    if (audioUrls[c.id]) return;
    setBusy(c.id);
    try {
      const res = await fetch(`${API_BASE}/call-logs/${c.id}/recording`, { credentials: 'include' });
      if (!res.ok) throw new Error('unavailable');
      const blob = await res.blob();
      setAudioUrls((m) => ({ ...m, [c.id]: URL.createObjectURL(blob) }));
    } catch { alert('Recording could not be loaded (the file may not exist on the media server).'); }
    finally { setBusy(''); }
  };
  const download = async (c: Rec) => {
    setBusy(c.id);
    try {
      const res = await fetch(`${API_BASE}/call-logs/${c.id}/recording?download=1`, { credentials: 'include' });
      if (!res.ok) throw new Error('unavailable');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = `recording_${c.peerNumber}_${c.id}.wav`; a.click();
      URL.revokeObjectURL(url);
    } catch { alert('Recording could not be downloaded.'); }
    finally { setBusy(''); }
  };
  const remove = async (c: Rec) => {
    if (!(await confirm({ title: 'Delete recording?', message: `Delete the recording for ${c.peerNumber}? This removes the audio file. The call log stays.`, confirmLabel: 'Delete', danger: true }))) return;
    await api(`/call-logs/${c.id}/recording`, { method: 'DELETE' }); load();
  };

  return (
    <div className="page">
      <h2 style={{ margin: '0 0 14px' }}>Recordings Library</h2>

      <div className="row" style={{ marginBottom: 12, justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <input placeholder="Search phone, agent or campaign…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 380 }} />
        <span className="muted" style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em', whiteSpace: 'nowrap' }}>Total: {list.length} archive{list.length === 1 ? '' : 's'}</span>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
          <thead><tr style={{ background: '#f9fafb' }}>
            <Th>Date / Timestamp</Th><Th>Customer Caller</Th><Th>Staff Agent</Th><Th>Duration</Th><Th>Campaign Group</Th><Th>Disposition Outcome</Th><Th style={{ textAlign: 'right' }}>Actions</Th>
          </tr></thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <Td className="muted">{fmtWhen(c.startedAt)}</Td>
                <Td><b>{c.peerNumber || '—'}</b></Td>
                <Td>
                  <div style={{ fontWeight: 600 }}>{c.agentName || (c.agentExt ? `Ext. ${c.agentExt}` : '—')}</div>
                  {c.agentName && c.agentExt && <div className="muted" style={{ fontSize: 12 }}>Ext. {c.agentExt}</div>}
                </Td>
                <Td style={{ color: 'var(--green-d)', fontWeight: 600 }}>{fmtDur(c.recordingSec ?? c.durationSec ?? 0)}</Td>
                <Td>{c.campaignName || '—'}</Td>
                <Td>{c.disposition ? <span className="pill ok">{c.disposition}</span> : <span className="muted">—</span>}</Td>
                <Td>
                  {audioUrls[c.id]
                    ? <audio controls autoPlay src={audioUrls[c.id]} style={{ height: 32, maxWidth: 220 }} />
                    : (
                      <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <button className="icon-btn" title="Play" onClick={() => play(c)} disabled={busy === c.id}><Play size={15} /></button>
                        <button className="icon-btn" title="Download" onClick={() => download(c)} disabled={busy === c.id}><Download size={15} /></button>
                        <button className="icon-btn" title="Delete" onClick={() => remove(c)}><Trash2 size={15} /></button>
                      </div>
                    )}
                </Td>
              </tr>
            ))}
            {!filtered.length && <tr><Td colSpan={7}><span className="muted">No recordings{q ? ' match your search' : ' yet. Enable “Record calls” on a campaign'}.</span></Td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return <th style={{ textAlign: 'left', padding: '11px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)', borderBottom: '1px solid var(--border)', ...style }}>{children}</th>;
}
function Td({ children, colSpan, className, style }: { children?: React.ReactNode; colSpan?: number; className?: string; style?: React.CSSProperties }) {
  return <td colSpan={colSpan} className={className} style={{ padding: '12px 14px', fontSize: 13, borderBottom: '1px solid #f0f1f3', ...style }}>{children}</td>;
}
