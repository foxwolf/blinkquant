# K线图浮动卡片化设计

日期：2026-10-15
状态：已批准（用户确认：固定位置悬浮卡片形态 + 方案 A 原地改造）

## 目标

把选股工作台 `/select` 的 K 线图从固定布局位置（grid 右 3/4 列、始终渲染 + 600px 占位）改为**动态生成的固定位置悬浮卡片**：查看股票时才生成并浮在页面之上，关闭即卸载，不占/不推挤页面布局；结果列表占全宽。

## 现状

- `SelectionWorkspace.tsx`（290 行）：`grid grid-cols-1 lg:grid-cols-4`（`:205`）——左 `SelectionResultsSidebar`（1 列）+ 右 `StockResearchPanel`（`lg:col-span-3`，始终渲染；未选股票时显示"选择股票查看图表"占位）。
- `StockResearchPanel.tsx`（246 行）：外壳 `<section className="lg:col-span-3 order-2 lg:order-2">`（`:83`）+ 内层 `h-[600px]` 卡片（`:84`）。功能：StockSearch 搜索、行业/概念/地域板块 chips、关键指标（PE TTM/市值/成交额/换手/成交量）、WatchlistPicker、复权（none/qfq/hfq）、周期 D/W/M、浏览器原生全屏。
- 状态全部在 `useStockResearch` hook（`useStockResearch.ts:71`，持有于 `SelectionWorkspace.tsx:54`）：`selectedStock` / `chartLoading` / `sectors` / `adjustMode` / `chartTimeframe` 等。`viewStock`（`:208`）仅在 fetch+解析成功后才置位 `selectedStock`；`clearSelectedStock`（`:372`）已存在，且 useSelection 已通过 `onClearSelectedStock`（`SelectionWorkspace.tsx:70`）挂钩"新一轮选股自动清空旧图"。
- `KLineChart.tsx` 已含 `ResizeObserver`（`:738`），容器尺寸变化自动 `applyOptions`，固定尺寸浮层无需改动图表组件。
- 全屏：`useStockResearch.ts:339` `toggleFullscreen` → `requestFullscreen(chartWrapperRef)`，`fullscreenchange` 监听（`:136`）同步 `isFullScreen`；移动端横屏锁定逻辑在内。
- 层级审计：`MainNav.tsx:87` `sticky top-0 z-50`（nav 内容 `h-14`）；全部模态（`AISelectModal.tsx:121`、`StrategyList.tsx:56`、保存策略弹窗 `SelectionWorkspace.tsx:255`、StockSearch 移动端）均为 `fixed inset-0 z-50`。
- 门禁 `scripts/check-ia4-routes.mjs` 对 SelectionWorkspace 现有 2 条结构断言（doesNotMatch `/api/status`、doesNotMatch `/stocks/`），对本次改动不冲突。

## 设计

### 1. 挂载与状态模型（`src/components/select/SelectionWorkspace.tsx`）

- 不新增 panel 开关状态维度：**卡片开 ≡ `selectedStock != null`**。
- grid（`:205`）`grid grid-cols-1 lg:grid-cols-4 gap-4 md:gap-6` 改单列容器：移除 `lg:grid-cols-4` 与 gap，`SelectionResultsSidebar` 占满 `max-w-7xl` 全宽。
- `StockResearchPanel` 改按需渲染：`{selectedStock && <StockResearchPanel ... onClose={clearSelectedStock} />}`。
- 关闭按钮 → 既有 `clearSelectedStock()`，与"新一轮选股自动清空旧图"同一语义，零新 API。
- 推论（均无需额外代码）：
  - 关闭后 sidebar 行高亮（`selectedCode`，同一数据源）同步消失；
  - `viewStock` 失败走 alert、`selectedStock` 不置位 → 卡片不会以错误态空壳出现；
  - 深链 `/select?code=` 行为不变：viewStock 成功 → 置位 → 卡片自动弹出；
  - 关闭后重新查看同一只股票会重新 fetch 一次 kline（与当前"新一轮选股后重看"行为一致，可接受）。

### 2. 浮动壳几何与层级（`src/components/select/StockResearchPanel.tsx`）

