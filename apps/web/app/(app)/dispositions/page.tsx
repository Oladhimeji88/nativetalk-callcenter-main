'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2, X } from 'lucide-react';
import { api, getUser } from '@/lib/api';
import { useConfirm } from '@/components/ConfirmProvider';

type Disposition = { id: string; name?: string; code?: string; category?: string; active?: boolean; isSystem?: boolean };
const EMPTY: Disposition = { id: '', name: '', code: '', category: 'Neutral', active: true };
const CATEGORIES = ['Success', 'Callback', 'Retry', 'Failure', 'DNC', 'Neutral'];

// How each category behaves when used to wrap up a campaign call.
const CATEGORY_EFFECT: Record<string, string> = {
  Success: 'Goal met. The lead is marked done.',
  Callback: 'A callback is expected. The lead is marked done.',
  Retry: 'Not reached. The lead goes back in the queue to retry (up to Max attempts).',
  Failure: 'Bad outcome. The lead is marked done.',
  DNC: 'Do Not Call. The lead is removed and never dialled again.',
  Neutral: 'No special effect. The lead is marked done.',
};

function badgeClass(cat?: string) {
  switch ((cat || '').toLowerCase()) {
    case 'success':  return 'disp-badge disp-badge-green';
    case 'callback': return 'disp-badge disp-badge-blue';
    case 'failure':
    case 'dnc':      return 'disp-badge disp-badge-red';
    default:         return 'disp-badge disp-badge-amber';
  }
}

export default function DispositionsPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const [list, setList] = useState<Disposition[]>([]);
  const [editing, setEditing] = useState<Disposition | null>(null);

  const load = async () => {
    const rows = await api('/dispositions').catch(() => []);
    setList((rows || []).map((r: any) => r?.data ?? r).filter((d: any) => d?.id));
  };
  useEffect(() => { if (!getUser()) { router.replace('/login'); return; } load(); /* eslint-disable-next-line */ }, [router]);

  const save = async () => {
    if (!editing) return;
    if (!editing.name?.trim()) return;
    const { id, ...body } = editing;
    try {
      if (id) await api(`/dispositions/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await api('/dispositions', { method: 'POST', body: JSON.stringify(body) });
      setEditing(null); load();
    } catch (e: any) { alert(e.message); }
  };
  const remove = async (d: Disposition) => {
    if (!(await confirm({ title: 'Delete disposition?', message: `Remove "${d.name}"? Agents will no longer be able to pick it.`, confirmLabel: 'Delete', danger: true }))) return;
    await api(`/dispositions/${d.id}`, { method: 'DELETE' }); load();
  };

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Dispositions</h2>
        <button className="btn btn-green" onClick={() => setEditing({ ...EMPTY })}>+ New disposition</button>
      </div>
      <p className="muted" style={{ margin: '0 0 14px' }}>
        Outcome labels agents pick when wrapping up a call. The <b>category</b> decides what happens to a campaign lead afterwards.
      </p>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#f9fafb' }}><Th>Label</Th><Th>Code</Th><Th>Type</Th><Th>Campaign effect</Th><Th /></tr></thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.id}>
                <Td><b>{d.name || '—'}</b>{d.isSystem && <span className="pill" style={{ marginLeft: 8, fontSize: 10, background: '#f3f4f6', color: '#6b7280' }} title="Standard disposition the system assigns automatically. Can't be deleted or renamed.">system</span>}</Td>
                <Td>{d.code ? <span className="pill">{d.code}</span> : <span className="muted">—</span>}</Td>
                <Td><span className={badgeClass(d.category)}>{d.category || 'Neutral'}</span></Td>
                <Td className="muted" style={{ fontSize: 12 }}>{CATEGORY_EFFECT[d.category || 'Neutral']}</Td>
                <Td>
                  <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    {d.isSystem ? <span className="muted" style={{ fontSize: 12 }}>—</span> : (
                      <>
                        <button className="icon-btn" title="Edit" onClick={() => setEditing(d)}><Pencil size={15} /></button>
                        <button className="icon-btn" title="Delete" onClick={() => remove(d)}><Trash2 size={15} /></button>
                      </>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
            {!list.length && <tr><Td colSpan={5}><span className="muted">No dispositions yet. The Console uses a built-in default set until you add some.</span></Td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <>
          <div className="drawer-backdrop" onClick={() => setEditing(null)} />
          <div className="drawer">
            <div className="drawer-head">
              <h3 style={{ margin: 0 }}>{editing.id ? 'Edit disposition' : 'New disposition'}</h3>
              <button className="drawer-x" onClick={() => setEditing(null)} aria-label="Close"><X size={20} /></button>
            </div>
            <div className="drawer-body">
              <Field label="Code"><input value={editing.code || ''} onChange={(e) => setEditing({ ...editing, code: e.target.value })} placeholder="e.g. ANSWERED" /></Field>
              <Field label="Label"><input value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Answered - Spoke" /></Field>
              <Field label="Type">
                <select value={editing.category || 'Neutral'} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{CATEGORY_EFFECT[editing.category || 'Neutral']}</div>
              </Field>
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn btn-green" onClick={save} disabled={!editing.name?.trim()}>Save</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) { return <th style={{ textAlign: 'left', padding: '11px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{children}</th>; }
function Td({ children, colSpan, className, style }: { children?: React.ReactNode; colSpan?: number; className?: string; style?: React.CSSProperties }) { return <td colSpan={colSpan} className={className} style={{ padding: '11px 12px', fontSize: 13, borderBottom: '1px solid #f0f1f3', ...style }}>{children}</td>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label style={{ display: 'block' }}><span className="muted" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>{label}</span>{children}</label>; }
