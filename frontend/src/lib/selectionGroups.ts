export interface IndustryGroup {
  industry: string;
  codes: string[];
}

export const OTHER_INDUSTRY = '其他';

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
    const industry = industryByCode.get(code) || OTHER_INDUSTRY;
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
