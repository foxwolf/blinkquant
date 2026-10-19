import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { encryptApiKey, maskApiKey } from '@/lib/llmCrypto';
import {
  clampTimeoutMs,
  parseMaxTokens,
  DEFAULT_REASONING_EFFORT,
} from '@/lib/llmConfig';

export const runtime = 'nodejs';

function rowToConfig(r: any) {
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

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.user) {
    return NextResponse.json({ error: auth.status === 403 ? '无权限' : '未登录' }, { status: auth.status });
  }
  try {
    const list = await sql`
      SELECT id, name, endpoint, model, api_key_hint, timeout_ms, reasoning_effort,
             max_tokens, template_kwargs, is_active, updated_at
      FROM llm_configs
      ORDER BY is_active DESC, updated_at DESC
    `;
    const envConfigured = !!(process.env.LLM_ENDPOINT && process.env.LLM_API_KEY && process.env.LLM_MODEL);
    const active = list.rows.find((r: any) => r.is_active);
    const activeSource = active ? 'db' : (envConfigured ? 'env' : 'none');
    return NextResponse.json({ configs: list.rows.map(rowToConfig), activeSource, envConfigured });
  } catch (e) {
    console.error('[admin/llm-configs] GET error:', e);
    return NextResponse.json({ error: '加载配置失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.user) {
    return NextResponse.json({ error: auth.status === 403 ? '无权限' : '未登录' }, { status: auth.status });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: '请求体非法' }, { status: 400 });

  const name = String(body.name || '').trim();
  const endpoint = String(body.endpoint || '').trim();
  const model = String(body.model || '').trim();
  const apiKey = String(body.apiKey || '').trim();
  if (!name || !endpoint || !model || !apiKey) {
    return NextResponse.json({ error: '名称/接口地址/模型/API Key 均为必填' }, { status: 400 });
  }
  if (!/^https?:\/\//.test(endpoint)) {
    return NextResponse.json({ error: '接口地址必须以 http(s):// 开头' }, { status: 400 });
  }
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: '服务端未配置 AUTH_SECRET，无法加密保存' }, { status: 500 });
  }

  const templateKwargs = body.templateKwargs ? String(body.templateKwargs) : null;
  if (templateKwargs) {
    try {
      JSON.parse(templateKwargs);
    } catch {
      return NextResponse.json({ error: 'templateKwargs 不是合法 JSON' }, { status: 400 });
    }
  }

  try {
    const enc = encryptApiKey(apiKey, secret);
    const hint = maskApiKey(apiKey);
    const timeoutMs = clampTimeoutMs(Number(body.timeoutMs ?? 50000));
    const reasoningEffort = String(body.reasoningEffort || DEFAULT_REASONING_EFFORT);
    const maxTokens = parseMaxTokens(body.maxTokens === undefined ? undefined : Number(body.maxTokens));
    const inserted = await sql`
      INSERT INTO llm_configs
        (name, endpoint, model, api_key_enc, api_key_hint, timeout_ms, reasoning_effort, max_tokens, template_kwargs)
      VALUES
        (${name}, ${endpoint}, ${model}, ${enc}, ${hint}, ${timeoutMs}, ${reasoningEffort}, ${maxTokens}, ${templateKwargs})
      RETURNING id, name, endpoint, model, api_key_hint, timeout_ms, reasoning_effort,
                max_tokens, template_kwargs, is_active, updated_at
    `;
    return NextResponse.json({ config: rowToConfig(inserted.rows[0]) });
  } catch (e) {
    console.error('[admin/llm-configs] POST error:', e);
    return NextResponse.json({ error: '保存配置失败' }, { status: 500 });
  }
}
