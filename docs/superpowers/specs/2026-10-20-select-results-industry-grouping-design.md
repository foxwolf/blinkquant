# 选股结果列表行业分组展示设计

- 日期：2026-10-20
- 状态：已与用户逐项确认（澄清问答 + 方案 A 获批，附加移动端显示要求）
- 范围：仅前端展示层 `frontend/src/components/select/SelectionResultsSidebar.tsx`，不改后端、不改 API 契约

## 1. 背景与问题

- 当前选股结果列表**无任何业务排序**：顺序 = 后端 `backend/scheduler/dispatcher.py:101-106` 对 3 节点 codes 取并集 `set()` 后的哈希迭代顺序，非确定、每次运行可能变化。
- 列表每行仅显示 名称 + 行业 + 加自选按钮，用户反馈希望**相同行业板块的股票放到一起**，便于按板块浏览。
- 行业映射前端已有（`stockList: Array<{code, name, industry?}>`），无需后端补充数据。

## 2. 已确认决策

| # | 问题 | 用户裁定 |
|---|---|---|
| Q1 | 排序核心诉求 | 相同行业板块放到一起 |
| Q2 | 展示形式 | 分组标题 + 分块展示 |
| Q3 | 行业组之间的顺序 | 按组内入选只数降序（同数按行业名升序） |
| Q4 | 组内股票排序 | 按股票代码升序 |
| Q5 | 行业缺失的股票 | 归入「其他」组，恒置底 |
| Q6 | 实现方案 | 方案 A：纯前端分组渲染（否决 B 可折叠视图、C 后端排序） |
| Q7 | 移动端 | 显示必须合理：行内删除行业列，组标题 sticky 贴顶 |

前端重排后，列表顺序不再受后端 `set()` 哈希乱序影响，确定性顺带解决，故不改 `dispatcher.py`。

## 3. 需求

### R1 分组纯函数（`SelectionResultsSidebar.tsx` 内新增）

```ts
interface IndustryGroup {
  industry: string;      // 行业名；缺失行业统一为 "其他"
  codes: string[];       // 组内股票代码，升序
}

function groupResultsByIndustry(
  results: string[],
  stockList: Array<{ code: string; name: string; industry?: string }>,
): IndustryGroup[]
```

排序规则（全序、确定性）：

1. 行业缺失（查表不到或 `industry` 为空串/undefined）→ 归入哨兵组「其他」。
2. 组间：「其他」恒置底，不参与比数；其余组按 `codes.length` 降序 → 同数按 `industry.localeCompare(other, 'zh-Hans-CN')` 升序。
3. 组内：`code` 字典序升序。
4. `results` 中同一 code 重复出现时去重（按首次出现）。

调用处用 `useMemo(() => groupResultsByIndustry(results, stockList), [results, stockList])` 缓存。

### R2 分组渲染与移动端（`SelectionResultsSidebar.tsx` 列表区）

列表容器（现 `:102-127` 的 `overflow-y-auto p-2 max-h-[65vh]`）内由 `results.map` 改为 `groups.map`：

- 每组先渲染**组标题行**：`行业 · N只`（「其他」组同样显示 `其他 · N只`），样式 `text-xs font-bold text-slate-500`；加 `sticky top-0 z-10 bg-white`（在滚动容器内贴顶，滚动时可辨识当前行业；移动端整列全宽时收益最大）。
- 组标题下渲染该组股票行，行结构沿用现有卡片行（checkbox + 名称按钮 + `WatchlistPicker`），交互不变。
- **行内删除行业文字列**（现 `:119` 的 `<span>{industry || '—'}</span>`）：行业已由组标题表达，窄屏腾出约 45% 宽度给股票名，避免移动端名称被截断。
- 名称仍从 `stockList` 查表；实现时先构建一次 `Map<code, {name}>` 替换现在的逐行 `stockList.find`（顺带消除 O(n²)）。
- 触摸目标与现状一致（行高、checkbox `w-4 h-4` 不动）；分组不引入折叠、不引入新按钮。
- 空结果时维持现有「暂无结果」占位。

### R3 不变项（回归保护）

- 头部「结果 / 日期 / 数量徽章」、degraded 提示、全选/取消全选、已选计数、自选列表下拉、批量加入、行内 `WatchlistPicker`、`onViewStock` K 线联动、`selectedCode` 高亮：逻辑全部不变（`selectedCodes` 仍以 code 为键，与顺序无关）。
- `useEffect` 中 `results.includes(code)` 的选中集清洗逻辑不变。
- 后端、任务契约、`/api/v1/select`、`dispatcher.py`：零改动。

## 4. 数据流

`useSelection` → `results: string[]`（顺序仍为后端原样）→ `SelectionResultsSidebar`：
`results + stockList` →（`useMemo` 分组排序）→ `IndustryGroup[]` → 分组渲染。

## 5. 错误处理

- `stockList` 尚未加载（空数组）：所有 code 查不到行业 → 全部落入「其他」组按代码升序置底显示，名称回退显示 code（与现状一致）；`stockList` 加载完成后 `useMemo` 依赖变化自动重排。
- 除上述外无其他错误路径（纯渲染层，无 IO）。

## 6. 测试与验证

- 组件为展示层，验证以 `cd frontend && npx tsc --noEmit` 类型检查 + 现有 CI 通过为准。
- 手工核对清单：
  1. 多行业结果 → 组按只数降序、同数字典序、「其他」置底；
  2. 组内代码升序；
  3. 全选/多选/批量加入在分组下行为与改前一致；
  4. 点击行开 K 线、`selectedCode` 高亮正常；
  5. 窄屏（<lg，单列全宽）组标题 sticky、行内无行业列、名称不截断；
  6. `results` 为空 → 「暂无结果」。
