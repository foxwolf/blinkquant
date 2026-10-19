// src/lib/selectNLServer.ts
// 服务端运行时：节点元数据拉取 / LLM 调用 / 共享限流存储。
// 纯函数（selectNL.ts）与运行时（本文件）分离，供 /api/select-nl 与 /api/select-nl/analyze 复用。

import type { NLMeta } from './selectNL';
import { isNemotronModel, type ResolvedLlmConfig } from './llmConfig';

// 测试模式：设置 NL_TEST_MODE=true 时跳过限流（仅供自动化测试，生产勿开）。
export const NL_TEST_MODE = process.env.NL_TEST_MODE === 'true';

export const NODES = [
  'https://scanli-blinkquant-node1.hf.space',
  'https://scanli-blinkquant-node2.hf.space',
  'https://scanli-blinkquant-node3.hf.space',
];

const META_TTL_MS = 24 * 60 * 60 * 1000;
let metaCache: { at: number; data: NLMeta } | null = null;

// 限流存储共享：分析端点与翻译端点使用同一 Map，但 key 前缀不同（见各自 route）。
// Vercel 每实例内存 Map 的近似性在两端点间一致。
export const rateStore = new Map<string, { timestamps: number[] }>();

export async function fetchNlMeta(): Promise<NLMeta> {
  if (metaCache && Date.now() - metaCache.at < META_TTL_MS) return metaCache.data;
  const result = await Promise.any(
    NODES.map(async (nodeUrl) => {
      const res = await fetch(`${nodeUrl}/api/v1/nl-meta`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`Node responded with ${res.status}`);
      return res.json();
    })
  );
  metaCache = { at: Date.now(), data: result as NLMeta };
  return result as NLMeta;
}

export async function callLlm(cfg: ResolvedLlmConfig, systemPrompt: string, query: string): Promise<string> {
  const nemotron = isNemotronModel(cfg.model);
  const llmRes = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query },
      ],
      temperature: 0,
      ...(nemotron ? {} : { reasoning_effort: cfg.reasoningEffort }),
      ...(nemotron && cfg.templateKwargs ? { chat_template_kwargs: cfg.templateKwargs } : {}),
      max_tokens: cfg.maxTokens,
    }),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  });
  if (!llmRes.ok) {
    throw new Error(`LLM HTTP ${llmRes.status}`);
  }
  const llmJson = await llmRes.json();
  return llmJson?.choices?.[0]?.message?.content ?? '';
}
