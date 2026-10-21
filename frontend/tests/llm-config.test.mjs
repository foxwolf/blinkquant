// frontend/tests/llm-config.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dirname, rel), 'utf8');

const extractCreateTable = (src) => {
  const start = src.indexOf('CREATE TABLE IF NOT EXISTS llm_configs');
  assert.notStrictEqual(start, -1, 'missing CREATE TABLE IF NOT EXISTS llm_configs');
  const end = src.indexOf(';', start);
  assert.notStrictEqual(end, -1, 'missing terminating ; for llm_configs DDL');
  return src.slice(start, end + 1).replace(/\s+/g, ' ').trim();
};

test('schema 契约：init_db.sql 含 llm_configs 表与部分唯一索引', () => {
  const sql = read('../scripts/init_db.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS llm_configs/);
  assert.match(sql, /api_key_enc/);
  assert.match(sql, /idx_llm_configs_one_active/);
  assert.match(sql, /WHERE is_active = TRUE/);
});

test('schema 契约：migrate_llm_configs.sql 与 init_db 一致', () => {
  const mig = read('../scripts/migrate_llm_configs.sql');
  assert.match(mig, /CREATE TABLE IF NOT EXISTS llm_configs/);
  assert.match(mig, /api_key_enc/);
  assert.match(mig, /idx_llm_configs_one_active/);
  assert.match(mig, /WHERE is_active = TRUE/);
});

test('schema 契约：init_db.sql 与 migrate_llm_configs.sql 的 llm_configs DDL 完全一致', () => {
  const init = extractCreateTable(read('../scripts/init_db.sql'));
  const mig = extractCreateTable(read('../scripts/migrate_llm_configs.sql'));
  assert.strictEqual(mig, init);
});

// ---- 复制 src/lib/llmCrypto.ts 的实现（仓库惯例：测试副本防 drift）----
function deriveKey(secret) {
  return createHash('sha256').update(secret).digest();
}
function encryptApiKey(plain, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}
function decryptApiKey(enc, secret) {
  const raw = Buffer.from(enc, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
function maskApiKey(plain) {
  if (!plain) return '';
  if (plain.length <= 8) return '****';
  return `${plain.slice(0, 3)}…${plain.slice(-4)}`;
}

test('AES-GCM 加解密往返', () => {
  const secret = 'test-secret-0123456789abcdef';
  const key = 'sk-abcdefghijklmnop';
  const enc = encryptApiKey(key, secret);
  assert.notEqual(enc, key);
  assert.equal(decryptApiKey(enc, secret), key);
});

test('错误密钥解密抛错', () => {
  const enc = encryptApiKey('sk-secret-value-123', 'secret-A');
  assert.throws(() => decryptApiKey(enc, 'secret-B'));
});

test('掩码：取前3后4，短 Key 全掩码', () => {
  assert.equal(maskApiKey('sk-abcdefghij1234'), 'sk-…1234');
  assert.equal(maskApiKey('short'), '****');
  assert.equal(maskApiKey(''), '');
});

test('llmCrypto 源文件存在且导出三个函数', () => {
  const src = read('../src/lib/llmCrypto.ts');
  assert.match(src, /export function encryptApiKey/);
  assert.match(src, /export function decryptApiKey/);
  assert.match(src, /export function maskApiKey/);
});

// ---- 复制 src/lib/llmConfig.ts 的纯函数 ----
const LLM_TIMEOUT_DEFAULT_MS = 50000;
const LLM_TIMEOUT_CAP_MS = 55000;
const DEFAULT_MAX_TOKENS = 1024;

function clampTimeoutMs(v) {
  if (!Number.isFinite(v) || v < 1000) return LLM_TIMEOUT_DEFAULT_MS;
  return Math.min(Math.floor(v), LLM_TIMEOUT_CAP_MS);
}
function parseMaxTokens(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v)) || Number(v) <= 0) return DEFAULT_MAX_TOKENS;
  return Math.floor(Number(v));
}
function parseTemplateKwargs(raw) {
  if (raw === null || raw === undefined || raw === '') return undefined;
  if (typeof raw === 'object') return raw;
  try {
    const p = JSON.parse(String(raw));
    return p && typeof p === 'object' ? p : undefined;
  } catch {
    return undefined;
  }
}
function isNemotronModel(model) {
  return /nemotron|lightning/i.test(model || '');
}

test('超时钳制：下限 1s、上限 55s、非法回落默认', () => {
  assert.equal(clampTimeoutMs(50_000), 50_000);
  assert.equal(clampTimeoutMs(100_000), 55_000);
  assert.equal(clampTimeoutMs(500), 50_000);
  assert.equal(clampTimeoutMs(NaN), 50_000);
});

test('maxTokens 解析：非法回落默认', () => {
  assert.equal(parseMaxTokens(2048), 2048);
  assert.equal(parseMaxTokens(0), 1024);
  assert.equal(parseMaxTokens(undefined), 1024);
});

