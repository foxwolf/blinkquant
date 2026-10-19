'use client';

import { useState, useEffect } from 'react';
import type { MutableRefObject, RefObject, Dispatch, SetStateAction } from 'react';
import dynamic from 'next/dynamic';
import StockSearch from '../StockSearch';
import WatchlistPicker from '../WatchlistPicker';
import { formatMoney, formatVolume } from '@/utils/format';

const KLineChart = dynamic(() => import('../KLineChart'), {
  ssr: false,
  loading: () => <div className="h-[400px] flex items-center justify-center bg-slate-100 rounded-xl animate-pulse text-slate-400">加载图表引擎...</div>
});

const TIMEFRAMES = [
  { label: '日', value: 'D' },
  { label: '周', value: 'W' },
  { label: '月', value: 'M' },
];

const ADJUST_OPTIONS = [
  { label: '不复权', value: 'none' as const },
  { label: '前复权', value: 'qfq' as const },
  { label: '后复权', value: 'hfq' as const },
];

const ADJUST_LABELS: Record<'none' | 'qfq' | 'hfq', string> = {
  none: '不复权',
  qfq: '前复权',
  hfq: '后复权',
};

const SECTOR_GROUP_ORDER = ['行业板块', '概念板块', '地域板块'];
const SECTOR_GROUP_LABELS: Record<string, string> = {
  '行业板块': '行业',
  '概念板块': '概念',
  '地域板块': '地域',
};
const SECTOR_MAX_SHOWN = 3;

export interface SelectedStock {
  kind: 'stock' | 'sector';
  code: string;
  name?: string;
  data: any;
}

interface StockResearchPanelProps {
  selectedStock: SelectedStock | null;
  stockList: Array<{code: string; name: string}>;
  sectors: { code: string; name: string; type: string }[];
  expandedSectors: Record<string, boolean>;
  chartLoading: boolean;
  chartTimeframe: string;
  onChangeChartTimeframe: (value: string) => void;
  subChartType: string;
  onChangeSubChartType: (value: string) => void;
  mainChartType: string;
  onChangeMainChartType: (value: string) => void;
  isFullScreen: boolean;
  chartWrapperRef: RefObject<HTMLDivElement>;
  adjustMode: 'none'|'qfq'|'hfq';
  adjustMenuOpen: boolean;
  adjustMenuRef: RefObject<HTMLDivElement>;
  onChangeAdjustMode: (value: 'none'|'qfq'|'hfq') => void;
  onChangeAdjustMenuOpen: (value: boolean) => void;
  onChangeSectorsExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
  onViewStock: (code: string) => void;
  onViewSector: (code: string, name: string) => void;
  lastStockRef: MutableRefObject<{ code: string; name: string } | null>;
  onReturnToStock: () => void;
  onToggleFullscreen: () => Promise<void>;
  onClose: () => void;
}

