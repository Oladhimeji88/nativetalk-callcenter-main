'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, PhoneMissed, Users, Megaphone, Receipt, CheckCheck, Voicemail } from 'lucide-react';
import { api, hasPermission } from '@/lib/api';

type Kind = 'missed' | 'queue' | 'campaign' | 'billing' | 'recording';

type Note = {
  id: string;
  kind: Kind;
  title: string;
  body: string;
  at: string;   // ISO
  href: string; // where clicking it takes you
};

const META: Record<Kind, { Icon: React.ComponentType<{ size?: number }>; cls: string }> = {
  missed:    { Icon: PhoneMissed, cls: 'note-red' },
  queue:     { Icon: Users,       cls: 'note-amber' },
  campaign:  { Icon: Megaphone,   cls: 'note-green' },
  billing:   { Icon: Receipt,     cls: 'note-blue' },
  recording: { Icon: Voicemail,   cls: 'note-slate' },
};

const READ_KEY = 'nt_read_notifications';
const readIds = (): string[] => {
  try { return JSON.parse(localStorage.getItem(READ_KEY) ?? '[]'); } catch { return []; }
};

function ago(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

// Notifications are derived from data the app already exposes — missed calls,
// queue pressure, campaign state, unpaid invoices — so there's no separate feed
// to keep in sync. Each source is gated by the permission that owns it, so an
// agent never triggers a request their role can't make.
async function collect(): Promise<Note[]> {
  const out: Note[] = [];

  const [logs, queues, campaigns, invoices] = await Promise.all([
    hasPermission('call_logs') ? api<any[]>('/call-logs?limit=40').catch(() => []) : Promise.resolve([]),
    hasPermission('queues') ? api<any[]>('/pbx/queues').catch(() => []) : Promise.resolve([]),
    hasPermission('campaigns') ? api<any[]>('/campaigns/overview').catch(() => []) : Promise.resolve([]),
    hasPermission('billing') ? api<any[]>('/billing/invoices').catch(() => []) : Promise.resolve([]),
  ]);

  for (const c of (logs ?? []).filter((l) => l.status === 'missed' || l.status === 'no-answer').slice(0, 6)) {
    out.push({
      id: `missed_${c.id}`,
      kind: 'missed',
      title: c.status === 'missed' ? 'Missed call' : 'Call not answered',
      body: `${c.contactName || c.peerNumber}${c.agentName ? ` · ${c.agentName}` : ''}`,
      at: c.startedAt,
      href: '/call-logs',
    });
  }

  for (const q of (queues ?? []).map((r: any) => r?.data ?? r)) {
    const health = String(q?.health ?? '').toLowerCase();
    if (health !== 'overloaded' && health !== 'busy') continue;
    out.push({
      id: `queue_${q.id}_${health}`,
      kind: 'queue',
      title: health === 'overloaded' ? `${q.name} queue is overloaded` : `${q.name} queue is busy`,
      body: `${q.waiting ?? 0} waiting · avg wait ${Math.round((q.avgWaitSec ?? 0) / 60)}m ${Math.round((q.avgWaitSec ?? 0) % 60)}s`,
      at: new Date(Date.now() - 4 * 60_000).toISOString(),
      href: '/queues',
    });
  }

  for (const c of (campaigns ?? []).slice(0, 8)) {
    if (c.active && (c.contactRate ?? 0) >= 60) {
      out.push({
        id: `camp_goal_${c.id}`,
        kind: 'campaign',
        title: `${c.name} is ahead of target`,
        body: `${c.contactRate}% contact rate across ${c.contactsCount ?? 0} leads`,
        at: new Date(Date.now() - 42 * 60_000).toISOString(),
        href: '/campaigns',
      });
    } else if (!c.active) {
      out.push({
        id: `camp_paused_${c.id}`,
        kind: 'campaign',
        title: `${c.name} is paused`,
        body: 'No numbers are being dialled while it stays paused.',
        at: new Date(Date.now() - 3 * 3600_000).toISOString(),
        href: '/campaigns',
      });
    }
    if ((c.abandonRate ?? 0) > 5) {
      out.push({
        id: `camp_aban_${c.id}`,
        kind: 'queue',
        title: `High abandon rate on ${c.name}`,
        body: `${c.abandonRate}% of answered calls never reached an agent.`,
        at: new Date(Date.now() - 26 * 60_000).toISOString(),
        href: '/campaigns',
      });
    }
  }

  for (const i of (invoices ?? []).filter((x) => x.status === 'open').slice(0, 3)) {
    out.push({
      id: `inv_${i.id}`,
      kind: 'billing',
      title: 'Invoice awaiting payment',
      body: `${i.currency} ${((i.amount ?? 0) / 100).toLocaleString()} · issued ${new Date(i.createdAt).toLocaleDateString()}`,
      at: i.createdAt,
      href: '/billing',
    });
  }

  return out.sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 12);
}

export default function Notifications() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [read, setRead] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRead(readIds());
    let alive = true;
    const load = () => collect().then((n) => { if (alive) { setNotes(n); setLoading(false); } });
    load();
    const t = setInterval(load, 45_000); // refresh quietly in the background
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const unread = useMemo(() => notes.filter((n) => !read.includes(n.id)), [notes, read]);

  const persist = (ids: string[]) => {
    setRead(ids);
    try { localStorage.setItem(READ_KEY, JSON.stringify(ids.slice(-300))); } catch { /* ignore */ }
  };
  const markAll = () => persist([...new Set([...read, ...notes.map((n) => n.id)])]);
  const openNote = (n: Note) => {
    persist([...new Set([...read, n.id])]);
    setOpen(false);
    router.push(n.href);
  };

  return (
    <div className="notif" ref={popRef}>
      <button
        className="topbar-icon"
        aria-label={unread.length ? `Notifications, ${unread.length} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={19} />
        {unread.length > 0 && <span className="topbar-badge">{unread.length > 9 ? '9+' : unread.length}</span>}
      </button>

      {open && (
        <div className="notif-pop" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <div>
              <div className="notif-title">Notifications</div>
              <div className="notif-sub">
                {loading ? 'Checking…' : unread.length ? `${unread.length} unread` : 'You are all caught up'}
              </div>
            </div>
            {unread.length > 0 && (
              <button className="notif-mark" onClick={markAll}>
                <CheckCheck size={14} /> Mark all read
              </button>
            )}
          </div>

          <div className="notif-list">
            {loading && <div className="notif-empty">Loading activity…</div>}

            {!loading && !notes.length && (
              <div className="notif-empty">
                <Bell size={22} />
                <p>Nothing needs your attention</p>
                <span>Missed calls, queue pressure and campaign alerts show up here.</span>
              </div>
            )}

            {!loading && notes.map((n) => {
              const { Icon, cls } = META[n.kind];
              const isUnread = !read.includes(n.id);
              return (
                <button key={n.id} className={`notif-item ${isUnread ? 'is-unread' : ''}`} onClick={() => openNote(n)}>
                  <span className={`notif-icon ${cls}`}><Icon size={15} /></span>
                  <span className="notif-body">
                    <span className="notif-item-title">{n.title}</span>
                    <span className="notif-item-desc">{n.body}</span>
                    <span className="notif-time">{ago(n.at)}</span>
                  </span>
                  {isUnread && <span className="notif-dot" aria-hidden />}
                </button>
              );
            })}
          </div>

          {!loading && notes.length > 0 && (
            <button className="notif-foot" onClick={() => { setOpen(false); router.push('/call-logs'); }}>
              View all call activity
            </button>
          )}
        </div>
      )}
    </div>
  );
}
