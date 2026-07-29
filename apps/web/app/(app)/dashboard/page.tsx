'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getUser, hasPermission, isPlatformStaff, isImpersonating } from '@/lib/api';
import AdminDashboard from './AdminDashboard';
import OpsDashboard from './OpsDashboard';
import AgentDashboard from './AgentDashboard';

type View = 'admin' | 'ops' | 'agent';

// One route, three dashboards. Which one you get follows from what your role can
// actually do, so nobody lands on a screen full of numbers they can't act on:
//
//   admin  — runs the workspace (users + billing): seats, spend, limits, health
//   ops    — runs the floor (analytics): live calls, queues, agents, campaigns
//   agent  — runs their own day: their calls, goal, callbacks, outcomes
//
// Platform staff don't belong in a workspace at all and are sent to the console.
export default function DashboardPage() {
  const router = useRouter();
  const [view, setView] = useState<View | null>(null);

  useEffect(() => {
    if (!getUser()) { router.replace('/login'); return; }
    if (isPlatformStaff() && !isImpersonating()) { router.replace('/platform'); return; }
    if (hasPermission('users') && hasPermission('billing')) setView('admin');
    else if (hasPermission('analytics')) setView('ops');
    else setView('agent');
  }, [router]);

  if (!view) return null;
  if (view === 'admin') return <AdminDashboard />;
  if (view === 'ops') return <OpsDashboard />;
  return <AgentDashboard />;
}
