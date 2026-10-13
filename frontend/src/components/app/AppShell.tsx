'use client';

import type { ReactNode } from 'react';
import MainNav, { type NavUser } from './MainNav';

interface AppShellProps {
  user: NavUser | null;
  onLogout: () => void;
  children: ReactNode;
}

export default function AppShell({
  user,
  onLogout,
  children,
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <MainNav user={user} onLogout={onLogout} />
      {children}
    </div>
  );
}
