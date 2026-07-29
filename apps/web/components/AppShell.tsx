'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getUser } from '@/lib/api';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile drawer
  const [collapsed, setCollapsed] = useState(false);      // desktop collapse

  // Client-side auth guard — no profile means signed out.
  useEffect(() => {
    if (!getUser()) router.replace('/login');
    else setReady(true);
  }, [router]);

  // Toggle: mobile opens the drawer, desktop collapses the rail.
  const toggle = () => {
    if (typeof window !== 'undefined' && window.innerWidth <= 900) setSidebarOpen((v) => !v);
    else setCollapsed((v) => !v);
  };

  if (!ready) return null;

  return (
    <div className={`shell ${collapsed ? 'shell-collapsed' : ''}`}>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="shell-main">
        <Topbar onToggle={toggle} />
        <main className="shell-content">{children}</main>
      </div>
    </div>
  );
}
