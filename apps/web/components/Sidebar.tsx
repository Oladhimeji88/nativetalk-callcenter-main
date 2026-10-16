'use client';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { UserCog, ShieldCheck, Cable, X } from 'lucide-react';
import {
  DashboardIcon, AgentWorkspaceIcon, QueuesIcon,
  AgentsIcon, RecordingsIcon, CallLogsIcon, CampaignsIcon, ContactsIcon,
  DispositionIcon,
} from './icons';
import { hasPermission, refreshProfile } from '@/lib/api';

type Item = { href: string; label: string; Icon: React.ComponentType<{ size?: number }>; perm?: string };
type Section = { label: string; items: Item[] };

// Sidebar sections — structure & order match Figma.
// roles omitted = supervisor + admin only.
const SECTIONS: Section[] = [
  {
    label: 'Main',
    items: [
      // Everyone gets a dashboard — the page picks the right one for the role.
      { href: '/dashboard',  label: 'Dashboard',    Icon: DashboardIcon },
      { href: '/agent',      label: 'Call Console', Icon: AgentWorkspaceIcon, perm: 'softphone' },
    ],
  },
  {
    label: 'Contact Center',
    items: [
      { href: '/queues',     label: 'Queues',        Icon: QueuesIcon, perm: 'queues' },
      { href: '/agents',     label: 'Agents Status', Icon: AgentsIcon, perm: 'live' },
      { href: '/recordings', label: 'Recordings',    Icon: RecordingsIcon, perm: 'recordings' },
    ],
  },
  {
    label: 'Campaigns',
    items: [
      { href: '/campaigns',    label: 'All Campaigns',      Icon: CampaignsIcon, perm: 'campaigns' },
      { href: '/contacts',     label: 'Contacts',           Icon: ContactsIcon, perm: 'contacts' },
      { href: '/dispositions', label: 'Dispositions',       Icon: DispositionIcon, perm: 'campaigns' },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { href: '/call-logs',  label: 'Call Logs',   Icon: CallLogsIcon, perm: 'call_logs' },
    ],
  },
];

// Administration section appended at the bottom (icons not in the Figma set — using lucide).
const ADMIN_GROUP: Item[] = [
  { href: '/users',  label: 'Users',  Icon: ({ size }) => <UserCog size={size} />,     perm: 'users' },
  { href: '/roles',  label: 'Roles',  Icon: ({ size }) => <ShieldCheck size={size} />, perm: 'users' },
  { href: '/trunks', label: 'Trunks', Icon: ({ size }) => <Cable size={size} />,        perm: 'pbx' },
];

function initials(name?: string) {
  if (!name) return '--';
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || name[0].toUpperCase();
}

// Permission-first: an item shows only if the user's role grants its permission
// (admins pass hasPermission automatically). No tier special-casing.
function visible(items: Item[]) {
  return items.filter((i) => !i.perm || hasPermission(i.perm));
}

export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const path = usePathname();
  const [sections, setSections] = useState<Section[]>([]);

  const computeSections = () => {
    // Every item is gated by its permission — for all roles.
    const filtered = SECTIONS
      .map((s) => ({ ...s, items: visible(s.items) }))
      .filter((s) => s.items.length > 0);

    const admin = visible(ADMIN_GROUP);
    if (admin.length) filtered.push({ label: 'Administration', items: admin });
    // Platform staff work in the Platform Console, which has its own shell —
    // this sidebar only ever shows one company's workspace.
    setSections(filtered);
  };

  useEffect(() => {
    computeSections(); // render immediately from the cached profile
    // Then pull fresh role/permissions; if an admin changed them, reload so the
    // whole app (nav, guards, badge) reflects it without a full logout. Re-checks
    // on navigation too, so a change applies without a manual refresh.
    refreshProfile().then((changed) => { if (changed) window.location.reload(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const renderItem = ({ href, label, Icon }: Item) => {
    const active = path === href || path.startsWith(href + '/');
    return (
      <Link key={href} href={href} onClick={onClose} className={`nav-item ${active ? 'nav-item-active' : ''}`}>
        <Icon size={18} />
        <span>{label}</span>
      </Link>
    );
  };

  return (
    <>
      {open && <div onClick={onClose} className="sidebar-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 30 }} />}

      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px 18px' }}>
          <Link href="/"><Image src="/nativetalk-logo.svg" alt="NativeTalk Cloud PBX" width={104} height={51} priority /></Link>
          <button onClick={onClose} className="sidebar-close" aria-label="Close menu"><X size={20} /></button>
        </div>

        {/* Scrollable nav region */}
        <div className="sidebar-scroll">
          {sections.map((section) => (
            <div key={section.label}>
              <div className="sidebar-section-label">{section.label}</div>
              <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {section.items.map(renderItem)}
              </nav>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
