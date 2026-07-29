'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const DIAL_METHODS = ['Preview', 'Progressive', 'Power', 'Predictive', 'Manual', 'VoiceBroadcast'];
const DIRECTION_TYPES = ['Outbound', 'Inbound', 'Blended'];

// What each dial method actually uses — the wizard only shows relevant tabs/fields.
type Caps = { desc: string; agents: boolean; queue: boolean; concurrency: boolean; overdial?: boolean; abandonTarget?: boolean; amd: boolean; maxAttempts: boolean; recording: boolean; dispositions: boolean; audio: boolean; callerid: boolean; schedule: boolean };
const MODES: Record<string, Caps> = {
  Preview:       { desc: 'The agent sees each contact, then clicks to dial. Paced by the agent, with no auto-dialing. The call goes out on the agent’s own line, so campaign caller ID and trunk don’t apply here.', agents: true, queue: false, concurrency: false, amd: false, maxAttempts: true, recording: true, dispositions: true, audio: false, callerid: false, schedule: false },
  Progressive:   { desc: 'The system auto-dials the next contact when an agent is free and connects the answered call.', agents: true, queue: true, concurrency: true, amd: true, maxAttempts: true, recording: true, dispositions: true, audio: false, callerid: true, schedule: true },
  Power:         { desc: 'Over-dials ahead of your free agents to cut their wait time: it dials a few numbers per free agent, so someone is usually answering as an agent frees up. If too many answer at once, a caller may wait briefly for an agent.', agents: true, queue: true, concurrency: true, overdial: true, amd: true, maxAttempts: true, recording: true, dispositions: true, audio: false, callerid: true, schedule: true },
  Predictive:    { desc: 'Like Power, but the system tunes how far it dials ahead on its own, watching the live answer and abandon rates. It leans in when agents have spare capacity and eases off if too many callers are getting dropped, aiming to keep agents busy while holding the abandon rate under your target.', agents: true, queue: true, concurrency: true, overdial: true, abandonTarget: true, amd: true, maxAttempts: true, recording: true, dispositions: true, audio: false, callerid: true, schedule: true },
  Manual:        { desc: 'The agent dials numbers themselves, with no automation. The call goes out on the agent’s own line.', agents: true, queue: false, concurrency: false, amd: false, maxAttempts: false, recording: true, dispositions: true, audio: false, callerid: false, schedule: false },
  VoiceBroadcast:{ desc: 'No agents. The system auto-dials the list and plays a recorded message.', agents: false, queue: false, concurrency: true, amd: true, maxAttempts: true, recording: false, dispositions: false, audio: true, callerid: true, schedule: true },
};

const countNumbers = (raw?: string) => (raw || '').split(/[\s,;\n]+/).map((s) => s.trim()).filter((s) => /\d{3,}/.test(s)).length;

