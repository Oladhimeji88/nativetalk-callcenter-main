'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getUser, landingPath } from '@/lib/api';

// Auth-aware landing: signed-out → login; otherwise the first module the user's
// permissions grant.
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    if (!getUser()) return router.replace('/login');
    router.replace(landingPath());
  }, [router]);
  return null;
}
