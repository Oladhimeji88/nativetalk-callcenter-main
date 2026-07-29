'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Phone, Pencil, Trash2, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { api, getUser, hasPermission } from '@/lib/api';
import { useConfirm } from '@/components/ConfirmProvider';
import { useCall } from '@/components/CallProvider';

type Contact = { id: string; name?: string; phone?: string; email?: string; company?: string; notes?: string; groupIds?: string[]; customFields?: Record<string, any>; lastContactedAt?: string | null; lastDisposition?: string | null };
type Field = { id: string; key: string; label: string; type: 'text' | 'number' | 'date' | 'select'; options?: string[] };
const fmtWhen = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null);
type Group = { id: string; name: string; count?: number };
const EMPTY: Contact = { id: '', name: '', phone: '', email: '', company: '', notes: '', groupIds: [], customFields: {} };

export default function ContactsPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const { callNumber } = useCall();
  const [list, setList] = useState<Contact[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [q, setQ] = useState('');
  const [groupFilter, setGroupFilter] = useState('');   // '' = all
  const [newGroup, setNewGroup] = useState('');          // inline new-group input
  const [editing, setEditing] = useState<Contact | null>(null);
  const [fields, setFields] = useState<Field[]>([]);     // tenant custom-field definitions
  const [manageFields, setManageFields] = useState(false);
  const [importing, setImporting] = useState(false);
  const isManager = hasPermission('contacts'); // can manage contacts + custom fields

  const groupName = (id: string) => groups.find((g) => g.id === id)?.name ?? '';
  const loadFields = async () => setFields(await api('/custom-fields').catch(() => []));
  const setCF = (key: string, val: any) => setEditing((c) => (c ? { ...c, customFields: { ...(c.customFields || {}), [key]: val } } : c));

  // Group changes reload from the server; the text search filters that list live.
  const load = async () => {
    const qs = groupFilter ? `?group=${encodeURIComponent(groupFilter)}` : '';
    setList(await api(`/contacts${qs}`).catch(() => []));
  };
  const filtered = q
    ? list.filter((c) => `${c.name ?? ''} ${c.phone ?? ''} ${c.email ?? ''} ${c.company ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    : list;
  const loadGroups = async () => setGroups(await api('/contact-groups').catch(() => []));
  useEffect(() => { if (!getUser()) { router.replace('/login'); return; } loadGroups(); loadFields(); /* eslint-disable-next-line */ }, [router]);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [groupFilter]);

  const save = async () => {
    if (!editing) return;
    if (!editing.name && !editing.phone) return;
    const { id, ...body } = editing;
    try {
      if (id) await api(`/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await api('/contacts', { method: 'POST', body: JSON.stringify(body) });
      setEditing(null); load(); loadGroups();
    } catch (e: any) { alert(e.message); }
  };
  const remove = async (c: Contact) => {
    if (!(await confirm({ title: 'Delete contact?', message: `Remove ${c.name || c.phone || 'this contact'}? This can't be undone.`, confirmLabel: 'Delete', danger: true }))) return;
    await api(`/contacts/${c.id}`, { method: 'DELETE' }); load(); loadGroups();
  };
  const call = (phone?: string) => { if (phone) { callNumber(phone); router.push('/agent'); } };

  const addGroup = async () => {
    const name = newGroup.trim();
    if (!name) return;
    await api('/contact-groups', { method: 'POST', body: JSON.stringify({ name }) });
    setNewGroup(''); loadGroups();
  };
  const deleteGroup = async (g: Group) => {
    if (!(await confirm({ title: 'Delete group?', message: `Delete "${g.name}"? Contacts stay, but lose this group.`, confirmLabel: 'Delete', danger: true }))) return;
    if (groupFilter === g.id) setGroupFilter('');
    await api(`/contact-groups/${g.id}`, { method: 'DELETE' }); loadGroups(); load();
  };
  const toggleGroupOnContact = (gid: string) => {
    if (!editing) return;
    const cur = editing.groupIds ?? [];
    setEditing({ ...editing, groupIds: cur.includes(gid) ? cur.filter((x) => x !== gid) : [...cur, gid] });
  };

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Contacts</h2>
        <div className="row" style={{ gap: 8 }}>
          {isManager && <button className="btn btn-ghost" onClick={() => setManageFields(true)}>Custom fields</button>}
          <button className="btn btn-ghost" onClick={() => setImporting(true)}>Import CSV</button>
          <button className="btn btn-green" onClick={() => setEditing({ ...EMPTY })}>+ New contact</button>
        </div>
      </div>

      {/* Group filter chips */}
      <div className="chips">
        <button className={`chip ${!groupFilter ? 'chip-on' : ''}`} onClick={() => setGroupFilter('')}>All</button>
        {groups.map((g) => (
          <span key={g.id} className={`chip ${groupFilter === g.id ? 'chip-on' : ''}`}>
            <button className="chip-label" onClick={() => setGroupFilter(g.id)}>{g.name} <span className="muted">({g.count ?? 0})</span></button>
            <button className="chip-x" title="Delete group" onClick={() => deleteGroup(g)}><X size={12} /></button>
          </span>
        ))}
        <span className="chip chip-add">
          <input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addGroup()} placeholder="+ New group" />
          {newGroup && <button className="chip-label" onClick={addGroup}>Add</button>}
        </span>
      </div>

      <div className="row" style={{ marginBottom: 10 }}>
        <input placeholder="Search name, phone or email…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#f9fafb' }}><Th>Name</Th><Th>Phone</Th><Th>Company</Th><Th>Groups</Th><Th>Last contacted</Th><Th /></tr></thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <Td><b>{c.name || '—'}</b>{c.email && <div className="muted" style={{ fontSize: 12 }}>{c.email}</div>}</Td>
                <Td>{c.phone || '—'}</Td>
                <Td>{c.company || '—'}</Td>
                <Td>
                  {(c.groupIds ?? []).length
                    ? <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>{(c.groupIds ?? []).map((gid) => <span key={gid} className="tag">{groupName(gid) || '—'}</span>)}</div>
                    : <span className="muted">—</span>}
                </Td>
                <Td>
                  {c.lastContactedAt
                    ? <div><div style={{ fontSize: 13 }}>{fmtWhen(c.lastContactedAt)}</div>{c.lastDisposition && <div className="muted" style={{ fontSize: 12 }}>{c.lastDisposition}</div>}</div>
                    : <span className="muted">Never</span>}
                </Td>
                <Td>
                  <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    {c.phone && <button className="icon-btn" title="Call" onClick={() => call(c.phone)}><Phone size={15} /></button>}
                    <button className="icon-btn" title="Edit" onClick={() => setEditing(c)}><Pencil size={15} /></button>
                    <button className="icon-btn" title="Delete" onClick={() => remove(c)}><Trash2 size={15} /></button>
                  </div>
                </Td>
              </tr>
            ))}
            {!filtered.length && <tr><Td colSpan={6}><span className="muted">No contacts{q ? ' match your search' : groupFilter ? ' in this group' : ' yet'}.</span></Td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <>
          <div className="drawer-backdrop" onClick={() => setEditing(null)} />
          <div className="drawer">
            <div className="drawer-head">
              <h3 style={{ margin: 0 }}>{editing.id ? 'Edit contact' : 'New contact'}</h3>
              <button className="drawer-x" onClick={() => setEditing(null)} aria-label="Close"><X size={20} /></button>
            </div>
            <div className="drawer-body">
              <Field label="Name"><input value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="Phone"><input value={editing.phone || ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
              <Field label="Company"><input value={editing.company || ''} onChange={(e) => setEditing({ ...editing, company: e.target.value })} /></Field>
              <Field label="Email"><input value={editing.email || ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
              <Field label="Notes"><textarea rows={3} value={editing.notes || ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
              {fields.map((f) => {
                const v = editing.customFields?.[f.key] ?? '';
                return (
                  <Field key={f.id} label={f.label}>
                    {f.type === 'select'
                      ? <select value={v} onChange={(e) => setCF(f.key, e.target.value)}><option value="">—</option>{(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}</select>
                      : <input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} value={v} onChange={(e) => setCF(f.key, e.target.value)} />}
                  </Field>
                );
              })}
              <Field label="Groups">
                {groups.length ? (
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {groups.map((g) => {
                      const on = (editing.groupIds ?? []).includes(g.id);
                      return <button key={g.id} type="button" className={`chip ${on ? 'chip-on' : ''}`} onClick={() => toggleGroupOnContact(g.id)}>{g.name}</button>;
                    })}
                  </div>
                ) : <span className="muted" style={{ fontSize: 13 }}>No groups yet. Create one above.</span>}
              </Field>
              <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                <button className="btn btn-green" onClick={save}>{editing.id ? 'Save' : 'Add contact'}</button>
              </div>
            </div>
          </div>
        </>
      )}

      {manageFields && <FieldsManager fields={fields} reload={loadFields} onClose={() => setManageFields(false)} />}
      {importing && <ImportModal fields={fields} groups={groups} onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); loadGroups(); }} />}
    </div>
  );
}

