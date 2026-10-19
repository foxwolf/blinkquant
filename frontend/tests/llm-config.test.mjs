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

test('select-nl 路由契约：使用 resolveLlmConfig 且不再读 LLM_ 常量', () => {
  for (const rel of ['../src/app/api/select-nl/route.ts', '../src/app/api/select-nl/analyze/route.ts']) {
    const src = read(rel);
    assert.match(src, /resolveLlmConfig/);
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
