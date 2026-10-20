'use client';

interface SelectionControlsProps {
  formula: string;
  selectDate: string;
  strategyName: string;
  excludeSt: boolean;
  excludeSuspended: boolean;
  loading: boolean;
  onFormulaChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onStrategyNameChange: (value: string) => void;
  onExcludeStChange: (value: boolean) => void;
  onExcludeSuspendedChange: (value: boolean) => void;
  onRun: () => void;
  onAISelect: () => void;
  onSaveStrategy: () => void;
}

export default function SelectionControls({
  formula,
  selectDate,
  strategyName,
  excludeSt,
  excludeSuspended,
  loading,
  onFormulaChange,
  onDateChange,
  onStrategyNameChange,
  onExcludeStChange,
  onExcludeSuspendedChange,
  onRun,
  onAISelect,
  onSaveStrategy,
}: SelectionControlsProps) {
  return (
    <section
      aria-label="选股控制"
      className="bg-white p-4 md:p-6 rounded-2xl border border-slate-200 shadow-sm"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            策略公式
          </label>
          <input
            className="min-w-[180px] max-w-xs flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
            placeholder="策略名（可选，用于成果库标题）"
            value={strategyName}
            onChange={(e) => onStrategyNameChange(e.target.value)}
            maxLength={40}
          />
          <button
            type="button"
            onClick={onAISelect}
            disabled={loading}
            className="ml-auto bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl font-bold disabled:opacity-50"
          >
            AI 选股
          </button>
        </div>

        <textarea
          value={formula}
          onChange={(e) => onFormulaChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              onRun();
            }
          }}
          rows={3}
          disabled={loading}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-mono text-sm resize-y focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none disabled:opacity-50"
          placeholder="例如：CLOSE > MA(CLOSE, 20)　（支持多行，Ctrl+Enter 运行）"
          aria-label="选股公式"
        />

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-bold text-slate-500">基准日期</label>
          <input
            type="date"
            title="选股日期（留空 = 最新交易日）"
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-mono text-sm text-slate-600 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
            value={selectDate}
            onChange={(e) => onDateChange(e.target.value)}
          />
          <span className="text-xs font-bold text-slate-500 ml-2">过滤</span>
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={excludeSt}
              onChange={(e) => onExcludeStChange(e.target.checked)}
              className="accent-blue-600"
            />
            剔除ST
          </label>
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={excludeSuspended}
              onChange={(e) => onExcludeSuspendedChange(e.target.checked)}
              className="accent-blue-600"
            />
            剔除停牌
          </label>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onSaveStrategy}
              disabled={loading}
              className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 px-4 py-2 rounded-xl font-bold"
            >
              保存为策略
            </button>
            <button
              type="button"
              onClick={onRun}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-2 rounded-xl font-bold flex items-center justify-center gap-2 min-w-[160px]"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                '运行选股'
              )}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
