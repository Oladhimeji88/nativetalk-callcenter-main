'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Trash2, X, Check, Lock } from 'lucide-react';
import { api, canPlatform } from '@/lib/api';
import { useConfirm } from '@/components/ConfirmProvider';
import { PageHead, Panel, Chip, Empty, IfCapable, naira, compactNaira, num } from '@/components/platform/ui';

const LIMIT_FIELDS: { key: string; label: string; hint: string }[] = [
  { key: 'maxExtensions', label: 'Extensions', hint: 'SIP extensions the company may provision' },
  { key: 'maxConcurrentCalls', label: 'Concurrent calls', hint: 'Simultaneous channels across the workspace' },
  { key: 'maxCampaigns', label: 'Campaigns', hint: 'Outbound campaigns that can exist at once' },
  { key: 'maxMinutesPerMonth', label: 'Minutes / month', hint: 'Included talk minutes before overage' },
  { key: 'storageGb', label: 'Recording storage (GB)', hint: 'Retained call recordings' },
];

// What we sell. Editing is Super Admin only — a price change reprices every
// company on the plan, so it is deliberately not a customer-support action.
export default function PlansPage() {
  const confirm = useConfirm();
  const [plans, setPlans] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const canEdit = canPlatform('plans.manage');

  const load = async () => setPlans(await api('/platform/plans').catch(() => []));
  useEffect(() => { load(); }, []);

  const remove = async (p: any) => {
    const ok = await confirm({
      title: `Delete the ${p.name} plan?`,
      message: 'Only possible while no company is on it. Existing customers must be moved first.',
      confirmLabel: 'Delete plan', danger: true,
    });
    if (!ok) return;
    try { await api(`/platform/plans/${p.id}`, { method: 'DELETE' }); toast.success('Plan deleted'); load(); }
    catch { /* surfaced by the API client */ }
  };

  const toggleActive = async (p: any) => {
    try {
      await api(`/platform/plans/${p.id}`, { method: 'PATCH', body: JSON.stringify({ active: !p.active }) });
      toast.success(p.active ? `${p.name} closed to new signups` : `${p.name} is now sellable`);
      load();
    } catch { /* surfaced */ }
  };

  const totalMrr = plans.reduce((s, p) => s + (p.mrr || 0), 0);

  return (
    <div className="ppage">
      <PageHead
        title="Plans & Pricing"
        sub="The packages companies buy. Changing a price or limit applies to every company already on that plan."
      >
        <IfCapable cap="plans.manage">
          <button className="btn btn-green" onClick={() => setEditing({ limits: {}, features: [] })}>+ New plan</button>
        </IfCapable>
      </PageHead>

      {!canEdit && (
        <div className="pbanner">
          <Lock size={15} />
          You can see pricing so you can advise customers, but only a Super Admin can change it.
        </div>
      )}

      <div className="pplan-grid">
        {plans.map((p) => (
          <article key={p.id} className={`pplan ${p.active === false ? 'is-retired' : ''}`}>
            <header>
              <div>
                <h3>{p.name}</h3>
                <p>{p.tagline}</p>
              </div>
              {p.active === false ? <Chip value="draft" /> : <Chip value="active" />}
            </header>

            <div className="pplan-price">
              <b>{naira(p.priceMonthly)}</b>
              <span>/ {p.billingPeriod ?? 'month'}</span>
            </div>

            <div className="pplan-metrics">
              <div><span>Companies</span><b>{num(p.tenantCount ?? 0)}</b></div>
              <div><span>MRR</span><b>{compactNaira(p.mrr ?? 0)}</b></div>
              <div><span>Trial</span><b>{p.trialDays ? `${p.trialDays}d` : 'None'}</b></div>
            </div>

            <ul className="pplan-features">
              {(p.features ?? []).map((f: string) => <li key={f}><Check size={13} /> {f}</li>)}
            </ul>

            <dl className="pplan-limits">
              {LIMIT_FIELDS.map((l) => (
                <div key={l.key}>
                  <dt>{l.label}</dt>
                  <dd>{num(p.limits?.[l.key] ?? 0)}</dd>
                </div>
              ))}
            </dl>

            <IfCapable cap="plans.manage">
              <footer>
                <button className="btn btn-sm" onClick={() => setEditing(p)}><Pencil size={14} /> Edit</button>
                <button className="btn btn-sm" onClick={() => toggleActive(p)}>
                  {p.active === false ? 'Reopen' : 'Close to signups'}
                </button>
                <button className="btn btn-sm btn-danger-ghost" onClick={() => remove(p)} disabled={(p.tenantCount ?? 0) > 0}>
                  <Trash2 size={14} />
                </button>
              </footer>
            </IfCapable>
          </article>
        ))}
        {!plans.length && <Empty title="No plans yet" sub="Create the first package you want to sell." />}
      </div>

      <Panel title="Revenue by plan" sub={`${compactNaira(totalMrr)} total monthly recurring revenue`}>
        <div className="pbars">
          {plans.filter((p) => (p.mrr ?? 0) > 0).map((p) => (
            <div key={p.id} className="pbar-row">
              <span className="pbar-label">{p.name}</span>
              <div className="pbar-track">
                <div className="pbar-fill" style={{ width: `${totalMrr ? Math.round((p.mrr / totalMrr) * 100) : 0}%` }} />
              </div>
              <span className="pbar-value">{compactNaira(p.mrr)} · {p.tenantCount}</span>
            </div>
          ))}
          {!plans.some((p) => (p.mrr ?? 0) > 0) && <Empty title="No billable companies yet" />}
        </div>
      </Panel>

      {editing && <PlanModal plan={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function PlanModal({ plan, onClose, onSaved }: { plan: any; onClose: () => void; onSaved: () => void }) {
  const isNew = !plan?.id;
  const [f, setF] = useState<any>({
    name: plan.name ?? '',
    tagline: plan.tagline ?? '',
    priceMonthly: (plan.priceMonthly ?? 0) / 100,
    trialDays: plan.trialDays ?? 14,
    features: (plan.features ?? []).join('\n'),
    limits: { ...(plan.limits ?? {}) },
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const setLimit = (k: string, v: string) => setF((p: any) => ({ ...p, limits: { ...p.limits, [k]: Number(v) || 0 } }));

  const save = async () => {
    if (!f.name.trim()) { setErr('Give the plan a name'); return; }
    setBusy(true);
    const body = {
      name: f.name.trim(),
      tagline: f.tagline.trim(),
      priceMonthly: Math.round(Number(f.priceMonthly) * 100),
      trialDays: Number(f.trialDays) || 0,
      features: String(f.features).split('\n').map((s) => s.trim()).filter(Boolean),
      limits: f.limits,
    };
    try {
      if (isNew) await api('/platform/plans', { method: 'POST', body: JSON.stringify(body) });
      else await api(`/platform/plans/${plan.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      toast.success(isNew ? 'Plan created' : `${body.name} updated — companies on it were repriced`);
      onSaved();
    } catch (e: any) { setErr(e.message || 'Could not save'); setBusy(false); }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer">
        <header className="drawer-head">
          <h3>{isNew ? 'New plan' : `Edit ${plan.name}`}</h3>
          <button className="drawer-x" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </header>
        <div className="drawer-body">
          <div>
            <label htmlFor="pl-name">Plan name</label>
            <input id="pl-name" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Growth" />
          </div>
          <div>
            <label htmlFor="pl-tag">One-line description</label>
            <input id="pl-tag" value={f.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder="Who this plan is for" />
          </div>
          <div className="prow-2">
            <div>
              <label htmlFor="pl-price">Price per month (₦)</label>
              <input id="pl-price" type="number" min={0} value={f.priceMonthly} onChange={(e) => set('priceMonthly', e.target.value)} />
            </div>
            <div>
              <label htmlFor="pl-trial">Trial length (days)</label>
              <input id="pl-trial" type="number" min={0} value={f.trialDays} onChange={(e) => set('trialDays', e.target.value)} />
            </div>
          </div>

          <div>
            <label>Limits</label>
            <div className="plimit-grid">
              {LIMIT_FIELDS.map((l) => (
                <label key={l.key} className="plimit" title={l.hint}>
                  <span>{l.label}</span>
                  <input type="number" min={0} value={f.limits[l.key] ?? 0} onChange={(e) => setLimit(l.key, e.target.value)} />
                </label>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="pl-features">Features (one per line)</label>
            <textarea id="pl-features" rows={6} value={f.features} onChange={(e) => set('features', e.target.value)} />
          </div>

          {!isNew && (
            <div className="pbanner is-warn">
              Saving reprices every company currently on {plan.name} and updates their limits immediately.
            </div>
          )}
          {err && <div className="err">{err}</div>}
          <div className="prow-end">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-green" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save plan'}</button>
          </div>
        </div>
      </aside>
    </>
  );
}
