'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, LogOut } from 'lucide-react';
import { getImpersonation, setImpersonation, type Impersonation } from '@/lib/api';

// Shown across the top of a customer workspace while platform staff are viewing
// it as the customer. It has to be impossible to miss: support looking at real
// customer data should never forget whose data it is.
export default function ImpersonationBar() {
  const router = useRouter();
  const [imp, setImp] = useState<Impersonation | null>(null);

  useEffect(() => { setImp(getImpersonation()); }, []);

  if (!imp) return null;

  const exit = () => {
    setImpersonation(null);
    router.replace('/platform/tenants');
    // Full reload so every cached profile read picks up the staff identity again.
    setTimeout(() => window.location.assign('/platform/tenants'), 0);
  };

  return (
    <div className="impbar">
      <Eye size={15} />
      <span>
        Viewing <b>{imp.tenantName}</b> as their administrator. Actions you take here affect the customer&apos;s live workspace.
      </span>
      <button onClick={exit}><LogOut size={14} /> Return to console</button>
    </div>
  );
}
