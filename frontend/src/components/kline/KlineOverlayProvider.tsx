'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import useStockResearch from '@/hooks/useStockResearch';
import StockResearchPanel from '@/components/select/StockResearchPanel';

interface KlineOverlayValue {
  openKline: (code: string) => void;
  closeKline: () => void;
  selectedCode: string | null;
  stockList: Array<{ code: string; name: string }>;
  ready: boolean;
}

const KlineOverlayContext = createContext<KlineOverlayValue | null>(null);

export function useKlineOverlay(): KlineOverlayValue {
  const ctx = useContext(KlineOverlayContext);
  if (!ctx) throw new Error('useKlineOverlay must be used within KlineOverlayProvider');
  return ctx;
}

export default function KlineOverlayProvider({ children }: { children: ReactNode }) {
  const {
    selectedStock,
    clearSelectedStock,
    stockList,
    viewStock,
    viewSector,
    chartLoading,
    chartTimeframe,
    changeChartTimeframe,
    subChartType,
    setSubChartType,
    mainChartType,
    setMainChartType,
    isFullScreen,
    toggleFullscreen,
    chartWrapperRef,
    adjustMode,
    adjustMenuOpen,
    adjustMenuRef,
    changeAdjustMode,
    setAdjustMenuOpen,
    sectors,
    expandedSectors,
    setExpandedSectors,
    lastStockRef,
    returnToStock,
  } = useStockResearch();

  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const stockListLengthRef = useRef(stockList.length);

  useEffect(() => {
    stockListLengthRef.current = stockList.length;
  }, [stockList.length]);

  const openKline = useCallback((code: string) => {
    if (stockListLengthRef.current === 0) {
      setPendingCode(code);
      return;
    }
    void viewStock(code);
  }, [viewStock]);

  const closeKline = useCallback(() => {
    clearSelectedStock();
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, [clearSelectedStock]);

  // 预热完成前的排队请求，就绪后消费一次。
  useEffect(() => {
    if (!pendingCode || stockList.length === 0) return;
    const code = pendingCode;
    setPendingCode(null);
    void viewStock(code);
  }, [pendingCode, stockList.length, viewStock]);

  // 换页即关。经 ref 调用，避免 closeKline 身份变化导致 effect 反复清空刚打开的浮窗。
  const closeRef = useRef(closeKline);
  useEffect(() => {
    closeRef.current = closeKline;
  }, [closeKline]);

  const pathname = usePathname();
  useEffect(() => {
    closeRef.current();
  }, [pathname]);

  const value = useMemo<KlineOverlayValue>(
    () => ({
      openKline,
      closeKline,
      selectedCode: selectedStock?.code ?? null,
      stockList,
      ready: stockList.length > 0,
    }),
    [openKline, closeKline, selectedStock?.code, stockList]
  );

  return (
    <KlineOverlayContext.Provider value={value}>
      {children}
      {selectedStock && (
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
          onViewStock={openKline}
          onViewSector={viewSector}
          lastStockRef={lastStockRef}
          onReturnToStock={returnToStock}
          onToggleFullscreen={toggleFullscreen}
          onClose={closeKline}
        />
      )}
    </KlineOverlayContext.Provider>
  );
}
