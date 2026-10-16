'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ShieldCheck, ShieldAlert, X, KeyRound, UserMinus } from 'lucide-react';
import { api, getUser } from '@/lib/api';
import { useConfirm } from '@/components/ConfirmProvider';
import {
  PageHead, Panel, Chip, Table, Th, Td, Empty, RequireCapability, ago, day,
} from '@/components/platform/ui';

const ROLE_COPY: Record<string, { label: string; blurb: string }> = {
  super_admin: {
    label: 'Super Admin',
    blurb: 'Full control: pricing, revenue, infrastructure, security policy, and who else gets console access.',
  },
  platform_admin: {
    label: 'Platform Admin',
    blurb: 'Customer operations: onboard, support, suspend and reactivate companies. No pricing, infrastructure or staff control.',
  },
};

// Who can reach the Platform Console at all. Super Admin only — this is the
// door to every customer's data, so it is the most sensitive page in the app.
export default function StaffPage() {
  return (
    <RequireCapability cap="staff.view">
      <StaffInner />
    </RequireCapability>
  );
}

function StaffInner() {
  const confirm = useConfirm();
  const [staff, setStaff] = useState<any[]>([]);
  const [inviting, setInviting] = useState(false);
  const me = getUser();

  const load = async () => setStaff(await api('/platform/staff').catch(() => []));
  useEffect(() => { load(); }, []);

  const setRole = async (s: any, platformRole: string) => {
    const ok = await confirm({
      title: platformRole === 'super_admin' ? `Promote ${s.firstName} to Super Admin?` : `Reduce ${s.firstName} to Platform Admin?`,
      message: platformRole === 'super_admin'
        ? 'They will be able to change pricing, drain nodes, alter security policy and grant console access to others.'
        : 'They keep customer operations but lose pricing, infrastructure and staff controls.',
      confirmLabel: 'Change role',
      danger: platformRole === 'super_admin',
    });
    if (!ok) return;
    try { await api(`/platform/staff/${s.id}`, { method: 'PATCH', body: JSON.stringify({ platformRole }) }); toast.success('Role updated'); load(); }
    catch { /* surfaced */ }
  };

  const setActive = async (s: any, active: boolean) => {
    if (!active) {
      const ok = await confirm({
        title: `Suspend ${s.firstName} ${s.lastName}?`,
        message: 'They lose access to the Platform Console immediately. Their audit history is kept.',
        confirmLabel: 'Suspend access', danger: true,
      });
      if (!ok) return;
    }
    try { await api(`/platform/staff/${s.id}`, { method: 'PATCH', body: JSON.stringify({ active }) }); toast.success(active ? 'Access restored' : 'Access suspended'); load(); }
    catch { /* surfaced */ }
  };

  const revoke = async (s: any) => {
    const ok = await confirm({
      title: `Remove ${s.email}?`,
      message: 'Deletes the console account entirely. Suspending is reversible; this is not.',
      confirmLabel: 'Remove access', danger: true,
    });
    if (!ok) return;
    try { await api(`/platform/staff/${s.id}`, { method: 'DELETE' }); toast.success('Access removed'); load(); }
    catch { /* surfaced */ }
  };

  const supers = staff.filter((s) => s.platformRole === 'super_admin' && s.active).length;
  const noMfa = staff.filter((s) => s.active && !s.mfaEnabled);

  return (
    <div className="ppage">
      <PageHead title="Platform Team" sub="Everyone who can operate the platform above customer workspaces.">
        <button className="btn btn-green" onClick={() => setInviting(true)}>+ Grant console access</button>
      </PageHead>

      <div className="prole-cards">
        {Object.entries(ROLE_COPY).map(([key, c]) => (
          <div key={key} className={`prole-card ${key === 'super_admin' ? 'is-super' : ''}`}>
            <div className="prole-card-head">
              {key === 'super_admin' ? <ShieldCheck size={17} /> : <ShieldAlert size={17} />}
              <h3>{c.label}</h3>
              <span className="prole-count">{staff.filter((s) => s.platformRole === key && s.active).length}</span>
            </div>
            <p>{c.blurb}</p>
          </div>
        ))}
      </div>

      {noMfa.length > 0 && (
        <div className="pbanner is-warn">
          <KeyRound size={15} />
          {noMfa.length} active {noMfa.length === 1 ? 'account has' : 'accounts have'} no second factor: {noMfa.map((s) => s.email).join(', ')}.
        </div>
      )}

      <Panel title={`${staff.length} console accounts`} sub={`${supers} active Super Admin${supers === 1 ? '' : 's'} — at least one must always remain`} flush>
        {staff.length ? (
          <Table head={<>
            <Th>Person</Th><Th>Role</Th><Th>2FA</Th><Th>Last seen</Th><Th>Since</Th><Th right>Actions</Th>
          </>}>
            {staff.map((s) => {
              const isMe = s.email === me?.email;
              return (
                <tr key={s.id} className={s.active ? '' : 'is-dim'}>
                  <Td>
                    <div className="pcell-title">
                      {s.firstName} {s.lastName}
                      {isMe && <span className="ptag">you</span>}
                    </div>
                    <div className="pcell-sub">{s.email}{s.title ? ` · ${s.title}` : ''}</div>
                  </Td>
                  <Td>
                    <select
                      aria-label={`Role for ${s.email}`}
                      value={s.platformRole}
                      onChange={(e) => setRole(s, e.target.value)}
                      disabled={isMe}
                      title={isMe ? 'You cannot change your own role' : ''}
                    >
                      <option value="platform_admin">Platform Admin</option>
                      <option value="super_admin">Super Admin</option>
                    </select>
                  </Td>
                  <Td>{s.mfaEnabled ? <Chip value="active" dot={false} /> : <span className="pchip is-warn">off</span>}</Td>
                  <Td className="pmuted">{ago(s.lastSeenAt)}</Td>
                  <Td className="pmuted">{day(s.createdAt)}</Td>
                  <Td right>
                    <div className="prow-actions">
                      {s.active
                        ? <button className="btn btn-sm" onClick={() => setActive(s, false)} disabled={isMe}>Suspend</button>
                        : <button className="btn btn-sm btn-green" onClick={() => setActive(s, true)}>Restore</button>}
                      <button className="btn btn-sm btn-danger-ghost" onClick={() => revoke(s)} disabled={isMe} title="Remove access">
                        <UserMinus size={13} />
                      </button>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </Table>
        ) : <Empty title="No console accounts" />}
      </Panel>

      {inviting && <InviteModal onClose={() => setInviting(false)} onSaved={() => { setInviting(false); load(); }} />}
    </div>
  );
}

function InviteModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ firstName: '', lastName: '', email: '', title: '', platformRole: 'platform_admin' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));

  const save = async () => {
    if (!f.email.trim()) { setErr('An email address is required'); return; }
    setBusy(true);
    try {
      await api('/platform/staff', { method: 'POST', body: JSON.stringify(f) });
      toast.success(`Console access granted to ${f.email}`);
      onSaved();
    } catch (e: any) { setErr(e.message || 'Could not grant access'); setBusy(false); }
  };

  return (
    <div className="confirm-overlay" onClick={onClose}>
      <div className="confirm-box pmodal" onClick={(e) => e.stopPropagation()}>
        <h3 className="confirm-title">Grant console access</h3>
        <p className="confirm-msg">They will be able to see customer data, so grant the narrower role unless there is a reason not to.</p>

        <div className="prow-2">
          <div>
            <label htmlFor="st-first">First name</label>
            <input id="st-first" value={f.firstName} onChange={(e) => set('firstName', e.target.value)} />
          </div>
          <div>
            <label htmlFor="st-last">Last name</label>
            <input id="st-last" value={f.lastName} onChange={(e) => set('lastName', e.target.value)} />
          </div>
        </div>

        <label htmlFor="st-mail">Work email</label>
        <input id="st-mail" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="name@nativetalk.cloud" />

        <label htmlFor="st-title">Job title</label>
        <input id="st-title" value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Customer Success" />

        <label>Role</label>
        <div className="pradio-group">
          {Object.entries(ROLE_COPY).map(([key, c]) => (
            <label key={key} className={`pradio ${f.platformRole === key ? 'is-on' : ''}`}>
              <input type="radio" name="platformRole" checked={f.platformRole === key} onChange={() => set('platformRole', key)} />
              <span>
                <b>{c.label}</b>
                <em>{c.blurb}</em>
              </span>
            </label>
          ))}
        </div>

        {err && <div className="err">{err}</div>}
        <div className="confirm-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-green" onClick={save} disabled={busy}>{busy ? 'Granting…' : 'Grant access'}</button>
        </div>
      </div>
    </div>
  );
}
