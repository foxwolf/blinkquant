'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import AISelectModal from '../AISelectModal';
import { useCluster } from '@/hooks/useCluster';
import SelectionControls from './SelectionControls';
import SelectionResultsSidebar from './SelectionResultsSidebar';
import StockResearchPanel from './StockResearchPanel';
import useStockResearch from '@/hooks/useStockResearch';
import useSelection, { type SelectionStrategySnapshot } from '@/hooks/useSelection';
import { useSession } from '@/lib/session-context';

const StrategyList = dynamic(() => import('../StrategyList'), { ssr: false });

export default function SelectionWorkspace() {
  const router = useRouter();
  const { user } = useSession();

  const [showStrategies, setShowStrategies] = useState(false);
  const [saveStrategyOpen, setSaveStrategyOpen] = useState(false);
  const [showAISelect, setShowAISelect] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'results' | 'watchlist'>('results');
  const [strategyName, setStrategyName] = useState('');
  const [selectionStrategySource, setSelectionStrategySource] = useState<SelectionStrategySnapshot | undefined>(undefined);
  const { submitTask } = useCluster();

  const {
    chartTimeframe,
    subChartType,
    mainChartType,
    setSubChartType,
    setMainChartType,
    changeChartTimeframe,
    isFullScreen,
    chartWrapperRef,
    adjustMode,
    adjustMenuOpen,
    adjustMenuRef,
    changeAdjustMode,
    setAdjustMenuOpen,
    selectedStock,
    clearSelectedStock,
    chartLoading,
    sectors,
    expandedSectors,
    setExpandedSectors,
    lastStockRef,
    stockList,
    viewStock,
    viewSector,
    toggleFullscreen,
    returnToStock,
  } = useStockResearch();


  const {
    formula,
    setFormula,
    selectDate,
    setSelectDate,
    timeframe,
    setTimeframe,
    results,
    loading,
    selectMeta,
    handleSelect,
  } = useSelection({
    submitTask,
    onClearSelectedStock: clearSelectedStock,
  });

  const [watchlistCodes, setWatchlistCodes] = useState<string[]>([]);

  const refreshWatchlist = useCallback(async () => {
    try {
      const res = await fetch('/api/watchlist', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        setWatchlistCodes(json.codes || []);
      }
    } catch (e) {
      console.error('Failed to load watchlist', e);
    }
  }, []);

  useEffect(() => {
    if (user) refreshWatchlist();
  }, [user, refreshWatchlist]);

  // 从策略库进入选股工作台时，读取一次待恢复的策略并清理会话标记。
  useEffect(() => {
    if (!user) return;

    try {
      const selectionRaw = sessionStorage.getItem('bq-pending-selection-strategy');
      if (selectionRaw) {
        const pending = JSON.parse(selectionRaw);
        if (typeof pending?.formula === 'string' && pending.formula.trim()) {
          setFormula(pending.formula);
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
  }, [user, setFormula, setTimeframe]);

  // Deep link: 旧股票研究页桩重定向到 /select?code=<symbol>，此处消费后清理 URL。
  // App Router 的 useRouter() 无 .query，深链必经 /stocks 桩跨路由落地（组件必重新挂载），effect 读 window.location 即可。
  useEffect(() => {
    if (!user || typeof window === 'undefined') return;
    const codeParam = new URLSearchParams(window.location.search).get('code');
    if (!codeParam) return;
    if (stockList.length === 0) return;
    router.replace('/select', { scroll: false });
    void viewStock(decodeURIComponent(codeParam));
  }, [router, user, stockList.length, viewStock]);

  const handleViewStock = useCallback((code: string) => {
    void viewStock(code);
  }, [viewStock]);

  const toggleWatchlist = useCallback(async (code: string) => {
    const exists = watchlistCodes.includes(code);
    try {
      if (exists) {
        await fetch(`/api/watchlist?code=${encodeURIComponent(code)}`, { method: 'DELETE' });
        setWatchlistCodes((prev) => prev.filter((c) => c !== code));
      } else {
        await fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        setWatchlistCodes((prev) => [...prev, code]);
      }
    } catch (e) {
      console.error('Failed to toggle watchlist', e);
    }
  }, [watchlistCodes]);

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
      setStrategyName('');
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

  const handleApplyStrategy = useCallback((strategyFormula: string, strategyTimeframe: string) => {
    setSelectionStrategySource(undefined);
    setFormula(strategyFormula);
    setTimeframe(strategyTimeframe);
    setShowStrategies(false);
  }, [setFormula, setTimeframe]);

  if (!user) return null;

  return (
      <main className="min-h-screen p-4 md:p-8 font-sans bg-slate-50 text-slate-900">
      <div className="max-w-7xl mx-auto space-y-6">
        <SelectionControls
          formula={formula}
          selectDate={selectDate}
          loading={loading}
          onFormulaChange={setFormula}
          onDateChange={setSelectDate}
          onRun={() => handleSelect({ date: selectDate || undefined })}
          onAISelect={() => setShowAISelect(true)}
          onSaveStrategy={() => setSaveStrategyOpen(true)}
        />

        {/* Results Area */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 md:gap-6">
          <SelectionResultsSidebar
            sidebarTab={sidebarTab}
            onTabChange={setSidebarTab}
            selectMeta={selectMeta}
            results={results}
            watchlistCodes={watchlistCodes}
            selectedCode={selectedStock?.code}
            stockList={stockList}
            onViewStock={handleViewStock}
            onRemoveWatchlist={toggleWatchlist}
            onWatchlistChanged={refreshWatchlist}
          />
          <StockResearchPanel
            selectedStock={selectedStock}
            stockList={stockList}
            sectors={sectors}
            expandedSectors={expandedSectors}
            chartLoading={chartLoading}
            chartTimeframe={chartTimeframe}
            onChangeChartTimeframe={changeChartTimeframe}
            subChartType={subChartType}
            onChangeSubChartType={setSubChartType}
            mainChartType={mainChartType}
            onChangeMainChartType={setMainChartType}
            isFullScreen={isFullScreen}
            chartWrapperRef={chartWrapperRef}
            adjustMode={adjustMode}
            adjustMenuOpen={adjustMenuOpen}
            adjustMenuRef={adjustMenuRef}
            onChangeAdjustMode={changeAdjustMode}
            onChangeAdjustMenuOpen={setAdjustMenuOpen}
            onChangeSectorsExpanded={setExpandedSectors}
            onViewStock={handleViewStock}
            onViewSector={viewSector}
            lastStockRef={lastStockRef}
            onReturnToStock={returnToStock}
            onToggleFullscreen={toggleFullscreen}
          />
        </div>
      </div>

      {showStrategies && (
        <StrategyList
          onApply={handleApplyStrategy}
          onClose={() => setShowStrategies(false)}
        />
      )}

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
          onRun={(formula, timeframe, date) => {
            setShowAISelect(false);
            handleSelect({ formula, timeframe, date: date || selectDate || undefined });
          }}
        />
      )}
      </main>
  );
}
