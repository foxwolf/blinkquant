'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import AISelectModal from '../AISelectModal';
import StrategyPicker, { type StrategyOption } from './StrategyPicker';
import { useCluster } from '@/hooks/useCluster';
import SelectionControls from './SelectionControls';
import SelectionResultsSidebar from './SelectionResultsSidebar';
import StockSearch from '../StockSearch';
import { useKlineOverlay } from '@/components/kline/KlineOverlayProvider';
import useSelection, { type SelectionStrategySnapshot } from '@/hooks/useSelection';
import { useSession } from '@/lib/session-context';
import { rewriteFormulaForTimeframe } from '@/lib/formulaTimeframe';

export default function SelectionWorkspace() {
  const router = useRouter();
  const { user } = useSession();

  const [saveStrategyOpen, setSaveStrategyOpen] = useState(false);
  const [showAISelect, setShowAISelect] = useState(false);
  const [selectionStrategySource, setSelectionStrategySource] = useState<SelectionStrategySnapshot | undefined>(undefined);
  const { submitTask } = useCluster();

  const { openKline, closeKline, selectedCode, stockList } = useKlineOverlay();


  const {
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
  } = useSelection({
    submitTask,
    onClearSelectedStock: closeKline,
    strategySource: selectionStrategySource,
  });

  // 手动切换周期时，公式同步改写为所选周期的自描述前缀形式
  // （日 = 裸公式，周 = W.，月 = M.；跨周期/受保护原子保留，见 formulaTimeframe.ts）
  const handleTimeframeChange = useCallback((tf: 'D' | 'W' | 'M') => {
    setFormula(rewriteFormulaForTimeframe(formula, timeframe as 'D' | 'W' | 'M', tf));
    setTimeframe(tf);
  }, [formula, timeframe, setFormula, setTimeframe]);

  // 从策略库进入选股工作台时，读取一次待恢复的策略并清理会话标记。
  useEffect(() => {
    if (!user) return;

    try {
      const selectionRaw = sessionStorage.getItem('bq-pending-selection-strategy');
      if (selectionRaw) {
        const pending = JSON.parse(selectionRaw);
        if (typeof pending?.formula === 'string' && pending.formula.trim()) {
          setFormula(pending.formula);
          if (typeof pending.name === 'string') setStrategyName(pending.name);
          if (['D', 'W', 'M'].includes(pending.timeframe)) setTimeframe(pending.timeframe);
          if (Number(pending.id) > 0) {
            setSelectionStrategySource({
              id: Number(pending.id),
              version_no: Number(pending.version_no) || 1,
              name: String(pending.name || ''),
              formula: String(pending.formula).trim(),
              timeframe: pending.timeframe === 'W' || pending.timeframe === 'M' ? pending.timeframe : 'D',
            });
          }
        }
      }
    } catch (e) {
      console.error('Failed to restore selection strategy', e);
    } finally {
      sessionStorage.removeItem('bq-pending-selection-strategy');
    }
  }, [user, setFormula, setStrategyName, setTimeframe]);

  // Deep link: 旧股票研究页桩重定向到 /select?code=<symbol>，此处消费后清理 URL。
  // App Router 的 useRouter() 无 .query，深链必经 /stocks 桩跨路由落地（组件必重新挂载），effect 读 window.location 即可。
  useEffect(() => {
    if (!user || typeof window === 'undefined') return;
    const codeParam = new URLSearchParams(window.location.search).get('code');
    if (!codeParam) return;
    router.replace('/select', { scroll: false });
    openKline(decodeURIComponent(codeParam));
  }, [router, user, openKline]);

  const handleSaveStrategy = useCallback(async () => {
    if (!strategyName.trim()) return;
    try {
      const res = await fetch('/api/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: strategyName.trim(), formula, timeframe }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(json.error || '保存失败');
        return;
      }
      setSaveStrategyOpen(false);
    } catch (e) {
      alert('保存失败');
    }
  }, [strategyName, formula, timeframe]);

  const handleFormulaChange = useCallback((nextFormula: string) => {
    if (selectionStrategySource && nextFormula.trim() !== selectionStrategySource.formula.trim()) {
      setSelectionStrategySource(undefined);
    }
    setFormula(nextFormula);
  }, [selectionStrategySource, setFormula]);

  const handlePickStrategy = useCallback((s: StrategyOption) => {
    const tf: 'D' | 'W' | 'M' = s.timeframe === 'W' || s.timeframe === 'M' ? s.timeframe : 'D';
    setSelectionStrategySource({
      id: Number(s.id),
      version_no: Number(s.version_no) || 1,
      name: String(s.name || ''),
      formula: String(s.formula).trim(),
      timeframe: tf,
    });
    setFormula(String(s.formula));
    setTimeframe(tf);
    setStrategyName(String(s.name || ''));
  }, [setFormula, setStrategyName, setTimeframe]);

  if (!user) return null;

  return (
      <main className="min-h-screen p-4 md:p-8 font-sans bg-slate-50 text-slate-900">
      <div className="max-w-7xl mx-auto space-y-6">
        <section aria-label="股票搜索" className="bg-white p-4 md:p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex flex-col gap-3">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">股票搜索</label>
            <StockSearch stockList={stockList} onSelect={openKline} className="w-full max-w-md" />
          </div>
        </section>
        <SelectionControls
          formula={formula}
          selectDate={selectDate}
          strategyName={strategyName}
          timeframe={timeframe}
          excludeSt={excludeSt}
          excludeSuspended={excludeSuspended}
          loading={loading}
          onFormulaChange={setFormula}
          onDateChange={setSelectDate}
          onStrategyNameChange={setStrategyName}
          onTimeframeChange={handleTimeframeChange}
          onExcludeStChange={setExcludeSt}
          onExcludeSuspendedChange={setExcludeSuspended}
          onRun={() => strategyName.trim() ? handleSelect({ date: selectDate || undefined }) : undefined}
          onAISelect={() => setShowAISelect(true)}
          onSaveStrategy={() => setSaveStrategyOpen(true)}
          strategyPickerSlot={<StrategyPicker onPick={handlePickStrategy} />}
        />

        {/* Results Area */}
        <div>
          <SelectionResultsSidebar
            selectMeta={selectMeta}
            results={results}
            selectedCode={selectedCode}
            stockList={stockList}
            onViewStock={openKline}
          />
        </div>
      </div>

      {saveStrategyOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setSaveStrategyOpen(false)}>
          <div
            className="bg-white rounded-2xl w-full max-w-md shadow-xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-bold text-slate-700 mb-4">保存为策略</h2>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">策略名称</label>
            <input
              value={strategyName}
              onChange={(e) => setStrategyName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveStrategy()}
              className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              placeholder="例如：突破20日均线"
              autoFocus
            />
            <div className="mt-4 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono break-all">{formula}</div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setSaveStrategyOpen(false)} className="px-4 py-2 text-sm border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50">取消</button>
              <button onClick={handleSaveStrategy} disabled={!strategyName.trim()} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold disabled:opacity-50">保存</button>
            </div>
          </div>
        </div>
      )}

      {showAISelect && (
        <AISelectModal
          onClose={() => setShowAISelect(false)}
          onRun={(aiFormula, aiTimeframe, aiDate) => {
            setShowAISelect(false);
            // 回填卡片：所见即所跑；与来源快照公式不一致时清快照，策略名保留
            handleFormulaChange(aiFormula);
            setTimeframe(aiTimeframe);
            if (aiDate) setSelectDate(aiDate);
            const snapshotStillMatches =
              !!selectionStrategySource && aiFormula.trim() === selectionStrategySource!.formula.trim();
            handleSelect({
              formula: aiFormula,
              timeframe: aiTimeframe,
              date: aiDate || selectDate || undefined,
              strategySource: snapshotStillMatches && selectionStrategySource ? selectionStrategySource : null,
            });
          }}
        />
      )}
      </main>
  );
}
