import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const routeFiles = [
  ['/', 'src/app/(app)/page.tsx'],
  ['/select', 'src/app/(app)/select/page.tsx'],
  ['/stocks', 'src/app/(app)/stocks/page.tsx'],
  ['/stocks/[symbol]', 'src/app/(app)/stocks/[symbol]/page.tsx'],
  ['/watchlists', 'src/app/(app)/watchlists/page.tsx'],
  ['/watchlists/[watchlistId]', 'src/app/(app)/watchlists/[watchlistId]/page.tsx'],
  ['/strategies', 'src/app/(app)/strategies/page.tsx'],
  ['/strategies/selection/[strategyId]', 'src/app/(app)/strategies/selection/[strategyId]/page.tsx'],
  ['/strategies/backtest/[strategyId]', 'src/app/(app)/strategies/backtest/[strategyId]/page.tsx'],
  ['/backtests', 'src/app/(app)/backtests/page.tsx'],
  ['/artifacts', 'src/app/(app)/artifacts/page.tsx'],
  ['/artifacts/selections', 'src/app/(app)/artifacts/selections/page.tsx'],
  ['/artifacts/selections/[artifactId]', 'src/app/(app)/artifacts/selections/[artifactId]/page.tsx'],
  ['/artifacts/backtests', 'src/app/(app)/artifacts/backtests/page.tsx'],
  ['/artifacts/backtests/[artifactId]', 'src/app/(app)/artifacts/backtests/[artifactId]/page.tsx'],
  ['/tasks', 'src/app/(app)/tasks/page.tsx'],
  ['/tasks/[taskId]', 'src/app/(app)/tasks/[taskId]/page.tsx'],
  ['/system', 'src/app/(app)/system/page.tsx'],
  ['/login', 'src/app/login/page.tsx'],
  ['/register', 'src/app/register/page.tsx'],
  ['/admin', 'src/app/(app)/admin/page.tsx'],
];

for (const [route, relativePath] of routeFiles) {
  assert.ok(existsSync(resolve(root, relativePath)), `Missing route ${route}: ${relativePath}`);
}
for (const special of ['src/app/error.tsx', 'src/app/not-found.tsx']) {
  assert.ok(existsSync(resolve(root, special)), `Missing global boundary: ${special}`);
}

