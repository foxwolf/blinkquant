// 周期切换时的公式自描述前缀改写（spec: docs/superpowers/specs/2026-10-21-formula-timeframe-rewrite-design.md）
// 约定：日 = 裸公式；周 = W. 前缀；月 = M. 前缀（与 AI 选股输出约定一致）。

const TF_PREFIXES = new Set(['D', 'W', 'M']);

// 前缀原子禁用板块字段（后端 _check_no_sector_fields）
const SECTOR_FIELD_RE = /^(S_CLOSE|S_PCT_CHG|INDUSTRY_[A-Z0-9_]+|SECTOR_[A-Z0-9_]+)$/;
// 日线专属字段：周/月表无对应列，带前缀必失败，保持原样
const DAILY_ONLY_FIELDS = new Set([
  'IS_LIMIT_UP', 'IS_TOUCH_LIMIT_UP', 'IS_LIMIT_DOWN', 'IS_TOUCH_LIMIT_DOWN', 'PREV_CLOSE',
]);

const TOKEN_RE = /(?:([DWM])\.)?([A-Z_][A-Z0-9_]*)/g;

type Edit = { start: number; end: number; text: string };

function applyEdits(text: string, edits: Edit[]): string {
  let out = text;
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

interface AtomInfo {
  prefixes: Set<string>;
  hasBareToken: boolean;
  hasProtectedField: boolean;
}

function inspectAtom(atom: string): AtomInfo {
  const prefixes = new Set<string>();
  let hasBareToken = false;
  let hasProtectedField = false;
  const re = new RegExp(TOKEN_RE.source, 'g');
  let m: RegExpExecArray | null;
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

function rewriteAtom(atom: string, fromTf: 'D' | 'W' | 'M', toTf: 'D' | 'W' | 'M'): string {
  const info = inspectAtom(atom);
  if (info.hasProtectedField) return atom;
  if (info.prefixes.size > 1) return atom;
  // 混合原子（带前缀 token 与裸 token 共存，后端本就拒绝跨期混用）保守不动
  if (info.prefixes.size >= 1 && info.hasBareToken) return atom;
  if (info.prefixes.has(toTf)) return atom;

  const edits: Edit[] = [];
  const re = new RegExp(TOKEN_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(atom)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    const token = m[2];
    if (token === 'AND' || token === 'OR') continue;

    if (info.prefixes.size === 0) {
      // 裸原子（身份 = 基础周期 = fromTf）：目标为日则原样，否则加目标前缀
      if (toTf !== 'D') {
        edits.push({ start, end, text: `${toTf}.${token}` });
      }
    } else if (info.prefixes.has(fromTf)) {
      // 旧基础周期的原子：跟随切换
      if (m[1] === fromTf) {
        edits.push({ start, end, text: toTf === 'D' ? token : `${toTf}.${token}` });
      } else if (toTf !== 'D') {
        // 同原子内的裸 token（基础周期 token）：跟随加目标前缀
        edits.push({ start, end, text: `${toTf}.${token}` });
      }
    }
    // 其他前缀（跨周期原子）→ 不动
  }
  if (edits.length === 0) return atom;
  return applyEdits(atom, edits);
}

export function rewriteFormulaForTimeframe(
  formula: string,
  fromTf: 'D' | 'W' | 'M',
  toTf: 'D' | 'W' | 'M',
): string {
  if (fromTf === toTf) return formula;
  if (typeof formula !== 'string' || formula.trim() === '') return formula;
  try {
    // 按 0 层括号的 AND/OR 单词切分，保留原文分隔符（含 && || 时不切分，整段按单原子处理）
    const pieces: string[] = [];
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
