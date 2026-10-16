# 管理页大模型设置设计（AI 选股 LLM 多套配置）

日期：2026-10-16
状态：已批准（方案 A：Postgres 多套配置 + 前端解析层）

## 目标

把 AI 选股的大模型配置从「静态 Vercel 环境变量、单套、改配置需重新部署」升级为「管理员在页面维护、多套可切换、切换即时生效」。API Key 加密落库，管理页只显示掩码。

## 现状

- 两个入口共用一套配置：`/api/select-nl`（翻译）与 `/api/select-nl/analyze`（语义分析），runtime `nodejs`、`maxDuration=60`。
- 配置在 `frontend/src/lib/selectNLServer.ts` **模块加载时**读成常量：`LLM_ENDPOINT` / `LLM_API_KEY` / `LLM_MODEL`（必填），`LLM_TIMEOUT_MS`（默认 50000，钳制上限 55000）、`LLM_REASONING_EFFORT`（默认 `low`）、`LLM_MAX_TOKENS`（默认 1024）、`LLM_TEMPLATE_KWARGS`（默认 `{"enable_thinking": false}`）。任一项必填缺失 → 503 `NOT_CONFIGURED`。
- `callLlm(system, user)`（`selectNLServer.ts:54`）用模块常量发请求，`temperature: 0`；`isNemotron()`（`selectNLServer.ts:19`，正则匹配 model 名）决定发 `reasoning_effort`（非 Nemotron）还是 `chat_template_kwargs`（Nemotron）。
- `NL_TEST_MODE=true` 跳过限流，仅自动化测试用。
- 管理页 `frontend/src/app/(app)/admin/page.tsx` 仅用户管理；admin 接口在 `/api/admin/*`，由 `requireAdmin` 守卫。
- 数据库为 Vercel Postgres（`@vercel/postgres`），schema 在 `frontend/scripts/init_db.sql` + `migrate_*.sql`；无任何设置类表。

## 设计

### 1. 数据模型

新表 `llm_configs`（追加到 `frontend/scripts/init_db.sql`，并新增 `frontend/scripts/migrate_llm_configs.sql` 供既有库执行一次）：

```sql
CREATE TABLE IF NOT EXISTS llm_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                    -- 显示名，如 "NVIDIA Nemotron"
  endpoint TEXT NOT NULL,                -- 完整 chat/completions URL
  model TEXT NOT NULL,
  api_key_enc TEXT NOT NULL,             -- base64(iv(12) || tag(16) || ciphertext)
  api_key_hint TEXT NOT NULL,            -- 掩码提示，如 "sk-…abcd"
  timeout_ms INTEGER NOT NULL DEFAULT 50000,
  reasoning_effort TEXT NOT NULL DEFAULT 'low',
  max_tokens INTEGER NOT NULL DEFAULT 1024,
  template_kwargs TEXT,                  -- JSON 字符串，留空=不发送
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- 数据库层保证「最多一套启用」
CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_configs_one_active
  ON llm_configs (is_active) WHERE is_active = TRUE;
```

### 2. 密钥安全（`frontend/src/lib/llmCrypto.ts`，新建）

- AES-256-GCM。密钥由 `AUTH_SECRET` 经 SHA-256 派生 32 字节；密文格式 `base64(iv(12) ‖ tag(16) ‖ ciphertext)`。
- 纯函数导出，便于 `node:test` 单测：`encryptApiKey(plain, secret)`、`decryptApiKey(enc, secret)`、`maskApiKey(plain)`（取前 3 + 后 4，如 `sk-…abcd`）。
- 写库只存密文 + 掩码；**任何 GET 接口都不返回密文或明文 Key**。
- 解密仅在服务端调用 LLM / 测试连接时发生。
- 生产缺 `AUTH_SECRET` 时保存直接报错，绝不降级为明文。

### 3. 配置解析层（`frontend/src/lib/llmConfig.ts`，新建）

```ts
export interface ResolvedLlmConfig {
  endpoint: string; apiKey: string; model: string;
  timeoutMs: number; reasoningEffort: string; maxTokens: number;
  templateKwargs?: Record<string, unknown>;
  source: 'db' | 'env';
}
export async function resolveLlmConfig(): Promise<ResolvedLlmConfig | null>;
```

优先级与行为：
1. `SELECT ... FROM llm_configs WHERE is_active = TRUE LIMIT 1` → 命中则解密 `api_key_enc`，`source='db'`。
2. 否则若 `LLM_ENDPOINT/KEY/MODEL` 齐全 → 用 env，`source='env'`（沿用现有默认值与钳制逻辑）。
3. 都没有 → `null`，路由照旧 503 `NOT_CONFIGURED`。

- **每次调用前读取、不做长缓存** → 切换立即生效、多实例一致；一条小索引查询，相对 LLM 延迟可忽略。
- 解密失败（如 `AUTH_SECRET` 轮换）→ `console.warn` 告警并当作未配置（降级 503），不让请求崩溃。
- env 的解析 / 钳制 / `template_kwargs` 解析逻辑集中到本文件。

### 4. `selectNLServer.ts` 改造

