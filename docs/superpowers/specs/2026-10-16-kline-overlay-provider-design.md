# K 线浮窗全局化（KlineOverlayProvider）设计

- 日期：2026-10-16
- 状态：设计已获用户逐段批准，待实施
- 关联：`2026-10-14` 股票研究并入选股页（`/stocks` 重定向桩来源）、`2026-10-15-select-ui-fixes-design.md`（浮窗卡片本体与右上角控件）

## 1. 背景与根因

需求：在非选股页面需要显示个股 K 线时，应**直接显示 K 线窗口**，而当前是先跳转到选股页、再由深链 effect 弹出浮窗（两阶段观感）。

根因（架构使然而非代码缺陷）：

- K 线浮窗 `StockResearchPanel` 全站唯一宿主是 `/select` 的 `SelectionWorkspace`，所需状态全部由自包含 hook `useStockResearch()` 提供。
- 外部入口被设计为漏斗：`/stocks/[symbol]`、`/stocks`、`/` 均为服务端重定向桩；自选详情页点股票（`watchlists/[watchlistId]/page.tsx:124` → `router.push('/stocks/x')`）与成果详情页点代码（`artifacts/ArtifactDetailPage.tsx:222` → `<Link href="/stocks/x">`）都经重定向落到 `/select?code=`，再由 workspace 深链 effect 按需挂载浮窗。

用户已确认的设计决策：

1. 形态 = **原地浮层**（停在当前页弹窗，不跳转）；
2. 入口范围 = 自选列表页 + 成果详情页（`/stocks/x` 深链维持现状落 `/select`）；
3. 架构 = **全局 Provider（方案 C）**；
4. `/select` **全站统一**：选股页改调全局 open，删除自有面板接线（全站唯一实例）；
5. 生命周期 = **换页即关**（不做画中画）。

## 2. 需求

- **R1 原地浮层**：自选详情页点股票行、成果详情页点代码 chip 时，在本页直接弹出 K 线浮窗，不发生任何路由跳转。
- **R2 全局唯一实例**：K 线浮窗由挂在 `(app)` 布局层的全局 Provider 统一承载；`/select` 选股页删除自有 `useStockResearch()` 实例与面板透传块，改用同一 context。
- **R3 换页即关**：路由路径变化时浮窗自动关闭并退出全屏；手动 ✕ 走同一清理路径。
- **R4 深链不变**：`/stocks/[symbol]` → `/select?code=` 重定向与 workspace 深链 effect 保留，仅落地实现改为调 `openKline(code)`。

## 3. 架构设计

### 3.1 Provider 与 API

新文件 `frontend/src/components/kline/KlineOverlayProvider.tsx`（`'use client'`）：

- 内部持有**唯一** `useStockResearch()` 实例；挂载后即按现有缓存逻辑预热 `stockList`。
- 状态 `pendingCode`：`stockList` 未就绪时暂存待开代码，就绪 effect 消费（自动触发一次后清空）。
- 渲染：`{selectedStock && <StockResearchPanel … />}`，全量透传 hook 输出，接线与现 workspace 一致：
  `onClose=clearSelectedStock`、`onViewStock=（包 viewStock）`、`onViewSector=viewSector`、`onToggleFullscreen=toggleFullscreen`、`onReturnToStock=returnToStock`、`onChangeAdjustMode/onChangeAdjustMenuOpen/onChangeSectorsExpanded` 及图表状态各 setter。
- Context API（`useKlineOverlay()`）：
  - `openKline(code: string)`：stockList 空则写入 `pendingCode`，否则 `viewStock(code)`；
  - `closeKline()`：`clearSelectedStock()` + 若 `isFullScreen` 则退出全屏（统一清理函数）；
  - `selectedCode`：`selectedStock?.code ?? null`（供选股页侧栏高亮）；
  - `ready`：stockList 就绪布尔（可选暴露）。
- 挂载点：`frontend/src/app/(app)/layout.tsx` 内、MainNav 之下包裹 children；`login/register/admin` 在 `(app)` 组外，不挂载。

### 3.2 调用点改造

1. **自选详情页** `frontend/src/app/(app)/watchlists/[watchlistId]/page.tsx:124`：
   `onSelect={(code) => router.push(\`/stocks/${code}\`)}` → `onSelect={openKline}`；`useRouter` 若无其他用途则删。
2. **成果详情页** `frontend/src/components/artifacts/ArtifactDetailPage.tsx:222`：
   `<Link href={'/stocks/'+code}>` → `<button onClick={() => openKline(code)}>`（保留原有 chip 样式类，去除导航语义）。
