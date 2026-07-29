'use client';
import { Fragment, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api, getUser, hasPermission } from '@/lib/api';

// Colour the role badge for the default groups; anything else is neutral grey.
const ROLE_BADGE: Record<string, string> = { agent: '#0891b2', supervisor: '#7c3aed', admin: '#16a34a' };
const roleColor = (roleName?: string) => ROLE_BADGE[(roleName || '').toLowerCase()] || '#888';

// Eligible managers: driven by the "Manage a team" permission (server-computed as
// canManageTeam), so cloned/custom roles that grant it qualify too.
const isManager = (a: any) => !!a?.canManageTeam;

const genPass = () => 'Ag-' + Math.random().toString(36).slice(2, 8) + '!' + Math.floor(Math.random() * 90 + 10);

// Account administration: create/manage login accounts, their role, and the SIP
// extension each one registers as. Admin-only.
export default function UsersPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [showAcct, setShowAcct] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [byManager, setByManager] = useState(false);
  const [nextExt, setNextExt] = useState('');

  const load = async () => {
    setAccounts(await api('/accounts').catch(() => []));
    setRoles(await api('/roles').catch(() => []));
    const ne = await api('/accounts/next-extension').catch(() => null);
    if (ne?.next) setNextExt(ne.next);
  };
  useEffect(() => {
    if (!getUser()) { router.replace('/login'); return; }
    if (!hasPermission('users')) { router.replace('/agent'); return; }
    load();
  }, [router]);

  return (
    <div className="agent-page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Users</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>Login accounts, their role, and the extension each one registers as.</p>
        </div>
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <div className="view-toggle">
            <button className={!byManager ? 'on' : ''} onClick={() => setByManager(false)}>All users</button>
            <button className={byManager ? 'on' : ''} onClick={() => setByManager(true)}>By manager</button>
          </div>
          <button className="btn btn-green" onClick={() => setShowAcct(true)}>+ Add account</button>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 18 }}>
        <table className="data-table">
          <thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Extension</Th>{!byManager && <Th>Manager</Th>}<Th>Campaigns</Th><Th>Status</Th><Th></Th></tr></thead>
          <tbody>
            {!accounts.length && <tr><Td colSpan={8}><span className="muted">No accounts yet.</span></Td></tr>}
            {byManager
              ? groupByManager(accounts).map((g) => (
                  <Fragment key={g.key}>
                    <tr style={{ background: '#f9fafb' }}>
                      <td colSpan={7} style={{ padding: '9px 14px', fontSize: 12, fontWeight: 700 }}>
                        {g.managerName}<span className="muted" style={{ fontWeight: 500 }}> · {g.reports.length} {g.reports.length === 1 ? 'user' : 'users'}</span>
                      </td>
                    </tr>
                    {g.reports.map((a) => <UserRow key={a.id} a={a} byManager onEdit={setEditing} />)}
                  </Fragment>
                ))
              : accounts.map((a) => <UserRow key={a.id} a={a} onEdit={setEditing} />)}
          </tbody>
        </table>
      </div>

      {showAcct && <AddAccountModal roles={roles} accounts={accounts} nextExt={nextExt} onClose={() => setShowAcct(false)} onSaved={() => { setShowAcct(false); load(); }} />}
      {editing && <EditAccountModal account={editing} roles={roles} accounts={accounts} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

// One account row (shared by the flat list and the grouped-by-manager view).
function UserRow({ a, byManager, onEdit }: { a: any; byManager?: boolean; onEdit: (a: any) => void }) {
  return (
    <tr>
      <Td>{[a.firstName, a.lastName].filter(Boolean).join(' ') || '—'}</Td>
      <Td>{a.email}</Td>
      <Td><span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: roleColor(a.roleName), padding: '2px 8px', borderRadius: 999 }}>{a.superAdmin ? 'super-admin' : (a.roleName || '—')}</span></Td>
      <Td><b>{a.agentExtension || '—'}</b></Td>
      {!byManager && <Td>{a.managerName || <span className="muted">—</span>}</Td>}
      <Td>{a.campaigns?.length
        ? <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>{a.campaigns.map((c: string) => <span key={c} className="tag" style={{ fontSize: 11 }}>{c}</span>)}</div>
        : <span className="muted">—</span>}</Td>
      <Td><span className={`pill ${a.active ? 'ok' : 'err'}`}>{a.active ? 'active' : 'disabled'}</span></Td>
      <Td><button className="btn btn-ghost btn-sm" onClick={() => onEdit(a)}>Edit</button></Td>
    </tr>
  );
}

// Group accounts by their manager: one section per manager who has reports,
// ordered by name, with the unassigned users last.
function groupByManager(accounts: any[]): { key: string; managerName: string; reports: any[] }[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const groups = new Map<string, any[]>();
  for (const a of accounts) {
    const key = a.managerId && byId.has(a.managerId) ? a.managerId : '__none__';
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(a);
  }
  const named = [...groups.entries()]
    .filter(([key]) => key !== '__none__')
    .map(([key, reports]) => {
      const m = byId.get(key);
      const name = [m?.firstName, m?.lastName].filter(Boolean).join(' ') || m?.email || 'Manager';
      return { key, managerName: m?.agentExtension ? `${name} · ext ${m.agentExtension}` : name, reports };
    })
    .sort((x, y) => x.managerName.localeCompare(y.managerName));
  const none = groups.get('__none__');
  if (none?.length) named.push({ key: '__none__', managerName: 'No manager', reports: none });
  return named;
}

