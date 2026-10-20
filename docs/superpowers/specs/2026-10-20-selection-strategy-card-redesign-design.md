# 选股工作台「策略公式」卡片重排与策略名/过滤器设计

日期：2026-10-20
状态：已批准（用户逐节确认）

## 背景与目标

选股工作台（`/select`）的策略公式卡片当前把所有控件挤在一行：公式 input、日期、运行选股、AI 选股、保存为策略。移动端控件纵向堆叠后底部按钮不可达。四个问题：

1. AI 选股生成公式点「运行选股」后，公式编辑框仍是旧公式（缺省 `CLOSE > MA(CLOSE, 20)`），所见非所跑。
2. 策略公式没有策略名，任务中心/成果库无法引用命名，后期管理困难。
3. 日期控件默认显示「年/月/日」空值，应显示当前日期。
4. 卡片元素需要重排（用户提供了 ASCII 示意图）。

本期范围（用户已确认）：重排 + 多行输入 + 剔除ST/剔除停牌过滤器 + 上述问题 1/2/3。**不含**常用模板、函数手册、代码高亮（留下一期）。

## 现状事实

- 卡片组件：`frontend/src/components/select/SelectionControls.tsx`（单行 input + Enter 运行）。
- 状态与提交：`frontend/src/hooks/useSelection.ts`（`formula` 默认 `'CLOSE > MA(CLOSE, 20)'`，`selectDate` 默认 `''`，`handleSelect` 提交 payload `{formula, timeframe, date?, selection_strategy_snapshot?}` 到 `/api/v1/tasks`）。
- 装配层：`frontend/src/components/select/SelectionWorkspace.tsx`。AI `onRun` 目前只 `handleSelect({formula, timeframe, date})`，不回填状态（`SelectionWorkspace.tsx:188-191`）。
- 策略名机制（后端已存在）：task payload 带 `selection_strategy_snapshot.name` 时，成果标题自动为「{name} 选股成果」（`backend/scheduler/scheduler.py:846-848`、`backend/scheduler/db.py:296-297`）；成果库列表显示 `来源策略：{name} · v{version_no}`（`frontend/src/components/artifacts/ArtifactLibraryPage.tsx:211`）；成果详情页「查看来源策略」链接仅当 `selectionSource.id` 存在（`ArtifactDetailPage.tsx:195`）。
- 选股执行链：调度器 `dispatch_selection(payload)` 将任务 payload **整包** POST 到各节点 `{url}/api/v1/select`（`backend/scheduler/dispatcher.py:70-80`）；节点 `SelectionRequest`（`backend/api/routes.py:43-47`）仅含 `formula/timeframe/date/trace`；引擎 `execute_selector`（`backend/core/engine.py`）信号计算为 per-code as-of（每只票取 ≤target_date 最后一根 bar）。
- 数据列：日线 df 含 `isST`、`volume`、`amount`；停牌可由「信号日无 bar」或「末根 bar volume==0 且 amount==0」推导（同 `data_manager.get_limit_flags` 的推导口径）。
- 选股链路当前**没有** ST/停牌过滤；回测链路有独立的 `exclude_st`/`min_listing_days` universe 过滤（不经过本路径）。

方案选择：就地改造现有组件 + 后端最小增量（否决了新建独立卡片组件：仅一处使用无复用收益；否决前端侧过滤 ST：结果只有 codes，逐只补查破坏三节点扇出与成果快照一致性）。

## 设计

### 1. 布局重排（SelectionControls 重写内部 JSX）

```
策略公式   [策略名（可选，用于成果库标题）________]        [✨ AI 选股]
------------------------------------------------------------------
  CLOSE > MA(CLOSE, 20) AND VOL > MA(VOL, 5)      ← textarea，3 行，
  …                                              Ctrl+Enter 运行
------------------------------------------------------------------
基准日期 YYYY-MM-DD📅   过滤 [☑剔除ST][☑剔除停牌]  [保存为策略] [运行选股▶]
```

- 标题行：左侧「策略公式」标签，右侧策略名输入 + AI 选股按钮（AI 选股按钮由下方挪上来，不新增功能；图中「自然语言转公式」即 AI 选股）。
- 公式框：textarea 3 行 `resize-y`，placeholder 保持示例。**Enter 不再触发运行**（多行需要换行），改 **Ctrl+Enter** 触发 `onRun`。
- 第三行：基准日期、两个过滤勾选、保存为策略、运行选股；右对齐。
- 移动端：沿用 `flex-col sm:flex-row` 响应式，各块纵向堆叠，动作按钮行始终可见。
- 组件 props 增加：`strategyName`、`onStrategyNameChange`、`excludeSt`、`onExcludeStChange`、`excludeSuspended`、`onExcludeSuspendedChange`。

### 2. 策略名（轻量命名，贯通标题与来源）

- `useSelection` 新增 `strategyName` 状态（初始 `''`）。
- 运行选股 payload 选取规则（`handleSelect`）：
  - 存在完整来源快照（`strategySource`，来自策略库进入）→ 照旧携带完整 snapshot（id/version/name/…）。
  - 否则 `strategyName.trim()` 非空 → 携带 `selection_strategy_snapshot: {name, formula, timeframe}`（无 id/version）。
  - 两者皆无 → 不带该键（成果标题维持「选股成果 #id」）。
