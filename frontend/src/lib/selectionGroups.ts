export interface IndustryGroup {
  industry: string;
  codes: string[];
}

export const OTHER_INDUSTRY = '其他';

// 东财行业字段为该股所属的多级行业板块名以 "/" 拼接（顺序不定，如
// "银行/银行Ⅱ/股份制银行Ⅲ" 与 "国有大型银行Ⅲ/银行Ⅱ/银行" 同属银行大类）。
// 分组键归一：去层级后缀（Ⅱ/Ⅲ/Ⅳ…）→ 去重 → 取最短段（并列取字典序，顺序无关），
// 使同一大类的股票合并为一组（如全部银行 → "银行"）。
const LEVEL_SUFFIX = /[ⅠⅡⅢⅣⅤ]+/g;

export function coarseIndustry(industry: string): string {
  const segs = Array.from(new Set(
    industry
      .split('/')
      .map((s) => s.replace(LEVEL_SUFFIX, '').trim())
      .filter(Boolean),
  ));
  if (segs.length === 0) return '';
  return segs.reduce((a, b) => (b.length < a.length || (b.length === a.length && b < a) ? b : a));
}

export function groupResultsByIndustry(
  results: string[],
  stockList: Array<{ code: string; name: string; industry?: string }>,
): IndustryGroup[] {
  const industryByCode = new Map<string, string>();
  for (const s of stockList) {
    if (s.industry) industryByCode.set(s.code, s.industry);
  }
  const seen = new Set<string>();
  const buckets = new Map<string, string[]>();
  for (const code of results) {
    if (seen.has(code)) continue;
    seen.add(code);
    const industry = coarseIndustry(industryByCode.get(code) || '') || OTHER_INDUSTRY;
    const bucket = buckets.get(industry);
    if (bucket) bucket.push(code); else buckets.set(industry, [code]);
  }
  const normal: IndustryGroup[] = [];
  let other: IndustryGroup | null = null;
  for (const [industry, codes] of Array.from(buckets)) {
    codes.sort();
    if (industry === OTHER_INDUSTRY) other = { industry, codes };
    else normal.push({ industry, codes });
  }
  normal.sort((a, b) => b.codes.length - a.codes.length || a.industry.localeCompare(b.industry, 'zh-Hans-CN'));
  return other ? [...normal, other] : normal;
}
