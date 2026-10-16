'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Search, X, ExternalLink, Ban, Play, Receipt, Trash2, Building2, Mail, Phone, MapPin,
} from 'lucide-react';
import { api, canPlatform, setImpersonation } from '@/lib/api';
import { useConfirm } from '@/components/ConfirmProvider';
import {
  PageHead, Panel, Chip, Meter, Empty, Table, Th, Td, IfCapable,
  naira, num, ago, day,
} from '@/components/platform/ui';

const STATUSES = ['all', 'active', 'trial', 'past_due', 'suspended'] as const;
const STATUS_LABEL: Record<string, string> = { all: 'All', active: 'Active', trial: 'Trial', past_due: 'Past due', suspended: 'Suspended' };

// Companies — the customer book. Everything a platform operator does to an
// account starts here: onboard, change plan, chase payment, suspend, or open
// the workspace as the customer sees it.
export default function TenantsPage() {
  const router = useRouter();
  const confirm = useConfirm();

  const [rows, setRows] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setRows(await api('/platform/tenants').catch(() => []));
    setPlans(await api('/platform/plans').catch(() => []));
  };
  useEffect(() => { load(); }, []);

  // Deep link from the overview: ?open=<tenantId>
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('open');
    if (id) setOpenId(id);
  }, []);
  useEffect(() => {
    if (!openId) { setDetail(null); return; }
    api(`/platform/tenants/${openId}`).then(setDetail).catch(() => setDetail(null));
  }, [openId, rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((t) => status === 'all' || t.status === status)
      .filter((t) => !needle || `${t.name} ${t.slug} ${t.region} ${t.primaryContact?.email ?? ''}`.toLowerCase().includes(needle));
  }, [rows, q, status]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const t of rows) c[t.status] = (c[t.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const act = async (fn: () => Promise<any>, message: string) => {
    try { await fn(); toast.success(message); load(); }
    catch { /* the API client surfaces the error */ }
  };

  const suspend = (t: any) => act(() => api(`/platform/tenants/${t.id}/suspend`, { method: 'POST' }), `${t.name} suspended`);
  const activate = (t: any) => act(() => api(`/platform/tenants/${t.id}/activate`, { method: 'POST' }), `${t.name} is active`);
  const invoice = (t: any) => act(() => api(`/platform/tenants/${t.id}/invoice`, { method: 'POST' }), `Invoice issued to ${t.name}`);
  const changePlan = (t: any, planId: string) =>
    act(() => api(`/platform/tenants/${t.id}/plan`, { method: 'POST', body: JSON.stringify({ planId }) }), 'Plan updated');

  const remove = async (t: any) => {
    const ok = await confirm({
      title: `Delete ${t.name}?`,
      message: 'This removes the company and everything in its workspace. Suspending is usually the right call instead — it keeps the data and stops billing.',
      confirmLabel: 'Delete permanently', danger: true,
    });
    if (!ok) return;
    await act(() => api(`/platform/tenants/${t.id}`, { method: 'DELETE' }), `${t.name} deleted`);
    setOpenId(null);
  };

  // Support access: step into the customer's workspace, clearly marked and audited.
  const openWorkspace = async (t: any) => {
    const ok = await confirm({
      title: `Open ${t.name}'s workspace?`,
      message: 'You will see the app exactly as their administrator does. This is recorded in the audit log, and a banner shows while you are in there.',
      confirmLabel: 'Open workspace',
    });
    if (!ok) return;
    try {
      const session = await api<any>(`/platform/tenants/${t.id}/impersonate`, { method: 'POST' });
      setImpersonation(session);
      router.push('/dashboard');
    } catch { /* surfaced by the API client */ }
  };

  return (
    <div className="ppage">
      <PageHead title="Companies" sub="Every business using the platform, and the state of their account.">
        <IfCapable cap="tenants.create">
          <button className="btn btn-green" onClick={() => setCreating(true)}>+ Onboard company</button>
        </IfCapable>
      </PageHead>

      <div className="ptoolbar">
        <div className="ptabs">
          {STATUSES.map((s) => (
            <button key={s} className={`ptab ${status === s ? 'is-on' : ''}`} onClick={() => setStatus(s)}>
              {STATUS_LABEL[s]} <span className="ptab-count">{counts[s] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="psearch">
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, region or contact…" />
        </div>
      </div>

      <Panel title={`${filtered.length} ${filtered.length === 1 ? 'company' : 'companies'}`} sub="Select a row to open the account" flush>
        {filtered.length ? (
          <Table head={<>
            <Th>Company</Th><Th>Plan</Th><Th>Status</Th><Th>Extensions</Th>
            <Th>Calls / period</Th><Th>Health</Th><Th right>MRR</Th>
          </>}>
            {filtered.map((t) => (
              <tr key={t.id} className="is-clickable" onClick={() => setOpenId(t.id)}>
                <Td>
                  <div className="pcell-title">{t.name}</div>
                  <div className="pcell-sub">{t.region} · joined {day(t.createdAt)}</div>
                </Td>
                <Td>
                  {t.plan}
                  {t.status === 'trial' && <div className="pcell-sub">{Math.max(0, t.trialDaysLeft ?? 0)} days left</div>}
                </Td>
                <Td><Chip value={t.status} /></Td>
                <Td><Meter value={t.usage.extensions} max={t.limits?.maxExtensions ?? 0} /></Td>
                <Td>{num(t.usage.callsThisPeriod)}</Td>
                <Td>
                  <span className={`phealth is-${t.healthScore >= 75 ? 'good' : t.healthScore >= 50 ? 'warn' : 'bad'}`}>
                    {t.healthScore}
                  </span>
                  <span className="pcell-sub"> {t.churnRisk} risk</span>
                </Td>
                <Td right><b>{t.mrr ? naira(t.mrr) : <span className="pmuted">—</span>}</b></Td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty title="No companies match" sub="Try a different status filter or search term." />
        )}
      </Panel>

      {detail && (
        <TenantDrawer
          t={detail}
          plans={plans}
          onClose={() => { setOpenId(null); router.replace('/platform/tenants'); }}
          onSuspend={() => suspend(detail)}
          onActivate={() => activate(detail)}
          onInvoice={() => invoice(detail)}
          onDelete={() => remove(detail)}
          onPlan={(planId: string) => changePlan(detail, planId)}
          onOpenWorkspace={() => openWorkspace(detail)}
        />
      )}

      {creating && <OnboardModal plans={plans} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
    </div>
  );
}

function TenantDrawer({ t, plans, onClose, onSuspend, onActivate, onInvoice, onDelete, onPlan, onOpenWorkspace }: any) {
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer pdrawer">
        <header className="drawer-head">
          <div>
            <h3>{t.name}</h3>
            <div className="pcell-sub">{t.slug}</div>
          </div>
          <button className="drawer-x" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </header>

        <div className="drawer-body pdrawer-body">
          <div className="prow-chips">
            <Chip value={t.status} />
            <span className="pchip is-muted"><Building2 size={12} /> {t.plan}</span>
            <span className="pchip is-muted"><MapPin size={12} /> {t.region}</span>
          </div>

          <div className="pdetail-grid">
            <div><span>MRR</span><b>{t.mrr ? naira(t.mrr) : '—'}</b></div>
            <div><span>Outstanding</span><b>{t.openInvoiceTotal ? naira(t.openInvoiceTotal) : '—'}</b></div>
            <div><span>Health</span><b>{t.healthScore}/100</b></div>
            <div><span>Churn risk</span><b style={{ textTransform: 'capitalize' }}>{t.churnRisk}</b></div>
            <div><span>Customer since</span><b>{day(t.createdAt)}</b></div>
            <div><span>Last active</span><b>{ago(t.lastActivityAt)}</b></div>
          </div>

          <section className="pdrawer-section">
            <h4>Usage against plan</h4>
            <div className="pusage">
              <div><span>Extensions</span><Meter value={t.usage.extensions} max={t.limits?.maxExtensions ?? 0} /></div>
              <div><span>Concurrent channels</span><Meter value={t.usage.concurrentPeak} max={t.limits?.maxConcurrentCalls ?? 0} /></div>
              <div><span>Minutes this month</span><Meter value={t.usage.minutesThisMonth} max={t.limits?.maxMinutesPerMonth ?? 0} /></div>
              <div><span>Recording storage</span><Meter value={t.usage.storageGb} max={t.limits?.storageGb ?? 0} label={`${t.usage.storageGb} / ${t.limits?.storageGb ?? 0} GB`} /></div>
            </div>
          </section>

          <section className="pdrawer-section">
            <h4>Primary contact</h4>
            <div className="pcontact">
              <div><Mail size={14} /> {t.primaryContact?.email || '—'}</div>
              <div><Phone size={14} /> {t.primaryContact?.phone || '—'}</div>
              <div className="pcell-sub">{t.primaryContact?.name}</div>
            </div>
            {t.notes && <div className="pnote">{t.notes}</div>}
          </section>

          <IfCapable cap="plans.view">
            <section className="pdrawer-section">
              <h4>Plan</h4>
              <select
                aria-label="Subscription plan"
                value={t.planId ?? ''}
                onChange={(e) => onPlan(e.target.value)}
                disabled={!canPlatform('tenants.manage')}
              >
                {plans.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name} — {naira(p.priceMonthly)}/mo</option>
                ))}
              </select>
              <p className="pfield-hint">Changing the plan updates their limits immediately and bills at the new rate next cycle.</p>
            </section>
          </IfCapable>

          <section className="pdrawer-section">
            <h4>Recent invoices</h4>
            {t.invoices?.length ? (
              <ul className="plist plist-flat">
                {t.invoices.slice(0, 4).map((i: any) => (
                  <li key={i.id}>
                    <div>
                      <div className="plist-title">{naira(i.amount)}</div>
                      <div className="plist-sub">{i.period ?? day(i.createdAt)}</div>
                    </div>
                    <Chip value={i.status} />
                  </li>
                ))}
              </ul>
            ) : <Empty title="No invoices yet" />}
          </section>

          <section className="pdrawer-section">
            <h4>Actions</h4>
            <div className="pactions">
              <IfCapable cap="tenants.impersonate">
                <button className="btn" onClick={onOpenWorkspace} disabled={t.status === 'suspended'}>
                  <ExternalLink size={15} /> Open workspace as customer
                </button>
              </IfCapable>
              <IfCapable cap="billing.view">
                <button className="btn" onClick={onInvoice}><Receipt size={15} /> Issue invoice</button>
              </IfCapable>
              <IfCapable cap="tenants.manage">
                {t.status === 'suspended'
                  ? <button className="btn btn-green" onClick={onActivate}><Play size={15} /> Reactivate account</button>
                  : <button className="btn" onClick={onSuspend}><Ban size={15} /> Suspend account</button>}
              </IfCapable>
              <IfCapable cap="tenants.delete">
                <button className="btn btn-danger-ghost" onClick={onDelete}><Trash2 size={15} /> Delete company</button>
              </IfCapable>
            </div>
            <p className="pfield-hint">
              Suspending blocks sign-in and stops billing but keeps every recording, contact and call record.
            </p>
          </section>
        </div>
      </aside>
    </>
  );
}

function OnboardModal({ plans, onClose, onSaved }: { plans: any[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({
    name: '', adminName: '', adminEmail: '', phone: '',
    region: 'Lagos', planId: plans[0]?.id ?? '', startTrial: true,
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));

  useEffect(() => { if (!f.planId && plans[0]) set('planId', plans[0].id); /* eslint-disable-next-line */ }, [plans]);

  const save = async () => {
    if (!f.name.trim()) { setErr('Company name is required'); return; }
    if (!f.adminEmail.trim()) { setErr("The administrator's email is required"); return; }
    setBusy(true);
    try {
      await api('/platform/tenants', { method: 'POST', body: JSON.stringify(f) });
      toast.success(`${f.name} onboarded`);
      onSaved();
    } catch (e: any) { setErr(e.message || 'Could not create the company'); setBusy(false); }
  };

  return (
    <div className="confirm-overlay" onClick={onClose}>
      <div className="confirm-box pmodal" onClick={(e) => e.stopPropagation()}>
        <h3 className="confirm-title">Onboard a company</h3>
        <p className="confirm-msg">Creates the workspace and invites their first administrator.</p>

        <label>Company name</label>
        <input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Acme Telecoms Ltd" autoFocus />

        <div className="prow-2">
          <div>
            <label>Administrator name</label>
            <input value={f.adminName} onChange={(e) => set('adminName', e.target.value)} placeholder="Full name" />
          </div>
          <div>
            <label>Administrator email</label>
            <input type="email" value={f.adminEmail} onChange={(e) => set('adminEmail', e.target.value)} placeholder="admin@company.com" />
          </div>
        </div>

        <div className="prow-2">
          <div>
            <label htmlFor="onboard-region">Region</label>
            <select id="onboard-region" value={f.region} onChange={(e) => set('region', e.target.value)}>
              {['Lagos', 'Abuja', 'Kano', 'Kaduna', 'Ibadan', 'Port Harcourt'].map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="onboard-plan">Plan</label>
            <select id="onboard-plan" value={f.planId} onChange={(e) => set('planId', e.target.value)}>
              {plans.filter((p) => p.active !== false).map((p: any) => (
                <option key={p.id} value={p.id}>{p.name} — {naira(p.priceMonthly)}/mo</option>
              ))}
            </select>
          </div>
        </div>

        <label className="pcheck">
          <input type="checkbox" checked={f.startTrial} onChange={(e) => set('startTrial', e.target.checked)} />
          Start on a free trial (billing begins when it converts)
        </label>

        {err && <div className="err">{err}</div>}
        <div className="confirm-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-green" onClick={save} disabled={busy}>{busy ? 'Creating…' : 'Create company'}</button>
        </div>
      </div>
    </div>
  );
}
