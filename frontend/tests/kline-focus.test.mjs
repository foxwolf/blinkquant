// frontend/tests/kline-focus.test.mjs
// Copy implementation to avoid TS import (same as src/utils/klineFocus.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const FOCUS_SPAN = 120;

function focusDateWindowUtc(focusDate) {
  const [y, m, d] = focusDate.split('-').map((x) => Number(x));
  if (!y || !m || !d) return { winStart: NaN, winEnd: NaN };
  const winStart = Date.UTC(y, m - 1, d, 0, 0, 0) / 1000 - 8 * 3600;
  return { winStart, winEnd: winStart + 24 * 3600 };
}

function matchFocusIndex(times, focusDate) {
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

function focusLogicalRange(idx, span = FOCUS_SPAN) {
  const half = Math.floor(span / 2);
  const start = Math.max(idx - half, -half);
  return { from: start, to: start + span - 1 };
}

const DAY = 86400;
// 2026-10-20 的 UTC 午夜 / 东八区午夜两种生成约定
const UTC_MIDNIGHT = Date.UTC(2026, 9, 20, 0, 0, 0) / 1000;
const CN_MIDNIGHT = Date.UTC(2026, 9, 19, 16, 0, 0) / 1000;

test('精确命中：容忍 UTC 午夜与东八区午夜两种 time 约定', () => {
  const times = [UTC_MIDNIGHT - 2 * DAY, UTC_MIDNIGHT - DAY, UTC_MIDNIGHT, UTC_MIDNIGHT + DAY];
  assert.equal(matchFocusIndex(times, '2026-10-20'), 2);
  const cnTimes = [CN_MIDNIGHT - 2 * DAY, CN_MIDNIGHT - DAY, CN_MIDNIGHT, CN_MIDNIGHT + DAY];
  assert.equal(matchFocusIndex(cnTimes, '2026-10-20'), 2);
});

test('信号日无 bar（停牌）→ 回退 ≤ 当日末的最近一条', () => {
  const times = [UTC_MIDNIGHT - 3 * DAY, UTC_MIDNIGHT - 2 * DAY, UTC_MIDNIGHT + 2 * DAY];
  assert.equal(matchFocusIndex(times, '2026-10-20'), 1);
});

test('信号日早于全部数据 → -1；非法输入 → -1', () => {
  assert.equal(matchFocusIndex([UTC_MIDNIGHT + DAY], '2026-10-01'), -1);
  assert.equal(matchFocusIndex([UTC_MIDNIGHT], ''), -1);
  assert.equal(matchFocusIndex([], '2026-10-20'), -1);
  assert.equal(matchFocusIndex([NaN, UTC_MIDNIGHT], '2026-10-20'), 1);
  assert.equal(matchFocusIndex([UTC_MIDNIGHT], 'bad-date'), -1);
});

test('focusLogicalRange：以 idx 为中心约 120 根，左侧不足允许留白', () => {
  assert.deepEqual(focusLogicalRange(500), { from: 440, to: 559 });
  assert.deepEqual(focusLogicalRange(10), { from: -50, to: 69 });
  assert.deepEqual(focusLogicalRange(100, 60), { from: 70, to: 129 });
});
