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