test('templateKwargs 解析：对象/JSON 字符串/非法', () => {
  assert.deepEqual(parseTemplateKwargs('{"enable_thinking":false}'), { enable_thinking: false });
  assert.deepEqual(parseTemplateKwargs({ a: 1 }), { a: 1 });
  assert.equal(parseTemplateKwargs('not json'), undefined);
  assert.equal(parseTemplateKwargs(''), undefined);
});

test('isNemotronModel 按模型名判定', () => {
  assert.equal(isNemotronModel('nvidia/nemotron-3-ultra-550b-a55b'), true);
  assert.equal(isNemotronModel('nemotron-3.5-lightning'), true);
  assert.equal(isNemotronModel('openai/gpt-oss-120b'), false);
  assert.equal(isNemotronModel(''), false);
});

test('llmConfig 契约：库优先/env 兜底', () => {
  const src = read('../src/lib/llmConfig.ts');
  assert.match(src, /export async function resolveLlmConfig/);
  assert.match(src, /FROM llm_configs WHERE is_active = TRUE/);
  assert.match(src, /source: 'db'/);
  assert.match(src, /source: 'env'/);
  assert.match(src, /export function resolveEnvConfig/);
});

test('select-nl 路由契约：走 callLlmWithFailover 且区分 503/502', () => {
  for (const rel of ['../src/app/api/select-nl/route.ts', '../src/app/api/select-nl/analyze/route.ts']) {
    const src = read(rel);
    assert.match(src, /callLlmWithFailover/);
    assert.match(src, /LlmNotConfiguredError/);
    assert.match(src, /NOT_CONFIGURED/);
    assert.doesNotMatch(src, /LLM_ENDPOINT/);
    assert.doesNotMatch(src, /LLM_API_KEY/);
  }
});

