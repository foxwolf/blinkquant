// 选股信号日在 K 线图中的定位纯函数（spec: docs/superpowers/specs/2026-10-21-kline-focus-signal-date-design.md）

export const FOCUS_SPAN = 120;

function focusDateWindowUtc(focusDate: string): { winStart: number; winEnd: number } {
  // 'YYYY-MM-DD' → 东八区当日全天的 UTC 窗口 [D 00:00 CST, D 24:00 CST)
  // = UTC [D-1 16:00, D 16:00)。bar.time 无论是 UTC 午夜（D 00:00 UTC）
  // 还是东八区午夜（D-1 16:00 UTC）生成，都落在窗口内。
  const [y, m, d] = focusDate.split('-').map((x) => Number(x));
  if (!y || !m || !d) return { winStart: NaN, winEnd: NaN };
  const winStart = Date.UTC(y, m - 1, d, 0, 0, 0) / 1000 - 8 * 3600;
  return { winStart, winEnd: winStart + 24 * 3600 };
}

/**
 * 在 bar.time（unix 秒）数组中定位 focusDate 对应 bar 的索引。
 * 匹配：bar.time 落在东八区当日全天窗口内。
 * 无精确命中 → 回退取窗口开始前（≤ 信号日之前）的最近一条（停牌/未来日期容错）；再无 → -1。
 */
export function matchFocusIndex(times: number[], focusDate: string): number {
  if (!focusDate || !Array.isArray(times) || times.length === 0) return -1;
  const { winStart, winEnd } = focusDateWindowUtc(focusDate);
  if (!Number.isFinite(winStart)) return -1;
  let lastBefore = -1;
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (!Number.isFinite(t)) continue;
    if (t >= winStart && t < winEnd) return i;
    if (t < winStart) lastBefore = i;
  }
  return lastBefore;
}

/** 以 idx 为中心的可视逻辑区间（约 span 根 bar）。 */
export function focusLogicalRange(idx: number, span: number = FOCUS_SPAN): { from: number; to: number } {
  const half = Math.floor(span / 2);
  const start = Math.max(idx - half, -half); // 允许左侧留白当历史不足时
  return { from: start, to: start + span - 1 };
}
