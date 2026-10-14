# 股票研究并入选股页设计

日期：2026-10-14
状态：已批准（用户确认：留在选股页内 + /stocks 重定向）

## 目标

把股票研究 UI 收敛到选股页 `/select` 一处：移除"股票研究"导航项；选股结果的"查看股票"改为在页内嵌面板展示（不跳页）；`/stocks` 与 `/stocks/[symbol]` 改为重定向桩，深链（自选股页、成果详情、旧书签）落到 `/select` 并自动打开对应股票图表。

## 现状

- `/select`（SelectionWorkspace）已内嵌 `StockResearchPanel`（246 行），功能为独立页的超集：StockSearch 搜索、行业/概念/地域板块 chips、关键指标（PE TTM/总市值/流通市值/成交额/换手率/成交量）、WatchlistPicker、复权（none/qfq/hfq）、周期 D/W/M、浏览器原生全屏（`useStockResearch.toggleFullscreen` → `requestFullscreen(chartWrapperRef)`）。
- 独立 `StockResearchPage`（178 行）= 搜索框 + 620px 大图 + 同样的板块/自选/复权/周期控件，无新增功能，仅提供独立 URL 与更大布局。
- 指向独立页的入口共 4 处：
  1. `MainNav.tsx:21` 导航项 `股票研究 → /stocks`
  2. `SelectionWorkspace.tsx:121` "查看股票" → `router.push('/stocks/' + code)`
  3. `watchlists/[watchlistId]/page.tsx:124` 深链 → `/stocks/[code]`
  4. `components/artifacts/ArtifactDetailPage.tsx:222` 深链 → `/stocks/[code]`
- `scripts/check-ia4-routes.mjs` 断言 8 个导航项（含 股票研究）、`/stocks` 与 `/stocks/[symbol]` 两个路由文件存在（routeFiles 共 21 条）、结尾文案 "8 enabled navigation items"。
- 重定向桩先例：`(app)/watchlist/page.tsx` 的 `redirect('/watchlists')`（gate 第 45 行同款断言模式）。

## 设计

### 1. `src/components/select/SelectionWorkspace.tsx`

- `handleViewStock(code)`（现 `:121`）：删除 `router.push('/stocks/' + ...)`，改为直接 `viewStock(code)`，在页内嵌面板展示；需要大屏时用面板既有的"全屏"按钮（浏览器原生全屏，逻辑不变）。
- 新增 URL 参数 effect：`useEffect` 读 `router.query.code`；当 `stockList.length > 0` 且 code 非空时 `viewStock(decodeURIComponent(String(code)))`，随后 `router.replace('/select', { scroll: false })` 清理 URL。用 `router.query` + effect（与 /stocks 页现有 `params.symbol` effect 同模式），避免 `useSearchParams()` 在静态预渲染页要求 Suspense 边界。
- effect 依赖 `[router.query.code, stockList.length, viewStock]`；`router.replace` 后 query 消失，effect 重跑时 code 为空，无副作用。

### 2. `src/components/app/MainNav.tsx`

- 删除 `{ label: '股票研究', href: '/stocks', enabled: true }` 一行（导航项 8 → 7）。

### 3. 重定向桩（服务端组件，复用 /watchlist 先例模式）

- `(app)/stocks/page.tsx`：
  ```tsx
  import { redirect } from 'next/navigation';
  export default function Page() {
    redirect('/select');
  }
  ```
- `(app)/stocks/[symbol]/page.tsx`：
  ```tsx
  import { redirect } from 'next/navigation';
  export default function Page({ params }: { params: { symbol: string } }) {
    redirect(`/select?code=${encodeURIComponent(params.symbol)}`);
  }
  ```

### 4. 删除 `src/components/stocks/StockResearchPage.tsx`

- 两个桩就位后该组件无引用，整文件删除。
- 共享件全部保留：`KLineChart.tsx`、`StockSearch.tsx`、`WatchlistPicker.tsx`、`useStockResearch.ts`、`StockResearchPanel.tsx`。

### 5. `scripts/check-ia4-routes.mjs` 同步更新

- nav 断言列表删除 `['股票研究', '/stocks']`，导航项计数 8 → 7。
- routeFiles 保留 `/stocks`、`/stocks/[symbol]` 两条（桩文件仍存在）。
- 新增断言（沿用第 45 行 `assert.match` 模式）：
  - `/stocks/page.tsx` 匹配 `redirect\(['"]\/select['"]\)`
  - `/stocks/[symbol]/page.tsx`：`assert.match(..., /redirect\(/)` 且 `assert.ok(...includes('/select?code='))`
- 结尾 `console.log` 文案 "8 enabled navigation items" → "7"。

## 非目标

- 不改自选股页 / 成果详情的深链代码（经桩重定向自然落到选股页）。
- 不改内嵌面板 `StockResearchPanel` 的功能、布局与全屏逻辑。
- 不动后端（本次纯前端 IA 收敛）。
- 不给 `/select` 增加新的 URL 状态（仅消费一次性的 `?code=` 入参并清理）。

## 行为差异（可接受，已批准）

- "查看股票"不再跳转独立页：图表在选股页内嵌面板打开，选股上下文（公式、日期、结果列表）保留。
- 顶导航"股票研究"消失，研究能力从"选股"进入。
- 旧 `/stocks/*` 链接继续可用（Next.js `redirect` 308 → `/select?code=...` 自动打开对应股票）。
- `/select` 与 `/stocks` 一样受 (app) 组登录守卫，无鉴权行为差异。

## 验证

1. `node scripts/check-ia4-routes.mjs`（含新断言）PASS
2. `node --test tests/*.test.mjs` 全部通过（218）
3. `npm run build`（next build）编译成功
4. 手工核对：`grep StockResearchPage` 无残留引用；`/stocks`、`/stocks/[symbol]` 两页为 redirect 桩
