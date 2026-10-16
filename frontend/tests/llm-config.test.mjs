// frontend/tests/llm-config.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dirname, rel), 'utf8');

test('schema 契约：init_db.sql 含 llm_configs 表与部分唯一索引', () => {
  const sql = read('../scripts/init_db.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS llm_configs/);
  assert.match(sql, /idx_llm_configs_one_active/);
  assert.match(sql, /WHERE is_active = TRUE/);
});

test('schema 契约：migrate_llm_configs.sql 与 init_db 一致', () => {
  const mig = read('../scripts/migrate_llm_configs.sql');
  assert.match(mig, /CREATE TABLE IF NOT EXISTS llm_configs/);
  assert.match(mig, /api_key_enc/);
  assert.match(mig, /idx_llm_configs_one_active/);
});