export default function StockResearchPanel({
  selectedStock, stockList, sectors, expandedSectors, chartLoading,
  chartTimeframe, onChangeChartTimeframe,
  subChartType, onChangeSubChartType, mainChartType, onChangeMainChartType, isFullScreen,
  chartWrapperRef, adjustMode, adjustMenuOpen, adjustMenuRef, onChangeAdjustMode,
  onChangeAdjustMenuOpen, onChangeSectorsExpanded, onViewStock, onViewSector,
  lastStockRef, onReturnToStock, onToggleFullscreen, onClose
}: StockResearchPanelProps) {
  // 移动端默认收起股票信息（板块/概念/指标），为 K 线图腾出更大面积；桌面端默认展开。
  const [infoExpanded, setInfoExpanded] = useState<boolean>(
    () => (typeof window === 'undefined' ? true : !window.matchMedia('(max-width: 1023px)').matches)
  );

  // 全屏信息浮层（默认收起）+ 图表刷新 key
  const [fsInfoExpanded, setFsInfoExpanded] = useState(false);
  const [chartRefreshKey, setChartRefreshKey] = useState(0);

  // 每次进入全屏时，信息浮层默认收起
  useEffect(() => {
    if (isFullScreen) setFsInfoExpanded(false);
  }, [isFullScreen]);

  // 全屏工具栏上的「收起/展开」：收起时刷新 K 线图
  const toggleFullscreenInfo = () => {
    if (fsInfoExpanded) {
      setFsInfoExpanded(false);
      setChartRefreshKey((k) => k + 1);
    } else {
      setFsInfoExpanded(true);
    }
  };

  // 板块标签 + PE/市值 信息块（头部内联 与 全屏浮层 共用）
  const renderStockInfo = () => {
    if (!selectedStock || selectedStock.kind !== 'stock') return null;
    return (
      <>
        <div className="w-full mt-1 flex flex-col gap-0.5">
          {SECTOR_GROUP_ORDER.map((type) => {
            const group = sectors.filter((s) => s.type === type);
            if (group.length === 0) return null;
            const expanded = !!expandedSectors[type];
            const shown = expanded ? group : group.slice(0, SECTOR_MAX_SHOWN);
            const hidden = group.length - shown.length;
            return (
              <div key={type} className="flex flex-wrap items-center gap-1">
                <span className="text-[9px] md:text-[10px] font-bold text-slate-400 leading-none shrink-0">
                  {SECTOR_GROUP_LABELS[type] || type}
                </span>
                {shown.map((s) => (
                  <button
                    key={s.code}
                    onClick={() => { lastStockRef.current = { code: selectedStock.code, name: selectedStock.name || selectedStock.code }; onViewSector(s.code, s.name); }}
                    className={`text-[10px] md:text-xs px-1.5 py-0.5 rounded border font-medium transition-colors ${
                      s.type === '行业板块' ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                      : s.type === '概念板块' ? 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100'
                      : 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
                {hidden > 0 && (
                  <button
                    onClick={() => onChangeSectorsExpanded((prev) => ({ ...prev, [type]: !prev[type] }))}
                    className="text-[10px] md:text-xs px-1.5 py-0.5 rounded border border-dashed border-slate-300 text-slate-500 hover:bg-slate-100 font-medium transition-colors"
                  >
                    {expanded ? '收起' : `+${hidden}`}
                  </button>
                )}
              </div>
            );
          })}
          {Object.values(expandedSectors).some(Boolean) && (
            <button
              onClick={() => onChangeSectorsExpanded({})}
              className="self-start text-[10px] md:text-xs px-1.5 py-0.5 rounded border border-dashed border-slate-300 text-slate-500 hover:bg-slate-100 font-medium transition-colors"
            >
              收起
            </button>
          )}
        </div>
        {(() => {
          const latest = selectedStock.data[selectedStock.data.length - 1];
          if (!latest) return null;
          const items = [
            { label: 'PE(TTM)', value: latest.peTTM != null ? Number(latest.peTTM).toFixed(2) : '--' },
            { label: '总市值', value: formatMoney(latest.total_mv) },
            { label: '流通市值', value: formatMoney(latest.float_mv) },
            { label: '成交额', value: formatMoney(latest.amount) },
            { label: '换手率', value: latest.turn != null ? `${Number(latest.turn).toFixed(2)}%` : '--' },
            { label: '成交量', value: formatVolume(latest.volume) },
          ];
          return (
            <div className="w-full mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5">
              {items.map(it => (
                <span key={it.label} className="text-[9px] md:text-xs text-slate-500 whitespace-nowrap">
                  {it.label}: <span className="font-mono font-medium text-slate-900">{it.value}</span>
                </span>
              ))}
            </div>
          );
        })()}
      </>
    );
  };

  return (
      <section className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] h-[70vh] z-[60] lg:left-auto lg:right-4 lg:top-auto lg:bottom-4 lg:translate-x-0 lg:translate-y-0 lg:w-[min(560px,calc(100vw-2rem))] lg:h-[min(640px,calc(100vh-12rem))] rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden">
            <div ref={chartWrapperRef} className="flex flex-col h-full w-full">
            {isFullScreen ? (
              <div className="relative flex items-center gap-1.5 px-2 py-1 border-b bg-white z-30 shrink-0">
                {selectedStock?.kind === 'stock' && <WatchlistPicker code={selectedStock.code} compact />}
                {selectedStock?.kind === 'stock' && (
                  <div className="relative" ref={adjustMenuRef}>
                    <button
                      type="button"
                      onClick={() => onChangeAdjustMenuOpen(!adjustMenuOpen)}
                      className="px-2 py-0.5 text-xs font-bold text-slate-600 border border-slate-200 bg-white rounded-md hover:bg-slate-100 transition-colors"
                    >
                      {ADJUST_LABELS[adjustMode]} ▼
                    </button>
                    {adjustMenuOpen && (
                      <div className="absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-slate-200 py-1 min-w-[120px] z-30">
                        {ADJUST_OPTIONS.map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => {
                              onChangeAdjustMode(opt.value);
                              localStorage.setItem('klineAdjustMode', opt.value);
                              onChangeAdjustMenuOpen(false);
                            }}
                            className={`w-full text-left px-3 py-1 text-xs ${adjustMode === opt.value ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-100'}`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex items-center bg-slate-50 rounded-md p-0.5 border border-slate-200">
                  {TIMEFRAMES.map((tf) => (
                    <button key={tf.value} type="button" onClick={() => onChangeChartTimeframe(tf.value)}
                      className={`px-2 py-0.5 text-xs font-bold rounded ${chartTimeframe === tf.value ? 'bg-blue-600 text-white shadow' : 'text-slate-500 hover:bg-slate-200/50'}`}
                    >
                      {tf.label}
                    </button>
                  ))}
                </div>
                {selectedStock?.kind === 'stock' && (
                  <button
                    type="button"
                    onClick={toggleFullscreenInfo}
                    aria-expanded={fsInfoExpanded}
                    className="shrink-0 px-1.5 py-0.5 text-[10px] font-bold rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 transition-colors"
                  >
                    {fsInfoExpanded ? '收起 ▲' : '展开 ▼'}
                  </button>
                )}
                {selectedStock && (
                  <span className="ml-[5em] min-w-0 text-xs font-bold text-slate-700 truncate">{selectedStock.name || selectedStock.code}</span>
                )}
                {selectedStock?.name && (
                  <span className="ml-[2em] text-xs font-bold text-slate-500">{selectedStock.code}</span>
                )}
                <div className="ml-auto flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => { void onToggleFullscreen(); }}
                    className="px-2 py-0.5 text-xs font-bold text-slate-600 border border-slate-200 bg-white rounded-md hover:bg-slate-100 transition-colors"
                  >
                    退出全屏
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="关闭K线图"
                    className="px-2 py-0.5 text-xs font-bold text-slate-600 border border-slate-200 bg-white rounded-md hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ) : (
              <div className="relative px-4 py-3 border-b bg-white z-10 shrink-0">
                <StockSearch stockList={stockList} onSelect={onViewStock} />
                <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => { void onToggleFullscreen(); }}
                      className="px-3 py-1 text-xs font-bold text-slate-600 border border-slate-200 bg-white rounded-md hover:bg-slate-100 transition-colors"
                    >
                      {isFullScreen ? '退出全屏' : '全屏'}
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      aria-label="关闭K线图"
                      className="px-3 py-1 text-xs font-bold text-slate-600 border border-slate-200 bg-white rounded-md hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                {selectedStock && (
                  <>
                    <div className="flex flex-col items-start min-w-0 w-full">
                      <div className="flex items-baseline w-full gap-2">
                        <span className="text-xl font-bold">{selectedStock.code}</span>
                        <span className="ml-2 text-base font-medium text-slate-500 truncate">{selectedStock.name}</span>
                        {selectedStock.kind === 'stock' && (
                          <button
                            type="button"
                            onClick={() => setInfoExpanded((v) => !v)}
                            aria-expanded={infoExpanded}
                            className="ml-auto shrink-0 px-2 py-0.5 text-[10px] font-bold rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 transition-colors"
                          >
                            {infoExpanded ? '收起 ▲' : '展开 ▼'}
                          </button>
                        )}
                      </div>
  {selectedStock.kind === 'stock' && infoExpanded && renderStockInfo()}
                    </div>
  
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedStock?.kind === 'sector' && (
                        <button
                          onClick={() => {
                            const last = lastStockRef.current;
                            if (!last) return;
                            onReturnToStock();
                          }}
                          className="px-3 py-1 text-xs font-bold text-slate-600 border border-slate-200 bg-white rounded-md mr-2 hover:bg-slate-100 transition-colors"
                        >
                          ← 返回 {lastStockRef.current?.name || '个股'}
                        </button>
                      )}
                      {selectedStock?.kind === 'stock' && <WatchlistPicker code={selectedStock.code} compact />}
                    <div className="flex items-center bg-slate-50 rounded-lg p-1 border border-slate-200">
    {/* 复权按钮 */}
    {selectedStock?.kind === 'stock' && (
    <div className="relative" ref={adjustMenuRef}>
      <button
        onClick={() => onChangeAdjustMenuOpen(!adjustMenuOpen)}
        className="px-3 py-1 text-xs font-bold text-slate-600 border border-slate-200 bg-white rounded-md mr-2 hover:bg-slate-100 transition-colors"
      >
        {ADJUST_LABELS[adjustMode]} ▼
      </button>
      {adjustMenuOpen && (
        <div className="absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-slate-200 py-1 min-w-[120px]">
          {ADJUST_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => {
                onChangeAdjustMode(opt.value);
                localStorage.setItem('klineAdjustMode', opt.value);
                onChangeAdjustMenuOpen(false);
              }}
              className={`w-full text-left px-3 py-1 text-xs ${adjustMode === opt.value ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
    )}
                        {TIMEFRAMES.map((tf) => (
                          <button key={tf.value} onClick={() => onChangeChartTimeframe(tf.value)}
                            className={`px-3 py-1 text-xs font-bold rounded-md ${chartTimeframe === tf.value ? 'bg-blue-600 text-white shadow' : 'text-slate-500 hover:bg-slate-200/50'}`}
                          >
                            {tf.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
              
              <div className="flex-1 w-full h-full relative p-1">
                {isFullScreen && fsInfoExpanded && selectedStock?.kind === 'stock' && (
                  <div className="absolute top-0 left-0 right-0 z-20 max-h-[45%] overflow-y-auto bg-white/95 backdrop-blur-sm border-b border-slate-200 shadow px-3 py-2">
                    {renderStockInfo()}
                  </div>
                )}
                {chartLoading && <div className="absolute inset-0 z-20 bg-white/60 backdrop-blur-sm flex items-center justify-center"><div className="w-8 h-8 border-4 border-blue-500/20 border-t-blue-600 rounded-full animate-spin"></div></div>}
                <KLineChart
                  key={chartRefreshKey}
                  code={selectedStock.code}
                  data={selectedStock.data}
                  subChartType={subChartType}
                  onSubChartTypeChange={onChangeSubChartType}
                  mainChartType={mainChartType}
                  onMainChartTypeChange={onChangeMainChartType}
                />
              </div>
            </div>
      </section>
  );
}