- 外壳（`:83` `<section>`）改为固定定位浮层，响应式两套锚点：
  - 桌面（lg+）：`fixed right-4 bottom-4 z-40 w-[min(560px,calc(100vw-2rem))] h-[min(640px,calc(100vh-12rem))]`
  - 移动（<lg）：`fixed inset-x-2 top-16 bottom-2 z-40`（h-14 导航 + 8px 余量，近全屏卡）
  - 共享：`rounded-2xl border border-slate-200 bg-white shadow-lg flex flex-col overflow-hidden`
- **z-40 是唯一安全层**：低于 MainNav（z-50）与全部模态（z-50）——卡打开时再开 AI 选股/保存策略弹窗，弹窗照常盖卡；卡内 StockSearch 下拉（z-30）、图表菜单（z-20）在卡片自身堆叠上下文内，不受影响。
- 无遮罩 backdrop：卡只是盒子，下层列表仍可滚动、点击。
- 头部（`:85` 工具条）右侧加"关闭"按钮（紧邻"全屏"按钮），调用新增 prop `onClose: () => void`。
- 删除空态占位分支（`:230-241` 三元中的 "选择股票查看图表"）——无卡即无图；简化为直接渲染 `<KLineChart/>`（卡片只在 selectedStock 存在时挂载）。
- 已核实：新选股触发清空依赖 `handleSelect → clearResults() → onClearSelectedStock()`（useSelection.ts:39,45）。

### 3. 零改动清单

- `useStockResearch.ts`、`KLineChart.tsx`、`SelectionResultsSidebar.tsx`、`StockSearch.tsx`、`WatchlistPicker.tsx`、后端与全部 API。
- "全屏"按钮与移动端横屏锁定逻辑不变：Fullscreen API 对 fixed 元素同样生效；全屏中点关闭 → 卡片卸载 → 浏览器自动退出全屏 → `fullscreenchange` 监听同步状态，无需额外处理。

### 4. 门禁断言（`scripts/check-ia4-routes.mjs`，先红后绿）

- workspace：`assert.match(workspace, /\{selectedStock && /, 'Selection workspace must mount the chart panel on demand')`
- workspace：`assert.doesNotMatch(workspace, /lg:grid-cols-4/, 'Panel column must be removed from the selection workspace grid')`
- panel（读 `src/components/select/StockResearchPanel.tsx`）：`assert.match(panel, /onClose/, 'Chart panel must expose a close wiring')`
- 结尾 `console.log` 文案追加 "floating K-line card" 一项。

## 非目标

- 不做拖拽、位置记忆、多卡片、Esc 关闭（YAGNI；拖拽形态已被用户否决）。
- 不改 `KLineChart.tsx` 内部实现与全部图表指标功能。
- 不动自选股页 / 成果详情的深链代码（已落 `/select`，自动弹出逻辑不变）。
- 不动后端（纯前端）。

## 行为差异（可接受，已批准）

- 图表不再常驻页面右 3/4：未看股票时页面只有全宽结果列表；查看股票时右下角浮出卡片（移动端为导航下近全屏卡）。
- 卡片打开时可能盖住列表右下角（桌面），关闭卡片或滚动列表即可避开。
- 图表面板按需挂载/卸载：查看中切换股票不丢状态（状态在 hook）；关闭后重看同一只股票会重新 fetch 一次 kline。
- "关闭"与"新一轮选股"共用 `clearSelectedStock`：跑新选股时打开的卡片自动收起（既有语义的延伸）。

## 验证

1. `node scripts/check-ia4-routes.mjs`（含新增 3 断言）PASS
2. `node --test tests/*.test.mjs` 全部通过（218）
3. `npm run build`（next build）编译成功
4. 手工冒烟（部署后，登录态）：
   - 选股结果点"查看股票" → 右下角浮出卡片，不跳页，列表仍全宽
   - 点"关闭" → 卡片卸载，列表行高亮消失
   - 地址栏 `/stocks/000001` → 自动浮出 000001 卡片
   - 卡片打开时跑新选股 → 卡片自动收起
   - 卡片打开时开 AI 选股弹窗 / 保存策略弹窗 → 弹窗盖在卡片上（层级）
   - "全屏"进出正常；全屏中点关闭 → 退出全屏
   - 移动端：卡片为导航下近全屏卡，关闭正常