- 删除模块级 `LLM_*` 常量与 `isNemotron()` 的模块态依赖。
- `callLlm(cfg: ResolvedLlmConfig, systemPrompt: string, query: string)`；Nemotron 判定改为 `isNemotronModel(cfg.model)` 纯函数。
- `NL_TEST_MODE`、`NODES`、`fetchNlMeta`、`rateStore` 保持不变。
- 两个路由把 `!LLM_ENDPOINT || !LLM_API_KEY || !LLM_MODEL` 判断替换为：
  ```ts
  const cfg = await resolveLlmConfig();
  if (!cfg) return NextResponse.json({ error: 'AI 选股未配置', code: 'NOT_CONFIGURED' }, { status: 503 });
  ```

### 5. 管理接口（全部 `requireAdmin`，runtime `nodejs`）

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/admin/llm-configs` | 列表（`id,name,endpoint,model,apiKeyHint,timeoutMs,reasoningEffort,maxTokens,templateKwargs,isActive,updatedAt`）+ `activeSource: 'db'|'env'|'none'`、`envConfigured: boolean`；不含密钥 |
| POST | `/api/admin/llm-configs` | 新建（加密 Key；默认 `is_active=false`） |
| PATCH | `/api/admin/llm-configs/[id]` | 局部更新；`apiKey` 留空=保留原密文，填写则重新加密 |
| DELETE | `/api/admin/llm-configs/[id]` | 删除 |
| POST | `/api/admin/llm-configs/[id]/activate` | 事务内先全部置 `false` 再置该条 `true`（部分唯一索引双保险） |
| POST | `/api/admin/llm-configs/test` | 连通测试：传 `{id}` 用库中 Key，或传未保存的 `{endpoint,model,apiKey,timeoutMs,reasoningEffort,maxTokens,templateKwargs}`；发极短 prompt，超时约 15s，返回 `{ok, latencyMs}` / `{ok:false, error}`；**不计用户配额** |

校验：`endpoint` 必须 `http(s)://`、`model`/`apiKey` 非空（新建）、`timeoutMs` 钳制到 `[1000, 55000]`、`templateKwargs` 必须是合法 JSON（否则 400）。

### 6. 管理页 UI（改 `frontend/src/app/(app)/admin/page.tsx`）

- 顶部 Tab：**用户管理**（现有内容不动）/ **大模型设置**。
- 大模型设置：
  - 状态条：当前生效来源 —— 「数据库：<名称>」/「环境变量（未在页面管理）」/「未配置」。
  - 配置列表卡片：名称、模型名、endpoint 主机、高级参数摘要、`启用` 徽标；操作 `启用` / `测试连接` / `编辑` / `删除`。
  - 新建/编辑表单（高级参数可折叠）：名称、endpoint、model、API Key（编辑时显示 `sk-…abcd` 占位，**留空=不修改**）、timeoutMs、reasoningEffort、maxTokens、templateKwargs(JSON)。
  - 反馈：测试显示「成功 · 1.2s」或失败原因；删除需二次确认。
  - 响应式，沿用现有 slate/圆角风格。

## 错误处理 / 边界

- 生产缺 `AUTH_SECRET` → 保存报错，不落明文。
- 解密失败 → 告警并降级（该配置不可用，回退 env / 未配置）。
- 启用并发：事务 + 部分唯一索引，冲突时其中一个失败并提示。
- 删除当前启用配置 → 来源自动变 env / 未配置。
- endpoint 由管理员填写（视为可信），仅校验 `http(s)://`；SSRF 风险接受（管理员已是最敏感权限）。

## 落地步骤

1. 新增 `frontend/scripts/migrate_llm_configs.sql` 并在 Vercel Postgres 执行一次建表；`init_db.sql` 同步追加该表便于全新部署。
2. 新增 `llmCrypto.ts`、`llmConfig.ts`，改造 `selectNLServer.ts` 与两个路由。
3. 新增 `/api/admin/llm-configs*` 路由 + 管理页 Tab。
4. 前端部署即可，**后端不涉及**；env 继续兜底 → 零中断。
5. 管理员在页面新建配置 → 测试连接 → 启用。

## 测试

- 纯函数单测 `frontend/tests/llm-config.test.mjs`（`node:test`）：加解密往返、错误密钥失败、掩码、env 解析/钳制、`isNemotronModel` 按模型判定、`resolveLlmConfig` 优先级（mock 依赖或用契约式断言）。
- 契约断言：GET 不返回密钥字段；两个 select-nl 路由调用 `resolveLlmConfig`。
- CI：`.github/workflows/frontend-ci.yml` 增加一步 `node tests/llm-config.test.mjs`（CI 无真实 Postgres，DB 部分走契约式断言）。
- 手工：新建 → 测试 → 启用 → 切换 → 删除 → env 兜底。

## 非目标（YAGNI）

- 按用户选择模型、用量/计费统计、密钥自动轮换、同时多套启用、非 OpenAI 协议、流式输出。
- `NL_TEST_MODE` 不进管理页（仅测试用，留在 env）。

## 行为差异（可接受）

配置从「模块加载时静态常量」变为「每次调用前解析」，每次 AI 选股多一条小查询；换来多套切换即时生效、无需重新部署。env 兜底保证既有部署零中断。