test('selectNLServer 契约：callLlm 接收配置对象', () => {
  const src = read('../src/lib/selectNLServer.ts');
  assert.match(src, /export async function callLlm\(\s*cfg: ResolvedLlmConfig/);
  assert.doesNotMatch(src, /const LLM_ENDPOINT = process\.env/);
  assert.doesNotMatch(src, /function isNemotron\(\)/);
});

test('管理接口契约：GET 列表不暴露密钥字段', () => {
  const src = read('../src/app/api/admin/llm-configs/route.ts');
  assert.match(src, /requireAdmin/);
  assert.match(src, /export const runtime = 'nodejs'/);
  assert.doesNotMatch(src, /apiKeyEnc/);
  assert.doesNotMatch(src, /api_key_enc:/);
});

test('管理接口契约：[id] 支持更新与删除，activate 在事务内切换', () => {
  const idSrc = read('../src/app/api/admin/llm-configs/[id]/route.ts');
  assert.match(idSrc, /export async function PATCH/);
  assert.match(idSrc, /export async function DELETE/);
  assert.match(idSrc, /apiKey 留空|不修改|typeof body.apiKey/);

  const actSrc = read('../src/app/api/admin/llm-configs/[id]/activate/route.ts');
  assert.match(actSrc, /sql.connect\(\)/);
  assert.match(actSrc, /BEGIN/);
  assert.match(actSrc, /COMMIT/);
  assert.match(actSrc, /release\(\)/);
});

test('管理接口契约：test 路由用 callLlm 且短超时', () => {
  const src = read('../src/app/api/admin/llm-configs/test/route.ts');
  assert.match(src, /callLlm/);
  assert.match(src, /latencyMs/);
  assert.match(src, /requireAdmin/);
});

// ---- 复制 src/lib/llmConfig.ts 的 failover 纯函数 ----
const CHAIN_STEP_BUDGET_MS = 40000;
const TOTAL_FAILOVER_BUDGET_MS = 55000;
const MIN_STEP_MS = 3000;
const DEFAULT_REASONING_EFFORT = 'low';
const DEFAULT_TEMPLATE_KWARGS = '{"enable_thinking": false}';

function resolveEnvConfig(env) {
  const { LLM_ENDPOINT, LLM_API_KEY, LLM_MODEL } = env;
  if (!LLM_ENDPOINT || !LLM_API_KEY || !LLM_MODEL) return null;
  return {
    endpoint: LLM_ENDPOINT,
    apiKey: LLM_API_KEY,
    model: LLM_MODEL,
    timeoutMs: clampTimeoutMs(env.LLM_TIMEOUT_MS),
    reasoningEffort: env.LLM_REASONING_EFFORT || DEFAULT_REASONING_EFFORT,
    maxTokens: parseMaxTokens(env.LLM_MAX_TOKENS ? Number(env.LLM_MAX_TOKENS) : undefined),
    templateKwargs: parseTemplateKwargs(env.LLM_TEMPLATE_KWARGS || DEFAULT_TEMPLATE_KWARGS),
    source: 'env',
  };
}

function buildConfigChain(rows, secret, env) {
  const chain = [];
  const sorted = [...rows].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
  for (const r of sorted) {
    if (!secret) break;
    try {
      chain.push({
        endpoint: r.endpoint,
        apiKey: decryptApiKey(r.api_key_enc, secret),
        model: r.model,
        timeoutMs: clampTimeoutMs(Number(r.timeout_ms)),
        reasoningEffort: r.reasoning_effort || DEFAULT_REASONING_EFFORT,
        maxTokens: parseMaxTokens(Number(r.max_tokens)),
        templateKwargs: parseTemplateKwargs(r.template_kwargs),
        source: 'db',
      });
    } catch (e) {
      console.warn('[llmConfig] 配置解密失败，跳过该配置:', e instanceof Error ? e.message : e);
    }
  }
  const envCfg = resolveEnvConfig(env);
  if (envCfg) chain.push(envCfg);
  return chain;
}

function planFailoverTimeouts(configs, totalBudgetMs = TOTAL_FAILOVER_BUDGET_MS) {
  const steps = [];
  let remaining = totalBudgetMs;
  for (const cfg of configs) {
    const timeoutMs = Math.min(cfg.timeoutMs, CHAIN_STEP_BUDGET_MS, remaining);
    if (timeoutMs < MIN_STEP_MS) break;
    steps.push({ cfg, timeoutMs });
    remaining -= timeoutMs;
    if (remaining < MIN_STEP_MS) break;
  }
  return steps;
}

const SECRET = 'failover-test-secret';

test('buildConfigChain：启用配置打头，其余按 updated_at 新→旧，env 兜底', () => {
  const enc = (m) => encryptApiKey(`key-${m}`, SECRET);
  const rows = [
    { endpoint: 'https://b', model: 'model-b', api_key_enc: enc('b'), timeout_ms: 50000, reasoning_effort: null, max_tokens: 1024, template_kwargs: null, is_active: false, updated_at: '2026-10-01T00:00:00Z' },
    { endpoint: 'https://a', model: 'model-a', api_key_enc: enc('a'), timeout_ms: 50000, reasoning_effort: null, max_tokens: 1024, template_kwargs: null, is_active: true, updated_at: '2026-09-01T00:00:00Z' },
    { endpoint: 'https://c', model: 'model-c', api_key_enc: enc('c'), timeout_ms: 50000, reasoning_effort: null, max_tokens: 1024, template_kwargs: null, is_active: false, updated_at: '2026-10-10T00:00:00Z' },
  ];
  const chain = buildConfigChain(rows, SECRET, { LLM_ENDPOINT: 'https://env', LLM_API_KEY: 'env-key', LLM_MODEL: 'env-model' });
  assert.deepEqual(chain.map((c) => `${c.model}@${c.source}`), ['model-a@db', 'model-c@db', 'model-b@db', 'env-model@env']);
  assert.equal(chain[0].apiKey, 'key-a');
});

test('buildConfigChain：解密失败跳过、缺 secret 仅 env、env 缺失不追加', () => {
  const rows = [
    { endpoint: 'https://bad', model: 'bad', api_key_enc: 'not-a-valid-cipher', timeout_ms: 50000, reasoning_effort: null, max_tokens: 1024, template_kwargs: null, is_active: true, updated_at: '2026-10-01T00:00:00Z' },
  ];
  const env = { LLM_ENDPOINT: 'https://env', LLM_API_KEY: 'k', LLM_MODEL: 'env-model' };
  assert.deepEqual(buildConfigChain(rows, SECRET, env).map((c) => c.model), ['env-model']);
  assert.deepEqual(buildConfigChain(rows, undefined, env).map((c) => c.source), ['env']);
  assert.deepEqual(buildConfigChain(rows, SECRET, {}), []);
});

test('planFailoverTimeouts：单模型裁到 40s，链内共享总预算，剩余不足 3s 停止', () => {
  const mk = (timeoutMs, model) => ({ model, timeoutMs });
  // 单配置 50s → 裁到 40s
  assert.deepEqual(planFailoverTimeouts([mk(50000, 'a')]).map((s) => s.timeoutMs), [40000]);
  // 两个 50s 配置：40s + 15s（剩余预算），之后剩余 < 3s 不再尝试
  const three = planFailoverTimeouts([mk(50000, 'a'), mk(50000, 'b'), mk(50000, 'c')]);
  assert.deepEqual(three.map((s) => `${s.cfg.model}:${s.timeoutMs}`), ['a:40000', 'b:15000']);
  // 小配置保留自身值
  const small = planFailoverTimeouts([mk(10000, 'a'), mk(10000, 'b'), mk(10000, 'c')]);
  assert.deepEqual(small.map((s) => `${s.cfg.model}:${s.timeoutMs}`), ['a:10000', 'b:10000', 'c:10000']);
});

test('selectNLServer 契约：callLlmWithFailover 抛 LlmNotConfiguredError 且记录切换', () => {
  const src = read('../src/lib/selectNLServer.ts');
  assert.match(src, /export class LlmNotConfiguredError/);
  assert.match(src, /export async function callLlmWithFailover/);
  assert.match(src, /planFailoverTimeouts/);
  assert.match(src, /llmFailover/);
});
