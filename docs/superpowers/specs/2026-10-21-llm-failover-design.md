# AI 选股大模型故障转移（failover）设计

- 日期：2026-10-21
- 状态：已与用户确认（2 项决策 + 设计获批）
- 前置：v2.4 管理端多套 LLM 配置（单套启用）；当前无重试/切换，启用模型失败即请求失败

## 1. 需求

AI 选股（/api/select-nl、/api/select-nl/analyze）在当前启用的 LLM 调用失败（超时/网络错误/HTTP 4xx、5xx 含 429）时，自动切换到备选模型继续完成本次请求。

## 2. 已确认决策

| # | 问题 | 裁定 |
|---|---|---|
| Q1 | 切换触发范围 | **仅调用失败**（超时/网络/HTTP 错误）；翻译内容不合法仍用当前模型走 repair 修正，不切换 |
| Q2 | 备选链构成 | **全部配置自动排链**：启用配置打头，其余按 updated_at 新→旧，env 兜底；管理端 UI 不改 |

## 3. 设计

### R1 配置链（`llmConfig.ts`）

- 常量：`CHAIN_STEP_BUDGET_MS = 30000`（单模型上限，保证主+备各有完整机会）、`TOTAL_FAILOVER_BUDGET_MS = 55000`（Vercel 60s 硬限留余量）、`MIN_STEP_MS = 3000`（剩余不足不再尝试）。
- 纯函数 `buildConfigChain(rows, secret, env)`：入参为 llm_configs 全行（已按 `is_active DESC, updated_at DESC` 排序）、AUTH_SECRET、env 对象；逐行解密（解密失败/缺 secret 的行跳过）；env 配置追加链尾（env 不完整则不加）。返回 `ResolvedLlmConfig[]`。
- 纯函数 `planFailoverTimeouts(configs, totalBudgetMs)`：顺序分配，每项 `timeout = min(clampTimeoutMs(cfg.timeoutMs), CHAIN_STEP_BUDGET_MS, remaining)`；`remaining -= timeout`；剩余 `< MIN_STEP_MS` 停止。返回 `Array<{ cfg, timeoutMs }>`。
- `resolveLlmConfigChain()`：`SELECT … ORDER BY is_active DESC, updated_at DESC` → `buildConfigChain`。DB 查询异常时仍用 env 兜底。
- 现有 `resolveLlmConfig`（单配置）保留给管理端测试接口使用。

### R2 失败转移执行（`selectNLServer.ts`）

- `callLlmWithFailover(systemPrompt, query, configs?)`：configs 可注入（测试）。链条为空 → 返回 `null`（调用方回 503 NOT_CONFIGURED）。否则按 `planFailoverTimeouts` 顺序调 `callLlm`；单项失败 console.warn 记录并继续；全部失败 → 抛最后一个错误（调用方回 502）。成功返回 `{ text, model, source }`。
- 切换在 **callLlm 抛错**时发生；内容校验失败不经过本层（保持路由层 repair 语义）。

### R3 路由接线（select-nl / analyze）

- 删除开头 `resolveLlmConfig` + 503 判断；调用点改为 `callLlmWithFailover`：
  - analyze：单次调用，`null → 503`，成功响应头加 `X-LLM-Model: <model>@<source>`。
  - select-nl：`translateOnce` 内部走 failover；返回结构附带成功调用的 model/source，最终成功响应头带 `X-LLM-Model`。repair 是否执行仍由 `shouldRetryTranslation`（40s 预算）控制；repair 调用本身失败也走 failover 链。
- 限流语义不变：仅成功才 `recordRequest`，链内多次尝试不多计。

## 4. 测试

- `llm-config.test.mjs` 追加（复制实现惯例）：buildConfigChain 排序/解密失败跳过/env 兜底/缺 secret；planFailoverTimeouts 的 min 裁剪、预算耗尽截断、<3s 停止；路由契约（503 空链语义）。
- `npx tsc --noEmit`；现有 17+ 用例全过。
- 生产验证：临时新建一个坏 endpoint 配置并启用 → AI 选股应自动落到链上下一个配置成功（响应头可见实际模型）→ 恢复原启用配置。

## 5. 不做 / 风险

- 不改管理端 UI；「启用」语义 = 链头。
- 不做跨请求的模型健康度记忆（每请求独立尝试全链）；弱备选拖慢最坏情形 = 全链 55s 超时返回 502，可接受。
- 内容不合法不切换模型（Q1 裁定），弱模型输出质量问题的兜底仍是 repair。
