# 策略公式卡片增强：策略库下拉 + 函数插入菜单

日期：2026-10-20
状态：已批准（内联下拉/管理去策略页；插入典型参数模板）
前置：v2.5 选股卡片重排已上线（main @ 0c6315b，生产 P0 全过）。

## 需求

1. 卡片内加「策略库」下拉，方便复用已保存策略（点选即回填并可追溯来源版本）。
2. 公式编辑框右上角加函数下拉菜单，选中函数后在编辑框光标处插入。

## 现状事实

- `SelectionWorkspace.tsx`：`showStrategies`/`StrategyList` modal 为死代码（无入口）；`handleApplyStrategy` 不回填策略名、不写快照。
- `GET /api/strategies`（前端 Edge → node1 `/user-assets/strategies`）返回 `{strategies:[{id,name,formula,timeframe,version_no,…}]}`，version_no = 最新版本号（`user_assets.py:62`）。
- 完整来源快照 `{id,version_no,name,formula,timeframe}` 机制已在 v2.5 打通（成果标题/来源行/详情链接）。
- 后端 `/api/v1/nl-meta`（公开只读）返回 `{fields, indicators, timeframes, units, example_queries, signatures, descriptions}`；前端仅有服务端用法（`selectNLServer.ts`），**无浏览器路由**。
- 节点代理惯例：`requireAuth` + `Promise.any`×3 + 5s 超时（`stock-sectors/route.ts`）。

## 设计

### A. `/api/nl-meta` 代理路由（新）

`frontend/src/app/api/nl-meta/route.ts`，edge runtime：
- `requireAuth`（工作台登录态才可用）→ `Promise.any`×3 节点 `GET /api/v1/nl-meta`，5s 超时 → 原样 JSON。
- 失败 503 `{error}`。客户端调用频率极低（每次打开函数菜单才拉，且做内存缓存），不加服务端缓存。

### B. StrategyPicker（新组件 `frontend/src/components/select/StrategyPicker.tsx`）

- 按钮「策略库 ▾」置于卡片标题行（策略名输入框与 AI 选股之间由 Workspace 布局决定，最终：策略名 → 策略库 ▾ → ml-auto AI 选股）。
- 每次**展开时** `GET /api/strategies`（no-store），loading/empty/error 三态在菜单内显示。
- 列表项：名称（粗体）、公式 mono 截断、周期角标 D/W/M；`max-h-72 overflow-y-auto`；点击 → `onPick(strategy)`，菜单收起。
- 底部行：`管理策略 →` 链接 `/strategies`（`<Link>`）。
- 菜单为 `absolute z-40` + 透明 backdrop 点击关闭；`w-72`。
- 组件卸载/收起时清数据缓存（避免保存新策略后陈旧）。

Workspace 接线：
- 删除 `StrategyList` dynamic import、`showStrategies` 状态与 modal 渲染；删除 `StrategyList.tsx` 文件。
- `onPick` 语义（与 pending 策略流一致）：`setFormula`、`setTimeframe`、`setStrategyName(name)`、`setSelectionStrategySource({id, version_no, name, formula, timeframe})`；不自动运行选股。
- 之后手改公式 → 现有 `handleFormulaChange` 清快照逻辑自动生效；AI 重写 → v2.5 逻辑清快照。

### C. FormulaFunctionMenu（新组件 `frontend/src/components/select/FormulaFunctionMenu.tsx`）

- 渲染于 `SelectionControls` 公式 textarea 容器内右上角（`absolute right-2 top-1.5`，半透明白底小按钮「ƒx 函数 ▾」）；textarea 加 `pt-7` 避让首行。
- 数据：首次打开拉 `/api/nl-meta`（模块级 Promise 缓存），用 `indicators`+`signatures`+`descriptions` 渲染分组菜单；拉取失败 → 菜单内错误提示，不阻塞输入。
- 分组（按指标名硬编码归属，未列出者归「其他」）：
  - 均线/窗口：MA EMA STD ROC REF HHV LLV SUM
  - 交叉/统计：CROSS_UP CROSS_DOWN MAX MIN ABS COUNT BARSLAST
  - 技术指标：其余全部（RSI/MACD_*/KDJ_*/BOLL_*/DMI_*/OBV/CCI/WR/MFI/SAR/AROON_*/TRIX/BBI/VWAP/BIAS/PPO/DEMA/TEMA/UO/VR/PSY/CR/ATR）
  - 每项 `title={descriptions[name]}` 悬浮中文说明。
- 插入模板 `SAMPLE_CALLS`（组件内静态 `Record<string,string>`，与后端指标名一致）：
  - 典型：`MA(CLOSE, 20)` `EMA(CLOSE, 12)` `STD(CLOSE, 20)` `ROC(CLOSE, 20)` `REF(CLOSE, 1)` `HHV(CLOSE, 20)` `LLV(CLOSE, 20)` `SUM(AMOUNT, 5)` `CROSS_UP(MA(CLOSE, 20), MA(CLOSE, 60))` `CROSS_DOWN(MA(CLOSE, 20), MA(CLOSE, 60))` `MAX(OPEN, CLOSE)` `MIN(OPEN, CLOSE)` `ABS(CLOSE - MA(CLOSE, 20))` `COUNT(CLOSE > MA(CLOSE, 20), 10)` `BARSLAST(CLOSE > MA(CLOSE, 20))` `ATR(14)` `RSI(CLOSE, 14)` `BOLL_UPPER(CLOSE, 20, 2)` `BOLL_LOWER(CLOSE, 20, 2)` `BOLL_MID(CLOSE, 20)` `KDJ_K(9, 3)` `KDJ_D(9, 3)` `KDJ_J(9, 3)` `MACD_DIF(12, 26)` `MACD_DEA(12, 26, 9)` `MACD_HIST(12, 26, 9)` `DMI_PDI(14)` `DMI_MDI(14)` `DMI_ADX(14)` `OBV()` `CCI(14)` `WR(14)` `MFI(14)` `SAR()` `AROON_UP(14)` `AROON_DOWN(14)` `TRIX(14)` `BBI()` `VWAP(20)` `BIAS(20)` `PPO(12, 26)` `DEMA(CLOSE, 20)` `TEMA(CLOSE, 20)` `UO()` `VR(14)` `PSY(12)` `CR(20)`
  - 未知函数回退 `` `${NAME}()` ``。
- 插入实现（在 SelectionControls，持有 textarea ref）：
  ```ts
  const insertAtCursor = (text: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? formula.length;
    const end = el?.selectionEnd ?? formula.length;
    const next = formula.slice(0, start) + text + formula.slice(end);
    onFormulaChange(next);
    requestAnimationFrame(() => { el?.focus(); const pos = start + text.length; el?.setSelectionRange(pos, pos); });
  };
  ```
- 菜单样式与 StrategyPicker 一致（backdrop 关闭、`max-h-72` 滚动、`w-64`）。

### 不做

字段插入菜单、语法校验、函数手册弹窗、StrategyList modal 双入口。

## 测试与验证

- `npx tsc --noEmit` → `npm run build`（顺序，workdir frontend），33/33。
- 后端零改动 → 不触发 backend 部署。
- 手动清单：
  1. 策略库下拉出现/刷新/空态；点选回填公式+周期+策略名；运行后成果来源行「X · vN」+ 详情链接。
  2. 保存新策略后重新展开下拉立即可见。
  3. 函数菜单三组齐全、悬浮说明；光标中间插入与选区替换；`Ctrl+Enter` 仍运行；textarea pt 避让不遮字。
  4. 移动端 375px：两菜单不溢出、可滚动。
