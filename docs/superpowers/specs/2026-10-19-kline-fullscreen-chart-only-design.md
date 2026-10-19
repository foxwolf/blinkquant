# K 线浮窗全屏只显示图表（设计）

> 日期：2026-10-19
> 范围：前端 `frontend/src/components/select/StockResearchPanel.tsx`（仅此文件）
> 状态：待评审

## 背景

K 线浮窗（`StockResearchPanel`）进入全屏时，全屏的目标是外层 wrapper `<div ref={chartWrapperRef} className="flex flex-col h-full w-full">`，因此全屏中包含**头部工具栏**（搜索框、股票代码/名称、板块标签、指标、复权/周期切换、全屏/关闭按钮）+ 图表区。需求是：全屏时**只显示图表**，不显示头部工具栏。

## 现状（关键结构）

```
<section className="fixed ... z-[60]">                       // 浮窗（非全屏布局）
  <div ref={chartWrapperRef} className="flex flex-col h-full w-full">   // ← 当前全屏目标
    <div className="relative px-4 py-3 border-b ..."> ... </div>          // 头部工具栏
    <div className="flex-1 w-full h-full relative p-1">                  // 图表区
      {chartLoading && ...}
      <KLineChart ... />
    </div>
  </div>
</section>
```

- `toggleFullscreen`（`frontend/src/hooks/useStockResearch.ts:340`）调用 `chartWrapperRef.current?.requestFullscreen()`；`isFullScreen` 由 `fullscreenchange` 监听维护（`:137-152`）。
- `chartWrapperRef` 由 hook 创建，仅用于 `requestFullscreen`。

## 设计

把全屏目标从 wrapper 改为**图表区 div**，并在图表区内叠加一个全屏时才出现的悬浮「退出全屏」按钮。

1. **ref 改挂点**：`StockResearchPanel.tsx`
   - wrapper（现 `:91`）移除 `ref={chartWrapperRef}`；其余 class 不变。
   - 图表区 div（现 `:256` `<div className="flex-1 w-full h-full relative p-1">`）加上 `ref={chartWrapperRef}`。
2. **悬浮退出按钮**：在图表区 div 内、与 `<KLineChart>` 同级新增，仅 `isFullScreen` 时渲染：
   ```tsx
   {isFullScreen && (
     <button
       type="button"
       onClick={() => { void onToggleFullscreen(); }}
       className="absolute top-2 right-2 z-30 px-3 py-1 text-xs font-bold text-slate-600 border border-slate-200 bg-white/95 rounded-md hover:bg-slate-100 transition-colors"
     >
       退出全屏
     </button>
   )}
   ```
   - 位置右上，避开 `KLineChart` 左上角（`top-2 left-2`）的指标菜单。
   - `z-30` 高于图表内浮层（`z-20`）。
3. **头部不变**：头部「全屏 / 退出全屏」按钮保留（用于进入全屏）；进入全屏后头部位于全屏元素之外，被浏览器自动隐藏，无需条件渲染。

## 行为

- 非全屏：与现状一致（浮窗 = 头部 + 图表）。
- 点头部「全屏」→ 只有图表区铺满整屏 + 右上悬浮「退出全屏」。
- 点悬浮按钮 / Esc / 系统手势 → 退出全屏，恢复浮窗（头部回来）。
- 进入全屏时，图表区因 `ResizeObserver`（`frontend/src/components/KLineChart.tsx:735`）随容器尺寸变化自动 `applyOptions` 铺满，无需额外处理。

## 边界与非目标

- 全屏中**不提供** ✕ 关闭：需先「退出全屏」再在头部关闭（最小改动）。Esc/手势退全屏的路径由既有 `fullscreenchange` 监听覆盖。
- 不改动 `toggleFullscreen`、移动端方向锁定（`screen.orientation.lock`）、`fullscreenchange`/`resize` 监听。
- **不处理** `showRotateHint` 死逻辑（`useStockResearch.ts:77` 设置但从未渲染）——另案。
- 不改动 `KLineChart` 内部逻辑。

## 涉及文件

- `frontend/src/components/select/StockResearchPanel.tsx`（唯一改动文件）

## 验收

- `npx tsc --noEmit` 通过；`npm run build` 成功（`✓ Compiled successfully`）。
- 手工：浮窗点「全屏」→ 只见图表 + 右上「退出全屏」；点它或按 Esc → 恢复正常浮窗（头部可见）；图表在全屏下无留白、随窗口尺寸自适应。
- 回归：非全屏浮窗的头部/搜索/周期/复权/关闭按钮行为不变。
