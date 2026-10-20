'use client';

import { useCallback, useEffect, useState } from 'react';

type SubmitSelectionTask = (
  taskType: 'selection',
  payload: any
) => Promise<number>;

const SELECT_RESULTS_STORAGE_KEY = 'bq-select-results';

interface SavedSelection {
  results: string[];
  selectMeta: { date?: string | null; degraded?: boolean } | null;
}

function loadSavedSelection(): SavedSelection {
  if (typeof window === 'undefined') {
    return { results: [], selectMeta: null };
  }
  try {
    const raw = localStorage.getItem(SELECT_RESULTS_STORAGE_KEY);
    if (!raw) return { results: [], selectMeta: null };
    const parsed = JSON.parse(raw);
    return {
      results: Array.isArray(parsed.results) ? parsed.results : [],
      selectMeta: parsed.selectMeta ?? null,
    };
  } catch {
    return { results: [], selectMeta: null };
  }
}

function persistSelection(results: string[], selectMeta: SavedSelection['selectMeta']) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SELECT_RESULTS_STORAGE_KEY, JSON.stringify({ results, selectMeta }));
  } catch {
    // ignore quota/private-mode errors
  }
}

function clearPersistedSelection() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(SELECT_RESULTS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export interface SelectionStrategySnapshot {
  id: number;
  version_no: number;
  name: string;
  formula: string;
  timeframe: 'D' | 'W' | 'M';
}

// 本地时区当天 YYYY-MM-DD（不用 toISOString，避免 UTC 偏移）
function localTodayStr(): string {
  if (typeof window === 'undefined') return '';
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

interface UseSelectionOptions {
  submitTask: SubmitSelectionTask;
  onClearSelectedStock?: () => void;
  strategySource?: SelectionStrategySnapshot;
}

export default function useSelection({
  submitTask,
  onClearSelectedStock,
  strategySource,
}: UseSelectionOptions) {
  const [formula, setFormula] = useState('CLOSE > MA(CLOSE, 20)');
  const [selectDate, setSelectDate] = useState<string>(() => localTodayStr());
  const [strategyName, setStrategyName] = useState('');
  const [excludeSt, setExcludeSt] = useState(true);
  const [excludeSuspended, setExcludeSuspended] = useState(true);
  const [timeframe, setTimeframe] = useState('D');
  const saved = loadSavedSelection();
  const [results, setResults] = useState<string[]>(saved.results);
  const [loading, setLoading] = useState(false);
  const [selectMeta, setSelectMeta] = useState<{ date?: string | null; degraded?: boolean } | null>(saved.selectMeta);

  useEffect(() => {
    persistSelection(results, selectMeta);
  }, [results, selectMeta]);

  const clearResults = useCallback(() => {
    setResults([]);
    setSelectMeta(null);
    clearPersistedSelection();
    onClearSelectedStock?.();
  }, [onClearSelectedStock]);

  const handleSelect = useCallback(
    async (overrides?: { formula?: string; timeframe?: string; date?: string }) => {
      setLoading(true);
      clearResults();

      const f = overrides?.formula ?? formula;
      const t = overrides?.timeframe ?? timeframe;
      const d = overrides?.date;
      const nameTrim = strategyName.trim();
      // 来源快照（策略库进入）优先；否则纯命名快照仅带 name（成果标题/来源行按 name 显示）
      const snapshot = strategySource
        ? { selection_strategy_snapshot: strategySource }
        : nameTrim
          ? { selection_strategy_snapshot: { name: nameTrim, formula: f, timeframe: t } }
          : {};

      try {
        const taskId = await submitTask(
          'selection',
          {
            formula: f,
            timeframe: t,
            ...(d ? { date: d } : {}),
            exclude_st: excludeSt,
            exclude_suspended: excludeSuspended,
            ...snapshot,
          }
        );

        while (true) {
          await new Promise((resolve) => setTimeout(resolve, 2000));

          try {
            const res = await fetch('/api/v1/tasks/' + taskId, { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);

            const task = await res.json();

            if (task.status === 'done') {
              let codes: string[] | null = null;
              let signalDate: string | null = null;
              let degraded = false;

              if (Array.isArray(task.result?.codes)) {
                codes = task.result.codes;
                signalDate = task.result.nodes?.node1?.signal_date ?? null;
              } else if (task.result?.success && Array.isArray(task.result?.data)) {
                codes = task.result.data;
                signalDate = task.result.date ?? null;
                degraded = !!task.result.meta?.degraded;
              }

              if (codes) {
                setResults(codes);
                setSelectMeta({ date: signalDate, degraded });
              } else {
                alert('Selection failed: ' + (task.result?.error || '未知错误'));
              }
              return;
            }

            if (task.status === 'failed') {
              alert('Selection failed: ' + (task.error || '未知错误'));
              return;
            }

            if (task.status === 'cancelled') {
              alert('选股任务已取消');
              return;
            }
          } catch (e: any) {
            console.error('Selection poll error:', e);
          }
        }
      } catch {
        alert('Gateway connection failed');
      } finally {
        setLoading(false);
      }
    },
    [clearResults, excludeSt, excludeSuspended, formula, strategyName, strategySource, submitTask, timeframe]
  );

  return {
    formula,
    setFormula,
    selectDate,
    setSelectDate,
    strategyName,
    setStrategyName,
    excludeSt,
    setExcludeSt,
    excludeSuspended,
    setExcludeSuspended,
    timeframe,
    setTimeframe,
    results,
    loading,
    selectMeta,
    handleSelect,
    clearResults,
  };
}
