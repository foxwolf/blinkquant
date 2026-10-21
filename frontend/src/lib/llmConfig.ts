// src/lib/llmConfig.ts
// 服务端运行时：解析当前生效的大模型配置（库优先，env 兜底）。
import { sql } from './db';
import { decryptApiKey } from './llmCrypto';
import { resolveLlmTimeout } from './selectNL';

export interface ResolvedLlmConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  reasoningEffort: string;
  maxTokens: number;
  templateKwargs?: Record<string, unknown>;
  source: 'db' | 'env';
}

export const DEFAULT_REASONING_EFFORT = 'low';
export const DEFAULT_MAX_TOKENS = 1024;
export const DEFAULT_TEMPLATE_KWARGS = '{"enable_thinking": false}';

export function rowToConfig(r: any) {
  return {
    id: r.id,
    name: r.name,
    endpoint: r.endpoint,
    model: r.model,
    apiKeyHint: r.api_key_hint,
    timeoutMs: r.timeout_ms,
    reasoningEffort: r.reasoning_effort,
    maxTokens: r.max_tokens,
    templateKwargs: r.template_kwargs,
    isActive: r.is_active,
    updatedAt: r.updated_at,
  };
}

export function isNemotronModel(model: string | null | undefined): boolean {
  return /nemotron|lightning/i.test(model || '');
}

export function clampTimeoutMs(value: number): number {
  return resolveLlmTimeout(Number.isFinite(value) ? String(value) : null);
}

export function parseMaxTokens(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) <= 0) {
    return DEFAULT_MAX_TOKENS;
  }
  return Math.floor(Number(value));
}

export function parseTemplateKwargs(raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  if (typeof raw === 'object') return Array.isArray(raw) ? undefined : (raw as Record<string, unknown>);
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export interface EnvLike {
  LLM_ENDPOINT?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
  LLM_TIMEOUT_MS?: string;
  LLM_REASONING_EFFORT?: string;
  LLM_MAX_TOKENS?: string;
  LLM_TEMPLATE_KWARGS?: string;
}

export function resolveEnvConfig(env: EnvLike): ResolvedLlmConfig | null {
  const { LLM_ENDPOINT, LLM_API_KEY, LLM_MODEL } = env;
  if (!LLM_ENDPOINT || !LLM_API_KEY || !LLM_MODEL) return null;
  return {
    endpoint: LLM_ENDPOINT,
    apiKey: LLM_API_KEY,
    model: LLM_MODEL,
    timeoutMs: resolveLlmTimeout(env.LLM_TIMEOUT_MS),
    reasoningEffort: env.LLM_REASONING_EFFORT || DEFAULT_REASONING_EFFORT,
    maxTokens: parseMaxTokens(env.LLM_MAX_TOKENS ? Number(env.LLM_MAX_TOKENS) : undefined),
    templateKwargs: parseTemplateKwargs(env.LLM_TEMPLATE_KWARGS || DEFAULT_TEMPLATE_KWARGS),
    source: 'env',
  };
}

export async function resolveLlmConfig(): Promise<ResolvedLlmConfig | null> {
  const secret = process.env.AUTH_SECRET;
  try {
    const rows = await sql`
      SELECT endpoint, model, api_key_enc, timeout_ms, reasoning_effort, max_tokens, template_kwargs
      FROM llm_configs WHERE is_active = TRUE LIMIT 1
    `;
    if (rows.rows.length > 0 && secret) {
      const r = rows.rows[0];
      return {
        endpoint: r.endpoint,
        apiKey: decryptApiKey(r.api_key_enc, secret),
        model: r.model,
        timeoutMs: clampTimeoutMs(Number(r.timeout_ms)),
        reasoningEffort: r.reasoning_effort || DEFAULT_REASONING_EFFORT,
        maxTokens: parseMaxTokens(Number(r.max_tokens)),
        templateKwargs: parseTemplateKwargs(r.template_kwargs),
        source: 'db',
      };
    } else if (rows.rows.length > 0 && !secret) {
      console.warn('[llmConfig] 存在启用配置但缺少 AUTH_SECRET，回退环境变量');
    }
  } catch (e) {
    console.warn('[llmConfig] 读取启用配置失败，回退环境变量:', e);
  }
  return resolveEnvConfig(process.env as EnvLike);
}

// ── 故障转移（failover）链 ─────────────────────────────────────────────
// 链 = 启用配置打头，其余配置按 updated_at 新→旧，env 兜底。
// 单模型超时上限 CHAIN_STEP_BUDGET_MS（40s）：与 55s 总预算配合，
// 主模型 40s 失败后备选仍有 ~15s 完整机会；整链共享 TOTAL_FAILOVER_BUDGET_MS
//（Vercel 60s 硬限留余量）。

export const CHAIN_STEP_BUDGET_MS = 40000;
export const TOTAL_FAILOVER_BUDGET_MS = 55000;
export const MIN_STEP_MS = 3000;

export interface LlmConfigRow {
  endpoint: string;
  model: string;
  api_key_enc: string;
  timeout_ms: number;
  reasoning_effort: string | null;
  max_tokens: number;
  template_kwargs: unknown;
  is_active: boolean;
  updated_at: string | Date;
}

export function buildConfigChain(
  rows: LlmConfigRow[],
  secret: string | undefined,
  env: EnvLike,
): ResolvedLlmConfig[] {
  const chain: ResolvedLlmConfig[] = [];
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

export interface FailoverStep<TCfg> {
  cfg: TCfg;
  timeoutMs: number;
}

export function planFailoverTimeouts<TCfg extends { timeoutMs: number }>(
  configs: TCfg[],
  totalBudgetMs: number = TOTAL_FAILOVER_BUDGET_MS,
): Array<FailoverStep<TCfg>> {
  const steps: Array<FailoverStep<TCfg>> = [];
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

export async function resolveLlmConfigChain(): Promise<ResolvedLlmConfig[]> {
  const secret = process.env.AUTH_SECRET;
  try {
    const rows = await sql`
      SELECT endpoint, model, api_key_enc, timeout_ms, reasoning_effort, max_tokens, template_kwargs,
             is_active, updated_at
      FROM llm_configs
      ORDER BY is_active DESC, updated_at DESC
    `;
    return buildConfigChain(rows.rows as LlmConfigRow[], secret, process.env as EnvLike);
  } catch (e) {
    console.warn('[llmConfig] 读取配置链失败，仅用环境变量兜底:', e);
    const envCfg = resolveEnvConfig(process.env as EnvLike);
    return envCfg ? [envCfg] : [];
  }
}
