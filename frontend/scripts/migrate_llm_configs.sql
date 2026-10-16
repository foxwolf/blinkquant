-- BlinkQuant 大模型设置增量迁移
-- 适用于已经存在 users / watchlists / strategies 的生产数据库。
-- 在 Vercel Postgres 控制台或 psql 中执行一次。

CREATE TABLE IF NOT EXISTS llm_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    model TEXT NOT NULL,
    api_key_enc TEXT NOT NULL,
    api_key_hint TEXT NOT NULL,
    timeout_ms INTEGER NOT NULL DEFAULT 50000,
    reasoning_effort TEXT NOT NULL DEFAULT 'low',
    max_tokens INTEGER NOT NULL DEFAULT 1024,
    template_kwargs TEXT,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_configs_one_active
    ON llm_configs (is_active) WHERE is_active = TRUE;
