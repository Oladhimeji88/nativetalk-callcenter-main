'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Megaphone, Send, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useConfirm } from '@/components/ConfirmProvider';
import { PageHead, Panel, Chip, Empty, RequireCapability, day } from '@/components/platform/ui';

// Announcements — maintenance windows, releases, plan retirements. Broadcast to
// every customer or narrowed to one plan.
export default function AnnouncementsPage() {
  return (
    <RequireCapability cap="announcements.manage">
      <AnnouncementsInner />
    </RequireCapability>
  );
}

function AnnouncementsInner() {
  const confirm = useConfirm();
  const [rows, setRows] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);

  const load = async () => {
    setRows(await api('/platform/announcements').catch(() => []));
    setPlans(await api('/platform/plans').catch(() => []));
  };
  useEffect(() => { load(); }, []);

  const audienceLabel = (a: string) => {
    if (a === 'all') return 'All companies';
    const id = a.replace('plan:', '');
    return `${plans.find((p) => p.id === id)?.name ?? 'Plan'} customers`;
  };

  const publish = async (a: any) => {
    const ok = await confirm({
      title: `Publish "${a.title}"?`,
      message: `This becomes visible to ${audienceLabel(a.audience).toLowerCase()} straight away.`,
      confirmLabel: 'Publish now',
    });
    if (!ok) return;
    try {
      await api(`/platform/announcements/${a.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'published', publishAt: new Date().toISOString() }) });
      toast.success('Published'); load();
    } catch { /* surfaced */ }
  };

  const remove = async (a: any) => {
    const ok = await confirm({ title: 'Delete this announcement?', message: a.title, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try { await api(`/platform/announcements/${a.id}`, { method: 'DELETE' }); toast.success('Deleted'); load(); }
    catch { /* surfaced */ }
  };

  return (
    <div className="ppage">
      <PageHead title="Announcements" sub="Notices shown to customers inside their workspace.">
        <button className="btn btn-green" onClick={() => setEditing({ audience: 'all' })}>+ New announcement</button>
      </PageHead>

      <div className="pann-list">
        {rows.map((a) => (
          <article key={a.id} className="pann">
            <div className="pann-head">
              <Megaphone size={16} />
              <h3>{a.title}</h3>
              <Chip value={a.status} />
            </div>
            <p>{a.body}</p>
            <footer>
              <span className="pcell-sub">
                {audienceLabel(a.audience)}
                {a.publishAt && ` · ${a.status === 'scheduled' ? 'scheduled for' : 'published'} ${day(a.publishAt)}`}
                {a.createdBy && ` · by ${a.createdBy}`}
              </span>
              <div className="prow-actions">
                {a.status !== 'published' && (
                  <button className="btn btn-sm btn-green" onClick={() => publish(a)}><Send size={13} /> Publish</button>
                )}
                <button className="btn btn-sm btn-danger-ghost" onClick={() => remove(a)}><Trash2 size={13} /></button>
              </div>
            </footer>
          </article>
        ))}
        {!rows.length && <Empty title="No announcements" sub="Tell customers about maintenance or new features." />}
      </div>

      {editing && <AnnouncementModal plans={plans} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function AnnouncementModal({ plans, onClose, onSaved }: { plans: any[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ title: '', body: '', audience: 'all' });
  const [err, setErr] = useState('');
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));

  const save = async () => {
    if (!f.title.trim() || !f.body.trim()) { setErr('A title and message are both required'); return; }
    try { await api('/platform/announcements', { method: 'POST', body: JSON.stringify(f) }); toast.success('Saved as draft'); onSaved(); }
    catch (e: any) { setErr(e.message || 'Could not save'); }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer">
        <header className="drawer-head">
          <h3>New announcement</h3>
          <button className="drawer-x" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </header>
        <div className="drawer-body">
          <div>
            <label htmlFor="an-title">Title</label>
            <input id="an-title" value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Scheduled maintenance on Sunday" />
          </div>
          <div>
            <label htmlFor="an-body">Message</label>
            <textarea id="an-body" rows={6} value={f.body} onChange={(e) => set('body', e.target.value)} placeholder="What is happening, when, and whether they need to do anything." />
          </div>
          <div>
            <label htmlFor="an-aud">Audience</label>
            <select id="an-aud" value={f.audience} onChange={(e) => set('audience', e.target.value)}>
              <option value="all">All companies</option>
              {plans.map((p) => <option key={p.id} value={`plan:${p.id}`}>{p.name} customers</option>)}
            </select>
          </div>
          <div className="pbanner">Saved as a draft. Nothing is sent until you publish it.</div>
          {err && <div className="err">{err}</div>}
          <div className="prow-end">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-green" onClick={save}>Save draft</button>
          </div>
        </div>
      </aside>
    </>
  );
}
