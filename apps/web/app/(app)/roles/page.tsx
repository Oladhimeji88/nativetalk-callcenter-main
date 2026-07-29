'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api, getUser, hasPermission, landingPath } from '@/lib/api';
import { useConfirm } from '@/components/ConfirmProvider';

// Permission keys shown in the role editor (must match the API permission map).
const PERMISSIONS: { key: string; label: string }[] = [
  { key: 'softphone',  label: 'Softphone' },
  { key: 'contacts',   label: 'Contacts' },
  { key: 'live',       label: 'Live calls' },
  { key: 'queues',     label: 'Queues' },
  { key: 'campaigns',  label: 'Campaigns' },
  { key: 'recordings', label: 'Recordings' },
  { key: 'analytics',  label: 'Analytics' },
  { key: 'call_logs',  label: 'Call logs (without Analytics: own calls only; with Analytics: everyone, or their team if restricted below)' },
  { key: 'pbx',        label: 'Cloud PBX' },
  { key: 'users',      label: 'User & role management' },
  { key: 'billing',    label: 'Billing' },
  { key: 'team',       label: 'Manage a team (can have users report to them)' },
  { key: 'team_scope', label: 'Restrict to own team (only see & manage their own team)' },
];
const PERM_LABEL: Record<string, string> = Object.fromEntries(PERMISSIONS.map((p) => [p.key, p.label.replace(/ \(.*\)$/, '')]));

// Dependencies: enabling a permission requires these (kept in sync with the API's
// permission-deps). Transitive — `live` → `softphone` → `contacts`.
const PERM_DEPS: Record<string, string[]> = {
  softphone: ['contacts'],
  live: ['softphone'],
  campaigns: ['contacts'],
  team_scope: ['team'],
};
const depsOf = (key: string, out = new Set<string>()) => {
  for (const d of PERM_DEPS[key] || []) if (!out.has(d)) { out.add(d); depsOf(d, out); }
  return out;
};
const dependentsOf = (key: string, out = new Set<string>()) => {
  for (const [p, deps] of Object.entries(PERM_DEPS)) if (deps.includes(key) && !out.has(p)) { out.add(p); dependentsOf(p, out); }
  return out;
};

// Role + permission administration. Admin-only. System roles are protected
// (clone to customise).
export default function RolesPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const [roles, setRoles] = useState<any[]>([]);
  const [editRole, setEditRole] = useState<any | null>(null); // role object, or {} for new

  const load = async () => setRoles(await api('/roles').catch(() => []));
  useEffect(() => {
    if (!getUser()) { router.replace('/login'); return; }
    if (!hasPermission('users')) { router.replace(landingPath()); return; }
    load();
  }, [router]);

  const delRole = async (r: any) => {
    const ok = await confirm({ title: `Delete role "${r.name}"?`, message: 'This permanently removes the role. Accounts using it keep their access until reassigned.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try { await api(`/roles/${r.id}`, { method: 'DELETE' }); toast.success('Role deleted'); load(); }
    catch { /* toast handled centrally */ }
  };
  const cloneRole = async (r: any) => {
    const ok = await confirm({ title: `Clone "${r.name}"?`, message: 'Creates an editable copy of this role that you can customise.', confirmLabel: 'Clone' });
    if (!ok) return;
    try { await api(`/roles/${r.id}/clone`, { method: 'POST', body: JSON.stringify({}) }); toast.success(`Cloned "${r.name}"`); load(); }
    catch { /* toast handled centrally */ }
  };

  return (
    <div className="agent-page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Roles</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>Permission sets that control what each account can see and do.</p>
        </div>
        <button className="btn btn-green" onClick={() => setEditRole({})}>+ Add role</button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 18 }}>
        <table className="data-table">
          <thead><tr><Th>Role</Th><Th>Type</Th><Th>Enabled permissions</Th><Th>Actions</Th></tr></thead>
          <tbody>
            {roles.map((r) => {
              const enabled = Object.entries(r.permissions || {}).filter(([, v]: any) => v?.enabled).map(([k]) => k);
              return (
                <tr key={r.id}>
                  <Td><b>{r.name}</b></Td>
                  <Td>{r.isSystem ? <span className="pill">system</span> : <span className="pill ok">custom</span>}</Td>
                  <Td><span className="muted">{enabled.length ? enabled.join(', ') : 'none'}</span></Td>
                  <Td>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditRole(r)} disabled={r.isSystem} title={r.isSystem ? 'System roles cannot be edited. Clone instead' : ''}>Edit</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => cloneRole(r)}>Clone</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => delRole(r)} disabled={r.isSystem}>Delete</button>
                    </div>
                  </Td>
                </tr>
              );
            })}
            {!roles.length && <tr><Td colSpan={4}><span className="muted">No roles yet.</span></Td></tr>}
          </tbody>
        </table>
      </div>

      {editRole && <RoleModal role={editRole} onClose={() => setEditRole(null)} onSaved={() => { setEditRole(null); load(); }} />}
    </div>
  );
}

function RoleModal({ role, onClose, onSaved }: { role: any; onClose: () => void; onSaved: () => void }) {
  const isNew = !role?.id;
  const [name, setName] = useState(role?.name ?? '');
  const [perms, setPerms] = useState<Record<string, { enabled: boolean }>>(() => {
    const init: Record<string, { enabled: boolean }> = {};
    PERMISSIONS.forEach((p) => { init[p.key] = { enabled: !!role?.permissions?.[p.key]?.enabled }; });
    return init;
  });
  const [err, setErr] = useState('');
  // Toggling resolves dependencies: turning one on enables what it needs; turning
  // one off disables anything that depended on it. Keeps the set consistent.
  const toggle = (k: string) => setPerms((prev) => {
    const next = { ...prev };
    const turningOn = !prev[k]?.enabled;
    next[k] = { enabled: turningOn };
    if (turningOn) depsOf(k).forEach((d) => { next[d] = { enabled: true }; });
    else dependentsOf(k).forEach((d) => { next[d] = { enabled: false }; });
    return next;
  });

  const save = async () => {
    if (!name.trim()) { setErr('Role name is required'); return; }
    try {
      if (isNew) await api('/roles', { method: 'POST', body: JSON.stringify({ name, permissions: perms }) });
      else await api(`/roles/${role.id}`, { method: 'PATCH', body: JSON.stringify({ name, permissions: perms }) });
      toast.success(isNew ? 'Role created' : 'Role updated');
      onSaved();
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <Modal title={isNew ? 'Add role' : `Edit ${role.name}`} onClose={onClose} onSave={save} err={err} cta={isNew ? 'Create role' : 'Save changes'}>
      <label>Role name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. QA Lead" />
      <label style={{ marginTop: 16 }}>Permissions</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        {PERMISSIONS.map((p) => {
          const reqs = [...depsOf(p.key)].map((d) => PERM_LABEL[d]);
          return (
            <label key={p.key} className="perm-toggle">
              <input type="checkbox" checked={perms[p.key].enabled} onChange={() => toggle(p.key)} />
              <span>{p.label}{reqs.length > 0 && <em className="muted" style={{ fontStyle: 'normal', fontSize: 11, display: 'block' }}>Requires {reqs.join(' + ')}</em>}</span>
            </label>
          );
        })}
      </div>
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