// Full IANA timezone list from the browser; falls back to a short common set on
// engines without Intl.supportedValuesOf.
const TIMEZONES: string[] = (() => {
  try {
    const zones = (Intl as any).supportedValuesOf?.('timeZone');
    if (Array.isArray(zones) && zones.length) return zones;
  } catch { /* fall through */ }
  return ['UTC', 'Africa/Lagos', 'Africa/Cairo', 'Africa/Johannesburg', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore'];
})();

export function CampaignWizard({ initial, onClose, onSaved }: { initial: any; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!initial?.id;
  const [tabKey, setTabKey] = useState('info');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState<any>(isEdit ? { ...initial } : {
    name: '', directionType: 'Outbound', description: '', goal: '',
    contactGroupId: '', numbers: '', dialMethod: 'Preview', concurrency: 1, overdialRatio: 2, abandonTargetPct: 3, maxAttempts: 1, recording: false, amd: false, audioFile: '',
    assignedAgentIds: [], queue: '', callerId: '', gateway: '',
    scheduleStart: '', scheduleEnd: '', callWindowStart: '', callWindowEnd: '', timezone: '', dispositionIds: [], excludeDispositionIds: [],
  });
  const [groups, setGroups] = useState<any[]>([]);
  const [totalContacts, setTotalContacts] = useState(0);
  const [agents, setAgents] = useState<any[]>([]);
  const [dispositions, setDispositions] = useState<any[]>([]);
  const [trunks, setTrunks] = useState<any[]>([]);

  useEffect(() => {
    api('/contact-groups').then(setGroups).catch(() => {});
    api('/contacts').then((r: any[]) => setTotalContacts((r || []).length)).catch(() => {});
    api('/accounts').then((r: any[]) => setAgents((r || []).filter((a) => a.agentExtension))).catch(() => {});
    api('/dispositions').then((r: any[]) => setDispositions((r || []).map((d) => d?.data ?? d).filter((d) => d?.name))).catch(() => {});
    api('/pbx/trunks').then((r: any[]) => setTrunks((r || []).filter((t) => t?.active !== false))).catch(() => {});
  }, []);

  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const toggle = (k: string, id: string) => setF((p: any) => {
    const cur: string[] = p[k] ?? [];
    return { ...p, [k]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
  });

  const caps = MODES[f.dialMethod] || MODES.Preview;
  const TAB_DEFS = [
    { key: 'info', label: 'Information', show: true },
    { key: 'contacts', label: 'Contacts', show: true },
    { key: 'dialing', label: 'Dialing', show: true },
    { key: 'agents', label: 'Agents', show: caps.agents },
    { key: 'callerid', label: 'Caller ID', show: caps.callerid },
    { key: 'schedule', label: 'Schedule', show: caps.schedule },
    { key: 'dispositions', label: 'Dispositions', show: caps.dispositions },
    { key: 'review', label: 'Review', show: true },
  ];
  const tabs = TAB_DEFS.filter((t) => t.show);
  // If the active tab got hidden by a mode change, fall back to Dialing.
  useEffect(() => { if (!tabs.some((t) => t.key === tabKey)) setTabKey('dialing'); /* eslint-disable-next-line */ }, [f.dialMethod]);

  const groupCount = f.contactGroupId === '*' ? totalContacts : (groups.find((g) => g.id === f.contactGroupId)?.count ?? 0);
  const contactsCount = groupCount + countNumbers(f.numbers);

  const save = async () => {
    if (!f.name.trim() || !f.goal.trim()) { setTabKey('info'); setErr('Campaign title and performance goal are required.'); return; }
    setSaving(true);
    const body: any = {
      ...f,
      concurrency: Number(f.concurrency) || 1,
      overdialRatio: Math.min(3, Math.max(1, Number(f.overdialRatio) || 1)),
      abandonTargetPct: Math.min(20, Math.max(0.5, Number(f.abandonTargetPct) || 3)),
      maxAttempts: Number(f.maxAttempts) || 1,
      contactGroupId: f.contactGroupId || null,
      scheduleStart: f.scheduleStart ? new Date(f.scheduleStart).toISOString() : null,
      scheduleEnd: f.scheduleEnd ? new Date(f.scheduleEnd).toISOString() : null,
    };
    delete body.id; delete body.count; delete body.materialized; delete body.agents; delete body.agentCount;
    delete body.contactsCount; delete body.contactRate; delete body.tenantId; delete body.createdAt; delete body.updatedAt; delete body.active;
    try {
      if (isEdit) await api(`/campaigns/${initial.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await api('/campaigns', { method: 'POST', body: JSON.stringify(body) });
      onSaved();
    } catch (e: any) { setErr(e.message || 'Could not save'); setSaving(false); }
  };

  return (
    <div className="wiz">
      <div className="wiz-head">
        <div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><span className="wiz-dot" /> {isEdit ? (f.name?.trim() || 'Edit Campaign') : 'New Campaign'}</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>Configure your outbound campaign. Jump to any section.</p>
        </div>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>

      <div className="wiz-tabs">
        {tabs.map((t) => (
          <button key={t.key} className={`wiz-tab ${t.key === tabKey ? 'on' : ''}`} onClick={() => setTabKey(t.key)}>{t.label}</button>
        ))}
      </div>

      <div className="wiz-body">
        {tabKey === 'info' && (
          <div className="wiz-grid">
            <Field label="Campaign label title *"><input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Lagos Fiber Expansion Campaign" /></Field>
            <Field label="Campaign direction type">
              <select value={f.directionType} onChange={(e) => set('directionType', e.target.value)}>{DIRECTION_TYPES.map((d) => <option key={d}>{d}</option>)}</select>
            </Field>
            <Field label="Description and directives" full>
              <textarea value={f.description} onChange={(e) => set('description', e.target.value)} style={{ minHeight: 120 }} placeholder="Draft scripts, outline campaign directives, target profile, or compliance parameters…" />
            </Field>
            <Field label="Primary performance goal *" full><input value={f.goal} onChange={(e) => set('goal', e.target.value)} placeholder="e.g. Generate 50 qualified sales conversions" /></Field>
          </div>
        )}

        {tabKey === 'contacts' && (
          <div className="wiz-grid">
            <Field label="Target a contact group">
              <select value={f.contactGroupId} onChange={(e) => set('contactGroupId', e.target.value)}>
                <option value="">None</option>
                <option value="*">All contacts ({totalContacts})</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.count ?? 0})</option>)}
              </select>
            </Field>
            <div />
            <Field label="…and / or add numbers manually (one per line / comma-separated)" full>
              <textarea value={f.numbers} onChange={(e) => set('numbers', e.target.value)} style={{ minHeight: 110 }} placeholder="+2348012345678&#10;+2348098765432" />
            </Field>
            <div className="wiz-note" style={{ gridColumn: '1 / -1' }}>This campaign will target <b>{contactsCount}</b> contact{contactsCount === 1 ? '' : 's'} (group + manual, de-duplicated on dial).</div>
          </div>
        )}

        {tabKey === 'dialing' && (
          <div className="wiz-grid">
            <Field label="Dial method">
              <select value={f.dialMethod} onChange={(e) => set('dialMethod', e.target.value)}>{DIAL_METHODS.map((m) => <option key={m}>{m}</option>)}</select>
            </Field>
            <div />
            <div className="wiz-note" style={{ gridColumn: '1 / -1' }}>{caps.desc}</div>
            {caps.concurrency && <Field label={caps.overdial ? 'Max simultaneous calls (hard cap)' : 'Concurrency (simultaneous calls)'}><input type="number" min={1} value={f.concurrency} onChange={(e) => set('concurrency', e.target.value)} /></Field>}
            {caps.overdial && <Field label={caps.abandonTarget ? 'Starting over-dial ratio (calls per free agent)' : 'Over-dial ratio (calls per free agent)'} hint={caps.abandonTarget ? 'Where Predictive begins before it tunes itself. 2 = start by dialing 2 numbers per free agent. It adjusts up or down automatically from here.' : 'How aggressively to dial ahead of your agents. 2 = dial 2 numbers per free agent. Higher fills agents faster but risks callers waiting for an agent. 1 = no over-dial.'}><input type="number" min={1} max={3} step={0.5} value={f.overdialRatio} onChange={(e) => set('overdialRatio', e.target.value)} /></Field>}
            {caps.abandonTarget && <Field label="Target abandon rate (%)" hint="The most dropped calls you'll accept. Predictive eases off dialing when the live abandon rate goes above this, and leans in when it's well below. Compliance rules often cap this around 3-5%."><input type="number" min={0.5} max={20} step={0.5} value={f.abandonTargetPct} onChange={(e) => set('abandonTargetPct', e.target.value)} /></Field>}
            {caps.maxAttempts && <Field label="Max attempts per number" hint="How many times a number can be retried after a No-Answer or Busy disposition before it's retired."><input type="number" min={1} value={f.maxAttempts} onChange={(e) => set('maxAttempts', e.target.value)} /></Field>}
            {caps.audio && <Field label="Audio message to play" full><input value={f.audioFile} onChange={(e) => set('audioFile', e.target.value)} placeholder="recording filename or path" /></Field>}
            {(caps.recording || caps.amd) && (
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 28, flexWrap: 'wrap', marginTop: 4 }}>
                {caps.recording && <label className="wiz-check"><input type="checkbox" checked={f.recording} onChange={(e) => set('recording', e.target.checked)} /> Record calls</label>}
                {caps.amd && <label className="wiz-check"><input type="checkbox" checked={f.amd} onChange={(e) => set('amd', e.target.checked)} /> Skip answering machines (AMD)</label>}
              </div>
            )}
          </div>
        )}

        {tabKey === 'agents' && (
          <Field label="Assign agents to this campaign" full>
            {agents.length ? (
              <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                {agents.map((a) => {
                  const on = (f.assignedAgentIds ?? []).includes(a.id);
                  return <button key={a.id} type="button" className={`chip ${on ? 'chip-on' : ''}`} onClick={() => toggle('assignedAgentIds', a.id)}>
                    {[a.firstName, a.lastName].filter(Boolean).join(' ') || a.email} ({a.agentExtension})
                  </button>;
                })}
              </div>
            ) : <span className="muted">No agents with extensions yet.</span>}
          </Field>
        )}


        {tabKey === 'callerid' && (
          <div className="wiz-grid">
            <Field label="Caller ID (shown to the person you call)"><input value={f.callerId} onChange={(e) => set('callerId', e.target.value)} placeholder="e.g. 018889999" /></Field>
            <Field label="Gateway / trunk (blank = local)">
              <select value={f.gateway} onChange={(e) => set('gateway', e.target.value)}>
                <option value="">Local (no trunk)</option>
                {trunks.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
              {!trunks.length && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>No trunks configured yet. Add one in Trunk Management to route calls to a carrier.</div>}
            </Field>
          </div>
        )}

        {tabKey === 'schedule' && (
          <>
            <div className="wiz-note" style={{ marginBottom: 14 }}>Scheduling is optional. Leave blank to run on demand. When set, the dialer only places calls inside the active dates and daily call window (in the timezone below); it pauses if the window closes mid-run.</div>
            <div className="wiz-grid">
              <Field label="Active from"><input type="date" value={f.scheduleStart} onChange={(e) => set('scheduleStart', e.target.value)} /></Field>
              <Field label="Active until"><input type="date" value={f.scheduleEnd} onChange={(e) => set('scheduleEnd', e.target.value)} /></Field>
              <Field label="Call window start"><input type="time" value={f.callWindowStart} onChange={(e) => set('callWindowStart', e.target.value)} /></Field>
              <Field label="Call window end"><input type="time" value={f.callWindowEnd} onChange={(e) => set('callWindowEnd', e.target.value)} /></Field>
              <Field label="Timezone">
                <select value={f.timezone} onChange={(e) => set('timezone', e.target.value)}>
                  <option value="">Server default</option>
                  {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </Field>
            </div>
          </>
        )}

        {tabKey === 'dispositions' && (
          <>
            <Field label="Dispositions offered for this campaign (none selected = all)" full>
              {dispositions.length ? (
                <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                  {dispositions.map((d) => {
                    const on = (f.dispositionIds ?? []).includes(d.id ?? d.name);
                    return <button key={d.id ?? d.name} type="button" className={`chip ${on ? 'chip-on' : ''}`} onClick={() => toggle('dispositionIds', d.id ?? d.name)}>{d.name}</button>;
                  })}
                </div>
              ) : <span className="muted">No dispositions configured. The defaults will be used.</span>}
            </Field>
            {dispositions.length > 0 && (
              <Field label="Don’t re-dial leads with these dispositions" hint="On a re-run, a lead whose last disposition is one of these is skipped (e.g. Sale Closed, Do Not Call). Leads not yet dispositioned are always dialed." full>
                <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                  {dispositions.map((d) => {
                    const on = (f.excludeDispositionIds ?? []).includes(d.id ?? d.name);
                    return <button key={d.id ?? d.name} type="button" className={`chip ${on ? 'chip-red' : ''}`} onClick={() => toggle('excludeDispositionIds', d.id ?? d.name)}>{d.name}</button>;
                  })}
                </div>
              </Field>
            )}
          </>
        )}

        {tabKey === 'review' && (
          <div className="wiz-review">
            <Row label="Name" value={f.name} />
            <Row label="Direction" value={f.directionType} />
            <Row label="Goal" value={f.goal} />
            <Row label="Contacts" value={`${contactsCount} (group: ${f.contactGroupId === '*' ? 'All contacts' : (groups.find((g) => g.id === f.contactGroupId)?.name || '—')}, manual: ${countNumbers(f.numbers)})`} />
            <Row label="Dial method" value={f.dialMethod} />
            {caps.agents && <Row label="Agents assigned" value={String((f.assignedAgentIds ?? []).length)} />}
            {caps.concurrency && <Row label="Concurrency" value={String(f.concurrency)} />}
            {caps.audio && <Row label="Audio message" value={f.audioFile || '—'} />}
            {caps.callerid && <Row label="Caller ID" value={f.callerId || '—'} />}
            {caps.schedule && <Row label="Schedule" value={f.scheduleStart || f.scheduleEnd ? `${f.scheduleStart || '…'} to ${f.scheduleEnd || '…'}` : 'on demand'} />}
            {caps.dispositions && <Row label="Dispositions" value={(f.dispositionIds ?? []).length ? `${f.dispositionIds.length} selected` : 'all'} />}
            {caps.dispositions && (f.excludeDispositionIds ?? []).length > 0 && <Row label="Skip on re-run" value={`${f.excludeDispositionIds.length} disposition(s)`} />}
          </div>
        )}

        {err && <div className="err" style={{ marginTop: 14 }}>{err}</div>}
      </div>

      <div className="wiz-foot" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-green" onClick={save} disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create campaign'}</button>
      </div>
    </div>
  );
}

function Field({ label, children, full, hint }: { label: string; children: React.ReactNode; full?: boolean; hint?: string }) {
  return <label style={{ display: 'block', gridColumn: full ? '1 / -1' : undefined }}>
    <span className="wiz-label">{label}</span>{children}
    {hint && <span className="wiz-field-hint">{hint}</span>}
  </label>;
}
function Row({ label, value }: { label: string; value: string }) {
  return <div className="wiz-review-row"><span className="muted">{label}</span><span style={{ fontWeight: 600 }}>{value}</span></div>;
}