3. **选股页 workspace** `frontend/src/components/select/SelectionWorkspace.tsx`：
   - 删除：`useStockResearch()` 解构块、`{selectedStock && <StockResearchPanel …/>}` 整块、`handleViewStock` 包装；
   - 新增：`const { openKline, closeKline, selectedCode } = useKlineOverlay()`；
   - 接线替换：顶部 `StockSearch onSelect` → `openKline`；侧栏 `selectedCode={selectedCode}`、`onViewStock={openKline}`；`useSelection({ onClearSelectedStock: closeKline })`；
   - 深链 effect 保留（`?code=` 读取 + `router.replace('/select', { scroll: false })`），动作改 `openKline(code)`，移除 `stockList.length` 依赖（排队守卫在 Provider 内）。
4. **不动**：`StockResearchPanel`/`KLineChart`/`useStockResearch` 本体；`/stocks/[symbol]`、`/stocks`、`/` 桩；浮窗内搜索/切股/切板块（同一实例内自然工作）。

### 3.3 生命周期与边角

- **换页即关**：Provider 内 `usePathname()` effect，路径变化时执行统一清理（`closeKline`），全屏态先 `document.exitFullscreen()` 兜底，防跨页残留全屏。
- **open 排队**：预热完成前的任意 `openKline` 调用（含深链）暂存于 `pendingCode`，就绪后自动打开。
- **同码重开**：关闭后再次点同一股票必须重开。`viewStock` 是否对同码短路需在实施时实测：若短路，`openKline` 对与 `selectedCode` 相同或浮窗已关闭的情形先执行 `clearSelectedStock()` 再 `viewStock(code)`；若不短路则直调即可。实测结论与最终手段写入实施计划。
- **互斥**：全局单实例，物理上不可能出现双窗。
- **鉴权**：`/api/stock-list`、`/api/kline`、`/api/sector-kline` 均已带登录守卫，`(app)` 组页面恒为登录态，无新增风险。
- **移动端**：浮窗样式与选股页完全一致（`fixed inset-x-2 top-16 …`），无新断点。

## 4. 改动文件

| 文件 | 改动 |
|---|---|
| `frontend/src/components/kline/KlineOverlayProvider.tsx` | 新建：Provider + context + 面板按需挂载 |
| `frontend/src/app/(app)/layout.tsx` | 挂 Provider（MainNav 之下） |
| `frontend/src/app/(app)/watchlists/[watchlistId]/page.tsx` | 点股票改 `openKline` |
| `frontend/src/components/artifacts/ArtifactDetailPage.tsx` | 代码 chip 改 button + `openKline` |
| `frontend/src/components/select/SelectionWorkspace.tsx` | 删自有面板接线，改用 context |
| `frontend/scripts/check-ia4-routes.mjs` | 面板宿主断言迁移（见 §5） |
| `frontend/tests/*`（视 grep 结果，可能为 0 个） | 若有锁 workspace 面板/deep-link 实现的断言则同步 |

## 5. 门禁与测试

- **门禁（刻意且唯一的断言行变更）**：`check-ia4-routes.mjs:79` 现断言 workspace 含 `{selectedStock && `。改为：
  - `KlineOverlayProvider` 源码含 `/\{selectedStock && /`（按需挂载语义不变）；
  - workspace 源码含 `openKline`（防回退私有实例）。
  - `:81-82` 面板 `/onClose/` 断言不变；PASS 文案 `floating K-line card (on-demand mount + close wiring)` 与 21 路由断言全部不动。
- **测试**：实施第一步 grep `frontend/tests` 对 workspace 的既有断言（已知 IA5.4.3 负断言 `refreshWatchlist|toggleWatchlist|sidebarTab` 不受影响）；如存在锁定面板挂载位置/deep-link `viewStock` 实现的用例，同步更新并在计划中如实记录为「架构迁移导致的刻意测试变更」。
- **三件套**：逐任务 `npx tsc --noEmit` + 门禁 PASS；收尾 `node --test tests/*.test.mjs`（预期 `# pass 218`，若增删须写明理由）+ `npm run build`。

## 6. 范围外（明确不做）

- `/stocks/x` 深链仍落 `/select`（按范围决策）。
- 画中画持久、URL 记忆/刷新恢复。
- 重构 `StockResearchPanel` 本体；给登录/后台页挂 Provider；根 `/watchlist`、`/stocks`、`/` 桩。
- workspace 预存死码（`useRef` 死导入、`handleFormulaChange`）：顺路清除算附带收益，不单列任务。

## 7. 验收标准

1. 自选详情页点股票：URL 不变，本页直接弹出 K 线浮窗；✕ 关闭回列表页。
2. 成果详情页点代码 chip：同上。
3. `/select` 顶部搜索、结果侧栏点股、深链 `?code=`：行为与改造前一致（同一浮窗），侧栏高亮随 `selectedCode` 联动。
4. 浮窗打开时经 MainNav 切页：浮窗关闭且不残留全屏。
5. 预热完成前触发 open（含深链）：就绪后自动打开，不丢请求。
6. 关闭后再点同一股票：浮窗重新打开。
7. 门禁 PASS（21 路由、文案不变）、`tsc` 0 错、全量测试绿、`npm run build` 成功。
