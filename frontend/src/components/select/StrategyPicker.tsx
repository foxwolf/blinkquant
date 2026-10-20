'use client';
import { useState, useCallback } from 'react';
import Link from 'next/link';

export interface StrategyOption {
  id: number;
  name: string;
  formula: string;
  timeframe: string;
  version_no?: number;
}

interface StrategyPickerProps {
  onPick: (s: StrategyOption) => void;
}

const TF_LABEL: Record<string, string> = { D: '日', W: '周', M: '月' };

export default function StrategyPicker({ onPick }: StrategyPickerProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [strategies, setStrategies] = useState<StrategyOption[]>([]);

  const toggle = useCallback(async () => {
    const next = !open;
    setOpen(next);
    if (!next) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/strategies', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || '加载失败');
        setStrategies([]);
      } else {
        setStrategies(json.strategies || []);
      }
    } catch {
      setError('网络错误');
      setStrategies([]);
    } finally {
      setLoading(false);
    }
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void toggle()}
        className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-2 rounded-xl text-sm font-bold"
      >
        策略库 ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-xl z-40 overflow-hidden">
            <div className="max-h-72 overflow-y-auto">
              {loading && <div className="px-3 py-6 text-center text-xs text-slate-400">加载中…</div>}
              {!loading && error && <div className="px-3 py-4 text-xs text-red-600">{error}</div>}
              {!loading && !error && strategies.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-slate-400">
                  暂无保存的策略，可用「保存为策略」保存当前公式
                </div>
              )}
              {!loading && !error && strategies.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { setOpen(false); onPick(s); }}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-b-0"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-800 truncate">{s.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 shrink-0">
                      {TF_LABEL[s.timeframe] || s.timeframe}
                    </span>
                  </div>
                  <div className="text-xs font-mono text-slate-500 truncate mt-0.5">{s.formula}</div>
                </button>
              ))}
            </div>
            <Link
              href="/strategies"
              className="block px-3 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50 border-t border-slate-100"
            >
              管理策略 →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
