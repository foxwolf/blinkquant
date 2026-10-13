# Session 收敛实施计划（refactor/session-context）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 客户端 session 获取收敛到 `(app)` 路由组 layout 单点（SessionProvider），删除 9 处页面/组件重复样板与重复请求。

**Architecture:** 新建 `src/lib/session-context.tsx`（Provider + `useSession()`，仅暴露引用稳定的 `user`）；`(app)/layout.tsx` 在 `user === null` 时渲染验证占位（children 不挂载，守卫语义不变）；9 个迁移点删自带 fetch/state/重定向/loading 门；IA4 脚本加"session fetch 仅限 context 文件"守卫。

**Tech Stack:** Next.js 14 App Router、React context、现有 `scripts/check-ia4-routes.mjs` 守卫、`node --test` 套件、`next build`。

**Spec:** `docs/superpowers/specs/2026-10-13-session-context-design.md`

---

### Task 1: SessionProvider 与 layout 改造

**Files:**
- Create: `frontend/src/lib/session-context.tsx`
- Modify: `frontend/src/app/(app)/layout.tsx`

- [ ] **Step 1: 创建 context 文件（完整内容）**

```tsx
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
```

- [ ] **Step 2: 重写 layout（完整内容；守卫= `user === null` 时渲染占位，children 不挂载；logout 不进 context）**

`frontend/src/app/(app)/layout.tsx` 全文替换为：

```tsx
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
```

- [ ] **Step 3: 验证**

Run（workdir `frontend`）: `node scripts/check-ia4-routes.mjs`（期望 PASS；此时旧页面各自 fetch 仍在，不违反新守卫——守卫在 Task 4 才加入）; `npm run build`（期望 Compiled successfully）

- [ ] **Step 4: Commit**

```bash
git add src/lib/session-context.tsx 'src/app/(app)/layout.tsx'
git commit -m "feat: add shared session provider for the (app) group"
```

---

### Task 2: 迁移 4 个页面

**Files:**
- Modify: `frontend/src/app/(app)/backtests/page.tsx`、`strategies/page.tsx`、`system/page.tsx`、`watchlists/page.tsx`

统一模式：删本地 `interface User`、`const [user, setUser]`、`const [authLoading, ...]`、session `useEffect`、渲染头的 `if (authLoading…)` 门；新增 `import { useSession } from '@/lib/session-context';` 与 `const { user } = useSession();`。`user` 在效果中仍作依赖/条件（引用稳定，行为不变）。`useRouter` 仅在无其他用途时删除。

- [ ] **Step 1: backtests/page.tsx**
  - 删 `import { useRouter }`（第 4 行；无其他 router 用途）与 `const router = useRouter();`
  - 删 `interface User {...}`（11-15）、`useState` user/authLoading（19-20）、session `useEffect`（29-47）、`if (authLoading || !user) return <div>正在加载…</div>`（49-51）
  - 组件体内加 `const { user } = useSession();`（`useBacktest` 调用之前）

- [ ] **Step 2: strategies/page.tsx**
  - 删 `interface User`（9）、user/authLoading state（24-25）、session `useEffect`（35-47）、第 167 行 `if (authLoading) return <main…spinner…>;` 门
  - 加 `useSession` import + `const { user } = useSession();`；保留 `useRouter`（88/128/135 仍用）

- [ ] **Step 3: system/page.tsx**
  - 删 `import { useRouter }`（5）与 `const router = useRouter();`（94；无其他用途）
  - 删 `interface User`（9）、user/authLoading state（95-96）、session `useEffect`（104-120）、`if (authLoading) {…}` 门（160-162）
  - 加 `const { user } = useSession();`；`usePolling(..., { enabled: !!user })` 与 `[user, refresh]` 效果不变

- [ ] **Step 4: watchlists/page.tsx**
  - 删 `interface User`（8）、user/authLoading state（17-18）、session `useEffect`（24-36）、第 88 行 `if (authLoading) return …` 门
  - 加 `const { user } = useSession();`；保留 `useRouter`（83 仍用）

- [ ] **Step 5: 验证 + Commit**

Run: `node scripts/check-ia4-routes.mjs`（PASS）; `npm run build`（成功）

```bash
git add 'src/app/(app)/backtests/page.tsx' 'src/app/(app)/strategies/page.tsx' 'src/app/(app)/system/page.tsx' 'src/app/(app)/watchlists/page.tsx'
git commit -m "refactor: migrate app pages to the shared session hook"
```

