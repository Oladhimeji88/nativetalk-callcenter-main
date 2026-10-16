'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Save, ShieldCheck, DoorOpen, Database, LifeBuoy, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHead, Panel, RequireCapability, Empty } from '@/components/platform/ui';

// Platform-wide policy. Everything here affects every customer at once, which
// is exactly why it is Super Admin only.
export default function SettingsPage() {
  return (
    <RequireCapability cap="settings.manage">
      <SettingsInner />
    </RequireCapability>
  );
}

function Toggle({ on, onChange, label, hint, danger }: { on: boolean; onChange: (v: boolean) => void; label: string; hint: string; danger?: boolean }) {
  return (
    <div className={`ptoggle-row ${danger && on ? 'is-danger' : ''}`}>
      <div>
        <div className="ptoggle-label">{label}</div>
        <div className="ptoggle-hint">{hint}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={`toggle ${on ? 'on' : ''}`}
        onClick={() => onChange(!on)}
      >
        <span className="toggle-knob" />
      </button>
    </div>
  );
}

function SettingsInner() {
  const [s, setS] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/platform/settings').then(setS).catch(() => {});
    api('/platform/plans').then(setPlans).catch(() => {});
  }, []);

  const set = (k: string, v: any) => { setS((p: any) => ({ ...p, [k]: v })); setDirty(true); };

  const save = async () => {
    setBusy(true);
    try { await api('/platform/settings', { method: 'PATCH', body: JSON.stringify(s) }); toast.success('Platform settings saved'); setDirty(false); }
    catch { /* surfaced */ } finally { setBusy(false); }
  };

  if (!s) return <div className="ploading">Loading settings…</div>;

  return (
    <div className="ppage">
      <PageHead title="Settings & Security" sub="Policy that applies to every company on the platform.">
        <button className="btn btn-green" onClick={save} disabled={!dirty || busy}>
          <Save size={15} /> {busy ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </button>
      </PageHead>

      {s.maintenanceMode && (
        <div className="pbanner is-danger">
          <TriangleAlert size={15} />
          Maintenance mode is on — customers cannot sign in to their workspaces.
        </div>
      )}

      <div className="pgrid-2">
        <Panel title="Signups & trials" sub="How new companies join the platform">
          <Toggle
            label="Self-service signup open"
            hint="When off, only your team can onboard a company from the Companies page."
            on={s.signupsOpen}
            onChange={(v) => set('signupsOpen', v)}
          />
          <div className="pfield">
            <label htmlFor="set-plan">Default plan for new signups</label>
            <select id="set-plan" value={s.defaultPlanId} onChange={(e) => set('defaultPlanId', e.target.value)}>
              {plans.filter((p) => p.active !== false).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="pfield">
            <label htmlFor="set-trial">Trial length (days)</label>
            <input id="set-trial" type="number" min={0} max={90} value={s.trialDays} onChange={(e) => set('trialDays', Number(e.target.value))} />
            <p className="pfield-hint">Applied to companies that sign up themselves. Onboarding a company manually can override it.</p>
          </div>
        </Panel>

        <Panel title="Console security" sub="Protecting access to customer data">
          <Toggle
            label="Require 2FA for platform staff"
            hint="Console accounts without a second factor are blocked at sign-in."
            on={s.enforceStaffMfa}
            onChange={(v) => set('enforceStaffMfa', v)}
          />
          <div className="pfield">
            <label htmlFor="set-timeout">Staff session timeout (minutes)</label>
            <input id="set-timeout" type="number" min={5} max={480} value={s.staffSessionTimeoutMins} onChange={(e) => set('staffSessionTimeoutMins', Number(e.target.value))} />
          </div>
          <div className="pfield">
            <label htmlFor="set-ips">Console IP allowlist</label>
            <textarea
              id="set-ips" rows={3}
              value={(s.ipAllowlist ?? []).join('\n')}
              onChange={(e) => set('ipAllowlist', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))}
              placeholder="One CIDR or address per line"
            />
            <p className="pfield-hint">Leave empty to allow any address. Applies to the Platform Console only, never to customer workspaces.</p>
          </div>
        </Panel>

        <Panel title="Data retention" sub="How long we keep customer records">
          <div className="pfield">
            <label htmlFor="set-ret">Call records (days)</label>
            <input id="set-ret" type="number" min={30} value={s.dataRetentionDays} onChange={(e) => set('dataRetentionDays', Number(e.target.value))} />
          </div>
          <div className="pfield">
            <label htmlFor="set-rec">Call recordings (days)</label>
            <input id="set-rec" type="number" min={7} value={s.recordingRetentionDays} onChange={(e) => set('recordingRetentionDays', Number(e.target.value))} />
            <p className="pfield-hint">Recordings are the largest cost driver. Shortening this frees storage across every company.</p>
          </div>
        </Panel>

        <Panel title="Support & availability" sub="Customer-facing contact and downtime">
          <div className="pfield">
            <label htmlFor="set-support">Support email shown to customers</label>
            <input id="set-support" type="email" value={s.supportEmail} onChange={(e) => set('supportEmail', e.target.value)} />
          </div>
          <Toggle
            danger
            label="Maintenance mode"
            hint="Blocks sign-in for every customer workspace. The Platform Console stays reachable."
            on={s.maintenanceMode}
            onChange={(v) => set('maintenanceMode', v)}
          />
        </Panel>
      </div>

      <Panel title="What these controls affect" sub="A reminder before changing anything here">
        <div className="pgov">
          <div className="pgov-item"><DoorOpen size={18} /><div><b>Access</b><span>Signup and console entry for everyone</span></div></div>
          <div className="pgov-item"><ShieldCheck size={18} /><div><b>Security</b><span>2FA, session length, IP allowlist</span></div></div>
          <div className="pgov-item"><Database size={18} /><div><b>Storage</b><span>Retention across all customer data</span></div></div>
          <div className="pgov-item"><LifeBuoy size={18} /><div><b>Support</b><span>The address customers are told to use</span></div></div>
        </div>
      </Panel>

      {!plans.length && <Empty title="No plans configured" sub="Create a plan before opening self-service signup." />}
    </div>
  );
}
