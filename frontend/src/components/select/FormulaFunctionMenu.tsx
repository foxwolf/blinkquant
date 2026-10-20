'use client';
import { useState, useCallback } from 'react';

interface NlMeta {
  indicators?: string[];
  signatures?: Record<string, string[]>;
  descriptions?: Record<string, string>;
}

interface FormulaFunctionMenuProps {
  onInsert: (text: string) => void;
  disabled?: boolean;
}

// 参数类型 → 中文标签（与后端 indicator_registry 签名约定一致）
const ARG_TYPE_LABELS: Record<string, string> = {
  field: '字段',
  pos_int: '正整数N',
  series: '序列',
  cond: '条件式',
};

// 插入编辑框时按参数类型生成占位提示（用户替换为实际参数）
const PLACEHOLDER_ARG_LABELS: Record<string, string> = {
  field: '高/低/开/收',
  pos_int: '20天',
  series: '序列(收/均线)',
  cond: '条件式',
};

function placeholderCall(name: string, signature: string[]): string {
  const args = signature.map((t) => PLACEHOLDER_ARG_LABELS[t] || t);
  return `${name}(${args.join(', ')})`;
}

const WINDOW_GROUP = ['MA', 'EMA', 'STD', 'ROC', 'REF', 'HHV', 'LLV', 'SUM'];
const LOGIC_GROUP = ['CROSS_UP', 'CROSS_DOWN', 'MAX', 'MIN', 'ABS', 'COUNT', 'BARSLAST'];

const SAMPLE_CALLS: Record<string, string> = {
  'MA': 'MA(CLOSE, 20)',
  'EMA': 'EMA(CLOSE, 12)',
  'STD': 'STD(CLOSE, 20)',
  'ROC': 'ROC(CLOSE, 20)',
  'REF': 'REF(CLOSE, 1)',
  'HHV': 'HHV(CLOSE, 20)',
  'LLV': 'LLV(CLOSE, 20)',
  'SUM': 'SUM(AMOUNT, 5)',
  'CROSS_UP': 'CROSS_UP(MA(CLOSE, 20), MA(CLOSE, 60))',
  'CROSS_DOWN': 'CROSS_DOWN(MA(CLOSE, 20), MA(CLOSE, 60))',
  'MAX': 'MAX(OPEN, CLOSE)',
  'MIN': 'MIN(OPEN, CLOSE)',
  'ABS': 'ABS(CLOSE - MA(CLOSE, 20))',
  'COUNT': 'COUNT(CLOSE > MA(CLOSE, 20), 10)',
  'BARSLAST': 'BARSLAST(CLOSE > MA(CLOSE, 20))',
  'ATR': 'ATR(14)',
  'RSI': 'RSI(CLOSE, 14)',
  'BOLL_UPPER': 'BOLL_UPPER(CLOSE, 20, 2)',
  'BOLL_LOWER': 'BOLL_LOWER(CLOSE, 20, 2)',
  'BOLL_MID': 'BOLL_MID(CLOSE, 20)',
  'KDJ_K': 'KDJ_K(9, 3)',
  'KDJ_D': 'KDJ_D(9, 3)',
  'KDJ_J': 'KDJ_J(9, 3)',
  'MACD_DIF': 'MACD_DIF(12, 26)',
  'MACD_DEA': 'MACD_DEA(12, 26, 9)',
  'MACD_HIST': 'MACD_HIST(12, 26, 9)',
  'DMI_PDI': 'DMI_PDI(14)',
  'DMI_MDI': 'DMI_MDI(14)',
  'DMI_ADX': 'DMI_ADX(14)',
  'OBV': 'OBV()',
  'CCI': 'CCI(14)',
  'WR': 'WR(14)',
  'MFI': 'MFI(14)',
  'SAR': 'SAR()',
  'AROON_UP': 'AROON_UP(14)',
  'AROON_DOWN': 'AROON_DOWN(14)',
  'TRIX': 'TRIX(14)',
  'BBI': 'BBI()',
  'VWAP': 'VWAP(20)',
  'BIAS': 'BIAS(20)',
  'PPO': 'PPO(12, 26)',
  'DEMA': 'DEMA(CLOSE, 20)',
  'TEMA': 'TEMA(CLOSE, 20)',
  'UO': 'UO()',
  'VR': 'VR(14)',
  'PSY': 'PSY(12)',
  'CR': 'CR(20)',
};

let metaPromise: Promise<NlMeta> | null = null;
function loadMeta(): Promise<NlMeta> {
  if (!metaPromise) {
    metaPromise = fetch('/api/nl-meta', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as NlMeta;
      })
      .catch((e) => {
        metaPromise = null;
        throw e;
      });
  }
  return metaPromise;
}

export default function FormulaFunctionMenu({ onInsert, disabled }: FormulaFunctionMenuProps) {
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState<NlMeta | null>(null);
  const [error, setError] = useState('');

  const toggle = useCallback(async () => {
    if (disabled) return;
    const next = !open;
    setOpen(next);
    if (!next || meta) return;
    setError('');
    try {
      setMeta(await loadMeta());
    } catch {
      setError('函数列表加载失败');
    }
  }, [open, meta, disabled]);

  const indicators = meta?.indicators || [];
  const descriptions = meta?.descriptions || {};
  const signatures = meta?.signatures || {};
  const otherGroup = indicators.filter((n) => !WINDOW_GROUP.includes(n) && !LOGIC_GROUP.includes(n));
  const groups: [string, string[]][] = [
    ['均线 / 窗口', WINDOW_GROUP.filter((n) => indicators.includes(n))],
    ['交叉 / 统计', LOGIC_GROUP.filter((n) => indicators.includes(n))],
    ['技术指标', otherGroup],
  ];

  return (
    <div className="absolute right-2 top-1.5 z-40">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={disabled}
        title={disabled ? '请先填写策略名' : '插入常用公式函数'}
        className="bg-white/90 border border-slate-200 hover:bg-white text-slate-500 text-xs font-bold px-2 py-1 rounded-lg shadow-sm disabled:opacity-40"
      >
        ƒx 函数 ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-40">
            <div className="max-h-72 overflow-y-auto">
              {error && <div className="px-3 py-4 text-xs text-red-600">{error}</div>}
              {!error && !meta && <div className="px-3 py-6 text-center text-xs text-slate-400">加载中…</div>}
              {!error && meta && groups.map(([label, names]) => (
                names.length > 0 && (
                  <div key={label}>
                    <div className="px-3 pt-2 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50">{label}</div>
                    {names.map((n) => (
                      <button
                        key={n}
                        type="button"
                        title={SAMPLE_CALLS[n] ? `示例：${SAMPLE_CALLS[n]}` : n}
                        onClick={() => {
                          setOpen(false);
                          onInsert(placeholderCall(n, signatures[n] || []));
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-blue-50 border-b border-slate-50 last:border-b-0"
                      >
                        <div className="flex items-baseline gap-2">
                          <span className="text-xs font-mono font-bold text-slate-700">{n}</span>
                          <span className="text-[10px] font-mono text-slate-400 truncate">
                            ({(signatures[n] || []).map((t) => ARG_TYPE_LABELS[t] || t).join(', ')})
                          </span>
                        </div>
                        {descriptions[n] && (
                          <div className="text-[10px] text-slate-500 leading-snug mt-0.5">{descriptions[n]}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
