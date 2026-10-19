'use client';
import { useCallback, useEffect, useState } from 'react';

interface LlmConfig {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  apiKeyHint: string;
  timeoutMs: number;
  reasoningEffort: string;
  maxTokens: number;
  templateKwargs: string | null;
  isActive: boolean;
  updatedAt: string;
}

const EMPTY_FORM = {
  name: '',
  endpoint: '',
  model: '',
  apiKey: '',
  apiKeyHint: '',
  timeoutMs: '50000',
  reasoningEffort: 'low',
  maxTokens: '1024',
  templateKwargs: '',
};

export default function LlmSettingsPanel() {
  const [configs, setConfigs] = useState<LlmConfig[]>([]);
  const [activeSource, setActiveSource] = useState<'db' | 'env' | 'none'>('none');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgKind, setMsgKind] = useState<'info' | 'error'>('info');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/llm-configs', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || '加载失败');
        return;
      }
      setConfigs(json.configs || []);
      setActiveSource(json.activeSource || 'none');
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startNew = () => {
    setEditingId('new');
    setForm({ ...EMPTY_FORM });
    setAdvanced(false);
    setMsg('');
  };

  const startEdit = (c: LlmConfig) => {
    setEditingId(c.id);
    setForm({
      name: c.name,
      endpoint: c.endpoint,
      model: c.model,
      apiKey: '',
      apiKeyHint: c.apiKeyHint,
      timeoutMs: String(c.timeoutMs),
      reasoningEffort: c.reasoningEffort,
      maxTokens: String(c.maxTokens),
      templateKwargs: c.templateKwargs || '',
    });
    setAdvanced(false);
    setMsg('');
  };

  const cancel = () => {
    setEditingId(null);
    setMsg('');
  };

  const save = async () => {
    setBusy(true);
    setMsg('');
    try {
      const isNew = editingId === 'new';
      const timeoutMs = Number(form.timeoutMs);
      const maxTokens = Number(form.maxTokens);
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(maxTokens) || maxTokens <= 0) {
        setMsg('超时与 max tokens 必须为正整数');
        setMsgKind('error');
        return;
      }
      const payload: any = {
        name: form.name,
        endpoint: form.endpoint,
        model: form.model,
        timeoutMs,
        reasoningEffort: form.reasoningEffort,
        maxTokens,
        templateKwargs: form.templateKwargs || '',
      };
      if (form.apiKey) payload.apiKey = form.apiKey;
      const res = await fetch(isNew ? '/api/admin/llm-configs' : `/api/admin/llm-configs/${editingId}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg(json.error || '保存失败');
        setMsgKind('error');
        return;
      }
      setEditingId(null);
      setMsgKind('info');
      await load();
    } catch {
      setMsg('网络错误');
      setMsgKind('error');
    } finally {
      setBusy(false);
    }
  };

  const activate = async (id: string) => {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(`/api/admin/llm-configs/${id}/activate`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setMsg(json.error || '启用失败');
        setMsgKind('error');
        return;
      }
      setMsgKind('info');
      await load();
    } catch {
      setMsg('网络错误');
      setMsgKind('error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: LlmConfig) => {
    if (!confirm(`确定删除配置「${c.name}」？`)) return;
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(`/api/admin/llm-configs/${c.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) {
        setMsg(json.error || '删除失败');
        setMsgKind('error');
        return;
      }
      if (editingId === c.id) setEditingId(null);
      setMsgKind('info');
      await load();
    } catch {
      setMsg('网络错误');
      setMsgKind('error');
    } finally {
      setBusy(false);
    }
  };

  const test = async (c: LlmConfig) => {
    setBusy(true);
    setMsg(`正在测试「${c.name}」...`);
    try {
      const res = await fetch('/api/admin/llm-configs/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id }),
      });
      const json = await res.json();
      if (json.ok) {
        setMsg(`「${c.name}」连接成功 · ${json.latencyMs}ms`);
        setMsgKind('info');
      } else {
        setMsg(`「${c.name}」连接失败：${json.error || '未知错误'}`);
        setMsgKind('error');
      }
    } catch {
      setMsg('测试请求失败');
      setMsgKind('error');
    } finally {
      setBusy(false);
    }
  };

  const statusText =
    activeSource === 'db'
      ? `当前生效：数据库配置（${configs.find((c) => c.isActive)?.name || ''}）`
      : activeSource === 'env'
      ? '当前生效：环境变量（未在页面管理）'
      : '当前未配置（AI 选股入口将返回 503）';

  return (
    <div className="space-y-4">
      <div
        className={`text-sm rounded-xl px-3 py-2 border ${
          activeSource === 'none'
            ? 'bg-amber-50 border-amber-200 text-amber-700'
            : 'bg-slate-50 border-slate-200 text-slate-600'
        }`}
      >
        {statusText}
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}
      {msg && (
        <div className={`text-sm rounded-xl px-3 py-2 border ${msgKind === 'error' ? 'text-red-600 bg-red-50 border-red-200' : 'text-slate-700 bg-blue-50 border-blue-200'}`}>
          {msg}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={startNew}
          disabled={busy}
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded-xl hover:bg-blue-700 disabled:opacity-40"
        >
          + 新建配置
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-400 py-6 text-center">加载中...</div>
      ) : configs.length === 0 && !error ? (
        <div className="text-sm text-slate-400 py-6 text-center">暂无配置</div>
      ) : (
        <div className="space-y-2">
          {configs.map((c) => (
            <div key={c.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-800 truncate">{c.name}</span>
                    {c.isActive && (
                      <span className="text-xs font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">启用</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    模型 <span className="font-mono">{c.model}</span> · Key {c.apiKeyHint}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5 truncate">{c.endpoint}</div>
                  <div className="text-xs text-slate-400 mt-1">
                    超时 {c.timeoutMs}ms · effort {c.reasoningEffort} · max_tokens {c.maxTokens}
                    {c.templateKwargs ? ' · 自定义 template_kwargs' : ''}
                  </div>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <div className="flex gap-2">
                    {!c.isActive && (
                      <button
                        onClick={() => activate(c.id)}
                        disabled={busy}
                        className="text-xs text-green-600 border border-green-200 hover:bg-green-50 rounded-lg px-2.5 py-1 disabled:opacity-40"
                      >
                        启用
                      </button>
                    )}
                    <button
                      onClick={() => test(c)}
                      disabled={busy}
                      className="text-xs text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg px-2.5 py-1 disabled:opacity-40"
                    >
                      测试连接
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => startEdit(c)}
                      disabled={busy}
                      className="text-xs text-blue-500 border border-blue-200 hover:bg-blue-50 rounded-lg px-2.5 py-1 disabled:opacity-40"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => remove(c)}
                      disabled={busy}
                      className="text-xs text-red-500 border border-red-200 hover:bg-red-50 rounded-lg px-2.5 py-1 disabled:opacity-40"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingId && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
          <div className="font-bold text-slate-700">{editingId === 'new' ? '新建配置' : '编辑配置'}</div>

          <label className="block text-xs text-slate-500">
            名称
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-xs text-slate-500">
            接口地址（完整 chat/completions URL）
            <input
              value={form.endpoint}
              onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
              placeholder="https://integrate.api.nvidia.com/v1/chat/completions"
              className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono"
            />
          </label>

          <label className="block text-xs text-slate-500">
            模型名
            <input
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="nvidia/nemotron-3-ultra-550b-a55b"
              className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono"
            />
          </label>

          <label className="block text-xs text-slate-500">
            API Key{editingId !== 'new' && '（留空=不修改）'}
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder={editingId !== 'new' ? `${form.apiKeyHint || '••••'}（不修改）` : 'nvapi-...'}
              className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono"
            />
          </label>

          <button onClick={() => setAdvanced((v) => !v)} className="text-xs text-slate-500 hover:text-slate-700">
            {advanced ? '收起高级参数' : '展开高级参数'}
          </button>

          {advanced && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block text-xs text-slate-500">
                超时 (ms)
                <input
                  type="number"
                  value={form.timeoutMs}
                  onChange={(e) => setForm({ ...form, timeoutMs: e.target.value })}
                  min="1000" max="55000"
                  className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-slate-500">
                reasoning effort
                <input
                  value={form.reasoningEffort}
                  onChange={(e) => setForm({ ...form, reasoningEffort: e.target.value })}
                  className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-slate-500">
                max tokens
                <input
                  type="number"
                  value={form.maxTokens}
                  onChange={(e) => setForm({ ...form, maxTokens: e.target.value })}
                  min="1"
                  className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-slate-500 sm:col-span-3">
                template_kwargs (JSON，留空=不发送)
                <input
                  value={form.templateKwargs}
                  onChange={(e) => setForm({ ...form, templateKwargs: e.target.value })}
                  placeholder='{"enable_thinking": false}'
                  className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono"
                />
              </label>
            </div>
          )}

          {msg && (
            <div className={`text-sm rounded-xl px-3 py-2 border ${msgKind === 'error' ? 'text-red-600 bg-red-50 border-red-200' : 'text-slate-700 bg-blue-50 border-blue-200'}`}>
              {msg}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button onClick={cancel} className="text-sm px-4 py-2 border border-slate-200 rounded-xl bg-white">
              取消
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="text-sm px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-40"
            >
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