- 从策略库「运行选股」进入（`bq-pending-selection-strategy`）→ 自动预填 `strategyName = pending.name`。
- 公式被手改或 AI 重写 → 仅清除来源版本快照（现有 `handleFormulaChange` 逻辑不变），策略名保留。
- 「保存为策略」弹窗预填 `strategyName`；保存成功后保留该名字（此时卡片名与已存策略一致）。
- 前端展示兼容（name-only 快照无 version_no）：
  - `ArtifactLibraryPage.tsx` 来源行：`来源策略：{name}`，仅当有 `version_no` 才追加 ` · v{version_no}`（模板串改为条件拼接）。
  - `ArtifactDetailPage.tsx` 无需改（链接已有 `id` 守卫）；来源信息区若有 name 无版本时显示 name-only，同样做条件处理。
- 后端无需改动（scheduler 标题逻辑只读 `name`）。

### 3. AI 回填（问题 1）

`SelectionWorkspace.tsx` AI `onRun(formula, timeframe, date)`：
- `setFormula(formula)`（经由现有 `handleFormulaChange` 语义：与来源快照公式不一致时自动清快照）。
- `setTimeframe(timeframe)`。
- `date` 存在时 `setSelectDate(date)`。
- 关闭弹窗；不再直接 `handleSelect` 传 overrides —— 改为回填后以卡片当前状态执行 `handleSelect({date: selectDate || undefined})` 等价语义（AI 场景用回填后的 `date || selectDate`）。

回填后卡片所见即所跑；用户可在运行前目检/微调 AI 公式。

### 4. 基准日期默认今天（问题 3）

- `useSelection`：`const [selectDate, setSelectDate] = useState(() => localTodayStr())`，`localTodayStr` 用本地时区手工拼 `YYYY-MM-DD`（不用 `toISOString`，避免 UTC 偏移）。
- 留空 = 原「最新交易日」语义，控件 `title` 提示保留；填今天时后端归一到最近交易日，与原留空行为等价。
- rerun/历史任务读存储 payload，不受前端初始值影响。

### 5. 剔除ST / 剔除停牌（新过滤器）

前端：
- `useSelection` 新增 `excludeSt`、`excludeSuspended` 状态，**默认 true/true**（用户确认默认勾选）。
- `handleSelect` payload 增加 `exclude_st`、`exclude_suspended`（始终显式发送布尔值）。

调度器：无改动（`dispatch_selection` 整包转发；旧任务 payload 无这些键 → 节点按默认 false 执行，rerun 语义不变）。

节点 API（`backend/api/routes.py`）：
- `SelectionRequest` 新增 `exclude_st: bool = False`、`exclude_suspended: bool = False`。
- `/select`（含 trace 分支）把两参数传入 `execute_selector`；默认 False → API 向后兼容，回测内部调用（`execute_selector_ranked`、QFQ 路径）不受影响。

引擎（`backend/core/engine.py`）：
- `execute_selector` 新增 kwarg `exclude_st: bool = False, exclude_suspended: bool = False`。
- 实现为 `execute_selector` 尾部的**共享后过滤**（单周期 `_execute_single` 与 `_execute_mtf` 汇合之后、返回前）；仅当 `backtest_mode=False` 且对应开关开启且 codes 非空时执行：
  - 在 `data_manager.df_daily.filter(date <= target_date)` 上按 code 取末根 bar（一次聚合）。
  - 剔除ST：末根 bar `isST == 1` 剔除（null 视为非 ST）。
  - 剔除停牌：末根 bar `date < target_date`（信号日无数据），或末根 bar `volume == 0 且 amount == 0`（零成交占位行）→ 剔除。
  - 周/月线策略同样以**日线**末根 bar 判定（数据最全、语义与日频停复牌一致）。
- 成果元数据含 payload → 成果详情可追溯当时的过滤设置。

部署顺序（重要）：**先发后端节点，再发前端**。后端未更新时 pydantic 忽略新字段 → 勾选静默不生效（等同不过滤，不会报错）。

### 6. 行为变更与测试

行为变更（已确认接受）：前端默认勾选两开关 → 新的选股结果默认剔除 ST/停牌股（历史上只要公式满足就会被选出）。

测试：
- 后端 `backend/tests/test_engine.py` 新增：
  - ST 股（末根 bar isST==1）开关开启被剔除、关闭保留；
  - 停牌股（末根 bar 早于 target_date）被剔除；
  - 零成交行（volume==0 且 amount==0）被剔除；
  - 两开关关闭时结果与现状一致；
  - isST 为 null 不被剔除。
- 前端：`npx tsc --noEmit` → `npm run build`（顺序执行），33/33。
- 手动验收清单：AI 生成→回填→再跑；策略名→成果库标题「XX 选股成果」；策略库进入预填名与版本链接；日期默认今天/清空=最新交易日；Ctrl+Enter 运行；移动端按钮可见；两开关勾选生效。

## 明确不做（本期）

常用模板下拉、函数手册弹窗、公式代码高亮、回测链路过滤器改动、策略同名版本升级（强关联）。
