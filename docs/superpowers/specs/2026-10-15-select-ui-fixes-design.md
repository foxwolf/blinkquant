# 选股页 UI 修正设计：卡内窗口控件 / 页面级股票搜索 / 结果侧栏精简

- 日期：2026-10-15
- 状态：已与用户逐项确认（4 轮澄清问答 + 设计获批）
- 关联：`docs/superpowers/specs/2026-10-15-floating-kline-chart-design.md`（浮动 K 线卡，已上线 a69b94c）

## 1. 背景

浮动 K 线卡上线后冒烟发现三处问题，用户提出修正；期间追加一项范围调整：

1. **窗口控件位置违习惯**：关闭 ✕ 目前在灰色工具组「全屏、日、周、月」之后，不符合窗体惯例——**全屏/退出全屏 + 关闭 ✕ 应钉在卡片右上角**。
2. **缺页面级股票入口**：只能先跑选股/点结果行/深链才能看 K 线，需在页面顶部（策略公式之上）加「股票搜索」区，手动输代码/名称直接开卡。
3. **结果侧栏两处问题**：高度固定 `h-[600px]` 不随内容；且**「自选」tab 删除**——自选股已有独立页 `/watchlists`，侧栏只留「结果」，数量徽章保留。

## 2. 已确认决策

| # | 问题 | 用户裁定 |
|---|---|---|
| Q1 | 侧栏高度策略 | 内容高 + 上限滚动（短列表卡片变矮，超过上限内部滚动） |
| Q2 | 数量展示位置 | 原裁「数量入按钮内」→（因 Q5 删 tab 失效）改标题左 + 日期/数量徽章右 |
| Q3 | 右上角实现 | 绝对定位角落悬浮（任何头部换行状态都钉角） |
| Q4 | 页面搜索区实现 | 复用现有 `StockSearch` 组件（联想/回车/拼音/移动端弹层全复用）；卡内原搜索框保留 |
| Q5 | 自选 tab | 删除，侧栏只留「结果」（范围追加，设计阶段确认） |

## 3. 需求

### R1 卡片右上角窗口控件（`StockResearchPanel.tsx`）

- 灰色工具组（`bg-slate-50 rounded-lg p-1 border border-slate-200`）**移除**全屏按钮与 ✕，保留：复权下拉 + 日/周/月。
- 头部容器（`px-4 py-3 border-b flex flex-wrap justify-between items-center gap-2 bg-white z-10 shrink-0`）加 `relative pr-32`（预留角落空间，防内容钻入控件下方）。
- 新增角落控件容器（绝对定位，任何换行状态都钉在右上角）：

```tsx
<div className="absolute right-3 top-2.5 z-20 flex items-center gap-1.5">
  <button
    type="button"
    onClick={() => { void onToggleFullscreen(); }}
    className="px-3 py-1 text-xs font-bold text-slate-600 border border-slate-200 bg-white rounded-md hover:bg-slate-100 transition-colors"
  >
    {isFullScreen ? '退出全屏' : '全屏'}
  </button>
  <button
    type="button"
    onClick={onClose}
    aria-label="Close stock chart"
    className="px-3 py-1 text-xs font-bold text-slate-600 border border-slate-200 bg-white rounded-md hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors"
  >
    ✕
  </button>
</div>
```

- 尺寸核算：「退出全屏」按钮 ≈ 72px + gap 6 + ✕ ≈ 36px + right-3 12px ≈ 126px ≤ `pr-32`（128px）。
- 全屏态：控件随 `<section>` 一起进入浏览器全屏 → 仍可退出/关闭；关闭自动退全屏逻辑（`fullscreenchange` hook 级监听）不动。
- `z-20` 位于头部内容（z-10）之上、卡内搜索联想（z-30，居左）之下——不冲突。
- 门禁 `/onClose/` 断言保持命中（✕ 的 `onClick={onClose}` 仍在 panel 文件中）。

### R2 页面级「股票搜索」区（`SelectionWorkspace.tsx` + `StockSearch.tsx`）

- `SelectionWorkspace.tsx`：在 `<SelectionControls>` **之前**插入（位于 `max-w-7xl space-y-6` 容器内）：

```tsx
<section aria-label="股票搜索" className="bg-white p-4 md:p-6 rounded-2xl border border-slate-200 shadow-sm">
  <div className="flex flex-col gap-3">
    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">股票搜索</label>
    <StockSearch stockList={stockList} onSelect={handleViewStock} className="w-full max-w-md" />
  </div>
</section>
```

（label 样式与策略公式卡一致；新增 `import StockSearch from '../StockSearch';`）

- `StockSearch.tsx`：加可选 prop `className?: string`，桌面端根 div 改为：

```tsx
<div className={`relative hidden md:block ${className ?? 'w-64 shrink-0'}`}>
```

