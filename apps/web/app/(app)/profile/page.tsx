'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ShieldCheck, Mail, Phone, Building2 } from 'lucide-react';
import { getUser, logout } from '@/lib/api';

// Account page reached from the topbar avatar menu. Profile details come from
// the cached sign-in profile; permissions are read-only (an admin changes them
// in Roles).
export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const u = getUser();
    if (!u) { router.replace('/login'); return; }
    setUser(u);
  }, [router]);

  if (!user) return null;

  const name = user.name || user.email || 'Agent';
  const initials = name.trim().split(/\s+/).slice(0, 2).map((p: string) => p[0]).join('').toUpperCase();
  const perms = Object.entries(user.permissions ?? {}).filter(([, v]: any) => v?.enabled).map(([k]) => k);

  return (
    <div className="agent-page">
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Profile</h1>
      <p className="muted" style={{ margin: '4px 0 0' }}>Your account details and what your role gives you access to.</p>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="row" style={{ gap: 16, alignItems: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#e8f5e9', color: '#15803d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700 }}>
            {initials}
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{name}</div>
            <span className="role-pill" style={{ marginTop: 6, display: 'inline-flex' }}>
              <ShieldCheck size={15} /> {(user.superAdmin ? 'Platform Admin' : user.roleName || 'Member').toUpperCase()}
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 2, marginTop: 22 }}>
          <Row Icon={Mail} label="Email" value={user.email} />
          <Row Icon={Phone} label="Extension" value={user.agentExtension || 'Not assigned'} />
          <Row Icon={Building2} label="Workspace" value={user.tenant || '—'} />
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ margin: '0 0 4px' }}>Access</h3>
        <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
          Granted by your role. Ask an admin to change it in <b>Roles</b>.
        </p>
        {perms.length
          ? <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{perms.map((p) => <span key={p} className="tag">{p.replace(/_/g, ' ')}</span>)}</div>
          : <span className="muted">No modules enabled.</span>}
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 18, gap: 8 }}>
        <button className="btn btn-ghost" onClick={() => toast.info('Password changes are handled by your administrator.')}>Change password</button>
        <button className="btn" onClick={() => logout().then(() => router.replace('/login'))}>Sign out</button>
      </div>
    </div>
  );
}

function Row({ Icon, label, value }: { Icon: React.ComponentType<{ size?: number }>; label: string; value: string }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', padding: '11px 0', borderTop: '1px solid #f0f1f3' }}>
      <span className="row muted" style={{ gap: 8 }}><Icon size={16} />{label}</span>
      <b style={{ fontSize: 14 }}>{value}</b>
    </div>
  );
}
