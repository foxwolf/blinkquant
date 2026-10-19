import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';

// 事务内先清空所有启用、再启用目标：同一时刻最多一条 is_active=TRUE，
// 与部分唯一索引 idx_llm_configs_one_active 双保险。
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(req);
  if (!auth.user) {
    return NextResponse.json({ error: auth.status === 403 ? '无权限' : '未登录' }, { status: auth.status });
  }

  const client = await sql.connect();
  try {
    await client.sql`BEGIN`;
    await client.sql`UPDATE llm_configs SET is_active = FALSE WHERE is_active = TRUE`;
    const res = await client.sql`
      UPDATE llm_configs SET is_active = TRUE, updated_at = NOW()
      WHERE id = ${params.id}
      RETURNING id, name
    `;
    if (res.rowCount === 0) {
      await client.sql`ROLLBACK`;
      return NextResponse.json({ error: '配置不存在' }, { status: 404 });
    }
    await client.sql`COMMIT`;
    return NextResponse.json({ ok: true, activated: res.rows[0] });
  } catch (e) {
    try {
      await client.sql`ROLLBACK`;
    } catch {
      /* ignore */
    }
    console.error('[admin/llm-configs/:id/activate] error:', e);
    return NextResponse.json({ error: '启用失败' }, { status: 500 });
  } finally {
    client.release();
  }
}
