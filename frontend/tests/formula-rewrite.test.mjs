// frontend/tests/formula-rewrite.test.mjs
// Copy implementation to avoid TS import (same as src/lib/formulaTimeframe.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const TF_PREFIXES = new Set(['D', 'W', 'M']);

const SECTOR_FIELD_RE = /^(S_CLOSE|S_PCT_CHG|INDUSTRY_[A-Z0-9_]+|SECTOR_[A-Z0-9_]+)$/;
const DAILY_ONLY_FIELDS = new Set([
  'IS_LIMIT_UP', 'IS_TOUCH_LIMIT_UP', 'IS_LIMIT_DOWN', 'IS_TOUCH_LIMIT_DOWN', 'PREV_CLOSE',
]);

const TOKEN_RE = /(?:([DWM])\.)?([A-Z_][A-Z0-9_]*)/g;

function applyEdits(text, edits) {
  let out = text;
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

function inspectAtom(atom) {
  const prefixes = new Set();
  let hasBareToken = false;
  let hasProtectedField = false;
  const re = new RegExp(TOKEN_RE.source, 'g');
  let m;
  while ((m = re.exec(atom)) !== null) {
    const token = m[2];
    if (token === 'AND' || token === 'OR') continue;
    if (SECTOR_FIELD_RE.test(token) || DAILY_ONLY_FIELDS.has(token)) {
      hasProtectedField = true;
    }
    if (m[1]) prefixes.add(m[1]);
    else hasBareToken = true;
  }
  return { prefixes, hasBareToken, hasProtectedField };
}

function rewriteAtom(atom, fromTf, toTf) {
  const info = inspectAtom(atom);
  if (info.hasProtectedField) return atom;
  if (info.prefixes.size > 1) return atom;
  if (info.prefixes.size >= 1 && info.hasBareToken) return atom;
  if (info.prefixes.has(toTf)) return atom;

  const edits = [];
  const re = new RegExp(TOKEN_RE.source, 'g');
  let m;
  while ((m = re.exec(atom)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    const token = m[2];
    if (token === 'AND' || token === 'OR') continue;

    if (info.prefixes.size === 0) {
      if (toTf !== 'D') {
        edits.push({ start, end, text: `${toTf}.${token}` });
      }
    } else if (info.prefixes.has(fromTf)) {
      if (m[1] === fromTf) {
        edits.push({ start, end, text: toTf === 'D' ? token : `${toTf}.${token}` });
      } else if (toTf !== 'D') {
        edits.push({ start, end, text: `${toTf}.${token}` });
      }
    }
  }
  if (edits.length === 0) return atom;
  return applyEdits(atom, edits);
}

function rewriteFormulaForTimeframe(formula, fromTf, toTf) {
  if (fromTf === toTf) return formula;
  if (typeof formula !== 'string' || formula.trim() === '') return formula;
  try {
    const pieces = [];
    let depth = 0;
    let atomStart = 0;
    let i = 0;
    while (i < formula.length) {
      const ch = formula[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (depth === 0) {
        const beforeOk = i === 0 || !/[A-Z0-9_]/.test(formula[i - 1]);
        if (beforeOk) {
          const w3 = formula.slice(i, i + 3);
          if (w3 === 'AND') {
            const afterOk = i + 3 >= formula.length || !/[A-Z0-9_]/.test(formula[i + 3]);
            if (afterOk) {
              pieces.push(rewriteAtom(formula.slice(atomStart, i), fromTf, toTf));
              pieces.push(formula.slice(i, i + 3));
              i += 3;
              atomStart = i;
              continue;
            }
          } else {
            const w2 = formula.slice(i, i + 2);
            if (w2 === 'OR') {
              const afterOk = i + 2 >= formula.length || !/[A-Z0-9_]/.test(formula[i + 2]);
              if (afterOk) {
                pieces.push(rewriteAtom(formula.slice(atomStart, i), fromTf, toTf));
                pieces.push(formula.slice(i, i + 2));
                i += 2;
                atomStart = i;
                continue;
              }
            }
          }
        }
      }
      i++;
    }
    pieces.push(rewriteAtom(formula.slice(atomStart), fromTf, toTf));
    return pieces.join('');
  } catch {
    return formula;
  }
}

test('裸公式 D→W 加前缀（函数与字段位置）', () => {
  assert.equal(
    rewriteFormulaForTimeframe('MA(CLOSE, 20) > CLOSE', 'D', 'W'),
    'W.MA(W.CLOSE, 20) > W.CLOSE',
  );
});

test('裸公式 D→M 加前缀（含嵌套括号算术）', () => {
  assert.equal(
    rewriteFormulaForTimeframe('(CLOSE - OPEN) / CLOSE > 0.05', 'D', 'M'),
    '(M.CLOSE - M.OPEN) / M.CLOSE > 0.05',
  );
});

test('W→D 去前缀', () => {
  assert.equal(
    rewriteFormulaForTimeframe('W.MA(W.CLOSE, 20) > W.CLOSE', 'W', 'D'),
    'MA(CLOSE, 20) > CLOSE',
  );
});

test('D→W→D 往返还原原文', () => {
  const f = 'CROSS_UP(MA(CLOSE, 5), MA(CLOSE, 20)) AND VOL > 1e7';
  assert.equal(rewriteFormulaForTimeframe(rewriteFormulaForTimeframe(f, 'D', 'W'), 'W', 'D'), f);
});

test('W→M 前缀替换', () => {
  assert.equal(
    rewriteFormulaForTimeframe('W.MA(W.CLOSE,5) > W.MA(W.CLOSE,20)', 'W', 'M'),
    'M.MA(M.CLOSE,5) > M.MA(M.CLOSE,20)',
  );
});

test('跨周期原子保留，裸原子跟随切换', () => {
  assert.equal(
    rewriteFormulaForTimeframe('CLOSE > 10 AND W.CLOSE > 0', 'D', 'M'),
    'M.CLOSE > 10 AND W.CLOSE > 0',
  );
  // W 周期下的 W. 原子是基础原子，切 M 时跟随
  assert.equal(
    rewriteFormulaForTimeframe('W.CLOSE > 10 AND M.CLOSE > 0', 'W', 'M'),
    'M.CLOSE > 10 AND M.CLOSE > 0',
  );
});

test('板块字段原子跳过', () => {
  assert.equal(rewriteFormulaForTimeframe('S_CLOSE > 0', 'D', 'W'), 'S_CLOSE > 0');
  assert.equal(rewriteFormulaForTimeframe('CLOSE > S_CLOSE', 'D', 'W'), 'CLOSE > S_CLOSE');
  assert.equal(rewriteFormulaForTimeframe('INDUSTRY_BANK == 1', 'D', 'W'), 'INDUSTRY_BANK == 1');
});

test('日线专属字段原子跳过', () => {
  assert.equal(
    rewriteFormulaForTimeframe('IS_LIMIT_UP == 1', 'D', 'W'),
    'IS_LIMIT_UP == 1',
  );
  assert.equal(
    rewriteFormulaForTimeframe('CLOSE > PREV_CLOSE', 'D', 'W'),
    'CLOSE > PREV_CLOSE',
  );
});

test('混合原子（前缀与裸 token 共存）跳过', () => {
  assert.equal(rewriteFormulaForTimeframe('W.CLOSE > CLOSE', 'W', 'M'), 'W.CLOSE > CLOSE');
  assert.equal(rewriteFormulaForTimeframe('W.CLOSE > MA(CLOSE,20)', 'W', 'D'), 'W.CLOSE > MA(CLOSE,20)');
});

test('多原子 AND/OR 分隔符保留', () => {
  assert.equal(
    rewriteFormulaForTimeframe('CLOSE > 10 AND VOL > 1e7 OR PE_TTM < 30', 'D', 'W'),
    'W.CLOSE > 10 AND W.VOL > 1e7 OR W.PE_TTM < 30',
  );
});

test('幂等与边界', () => {
  assert.equal(rewriteFormulaForTimeframe('W.MA(W.CLOSE,5)', 'W', 'W'), 'W.MA(W.CLOSE,5)');
  assert.equal(rewriteFormulaForTimeframe('', 'D', 'W'), '');
  assert.equal(rewriteFormulaForTimeframe('   ', 'D', 'W'), '   ');
  assert.equal(rewriteFormulaForTimeframe('CLOSE > 10', 'D', 'D'), 'CLOSE > 10');
});
