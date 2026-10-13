'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BacktestParams } from '@/components/BacktestPanel';

type SubmitBacktestTask = (
  taskType: 'backtest',
  payload: BacktestParams,
  options?: { strategyTemplateId?: number | null }
) => Promise<number>;

interface UseBacktestOptions {
  submitTask: SubmitBacktestTask;
  strategyTemplateId: number | null;
}

export default function useBacktest({
  submitTask,
  strategyTemplateId,
}: UseBacktestOptions) {
  const [backtestResult, setBacktestResult] = useState<any>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);

  const clearBacktestState = useCallback(() => {
    localStorage.removeItem('backtestJobId');
    localStorage.removeItem('backtestNode');
    localStorage.removeItem('backtestTime');
  }, []);

  const pollTaskStatus = useCallback(async (taskId: number) => {
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      try {
        const res = await fetch('/api/v1/tasks/' + taskId, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const task = await res.json();

        if (task.status === 'done') {
          if (task.result) {
            setBacktestResult({ legacy: task.result });
          } else {
            setBacktestResult({
              taskId: task.id,
              summary: task.result_summary,
            });
          }
          return;
        }
        if (task.status === 'failed') {
          alert('回测失败: ' + (task.error || '未知错误'));
          return;
        }
        if (task.status === 'cancelled') {
          alert('回测任务已取消');
          return;
        }
        if (task.status === 'preempted') {
          alert('回测被选股任务抢占，已自动重新排队');
          return;
        }
      } catch (e) {
        console.error('Poll error:', e);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.removeItem('backtestJobId');
    localStorage.removeItem('backtestNode');
    localStorage.removeItem('backtestTime');
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (backtestLoading) {
      timer = setTimeout(() => {
        console.warn('backtestLoading stuck >2min, force reset');
        setBacktestLoading(false);
        clearBacktestState();
      }, 120000);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [backtestLoading, clearBacktestState]);

  const handleBacktest = useCallback(async (params: BacktestParams) => {
    setBacktestLoading(true);
    setBacktestResult(null);
    try {
      const taskId = await submitTask('backtest', params, {
        strategyTemplateId,
      });
      await pollTaskStatus(taskId);
    } catch (e: any) {
      alert('回测失败: ' + e.message);
    } finally {
      setBacktestLoading(false);
    }
  }, [pollTaskStatus, strategyTemplateId, submitTask]);

  return {
    backtestResult,
    backtestLoading,
    handleBacktest,
    setBacktestResult,
  };
}
