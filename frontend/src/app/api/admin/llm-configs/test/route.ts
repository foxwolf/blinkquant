import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { decryptApiKey } from '@/lib/llmCrypto';
import { callLlm } from '@/lib/selectNLServer';
import { parseMaxTokens, parseTemplateKwargs, type ResolvedLlmConfig } from '@/lib/llmConfig';

export const runtime = 'nodejs';

// 未保存的配置：用请求体里的 endpoint/model/apiKey 构造临时配置
function buildCfgFromBody(body: any): ResolvedLlmConfig | { error: string } {
  const endpoint = String(body?.endpoint || '').trim();
  const model = String(body?.model || '').trim();
  const apiKey = String(body?.apiKey || '').trim();
  if (!endpoint || !model || !apiKey) return { error: '缺少 endpoint/model/apiKey' };
  if (!/^https?:\/\//.test(endpoint)) return { error: '接口地址必须以 http(s):// 开头' };
  return {
    endpoint,
    apiKey,
    model,
    timeoutMs: 15000,
    reasoningEffort: String(body?.reasoningEffort || 'low'),
    maxTokens: parseMaxTokens(body?.maxTokens === undefined ? undefined : Number(body.maxTokens)),
    templateKwargs: parseTemplateKwargs(body?.templateKwargs),
    source: 'db',
  };
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.user) {
    return NextResponse.json({ error: auth.status === 403 ? '无权限' : '未登录' }, { status: auth.status });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: false, error: '请求体非法' }, { status: 400 });

  let cfg: ResolvedLlmConfig;
  try {
    if (typeof body.id === 'string' && body.id) {
      // 用库中已保存的配置（解密其 Key）
      const secret = process.env.AUTH_SECRET;
      if (!secret) return NextResponse.json({ ok: false, error: '服务端未配置 AUTH_SECRET' });
      const rows = await sql`
        SELECT endpoint, model, api_key_enc, timeout_ms, reasoning_effort, max_tokens, template_kwargs
        FROM llm_configs WHERE id = ${body.id}
      `;
      if (rows.rows.length === 0) return NextResponse.json({ ok: false, error: '配置不存在' });
      const r = rows.rows[0];
      cfg = {
        endpoint: r.endpoint,
        apiKey: decryptApiKey(r.api_key_enc, secret),
        model: r.model,
        timeoutMs: 15000,
        reasoningEffort: r.reasoning_effort || 'low',
        maxTokens: parseMaxTokens(Number(r.max_tokens)),
        templateKwargs: parseTemplateKwargs(r.template_kwargs),
        source: 'db',
      };
    } else {
      const built = buildCfgFromBody(body);
      if ('error' in built) return NextResponse.json({ ok: false, error: built.error });
      cfg = built;
    }

    const startedAt = Date.now();
    const content = await callLlm(cfg, '你是连通性测试助手。', '仅回复两个字：正常');
    return NextResponse.json({
      ok: true,
      latencyMs: Date.now() - startedAt,
      sample: String(content).slice(0, 50),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