const home = readFileSync(resolve(root, 'src/app/(app)/page.tsx'), 'utf8');
const select = readFileSync(resolve(root, 'src/app/(app)/select/page.tsx'), 'utf8');
assert.match(home, /redirect\(['"]\/select['"]\)/, 'Home must redirect to the canonical /select workspace');
assert.match(select, /SelectionWorkspace/, '/select must reuse the same selection workspace');
assert.ok(!existsSync(resolve(root, 'src/app/(app)/page.tsx.working')), 'Obsolete aggregate page backup must be removed');

const legacyWatchlist = resolve(root, 'src/app/watchlist/page.tsx');
assert.ok(existsSync(legacyWatchlist), 'Legacy /watchlist alias must exist');
assert.match(readFileSync(legacyWatchlist, 'utf8'), /redirect\(['"]\/watchlists['"]\)/, 'Legacy /watchlist must redirect to canonical /watchlists');

const stocksHome = readFileSync(resolve(root, 'src/app/(app)/stocks/page.tsx'), 'utf8');
assert.match(stocksHome, /redirect\(['"]\/select['"]\)/, '/stocks must redirect to canonical /select');

const stocksSymbol = readFileSync(resolve(root, 'src/app/(app)/stocks/[symbol]/page.tsx'), 'utf8');
assert.match(stocksSymbol, /redirect\(/, '/stocks/[symbol] must redirect to the select workspace');
assert.ok(stocksSymbol.includes('/select?code='), '/stocks/[symbol] must deep-link the symbol via /select?code=');

const nav = readFileSync(resolve(root, 'src/components/app/MainNav.tsx'), 'utf8');
for (const [label, href] of [
  ['选股', '/select'],
  ['自选股', '/watchlists'],
  ['策略库', '/strategies'],
  ['回测研究', '/backtests'],
  ['成果库', '/artifacts'],
  ['任务中心', '/tasks'],
  ['系统状态', '/system'],
]) {
  assert.ok(nav.includes(`{ label: '${label}', href: '${href}', enabled: true }`), `Navigation item must be enabled: ${label}`);
}

for (const [name, source] of [
  ['/strategies', readFileSync(resolve(root, 'src/app/(app)/strategies/page.tsx'), 'utf8')],
  ['/strategies/selection/[strategyId]', readFileSync(resolve(root, 'src/app/(app)/strategies/selection/[strategyId]/page.tsx'), 'utf8')],
  ['/strategies/backtest/[strategyId]', readFileSync(resolve(root, 'src/app/(app)/strategies/backtest/[strategyId]/page.tsx'), 'utf8')],
]) {
  assert.doesNotMatch(source, /\/select\?tab=backtest/, `${name} must not deep-link to the removed select-page backtest panel`);
  assert.match(source, /router\.push\('\/backtests'\)/, `${name} must open the backtest workspace at /backtests`);
}

const workspace = readFileSync(resolve(root, 'src/components/select/SelectionWorkspace.tsx'), 'utf8');
assert.doesNotMatch(workspace, /\/api\/status/, 'Selection workspace must not poll the legacy /api/status endpoint');
assert.doesNotMatch(workspace, /\/stocks\//, 'Selection workspace must not deep-link to the removed standalone /stocks page');

const statusRoute = readFileSync(resolve(root, 'src/app/api/status/route.ts'), 'utf8');
assert.match(statusRoute, /requireAuth\(req\)/, '/api/status must require login (no unauthenticated hardware metrics)');
assert.match(statusRoute, /private, no-store/, '/api/status must not be publicly CDN-cached');

const systemPage = readFileSync(resolve(root, 'src/app/(app)/system/page.tsx'), 'utf8');
assert.match(systemPage, /NodeHealthCards metricsNodes=\{metricsNodes\}/, '/system must feed /api/status metrics into NodeHealthCards');
assert.match(systemPage, /fetch\('\/api\/status'/, '/system must own the single /api/status refresh cycle');

function walkSource(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkSource(p));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}
const relative = (p) => p.slice(root.length + 1).split('\\').join('/');
const shellImporters = walkSource(resolve(root, 'src'))
  .filter((p) => p.endsWith('.tsx') && readFileSync(p, 'utf8').includes('AppShell'))
  .map(relative)
  .filter((p) => p !== 'src/components/app/AppShell.tsx' && p !== 'src/app/(app)/layout.tsx');
assert.deepEqual(shellImporters, [], `Only the (app) layout may render AppShell, found: ${shellImporters.join(', ')}`);

const intervalSites = walkSource(resolve(root, 'src'))
  .filter((p) => readFileSync(p, 'utf8').includes('setInterval'))
  .map(relative)
  .filter((p) => p !== 'src/lib/polling.ts');
assert.deepEqual(intervalSites, [], `setInterval must live only in src/lib/polling.ts, found: ${intervalSites.join(', ')}`);

const sessionFetchSites = walkSource(resolve(root, 'src'))
  .filter((p) => readFileSync(p, 'utf8').includes("'/api/auth/session'"))
  .map(relative)
  .filter((p) => p !== 'src/lib/session-context.tsx');
assert.deepEqual(sessionFetchSites, [], `Session fetch must live only in src/lib/session-context.tsx, found: ${sessionFetchSites.join(', ')}`);

const sessionContextSrc = readFileSync(resolve(root, 'src/lib/session-context.tsx'), 'utf8');
assert.match(sessionContextSrc, /export function useSession/, 'Session context must expose useSession');
assert.match(sessionContextSrc, /SessionProvider/, 'Session context must export SessionProvider');

const useClusterSrc = readFileSync(resolve(root, 'src/hooks/useCluster.ts'), 'utf8');
assert.doesNotMatch(useClusterSrc, /setInterval/, 'useCluster must not background-poll; consumers only use submitTask');

for (const removed of [
  'src/components/TaskList.tsx',
  'src/components/ClusterStatusBar.tsx',
  'src/lib/theme.ts',
  'src/app/api/select/route.ts',
  'src/app/api/backtest/route.ts',
  'src/app/api/search/route.ts',
]) {
  assert.ok(!existsSync(resolve(root, removed)), `Removed dead code must not come back: ${removed}`);
}

const strategyImport = readFileSync(resolve(root, 'src/app/api/strategies/import/route.ts'), 'utf8');
const strategyCreate = readFileSync(resolve(root, 'src/app/api/strategies/route.ts'), 'utf8');
const strategyUpdate = readFileSync(resolve(root, 'src/app/api/strategies/[id]/route.ts'), 'utf8');
const strategyExtract = readFileSync(resolve(root, 'src/app/api/strategies/extract-from-backtest/route.ts'), 'utf8');
const nodeAssets = readFileSync(resolve(root, '../backend/scheduler/user_assets.py'), 'utf8');

assert.match(strategyImport, /node1Json/);
assert.match(strategyImport, /\/user-assets\/strategies\/import/);
assert.match(strategyImport, /user_id: auth\.user\.userId/);
assert.doesNotMatch(strategyImport, /jsonb_to_recordset/);
assert.doesNotMatch(strategyImport, /source_backtest.*uploaded/i);
assert.match(nodeAssets, /async def import_selection_strategies/);
assert.match(nodeAssets, /async with acquire\(\) as conn/);

assert.match(strategyCreate, /node1Json/);
assert.match(strategyCreate, /\/user-assets\/strategies/);
assert.match(nodeAssets, /async def create_strategy/);
assert.match(nodeAssets, /INSERT INTO strategy_versions/);
assert.match(nodeAssets, /async with acquire\(\) as conn/);

assert.match(strategyUpdate, /node1Json/);
assert.match(strategyUpdate, /\/user-assets\/strategies\//);
assert.match(nodeAssets, /async def update_strategy/);
assert.match(nodeAssets, /next_version/);

assert.match(strategyExtract, /node1Json/);
assert.match(strategyExtract, /\/user-assets\/strategies/);
assert.match(strategyExtract, /Cookie: req\.headers\.get\('cookie'\) \|\| ''/);

console.log(`IA4 route regression PASS: ${routeFiles.length} routes, shared selection workspace, 7 enabled navigation items, /watchlist compatibility redirect, and atomic strategy/version persistence checks.`);
