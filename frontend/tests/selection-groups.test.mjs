// frontend/tests/selection-groups.test.mjs
// Copy implementation to avoid TS import (same as src/lib/selectionGroups.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const OTHER_INDUSTRY = '其他';

function groupResultsByIndustry(results, stockList) {
  const industryByCode = new Map();
  for (const s of stockList) {
    if (s.industry) industryByCode.set(s.code, s.industry);
  }
  const seen = new Set();
  const buckets = new Map();
  for (const code of results) {
    if (seen.has(code)) continue;
    seen.add(code);
    const industry = industryByCode.get(code) || OTHER_INDUSTRY;
    const bucket = buckets.get(industry);
    if (bucket) bucket.push(code); else buckets.set(industry, [code]);
  }
  const normal = [];
  let other = null;
  for (const [industry, codes] of buckets) {
    codes.sort();
    if (industry === OTHER_INDUSTRY) other = { industry, codes };
    else normal.push({ industry, codes });
  }
  normal.sort((a, b) => b.codes.length - a.codes.length || a.industry.localeCompare(b.industry, 'zh-Hans-CN'));
  return other ? [...normal, other] : normal;
}

test('组按只数降序、同数按行业名升序、组内代码升序', () => {
  const stockList = [
    { code: 'sh.600000', name: '浦发银行', industry: '银行' },
    { code: 'sh.600036', name: '招商银行', industry: '银行' },
    { code: 'sz.000001', name: '平安银行', industry: '银行' },
    { code: 'sh.600519', name: '贵州茅台', industry: '白酒' },
    { code: 'sz.000858', name: '五粮液', industry: '白酒' },
    { code: 'sz.300750', name: '宁德时代', industry: '电池' },
    { code: 'sh.601012', name: '隆基绿能', industry: '电池' },
  ];
  const results = ['sz.300750', 'sh.600000', 'sz.000858', 'sh.600519', 'sh.601012', 'sz.000001', 'sh.600036'];
  const groups = groupResultsByIndustry(results, stockList);
  assert.deepStrictEqual(groups, [
    { industry: '银行', codes: ['sh.600000', 'sh.600036', 'sz.000001'] },
    { industry: '白酒', codes: ['sh.600519', 'sz.000858'] },
    { industry: '电池', codes: ['sh.601012', 'sz.300750'] },
  ]);
});

test('行业缺失归入「其他」且恒置底（即使数量最多）', () => {
  const stockList = [
    { code: 'sh.600519', name: '贵州茅台', industry: '白酒' },
    { code: 'sh.600000', name: '浦发银行' },
    { code: 'sz.000001', name: '平安银行', industry: '' },
  ];
  const results = ['sh.600000', 'sz.000001', 'sh.600519'];
  const groups = groupResultsByIndustry(results, stockList);
  assert.deepStrictEqual(groups, [
    { industry: '白酒', codes: ['sh.600519'] },
    { industry: '其他', codes: ['sh.600000', 'sz.000001'] },
  ]);
});

test('重复 code 去重', () => {
  const stockList = [{ code: 'sh.600000', name: '浦发银行', industry: '银行' }];
  const groups = groupResultsByIndustry(['sh.600000', 'sh.600000'], stockList);
  assert.deepStrictEqual(groups, [{ industry: '银行', codes: ['sh.600000'] }]);
});

test('stockList 未加载时全部落入「其他」按代码升序', () => {
  const groups = groupResultsByIndustry(['sz.000001', 'sh.600000'], []);
  assert.deepStrictEqual(groups, [{ industry: '其他', codes: ['sh.600000', 'sz.000001'] }]);
});

test('空结果返回空数组', () => {
  assert.deepStrictEqual(groupResultsByIndustry([], [{ code: 'a', name: 'a', industry: 'x' }]), []);
});
