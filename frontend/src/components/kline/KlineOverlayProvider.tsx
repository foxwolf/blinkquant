'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import useStockResearch, { type StockListItem } from '@/hooks/useStockResearch';
import StockResearchPanel from '@/components/select/StockResearchPanel';

interface KlineOverlayValue {
  openKline: (code: string) => void;
  closeKline: () => void;
  selectedCode: string | null;
  stockList: StockListItem[];
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

  const pathname = usePathname();
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const openPathRef = useRef<string | null>(null);
  const stockListLengthRef = useRef(stockList.length);

  useEffect(() => {
    stockListLengthRef.current = stockList.length;
  }, [stockList.length]);

  const openKline = useCallback((code: string) => {
    openPathRef.current = pathname;
    if (stockListLengthRef.current === 0) {
      setPendingCode(code);
      return;
    }
    void viewStock(code);
  }, [viewStock, pathname]);

  const closeKline = useCallback(() => {
    openPathRef.current = null;
    setPendingCode(null);
    clearSelectedStock();
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, [clearSelectedStock]);

  // 预热完成前的排队请求，就绪后按归属消费（归属不符=已换页，静默丢弃；单窗语义：后到覆盖先到）。
  useEffect(() => {
    if (!pendingCode || stockList.length === 0) return;
    const code = pendingCode;
    setPendingCode(null);
    if (openPathRef.current !== pathname) return;
    void viewStock(code);
  }, [pendingCode, stockList.length, viewStock, pathname]);

  // 换页即关。经 ref 调用，避免 closeKline 身份变化导致 effect 反复清空刚打开的浮窗。
  const closeRef = useRef(closeKline);
  useEffect(() => {
    closeRef.current = closeKline;
  }, [closeKline]);

  useEffect(() => {
    if (openPathRef.current !== null && openPathRef.current !== pathname) closeRef.current();
  }, [pathname]);

  // 迟到落地守卫：open 已被关闭或已换页时，丢弃刚落地的图表状态。
  useEffect(() => {
    if (selectedStock && openPathRef.current !== pathname) clearSelectedStock();
  }, [selectedStock, pathname, clearSelectedStock]);

  const value = useMemo<KlineOverlayValue>(
    () => ({
      openKline,
      closeKline,
      selectedCode: openPathRef.current === pathname && selectedStock ? selectedStock.code : null,
      stockList,
      ready: stockList.length > 0,
    }),
    [openKline, closeKline, pathname, selectedStock, stockList]
  );

  return (
    <KlineOverlayContext.Provider value={value}>
      {children}
      {openPathRef.current === pathname && selectedStock && (
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