---

### Task 3: 迁移 5 个组件

**Files:**
- Modify: `frontend/src/components/artifacts/ArtifactDetailPage.tsx`、`artifacts/ArtifactLibraryPage.tsx`、`select/SelectionWorkspace.tsx`、`stocks/StockResearchPage.tsx`、`tasks/TaskCenterPage.tsx`

模式同 Task 2；组件渲染头原 `if (authLoading) { return spinner }` 门改为防御性 `if (!user) return null;`（children 只会在 user 就绪后挂载，此为保险）。

- [ ] **Step 1: ArtifactDetailPage.tsx**
  - 删 user/authLoading state（25-26）、session `useEffect`（34-52）、第 109 行 `if (authLoading) {…}` 门（替换为 `if (!user) return null;`）
  - 加 `const { user } = useSession();`；保留 `useRouter`（141/169 仍用）；两个 `[user, …]` 效果不变

- [ ] **Step 2: ArtifactLibraryPage.tsx**
  - 删 `import { useRouter }`（5）与 `const router = useRouter();`（41；无其他用途）
  - 删 user/authLoading state（43-44）、session `useEffect`（90-108）、第 152 行门（改 `if (!user) return null;`）
  - 加 `const { user } = useSession();`；`usePolling enabled: !!user` 不变

- [ ] **Step 3: SelectionWorkspace.tsx**
  - 删 user/authLoading state（17-18）、session `useEffect`（20-40）、第 198 行门（改 `if (!user) return null;`）
  - 加 `const { user } = useSession();`；保留 `useRouter`（142 仍用）

- [ ] **Step 4: StockResearchPage.tsx**
  - 删 user/authLoading state（38-39）、session `useEffect`（44-63，含 `loadSession` 包装）、第 82 行门（改 `if (!user) return null;`）
  - 加 `const { user } = useSession();`；保留 `useRouter`（97/110 仍用）

- [ ] **Step 5: TaskCenterPage.tsx**
  - 删 user/authLoading state（46-47）、session `useEffect`（79-97）、第 134 行门（改 `if (!user) return null;`）
  - 加 `const { user } = useSession();`；保留 `useRouter`（126 仍用）

- [ ] **Step 6: 验证 + Commit**

Run: `node scripts/check-ia4-routes.mjs`（PASS）; `npm run build`（成功）; 确认残留：`Select-String -Path (Get-ChildItem -Recurse -Include *.tsx -File src | % FullName) -Pattern "auth/session"` 仅 `src/lib/session-context.tsx`

```bash
git add src/components/artifacts/ArtifactDetailPage.tsx src/components/artifacts/ArtifactLibraryPage.tsx src/components/select/SelectionWorkspace.tsx src/components/stocks/StockResearchPage.tsx src/components/tasks/TaskCenterPage.tsx
git commit -m "refactor: migrate shared components to the session hook"
```

---

### Task 4: IA4 守卫 + 全量验证

**Files:**
- Modify: `frontend/scripts/check-ia4-routes.mjs`

- [ ] **Step 1: 在 intervalSites 守卫（约 101 行）之后插入**

```js
const sessionFetchSites = walkSource(resolve(root, 'src'))
  .filter((p) => readFileSync(p, 'utf8').includes("'/api/auth/session'"))
  .map(relative)
  .filter((p) => p !== 'src/lib/session-context.tsx');
assert.deepEqual(sessionFetchSites, [], `Session fetch must live only in src/lib/session-context.tsx, found: ${sessionFetchSites.join(', ')}`);

const sessionContextSrc = readFileSync(resolve(root, 'src/lib/session-context.tsx'), 'utf8');
assert.match(sessionContextSrc, /export function useSession/, 'Session context must expose useSession');
assert.match(sessionContextSrc, /SessionProvider/, 'Session context must export SessionProvider');
```

- [ ] **Step 2: 全量验证**

Run（workdir `frontend`）:
- `node scripts/check-ia4-routes.mjs` → PASS（新守卫不报任何文件）
- 全部 `node --test tests\*.test.mjs` → `# fail 0`
- `npm run build` → Compiled successfully

- [ ] **Step 3: Commit**

```bash
git add scripts/check-ia4-routes.mjs
git commit -m "test: guard session fetch against the shared context only"
```