function ImportModal({ fields, groups, onClose, onDone }: { fields: Field[]; groups: Group[]; onClose: () => void; onDone: () => void }) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<string, number>>({});
  const [groupId, setGroupId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Standard targets + one per custom field. "Group" maps a column of group
  // names: each row joins the group with that name (created if it's new).
  const targets = [{ key: 'name', label: 'Name' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'company', label: 'Company' },
    { key: 'group', label: 'Group' },
    ...fields.map((f) => ({ key: f.key, label: f.label }))];

  const onFile = async (file?: File) => {
    if (!file) return;
    setErr('');
    try {
      // SheetJS reads CSV and Excel (.xlsx/.xls) alike.
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false, defval: '' });
      const h = (aoa[0] || []).map((x) => String(x).trim());
      const r = aoa.slice(1).map((row) => (h.map((_, i) => String(row[i] ?? ''))));
      setHeaders(h); setRows(r);
      // auto-map by header name
      const auto: Record<string, number> = {};
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const t of targets) {
        const i = h.findIndex((x) => norm(x) === norm(t.key) || norm(x) === norm(t.label) || (t.key === 'phone' && /mobile|tel|number/.test(norm(x))));
        auto[t.key] = i;
      }
      setMap(auto);
    } catch { setErr('Could not read that file. Use a .csv or .xlsx with a header row.'); }
  };

  const doImport = async () => {
    setBusy(true); setErr('');
    const get = (row: string[], key: string) => { const i = map[key]; return i >= 0 && i < row.length ? (row[i] ?? '').trim() : ''; };
    const contacts = rows.map((row) => ({
      name: get(row, 'name'), phone: get(row, 'phone'), email: get(row, 'email'), company: get(row, 'company'),
      group: get(row, 'group'),
      customFields: Object.fromEntries(fields.map((f) => [f.key, get(row, f.key)]).filter(([, v]) => v)),
    })).filter((c) => c.name || c.phone);
    try {
      const res = await api('/contacts/import', { method: 'POST', body: JSON.stringify({ contacts, groupId: groupId || undefined }) });
      alert(`Imported ${res?.created ?? 0} contacts.${res?.createdGroups ? ` Created ${res.createdGroups} new group${res.createdGroups === 1 ? '' : 's'}.` : ''}`);
      onDone();
    } catch (e: any) { setErr(e.message || 'Import failed'); setBusy(false); }
  };

  return (
    <div className="confirm-overlay" onClick={onClose}>
      <div className="confirm-box" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px' }}>Import contacts</h3>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Upload a <b>CSV or Excel</b> file. The first row must be column headers. Then match your columns to our fields below.</p>
        <input type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
        {headers.length > 0 && (
          <>
            {/* Preview so you can see your data before importing */}
            <div className="muted" style={{ fontSize: 13, margin: '12px 0 4px' }}>Found <b>{rows.length}</b> row{rows.length === 1 ? '' : 's'}. Preview:</div>
            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12 }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                <thead><tr style={{ background: '#f9fafb' }}>{headers.map((h, i) => <th key={i} style={{ padding: '5px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h || <span className="muted">col {i + 1}</span>}</th>)}</tr></thead>
                <tbody>{rows.slice(0, 4).map((r, ri) => <tr key={ri}>{headers.map((_, ci) => <td key={ci} style={{ padding: '5px 8px', borderBottom: '1px solid #f0f1f3', whiteSpace: 'nowrap' }}>{r[ci] || <span className="muted">—</span>}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <div className="muted" style={{ fontSize: 13, margin: '0 0 6px' }}>Match each field to a column in your file:</div>
            <div style={{ display: 'grid', gap: 8, maxHeight: 240, overflowY: 'auto' }}>
              {targets.map((t) => (
                <div key={t.key} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{t.label}{t.key === 'phone' ? ' *' : ''}</span>
                  <select value={map[t.key] ?? -1} onChange={(e) => setMap({ ...map, [t.key]: Number(e.target.value) })} style={{ width: '100%' }}>
                    <option value={-1}>— skip —</option>
                    {headers.map((h, i) => <option key={i} value={i}>{h || `col ${i + 1}`}</option>)}
                  </select>
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                <span style={{ fontSize: 13, whiteSpace: 'nowrap' }} title="Optional: additionally add every imported contact to this group. Rows with a mapped Group column also join that group.">Add all to</span>
                <select value={groupId} onChange={(e) => setGroupId(e.target.value)} style={{ width: '100%' }}>
                  <option value="">— no extra group —</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
            </div>
          </>
        )}
        {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-green" onClick={doImport} disabled={busy || !rows.length || (map.name ?? -1) < 0 && (map.phone ?? -1) < 0}>{busy ? 'Importing…' : `Import ${rows.length || ''}`}</button>
        </div>
      </div>
    </div>
  );
}

function FieldsManager({ fields, reload, onClose }: { fields: Field[]; reload: () => void; onClose: () => void }) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<'text' | 'number' | 'date' | 'select'>('text');
  const [options, setOptions] = useState('');
  const add = async () => {
    if (!label.trim()) return;
    await api('/custom-fields', { method: 'POST', body: JSON.stringify({ label: label.trim(), type, options: type === 'select' ? options.split(',').map((s) => s.trim()).filter(Boolean) : [] }) });
    setLabel(''); setOptions(''); setType('text'); reload();
  };
  const del = async (id: string) => { await api(`/custom-fields/${id}`, { method: 'DELETE' }); reload(); };
  return (
    <div className="confirm-overlay" onClick={onClose}>
      <div className="confirm-box" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <h3 style={{ margin: '0 0 4px' }}>Custom contact fields</h3>
          <button className="drawer-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Extra info you want to keep on contacts (e.g. Industry, Policy no.). Each field you add here shows up on every contact, carries onto campaign leads, and appears in call records.</p>

        {/* Existing fields */}
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em', color: 'var(--muted)', margin: '8px 0 6px' }}>Your fields</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          {fields.map((f) => (
            <div key={f.id} className="row" style={{ justifyContent: 'space-between', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8 }}>
              <span><b>{f.label}</b> <span className="muted" style={{ fontSize: 12 }}>· {f.type === 'select' ? `choices: ${(f.options || []).join(', ')}` : f.type}</span></span>
              <button className="icon-btn" title="Delete field" onClick={() => del(f.id)}><Trash2 size={14} /></button>
            </div>
          ))}
          {!fields.length && <span className="muted" style={{ fontSize: 13 }}>No custom fields yet. Add one below.</span>}
        </div>

        {/* Add a new field */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em', color: 'var(--muted)', marginBottom: 8 }}>Add a field</div>
          <div style={{ display: 'grid', gap: 10 }}>
            <label style={{ display: 'block' }}>
              <span className="muted" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Field name</span>
              <input placeholder="e.g. Industry" value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: '100%' }} />
            </label>
            <label style={{ display: 'block' }}>
              <span className="muted" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Type</span>
              <select value={type} onChange={(e) => setType(e.target.value as any)} style={{ width: '100%' }}>
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
                <option value="select">Dropdown (choose from a list)</option>
              </select>
            </label>
            {type === 'select' && (
              <label style={{ display: 'block' }}>
                <span className="muted" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Choices (comma-separated)</span>
                <input placeholder="e.g. Retail, Tech, Health" value={options} onChange={(e) => setOptions(e.target.value)} style={{ width: '100%' }} />
              </label>
            )}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-green" onClick={add} disabled={!label.trim()}>+ Add field</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) { return <th style={{ textAlign: 'left', padding: '9px 12px', fontSize: 12, color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{children}</th>; }
function Td({ children, colSpan }: { children?: React.ReactNode; colSpan?: number }) { return <td colSpan={colSpan} style={{ padding: '9px 12px', fontSize: 13, borderBottom: '1px solid #f0f1f3' }}>{children}</td>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><span className="muted" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>{label}</span>{children}</label>;
}
