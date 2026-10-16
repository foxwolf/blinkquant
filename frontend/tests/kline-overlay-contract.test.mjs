import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('kline overlay provider owns the single on-demand chart panel instance', () => {
  const provider = read('src/components/kline/KlineOverlayProvider.tsx');
  assert.match(provider, /export function useKlineOverlay/);
  assert.match(provider, /export default function KlineOverlayProvider/);
  assert.match(provider, /useStockResearch\(\)/);
  assert.match(provider, /openPathRef.current === pathname && selectedStock && /);
  assert.match(provider, /openKline/);
  assert.match(provider, /pendingCode/);
  assert.match(provider, /clearSelectedStock/);
  assert.match(provider, /usePathname\(\)/);
  assert.match(provider, /<StockResearchPanel/);
  assert.match(provider, /onClose=\{closeKline\}/);
});

test('kline overlay is mounted app-wide and wired into non-select entry points', () => {
  const layout = read('src/app/(app)/layout.tsx');
  assert.match(layout, /<KlineOverlayProvider>/);
  const watchlist = read('src/app/(app)/watchlists/[watchlistId]/page.tsx');
  assert.match(watchlist, /onSelect=\{openKline\}/);
  assert.doesNotMatch(watchlist, /\/stocks\//);
  const artifact = read('src/components/artifacts/ArtifactDetailPage.tsx');
  assert.match(artifact, /onClick=\{\(\) => openKline\(/);
  assert.doesNotMatch(artifact, /href=\{'\/stocks\//);
});
