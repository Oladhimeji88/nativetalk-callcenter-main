'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PanelLeft, ChevronDown, LogOut, User, ShieldCheck } from 'lucide-react';
import { logout, getUser } from '@/lib/api';
import { useCall } from './CallProvider';
import Notifications from './Notifications';

function initials(name?: string) {
  if (!name) return '--';
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || name[0].toUpperCase();
}

// Timezone → display helpers (auto-detected from the browser). Falls back to the
// tz city + Intl short name for anywhere not in the map.
const TZ_ABBR: Record<string, string> = {
  'Africa/Lagos': 'WAT', 'Africa/Accra': 'GMT', 'Africa/Nairobi': 'EAT',
  'Africa/Johannesburg': 'SAST', 'Africa/Cairo': 'EET',
};
const TZ_PLACE: Record<string, string> = {
  'Africa/Lagos': 'Lagos, Nigeria', 'Africa/Accra': 'Accra, Ghana', 'Africa/Nairobi': 'Nairobi, Kenya',
  'Africa/Johannesburg': 'Johannesburg, SA', 'Africa/Cairo': 'Cairo, Egypt',
};

export default function Topbar({ onToggle }: { onToggle: () => void }) {
  const router = useRouter();
  const { phase, reconnecting, wrapUp } = useCall();
  const [user, setUser] = useState<any>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [clock, setClock] = useState('');
  const [place, setPlace] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setUser(getUser()); }, []);

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setPlace(TZ_PLACE[tz] || tz.split('/').pop()?.replace(/_/g, ' ') || '');
    const tick = () => {
      const d = new Date();
      const t = d.toLocaleTimeString('en-GB', { hour12: false });
      const abbr = TZ_ABBR[tz]
        || new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value
        || '';
      setClock(`${t} ${abbr}`.trim());
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    if (menuOpen) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const name = user?.name || user?.email || '';
  // Show the account's actual role (permission group) name, e.g. "Supervisor" / "test".
  const roleLabel = user?.superAdmin ? 'Platform Admin' : (user?.roleName || 'Member');

  // Live agent call-status badge (from the global softphone state).
  const status =
      phase === 'incall'    ? { text: 'ON CALL', cls: 'live' }
    : phase === 'incoming'  ? { text: 'INCOMING CALL', cls: 'live' }
    : phase === 'outgoing'  ? { text: 'CALLING…', cls: 'warn' }
    : wrapUp                ? { text: 'ACTIVE CALL: Wrap-Up', cls: 'wrap' }
    : reconnecting          ? { text: 'RECONNECTING…', cls: 'warn' }
    : phase === 'registered'? { text: 'AVAILABLE', cls: 'ok' }
    : null;

  return (
    <header className="topbar">
      <button onClick={onToggle} className="topbar-toggle" aria-label="Toggle sidebar"><PanelLeft size={20} /></button>

      {status && (
        <span className={`call-status ${status.cls}`}><span className="dot" /> {status.text}</span>
      )}

      <div className="topbar-right">
        {clock && (
          <div className="topbar-clock">
            <div className="topbar-clock-time">{clock}</div>
            {place && <div className="topbar-clock-place">{place}</div>}
          </div>
        )}

        <span className="role-pill"><ShieldCheck size={15} /> {roleLabel.toUpperCase()}</span>

        <Notifications />

        <div className="topbar-user" ref={menuRef}>
          <button className="topbar-user-btn" onClick={() => setMenuOpen((v) => !v)}>
            <div className="topbar-avatar">{initials(name)}</div>
            <div className="topbar-user-meta">
              <div className="topbar-user-name">{name}</div>
              <div className="topbar-user-role">{user?.email}</div>
            </div>
            <ChevronDown size={16} />
          </button>

          {menuOpen && (
            <div className="card topbar-menu-pop">
              <button className="nav-item" style={{ width: '100%', border: 'none', background: 'none', cursor: 'pointer' }} onClick={() => { setMenuOpen(false); router.push('/profile'); }}>
                <User size={18} /><span>Profile</span>
              </button>
              <button className="nav-item" style={{ width: '100%', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--red)' }} onClick={() => logout().then(() => router.replace('/login'))}>
                <LogOut size={18} /><span>Sign out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
