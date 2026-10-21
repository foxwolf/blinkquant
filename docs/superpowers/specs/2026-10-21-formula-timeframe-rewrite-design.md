# 周期切换自描述前缀改写 设计

- 日期：2026-10-21
- 状态：已与用户逐项确认（3 轮澄清 + 设计获批）
- 前置：选股表单已有日/周/月切换（2026-10-21）；AI 公式约定 = 日裸/W.前缀/M.前缀

## 1. 需求

在公式选股界面，用户手动切换日/周/月周期时，公式编辑框内的公式自动改写为与所选周期一致的自描述前缀形式，与 AI 选股生成的公式约定统一：

- **日 = 裸公式**（`MA(CLOSE,20)`），切回日时去前缀，D→W→D 往返还原原文；
- **周 = `W.` 前缀**（`W.MA(W.CLOSE,20)`）；**月 = `M.` 前缀**；
- **仅手动切换时改写**；AI 回填、策略库加载的公式保持原样（已裁定）。

## 2. 已确认决策

| # | 问题 | 裁定 |
|---|---|---|
| Q1 | 改写方向 | 自描述前缀改写（理由：与 AI 生成公式统一） |
| Q2 | 日周期形式 | 裸公式（与 AI 日周期输出一致，可往返还原） |
| Q3 | 归一化时机 | 仅手动切换；AI 回填/策略库加载不改 |

## 3. R1 后端：series/cond 位置放行前缀字段（security.py）

改写产物如 `CROSS_UP(W.CLOSE, W.MA(W.CLOSE,20))`、`COUNT(W.CLOSE > 10, 3)`。当前 `_require_series` 只接受 `ast.Name`（裸字段），`ast.Attribute`（`W.CLOSE`）被拒。修复：

- `_require_series` 新增分支：`ast.Attribute` 且 `node.value` 为 `D./W./M.` 前缀 → 校验 `attr` ∈ FIELDS → 返回 `self.fields[attr]`。
- cond 位置经 `_require_cond → _validate_cond_structure → _require_series_operand → _require_series` 自动覆盖。
- 纯放行：不影响既有公式的解析（裸字段路径不变）。
- 测试：`test_security.py` 增加 `CROSS_UP(W.CLOSE, W.MA(W.CLOSE,20))` 与 `COUNT(W.CLOSE > 10, 3)` 解析通过用例。

## 4. R2 前端：改写器（新纯函数 `frontend/src/lib/formulaTimeframe.ts`）

```ts
export function rewriteFormulaForTimeframe(
  formula: string, fromTf: 'D' | 'W' | 'M', toTf: 'D' | 'W' | 'M'
): string
```

- `fromTf === toTf` 或空公式 → 原样返回。
- 用 `splitBoolTopLevel`（复用 selectNL.ts 的拆分语义，本文件内实现副本）拆原子，逐原子：
  - 收集带前缀 token 的前缀集合（排除 AND/OR）。
  - **跳过**（原样返回）：① 含板块字段（`S_CLOSE`/`S_PCT_CHG`/`INDUSTRY_*`/`SECTOR_*`）——前缀原子禁用板块字段；② 含日线专属字段（`IS_LIMIT_UP`/`IS_TOUCH_LIMIT_UP`/`IS_LIMIT_DOWN`/`IS_TOUCH_LIMIT_DOWN`/`PREV_CLOSE`）——周/月表无列；③ 前缀集合 >1（混合原子，后端本就拒绝，保守不动）。
  - **裸原子** → `toTf === 'D'` 原样；否则加 `toTf` 前缀：函数调用位置加在函数名（`W.MA(`），字段位置加在字段（`W.CLOSE`）。
  - **前缀集合 == {toTf}** → 原样。
  - **前缀集合 == {fromTf}**（≠ toTf）→ 改为目标形式：`toTf==='D'` 去前缀；否则前缀 `fromTf → toTf` 替换（`W.` → `M.`）。
  - **其他前缀（跨周期）** → 原样。
- 任何异常兜底返回原文。
- 拼接保持原子间 AND/OR 原文分隔符。

## 5. R3 前端：接线（SelectionWorkspace.tsx）

- 新增 `handleTimeframeChange(tf)`：`setFormula(rewriteFormulaForTimeframe(formula, timeframe, tf))` + `setTimeframe(tf)`，传给 `SelectionControls` 的 `onTimeframeChange`。
- AI 回填（`onRun` 内 `setTimeframe(aiTimeframe)`）与策略库进入（`setTimeframe(tf)`）不改。

## 6. 测试

- 后端：R1 两用例 + 现有全量。
- 前端：新 `frontend/tests/formula-rewrite.test.mjs`（复制实现惯例）：裸→W 加前缀（函数/字段位置）、W→D 去前缀、D→W→D 往返、W→M 换前缀、跨周期原子保留、板块/日线专属字段原子跳过、混合原子跳过、幂等、空公式、异常输入。
- `npx tsc --noEmit` 0 错误。
- 部署后生产验证：`CROSS_UP(W.CLOSE, W.MA(W.CLOSE,20))` + W 可执行；表单手工场景（切周期后提交成功）。

## 7. 不做 / 风险

- 不改 AI 回填与策略库加载路径（Q3）。
- 不自动修复用户手写的混合原子（后端仍拒绝，错误信息已透传节点详情）。
- 全前缀公式在引擎走 as-of 慢路径，性能弱于裸单周期公式（可接受，量级 <200 只×60 周窗口）。
