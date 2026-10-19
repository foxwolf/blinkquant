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
