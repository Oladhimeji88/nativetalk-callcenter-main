'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2, X } from 'lucide-react';
import { api, getUser } from '@/lib/api';
import { useConfirm } from '@/components/ConfirmProvider';

type Trunk = {
  id: string; name: string; username: string; password: string; proxy: string;
  realm?: string | null; fromDomain?: string | null; register?: boolean;
  callerId?: string | null; active?: boolean; provider?: string | null;
};
const EMPTY: Partial<Trunk> = { name: '', username: '', password: '', proxy: '', callerId: '', realm: '', fromDomain: '', register: true, active: true };

export default function TrunksPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const [list, setList] = useState<Trunk[]>([]);
  const [editing, setEditing] = useState<Partial<Trunk> | null>(null);
  const [err, setErr] = useState('');

  const load = async () => setList((await api('/pbx/trunks').catch(() => [])) || []);
  useEffect(() => { if (!getUser()) { router.replace('/login'); return; } load(); /* eslint-disable-next-line */ }, [router]);

  const save = async () => {
    if (!editing) return;
    setErr('');
    const { id, provider, ...rest } = editing as any;
    const body = { ...rest, register: !!editing.register, active: editing.active !== false };
    if (!body.name?.trim() || !body.proxy?.trim() || !body.username?.trim() || !body.password?.trim()) {
      setErr('Name, proxy, username and password are required.'); return;
    }
    try {
      if (id) await api(`/pbx/trunks/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await api('/pbx/trunks', { method: 'POST', body: JSON.stringify(body) });
      setEditing(null); load();
    } catch (e: any) { setErr(e.message || 'Could not save trunk'); }
  };
  const remove = async (t: Trunk) => {
    const managed = t.provider === 'voipswitch';
    if (!(await confirm({
      title: 'Delete trunk?',
      message: managed
        ? `"${t.name}" is auto-provisioned by the carrier. Removing it here deletes the gateway from FreeSWITCH (the carrier account stays). Continue?`
        : `Remove "${t.name}"? Its gateway is removed from FreeSWITCH and outbound calls stop routing through it.`,
      confirmLabel: 'Delete', danger: true,
    }))) return;
    await api(`/pbx/trunks/${t.id}`, { method: 'DELETE' }); load();
  };

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Trunks</h2>
        <button className="btn btn-green" onClick={() => { setErr(''); setEditing({ ...EMPTY }); }}>+ Add trunk</button>
      </div>
      <p className="muted" style={{ margin: '0 0 14px' }}>
        SIP gateways to your carriers. Outbound calls to external numbers route through your active trunk. Saving a trunk updates FreeSWITCH automatically.
      </p>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#f9fafb' }}><Th>Name</Th><Th>Proxy</Th><Th>Caller ID</Th><Th>Register</Th><Th>Source</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id}>
                <Td><b>{t.name}</b><div className="muted" style={{ fontSize: 12 }}>{t.username}</div></Td>
                <Td>{t.proxy}</Td>
                <Td>{t.callerId || <span className="muted">—</span>}</Td>
                <Td>{t.register === false ? <span className="muted">No</span> : 'Yes'}</Td>
                <Td>{t.provider === 'voipswitch' ? <span className="pill">Auto (carrier)</span> : <span className="pill ok">Custom</span>}</Td>
                <Td><span className={`camp-status ${t.active === false ? 'off' : 'on'}`}>{t.active === false ? 'PAUSED' : 'ACTIVE'}</span></Td>
                <Td>
                  <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <button className="icon-btn" title="Edit" onClick={() => { setErr(''); setEditing(t); }}><Pencil size={15} /></button>
                    <button className="icon-btn" title="Delete" onClick={() => remove(t)}><Trash2 size={15} /></button>
                  </div>
                </Td>
              </tr>
            ))}
            {!list.length && <tr><Td colSpan={7}><span className="muted">No trunks yet. Add one to route outbound calls to a carrier.</span></Td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <>
          <div className="drawer-backdrop" onClick={() => setEditing(null)} />
          <div className="drawer">
            <div className="drawer-head">
              <h3 style={{ margin: 0 }}>{editing.id ? 'Edit trunk' : 'Add trunk'}</h3>
              <button className="drawer-x" onClick={() => setEditing(null)} aria-label="Close"><X size={20} /></button>
            </div>
            <div className="drawer-body">
              {editing.provider === 'voipswitch' && (
                <div className="wiz-note" style={{ marginBottom: 12 }}>This trunk is auto-provisioned by the carrier. Editing it here changes how FreeSWITCH connects; it won't change your carrier account.</div>
              )}
              <Field label="Name (gateway name)">
                <input value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. my-carrier" disabled={!!editing.id} />
                {!editing.id && <span className="muted" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>Prefixed with your workspace name for uniqueness. Can&apos;t be changed later.</span>}
              </Field>
              <Field label="Proxy (carrier host / IP)"><input value={editing.proxy || ''} onChange={(e) => setEditing({ ...editing, proxy: e.target.value })} placeholder="e.g. sip.provider.com" /></Field>
              <Field label="Username"><input value={editing.username || ''} onChange={(e) => setEditing({ ...editing, username: e.target.value })} /></Field>
              <Field label="Password"><input value={editing.password || ''} onChange={(e) => setEditing({ ...editing, password: e.target.value })} /></Field>
              <Field label="Caller ID (DID shown to the callee)"><input value={editing.callerId || ''} onChange={(e) => setEditing({ ...editing, callerId: e.target.value })} placeholder="optional" /></Field>
              <Field label="Realm"><input value={editing.realm || ''} onChange={(e) => setEditing({ ...editing, realm: e.target.value })} placeholder="optional — defaults to proxy" /></Field>
              <Field label="From domain"><input value={editing.fromDomain || ''} onChange={(e) => setEditing({ ...editing, fromDomain: e.target.value })} placeholder="optional" /></Field>
              <div style={{ display: 'flex', gap: 24, margin: '12px 0 4px', flexWrap: 'wrap' }}>
                <label className="wiz-check"><input type="checkbox" checked={editing.register !== false} onChange={(e) => setEditing({ ...editing, register: e.target.checked })} /> Register with carrier</label>
                <label className="wiz-check"><input type="checkbox" checked={editing.active !== false} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Active</label>
              </div>
              {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
                <button className="btn btn-green" onClick={save}>Save</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) { return <th style={{ textAlign: 'left', padding: '11px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{children}</th>; }
function Td({ children, colSpan }: { children?: React.ReactNode; colSpan?: number }) { return <td colSpan={colSpan} style={{ padding: '11px 12px', fontSize: 13, borderBottom: '1px solid #f0f1f3' }}>{children}</td>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label style={{ display: 'block', marginBottom: 10 }}><span className="muted" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>{label}</span>{children}</label>; }
