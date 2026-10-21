# 选股周/月周期修复 + 表单周期切换 设计

- 日期：2026-10-21
- 状态：根因已生产实验实锤，方案已获用户批准
- 关联调试结论：AI/公式选股周、月周期结果为 0 或任务失败

## 1. 根因（已实证）

三层问题叠加：

1. **引擎·挂载列与 as-of frame 不一致（核心）**：`_prepare_hot_jit`（engine.py:47-100）把 `MA_CLOSE_5` 等指标列广播挂载到 df_daily/df_weekly/df_monthly。用户 base_tf='W' 时 W. 原子 `mount_enabled=True`（engine.py:614）→ 解析命中 df_weekly 挂载列 → expr=`pl.col("MA_CLOSE_5")`；但 MTF 原子求值表是 `build_asof_frame` 重建表（data_manager.py:169-173 列白名单，无挂载列）→ `ColumnNotFoundError` → **engine.py:628-635 吞异常返回空集 → 0 结果**。
   - 生产实证：`W.MA(W.CLOSE,5) > W.MA(W.CLOSE,20)` → 0；`W.MA(W.CLOSE,2) > 10`（冷门窗口无挂载列）→ 1120；`W.EMA(W.CLOSE,7) > 0` → 1823；等价无前缀公式 `MA(CLOSE,5) > MA(CLOSE,20)` + W → 2268。
2. **引擎·解析器全局状态污染**：`_eval_atom:614` 在求值阶段设置 `blink_parser.mount_enabled`，残留影响下一次解析（`_build_plan` 解析时 mount_enabled 不可控）。
3. **前端·LLM 坏输出未拦截**：LLM 常输出混用形态 `W.MA(CLOSE,5)`（裸字段+前缀指标），被节点 `parse_multi_tf`（security.py:213 `Cannot mix bare and prefixed fields`）拒绝 → 3 节点 400 → 任务失败；前端 `validateFormula` 未校验该形态。

另有 UI 缺口：选股表单（SelectionControls）无日/周/月切换，手写公式恒以 D 提交。

## 2. 需求

### R1 引擎：MTF 原子挂载列治理（security.py `_build_plan`）

- atom 解析前显式 `self.mount_enabled = (tf == 'D')`，解析后恢复原值（try/finally）。
- 依据：D 的 as-of frame = `df_daily.filter(date<=target)`（挂载列保留）；W/M 的 as-of frame 是重建表（列白名单）→ W/M 原子必须走慢路径（rolling 在 as-of frame 上现算）。
- `engine.py:614`（`_eval_atom` 内 `blink_parser.mount_enabled = (tf == base_tf)`）删除：求值阶段不解析表达式，该行只污染全局状态。

### R2 引擎：atom 求值异常不再静默（engine.py）

- 新增 `class AtomEvalError(Exception)`。
- `_eval_atom` except：`raise_on_error=True` → 原 `BacktestSelectionError` 不变；否则 `raise AtomEvalError(...)`。
- `_execute_mtf`：`_fold_plan` 外包 `try/except AtomEvalError` → 返回 `{"error": f"MTF atom eval failed: {e}"}`（实时选股走 routes 400，与 parse error 行为一致）。回测路径（raise_on_error=True）行为不变。

### R3 前端：validateFormula 拦截混用原子（selectNL.ts + select-nl.test.mjs 副本同步）

- 在 `validateFormula` 增加原子级检查：用现有 `splitBoolTopLevel` 拆原子；对每个原子，若**同时存在**带前缀 token（`D./W./M.` 前缀的字段或指标）与**裸字段** token（无前缀且 ∈ fields）→ `{ok:false, reason:'同一原子内不能混用裸字段与周期前缀（如 W.MA(CLOSE,5) 应写 W.MA(W.CLOSE,5)）'}`。
- 语义与后端 `_collect_prefixes` + `_has_bare_fields` 对齐；括号内嵌套（cond/series 参数）不拆分，覆盖在同一原子内。
- 拒绝后走现有 LLM 修正重试链（select-nl 路由 :541 已有机制），无需新管道。
- `frontend/tests/select-nl.test.mjs` 的复制实现同步更新并新增用例。

### R4 前端：选股表单日/周/月切换（SelectionControls.tsx + SelectionWorkspace.tsx）

- `SelectionControls` 新增 props：`timeframe: string`、`onTimeframeChange: (tf: 'D'|'W'|'M') => void`。
- UI：在「基准日期」左侧加 D/W/M 按钮组（日/周/月），样式参照 `AISelectModal.tsx:185` 的周期按钮（`px-2 py-1 text-xs font-bold rounded-md`，选中 `bg-blue-600 text-white`，未选 `text-slate-500 hover:bg-slate-100`），带 `border` 容器与移动端可点面积（`py-1.5`）。
- `SelectionWorkspace` 传入 `timeframe` 与 `onTimeframeChange={setTimeframe}`；`handleSelect` 逻辑不变（继续用 state timeframe，`overrides?.timeframe ?? timeframe`）。
- AI 回填/策略库进入仍会 `setTimeframe`，与表单按钮状态自然同步。

## 3. 不变项

- 单周期路径（无前缀公式 + timeframe=W/M，`_execute_single`）不动——实测正常（df_weekly 原表挂载列有效）。
- hot-JIT 广播机制本身不动（D 原子仍享受挂载加速）。
- `build_asof_frame`、`_resample_all`、任务/调度链路不动。

## 4. 测试与验证

- 后端新增 `backend/tests/test_mtf_mount_regression.py`：
  1. 模拟挂载列存在（手动给 df_weekly 加 MA_CLOSE_5/20 列）→ `execute_selector('W.MA(W.CLOSE,5) > W.MA(W.CLOSE,20)', 'W')` 返回非空且与无挂载列时一致；
  2. patch `build_asof_frame` 返回缺列 frame → 实时 `execute_selector` 返回 error dict（非空 codes=false），不再静默 0。
- 现有 backend 测试全量回归（pytest backend/tests）。
- 前端：`node tests/select-nl.test.mjs` 全过（含新混用拒绝用例）；`npx tsc --noEmit` 0 错误。
- 部署后生产验证：`W.MA(W.CLOSE,5) > W.MA(W.CLOSE,20)` + W → 期望 2268（与无前缀等价公式一致）；`W.MA(CLOSE,5) > W.MA(CLOSE,20)` → 400 带 Parse error（属预期，前端已拦截不会提交）。
