'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Building2, Tags, Receipt, ShieldCheck, Server,
  ScrollText, Settings, LogOut, ChevronDown, X, PanelLeft, Megaphone,
} from 'lucide-react';
import {
  getUser, logout, getPlatformRole, canPlatform, isImpersonating,
  PLATFORM_ROLE_LABEL, type PlatformCapability,
} from '@/lib/api';

type Item = { href: string; label: string; Icon: React.ComponentType<{ size?: number }>; cap: PlatformCapability; hint: string };
type Group = { label: string; items: Item[] };

// The console is organised by what the work *is*, not by data model: who our
// customers are, what we charge them, and whether the platform is healthy.
const GROUPS: Group[] = [
  {
    label: 'Operations',
    items: [
      { href: '/platform', label: 'Overview', Icon: LayoutDashboard, cap: 'tenants.view', hint: 'Platform health at a glance' },
      { href: '/platform/tenants', label: 'Companies', Icon: Building2, cap: 'tenants.view', hint: 'Every customer workspace' },
    ],
  },
  {
    label: 'Commercial',
    items: [
      { href: '/platform/plans', label: 'Plans & Pricing', Icon: Tags, cap: 'plans.view', hint: 'What we sell' },
      { href: '/platform/billing', label: 'Revenue & Invoices', Icon: Receipt, cap: 'billing.view', hint: 'MRR, invoices, collections' },
    ],
  },
  {
    label: 'Platform',
    items: [
      { href: '/platform/infrastructure', label: 'Infrastructure', Icon: Server, cap: 'infrastructure.view', hint: 'Nodes, services, capacity' },
      { href: '/platform/announcements', label: 'Announcements', Icon: Megaphone, cap: 'announcements.manage', hint: 'Notices sent to customers' },
      { href: '/platform/audit', label: 'Audit Log', Icon: ScrollText, cap: 'audit.view', hint: 'Who changed what' },
    ],
  },
  {
    label: 'Governance',
    items: [
      { href: '/platform/staff', label: 'Platform Team', Icon: ShieldCheck, cap: 'staff.view', hint: 'Who has console access' },
      { href: '/platform/settings', label: 'Settings & Security', Icon: Settings, cap: 'settings.manage', hint: 'Signups, MFA, retention' },
    ],
  },
];

const initials = (name?: string) => {
  if (!name) return '--';
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase();
};

export default function PlatformShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [role, setRole] = useState<ReturnType<typeof getPlatformRole>>(null);
  const [open, setOpen] = useState(false);      // mobile drawer
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Console access is platform-staff only. Anyone else goes back to their own
  // workspace — including staff who are currently viewing a customer as them.
  useEffect(() => {
    const u = getUser();
    if (!u) { router.replace('/login'); return; }
    if (isImpersonating()) { router.replace('/dashboard'); return; }
    const r = getPlatformRole();
    if (!r) { router.replace('/dashboard'); return; }
    setUser(u); setRole(r); setReady(true);
  }, [router]);

  useEffect(() => { setOpen(false); }, [path]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  if (!ready) return null;

  const groups = GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => canPlatform(i.cap)) }))
    .filter((g) => g.items.length);

  const active = (href: string) => (href === '/platform' ? path === href : path.startsWith(href));
  const roleLabel = role ? PLATFORM_ROLE_LABEL[role] : '';

  return (
    <div className={`pconsole ${open ? 'pconsole-open' : ''}`}>
      {open && <div className="pconsole-backdrop" onClick={() => setOpen(false)} />}

      <aside className="pnav">
        <div className="pnav-brand">
          <Link href="/platform" className="pnav-logo">
            <Image src="/nativetalk-logo.svg" alt="NativeTalk" width={104} height={30} priority />
          </Link>
          <button className="pnav-close" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
        <div className="pnav-tag">Platform Console</div>

        <div className="pnav-scroll">
          {groups.map((g) => (
            <div key={g.label} className="pnav-group">
              <div className="pnav-group-label">{g.label}</div>
              {g.items.map(({ href, label, Icon, hint }) => (
                <Link key={href} href={href} title={hint} className={`pnav-item ${active(href) ? 'is-active' : ''}`}>
                  <Icon size={17} />
                  <span>{label}</span>
                </Link>
              ))}
            </div>
          ))}
        </div>

        {role === 'platform_admin' && (
          <div className="pnav-note">
            Pricing, infrastructure controls and staff access are reserved for Super Admins.
          </div>
        )}
      </aside>

      <div className="pconsole-main">
        <header className="ptopbar">
          <button className="ptopbar-toggle" onClick={() => setOpen(true)} aria-label="Open menu"><PanelLeft size={18} /></button>
          <span className="penv-badge" title="You are working above every customer workspace">
            <span className="dot" /> Control plane · Production
          </span>

          <div className="ptopbar-right" ref={menuRef}>
            <span className={`prole-pill ${role === 'super_admin' ? 'is-super' : ''}`}>
              <ShieldCheck size={14} /> {roleLabel}
            </span>
            <button className="ptopbar-user" onClick={() => setMenuOpen((v) => !v)}>
              <span className="ptopbar-avatar">{initials(user?.name)}</span>
              <span className="ptopbar-meta">
                <span className="ptopbar-name">{user?.name}</span>
                <span className="ptopbar-mail">{user?.email}</span>
              </span>
              <ChevronDown size={15} />
            </button>
            {menuOpen && (
              <div className="ptopbar-menu">
                <div className="ptopbar-menu-head">
                  <div className="ptopbar-name">{user?.name}</div>
                  <div className="ptopbar-mail">{roleLabel}</div>
                </div>
                <button className="ptopbar-menu-item danger" onClick={() => logout().then(() => router.replace('/login'))}>
                  <LogOut size={16} /> Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="pconsole-content">{children}</main>
      </div>
    </div>
  );
}
