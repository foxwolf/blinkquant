# Session 收敛设计（refactor/session-context）

日期：2026-10-13
状态：已批准（方案 A）

## 目标

把客户端 session 获取从"每页各自 fetch"收敛为 `(app)` 路由组 layout 单点提供，删除 9 处重复样板（每处约 25 行：自带 interface、state、mounted 守卫、未登录重定向、loading 门），组内导航的 `/api/auth/session` 请求从每页 1 次降为 layout 挂载 1 次。

## 现状

- `src/app/(app)/layout.tsx` 已做登录守卫：fetch session、未登录 `router.replace('/login')`、loading 期间只渲染验证占位、把 `user` 传给 `AppShell`（MainNav 用 `role === 'admin'` 做菜单门控）。
- 另有 9 处各自 fetch `/api/auth/session`：`backtests|strategies|system|watchlists` 4 个 page，`ArtifactDetailPage`、`ArtifactLibraryPage`、`SelectionWorkspace`、`StockResearchPage`、`TaskCenterPage` 5 个组件。每处自带 `interface User { id; email; role }`、state、同样的 mounted 守卫与重定向。
- 客户端对 `user` 的消费只有两类：真值守卫（9 处全是）；MainNav 的 `role === 'admin'`（由 layout 经 AppShell 传入）。`user.id` 在客户端无消费。admin 页不用 session user（有自己的 403 与用户表逻辑）。

## 设计

### 1. `src/lib/session-context.tsx`（新建，client）

```tsx
'use client';
// SessionProvider: fetch('/api/auth/session', { cache: 'no-store' })
//   mounted 守卫；json.user 存入 state；无 user 时 router.replace('/login')
// useSession(): { user: NavUser | null }  // user 引用在 Provider 生命周期内稳定
```

- `NavUser` 复用 `@/components/app/MainNav` 的既有导出，不新建类型。
- Provider 只暴露 `user`；`logout` 留在 layout（仅 AppShell 需要），不进 context。
- fetch 失败（网络异常）与"无 user"同样重定向 /login——与现状 9 处行为一致。

### 2. `(app)/layout.tsx` 改造

- 守卫语义不变：layout 在 `user === null`（含加载中与已重定向）时渲染"正在验证登录状态…"占位，children 不挂载；user 就绪后才渲染 AppShell 树。
- `logout` 回调不变；`AppShell user={user}` 改为从 `useSession()` 取。

### 3. 9 处页面/组件迁移

删除各自的 interface、`useState`、session `useEffect`、重定向与 `authLoading` 门，替换为 `const { user } = useSession();`。效果依赖 `[user]` 的行为不变（user 为 null 时跳过、就绪后触发一次）。组件内 `if (!user) return null` 防御性保留（这些组件仅在 (app) 组内使用，实际不会遇到 null，但避免假设）。

### 4. CI 守卫（`scripts/check-ia4-routes.mjs` 扩展）

新增断言：`/api/auth/session` 字面量只允许出现在 `src/lib/session-context.tsx`（以及服务端注释允许清单按现状不设——现有唯一注释在 `api/backtest-strategy-templates/route.ts`，不匹配 fetch 模式则忽略）。实现方式沿用现有 walkSource + 简单字符串包含检查。

## 非目标

- 不引入 SWR/react-query（已评估：不引入）。
- 不新增 session 过期中段复查（现状挂载后也不复查；行为保持）。
- 不动 `/api/auth/session` 服务端实现、登录/注册页、admin 页。
- 不做多标签页同步（BroadcastChannel 等）——超出本次范围。

## 行为差异（可接受，已批准）

组内页面级"重复验证登录"消失。layout 已在 children 挂载前完成守卫，语义等价；每页重定向逻辑本就与 layout 重复。

## 验证

1. `node scripts/check-ia4-routes.mjs`（含新守卫）
2. `node --test tests/*.test.mjs` 全部通过
3. `next build` 编译成功
4. 手工核对：9 迁移文件中无残留 `auth/session` fetch（grep）
