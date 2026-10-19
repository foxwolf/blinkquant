import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { encryptApiKey, maskApiKey } from '@/lib/llmCrypto';
import { clampTimeoutMs, parseMaxTokens } from '@/lib/llmConfig';

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

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(req);
  if (!auth.user) {
    return NextResponse.json({ error: auth.status === 403 ? '无权限' : '未登录' }, { status: auth.status });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: '请求体非法' }, { status: 400 });

  try {
    const existing = await sql`SELECT * FROM llm_configs WHERE id = ${params.id}`;
    if (existing.rows.length === 0) {
      return NextResponse.json({ error: '配置不存在' }, { status: 404 });
    }
    const cur = existing.rows[0];

    const name = body.name !== undefined ? String(body.name).trim() : cur.name;
    const endpoint = body.endpoint !== undefined ? String(body.endpoint).trim() : cur.endpoint;
    const model = body.model !== undefined ? String(body.model).trim() : cur.model;
    if (!name || !endpoint || !model) {
      return NextResponse.json({ error: '名称/接口地址/模型不能为空' }, { status: 400 });
    }
    if (!/^https?:\/\//.test(endpoint)) {
      return NextResponse.json({ error: '接口地址必须以 http(s):// 开头' }, { status: 400 });
    }

    // API Key 留空 = 不修改（保留既有密文）
    let apiKeyEnc = cur.api_key_enc;
    let apiKeyHint = cur.api_key_hint;
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (apiKey) {
      const secret = process.env.AUTH_SECRET;
      if (!secret) {
        return NextResponse.json({ error: '服务端未配置 AUTH_SECRET，无法加密保存' }, { status: 500 });
      }
      apiKeyEnc = encryptApiKey(apiKey, secret);
      apiKeyHint = maskApiKey(apiKey);
    }

    const timeoutMs = body.timeoutMs !== undefined ? clampTimeoutMs(Number(body.timeoutMs)) : cur.timeout_ms;
    const reasoningEffort = body.reasoningEffort !== undefined ? String(body.reasoningEffort) : cur.reasoning_effort;
    const maxTokens = body.maxTokens !== undefined ? parseMaxTokens(Number(body.maxTokens)) : cur.max_tokens;
    let templateKwargs = cur.template_kwargs;
    if (body.templateKwargs !== undefined) {
      templateKwargs = body.templateKwargs ? String(body.templateKwargs) : null;
      if (templateKwargs) {
        try {
          JSON.parse(templateKwargs);
        } catch {
          return NextResponse.json({ error: 'templateKwargs 不是合法 JSON' }, { status: 400 });
        }
      }
    }

    const updated = await sql`
      UPDATE llm_configs
      SET name = ${name}, endpoint = ${endpoint}, model = ${model},
          api_key_enc = ${apiKeyEnc}, api_key_hint = ${apiKeyHint},
          timeout_ms = ${timeoutMs}, reasoning_effort = ${reasoningEffort},
          max_tokens = ${maxTokens}, template_kwargs = ${templateKwargs},
          updated_at = NOW()
      WHERE id = ${params.id}
      RETURNING id, name, endpoint, model, api_key_hint, timeout_ms, reasoning_effort,
                max_tokens, template_kwargs, is_active, updated_at
    `;
    return NextResponse.json({ config: rowToConfig(updated.rows[0]) });
  } catch (e) {
    console.error('[admin/llm-configs/:id] PATCH error:', e);
    return NextResponse.json({ error: '更新配置失败' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(req);
  if (!auth.user) {
    return NextResponse.json({ error: auth.status === 403 ? '无权限' : '未登录' }, { status: auth.status });
  }
  try {
    const result = await sql`DELETE FROM llm_configs WHERE id = ${params.id}`;
    if (result.rowCount === 0) {
      return NextResponse.json({ error: '配置不存在' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[admin/llm-configs/:id] DELETE error:', e);
    return NextResponse.json({ error: '删除配置失败' }, { status: 500 });
  }
}
