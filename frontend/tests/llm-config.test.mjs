// frontend/tests/llm-config.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