默认值不变 → 卡内现有用法零影响；移动端图标按钮/覆盖层不动。
- 行为：选中 → `handleViewStock` → `viewStock` → 浮出 K 线卡（已开则换股、不重弹）——与点结果行完全同链路。深链 effect、卡内 StockSearch 均不动。
- `stockList` 为空（加载中）时搜索无结果/回车无效，与卡内行为一致，不另做处理。

### R3 结果侧栏精简 + 自适应（`SelectionResultsSidebar.tsx` + `SelectionWorkspace.tsx`）

**侧栏删除项**：「自选」tab 按钮、`sidebarTab`/`onTabChange` props、`Watchlist` 渲染分支及其 import、`SidebarTab` 类型、`BulkWatchlistBar` 的 `onChanged` 传参（prop 本身可选，不传即止）。

**头部新布局**（左侧普通标题、右侧徽章恒显——不再随 tab 条件）：

```tsx
<div className="p-4 border-b flex justify-between items-center bg-slate-50/50">
  <span className="text-sm font-bold text-slate-700">结果</span>
  <div className="flex items-center gap-2">
    {selectMeta?.date && (
      <span className="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full font-mono">{selectMeta.date}</span>
    )}
    <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full font-mono">{results.length}</span>
  </div>
</div>
```

**高度自适应**：
- 外层卡 `bg-white rounded-2xl border flex flex-col h-[600px] shadow-sm` → **去 `h-[600px]`**，卡片高度由内容撑开。
- 结果列表 div：`flex-1 overflow-y-auto p-2 custom-scrollbar` → `overflow-y-auto p-2 max-h-[65vh] custom-scrollbar`（去 `flex-1`，用列表自身 max-h 封顶，规避 flex 基准陷阱）。
- 降级横幅、结果行结构、行内 `WatchlistPicker` 星标、`BulkWatchlistBar` 保留。

**Workspace 连带清理**（删除前 grep 确认无其余消费方）：
- `sidebarTab` useState + 传参。
- `watchlistCodes` useState、`refreshWatchlist`、`useEffect(user → refreshWatchlist)`、`toggleWatchlist`、侧栏 `watchlistCodes`/`onRemoveWatchlist`/`onWatchlistChanged` 传参。
- 预期：`toggleWatchlist` 仅作 `onRemoveWatchlist` 消费、`watchlistCodes` 仅作侧栏 prop 消费（`WatchlistPicker` 星标组件自包含、独立 fetch，自选股页 `/watchlists` 数据源不受影响）——若 grep 发现其他消费方则保留该管道并在报告中说明。

## 4. 改动文件

| 文件 | 改动 |
|---|---|
| `frontend/src/components/select/StockResearchPanel.tsx` | R1：头部 relative+pr-32、角落控件组、全屏/✕ 移出灰组 |
| `frontend/src/components/select/SelectionWorkspace.tsx` | R2 插入搜索卡；R3 删 tab 态与 watchlist 管道 |
| `frontend/src/components/StockSearch.tsx` | R2：可选 `className` prop |
| `frontend/src/components/select/SelectionResultsSidebar.tsx` | R3：删 tab、头部新布局、高度自适应 |

## 5. 不变项 / 范围外

- `/watchlists` 自选股页、`Watchlist`、`WatchlistPicker` 组件本身不动；星标加自选链路不动。
- `useStockResearch`、`KLineChart`、深链 effect（`?code=` 消费）、门禁 3 断言与 PASS 文案不动（三项新改动均不触碰断言命中条件）。
- 卡内头部其余元素（StockSearch、股票信息/板块 chips/指标行、复权、D/W/M）布局保留。
- AI 选股、保存策略、策略库模态、MainNav 不动。
- 无后端、无 hook、无测试文件改动。

## 6. 验收

1. 门禁：`node scripts/check-ia4-routes.mjs` → PASS，21 路由，文案不变。
2. `node --test tests/*.test.mjs` → `# pass 218`。
3. `npm run build` → `✓ Compiled successfully`。
4. 部署后冒烟（登录态浏览器）：
   1. 卡片右上角并排「全屏/退出全屏 + ✕」钉角；头部内容不钻入控件下；灰组只剩复权+日/周/月。
   2. 全屏中角落控件可见；全屏中点 ✕ → 卡卸载并自动退全屏。
   3. 页面顶部「股票搜索」：代码/名称/拼音联想选中 → 浮卡；开卡状态下换股不重弹；移动端图标弹层可用。
   4. 侧栏无「自选」tab；头部左「结果」右「日期 + 数量」徽章恒显。
   5. 结果少（≈5 条）→ 侧栏卡片贴内容变矮；结果多 → 列表 65vh 封顶内部滚动。
   6. 结果行星标加自选 → `/watchlists` 页数据正常；`BulkWatchlistBar` 批量加入可用。
   7. 深链 `/stocks/000001` → `/select?code=` 自动开卡；保存策略/AI 模态（z-50）盖卡回归。