// Supervisors + admins a user can report to.
function ManagerSelect({ accounts, value, exclude, onChange }: { accounts: any[]; value: string; exclude?: string; onChange: (v: string) => void }) {
  const options = accounts.filter((a) => isManager(a) && a.id !== exclude);
  return (
    <>
      <label>Manager</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">No manager</option>
        {options.map((m) => {
          const name = [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email;
          const ext = m.agentExtension ? ` · ext ${m.agentExtension}` : '';
          const roleLabel = m.superAdmin ? 'super-admin' : (m.roleName || 'role');
          return <option key={m.id} value={m.id}>{name}{ext} ({roleLabel})</option>;
        })}
      </select>
    </>
  );
}

function AddAccountModal({ roles, accounts, nextExt, onClose, onSaved }: { roles: any[]; accounts: any[]; nextExt: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ firstName: '', lastName: '', email: '', password: '', roleId: '', managerId: '', extension: nextExt, extPassword: genPass() });
  const [err, setErr] = useState('');
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  useEffect(() => { if (nextExt) setF((p: any) => ({ ...p, extension: nextExt })); }, [nextExt]);

  const save = async () => {
    if (!f.email || !f.password) { setErr('Email and login password are required'); return; }
    if (!f.roleId) { setErr('Select a role'); return; }
    if (!/^\d{3,6}$/.test(String(f.extension))) { setErr('Extension must be 3–6 digits'); return; }
    try {
      await api('/accounts', { method: 'POST', body: JSON.stringify(f) });
      toast.success('Account created');
      onSaved();
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <Modal title="Add account" onClose={onClose} onSave={save} err={err} cta="Create account">
      <div className="row" style={{ gap: 10 }}>
        <div style={{ flex: 1 }}><label>First name</label><input value={f.firstName} onChange={(e) => set('firstName', e.target.value)} /></div>
        <div style={{ flex: 1 }}><label>Last name</label><input value={f.lastName} onChange={(e) => set('lastName', e.target.value)} /></div>
      </div>
      <label>Email</label><input value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="person@company.com" />
      <label>Role</label>
      <select value={f.roleId} onChange={(e) => set('roleId', e.target.value)}>
        <option value="">Select a role…</option>
        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}{r.isSystem ? '' : ' (custom)'}</option>)}
      </select>
      <ManagerSelect accounts={accounts} value={f.managerId} onChange={(v) => set('managerId', v)} />
      <div className="row" style={{ gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label>Extension number</label>
          <input value={f.extension} onChange={(e) => set('extension', e.target.value)} placeholder={nextExt || 'e.g. 1006'} />
          {nextExt && <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>Next free: {nextExt}</p>}
        </div>
        <div style={{ flex: 1 }}>
          <label>Extension password</label>
          <div className="row"><input value={f.extPassword} onChange={(e) => set('extPassword', e.target.value)} /><button type="button" className="btn btn-ghost btn-sm" onClick={() => set('extPassword', genPass())}>↻</button></div>
        </div>
      </div>
      <label>Login password</label><input type="password" value={f.password} onChange={(e) => set('password', e.target.value)} placeholder="Temporary password" />
    </Modal>
  );
}

function EditAccountModal({ account, roles, accounts, onClose, onSaved }: { account: any; roles: any[]; accounts: any[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({
    firstName: account.firstName ?? '', lastName: account.lastName ?? '',
    roleId: account.roleId ?? '', managerId: account.managerId ?? '', active: account.active ?? true,
  });
  const [err, setErr] = useState('');
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));

  const save = async () => {
    const body: any = { firstName: f.firstName, lastName: f.lastName, managerId: f.managerId, active: f.active };
    if (f.roleId) body.roleId = f.roleId;
    try {
      await api(`/accounts/${account.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      toast.success('Account updated');
      onSaved();
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <Modal title={`Edit ${[account.firstName, account.lastName].filter(Boolean).join(' ') || account.email}`} onClose={onClose} onSave={save} err={err} cta="Save changes">
      <div className="row" style={{ gap: 10 }}>
        <div style={{ flex: 1 }}><label>First name</label><input value={f.firstName} onChange={(e) => set('firstName', e.target.value)} /></div>
        <div style={{ flex: 1 }}><label>Last name</label><input value={f.lastName} onChange={(e) => set('lastName', e.target.value)} /></div>
      </div>
      <label>Role</label>
      <select value={f.roleId} onChange={(e) => set('roleId', e.target.value)}>
        <option value="">Keep current ({account.roleName || account.role})</option>
        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}{r.isSystem ? '' : ' (custom)'}</option>)}
      </select>
      <ManagerSelect accounts={accounts} value={f.managerId} exclude={account.id} onChange={(v) => set('managerId', v)} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, cursor: 'pointer' }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={f.active} onChange={(e) => set('active', e.target.checked)} />
        Active (can log in)
      </label>
    </Modal>
  );
}

function Modal({ title, children, onClose, onSave, err, cta }: any) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'grid', placeItems: 'center', zIndex: 50 }} onClick={onClose}>
      <div className="card" style={{ width: 460, maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        {children}
        {err && <div className="err">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-green" onClick={onSave}>{cta ?? 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
function Th({ children }: { children?: React.ReactNode }) { return <th style={{ textAlign: 'left', padding: '11px 14px', fontSize: 12, color: 'var(--muted)', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>{children}</th>; }
function Td({ children, colSpan }: { children?: React.ReactNode; colSpan?: number }) { return <td colSpan={colSpan} style={{ padding: '11px 14px', fontSize: 13, borderBottom: '1px solid #f0f1f3' }}>{children}</td>; }
