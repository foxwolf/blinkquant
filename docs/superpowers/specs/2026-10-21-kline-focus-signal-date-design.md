# 选股结果打开 K 线定位到信号日 设计

- 日期：2026-10-21
- 状态：已与用户确认（2 项决策）
- 范围：仅前端。K 线图为 lightweight-charts；现状打开后 `fitContent()` 显示全部历史，无日期定位概念

## 1. 需求

在选股页点击结果列表中的个股打开 K 线浮层时，图表打开后**信号日（选股时设定的基准日期，`selectMeta.date`）的那根 K 线居中显示**。

已确认决策：
- **可视范围**：常规缩放（约 120 根 bar，信号日居中，左右各 ~60 根，可拖动缩放），不是全历史塞屏；
- **视觉标记**：信号日 K 线上方加箭头标记 +「选股日」字样，拖动缩放后仍可见。

## 2. 设计

### R1 纯函数 `frontend/src/utils/klineFocus.ts`（可单测）

```ts
matchFocusIndex(times: number[], focusDate: string): number
```
- bar.time 为 unix 秒。匹配规则：与 focusDate 的正午 UTC 时间戳相差 <12h 视为同一交易日（同时容忍 UTC 午夜与东八区午夜两种生成约定）；
- 无精确命中 → 回退取 `time ≤ focusDate 当日末` 的最近一条（停牌/未来日期容错）；再无 → -1；
- `focusLogicalRange(idx, span = 120)` → `{ from: idx - span/2, to: idx + span/2 }`。

### R2 `KLineChart.tsx`

- 新 props：`focusDate?: string`。
- 创建图表 effect 末尾：有 focusDate 且 `matchFocusIndex ≥ 0` → `setVisibleLogicalRange(focusLogicalRange(idx))` + `candlestickSeries.setMarkers([{ time, position:'aboveBar', shape:'arrowDown', color:'#2563eb', text:'选股日' }])`；否则维持 `fitContent()`。
- `focusDate` 随 `data` effect 生效：切换周/月周期或复权后 data 重算，自动重新居中到新周期对应 bar（选股日为日级日期，W/M 取 ≤ 该日的最近 bar，由 R1 回退规则保证）。

### R3 数据流（focusDate 随选中股票走）

- `useStockResearch`：`SelectedStock` 增加 `focusDate?: string`；`viewStock(code, focusDate?)` 写入。周期/复权切换已用 `{...prev, data}` 保留该字段；`returnToStock`（板块返回个股）经 `lastStockRef` 恢复的路径不带 focusDate（无伤大雅，板块视图本就无选股日概念）。
- `StockResearchPanel`：`<KLineChart … focusDate={selectedStock.focusDate} />`（板块 kind 不渲染该 props）。
- `KlineOverlayProvider`：`openKline(code, focusDate?)`；预热排队 state 由 `pendingCode: string|null` 改为 `{ code, focusDate } | null`，就绪消费时透传。
- `SelectionResultsSidebar`：`onViewStock: (code: string, focusDate?: string) => void`；行点击传 `onViewStock(code, selectMeta?.date || undefined)`。
- 其他入口（搜索、自选、成就库、深链）不传 focusDate → 行为与现状完全一致。

## 3. 测试

- 新 `frontend/tests/kline-focus.test.mjs`（复制实现惯例）：精确命中（UTC 午夜/东八区午夜两种 time 约定）、回退 ≤ 最近一条、无匹配 -1、范围计算。
- `npx tsc --noEmit`；现有前端测试全过。
- 部署后手工验收：选股（设定基准日期）→ 点结果行 → 信号日居中 + 标记；切周/月/复权后重新居中；从搜索/自选打开 → 行为不变。
