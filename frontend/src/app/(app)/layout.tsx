'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/app/AppShell';
import { SessionProvider, useSession } from '@/lib/session-context';

function AppChrome({ children, onLogout }: { children: React.ReactNode; onLogout: () => void }) {
  const { user } = useSession();
  if (!user) {
    return <div className="min-h-screen grid place-items-center text-sm text-slate-500">正在验证登录状态…</div>;
  }
  return (
    <AppShell user={user} onLogout={onLogout}>
      {children}
    </AppShell>
  );
}

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
  }, [router]);

  return (
    <SessionProvider>
      <AppChrome onLogout={logout}>{children}</AppChrome>
    </SessionProvider>
  );
}
