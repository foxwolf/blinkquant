'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { NavUser } from '@/components/app/MainNav';

const SessionContext = createContext<{ user: NavUser | null }>({ user: null });

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<NavUser | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch('/api/auth/session', { cache: 'no-store' });
        const json = await res.json();
        if (!mounted) return;
        if (json.user) setUser(json.user);
        else router.replace('/login');
      } catch {
        if (mounted) router.replace('/login');
      }
    })();
    return () => { mounted = false; };
  }, [router]);

  return <SessionContext.Provider value={{ user }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
