// Run upstream React's public-contract tests against one arm and write a
// ledger with one row per test.
//
//   node run.ts [--arm nts|upstream|stub] [--suite reconciler|scheduler|react]
//               [--mode development|production] [--update] [test files...]
//
// The upstream checkout is `NTS_REACT_UPSTREAM`, default
// ~/.cache/nts-react/upstream. It must be at the commit pinned in
// ../../upstream-compile/upstream.lock.json and have its dependencies
// installed. The `upstream` arm also needs its stable build (see README.md).
//
// The ledger for the nts arm is checked in, so a run is judged by its diff
// against the previous one, not only by its total. `--update` rewrites it.
// Control arms write only under build/.

import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const lane = resolve(here, '../..');

const args = process.argv.slice(2);
function option(name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = args[i + 1];
  if (value === undefined) throw new Error(`--${name} needs a value`);
  args.splice(i, 2);
  return value;
}
// Each suite is a directory of upstream test files with its own ledger.
const suites: Record<string, string> = {
  reconciler: 'packages/react-reconciler/src/__tests__/',
  scheduler: 'packages/scheduler/src/__tests__/',
  react: 'packages/react/src/__tests__/',
};

const arm = option('arm', 'nts');
const mode = option('mode', 'development');
const suite = option('suite', 'reconciler');
const update = args.includes('--update');
const suitePattern = suites[suite];
if (suitePattern === undefined) {
  throw new Error(`--suite must be one of ${Object.keys(suites).join(', ')}`);
}
// Extra arguments narrow the suite to matching test files, for a quick
// look; a narrowed run never rewrites the ledger.
const filters = args.filter(a => a !== '--update');
const patterns = filters.length === 0 ? [suitePattern] : filters;

const upstream = process.env['NTS_REACT_UPSTREAM'] ?? join(homedir(), '.cache/nts-react/upstream');
const lock = JSON.parse(readFileSync(join(lane, 'upstream-compile/upstream.lock.json'), 'utf8'));
const head = spawnSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], {encoding: 'utf8'});
if (head.status !== 0 || head.stdout.trim() !== lock.commit) {
  throw new Error(`${upstream} is not at the pinned commit ${lock.commit}`);
}
const armRoots: Record<string, string> = {
  upstream: join(upstream, 'build/oss-stable'),
  stub: join(lane, 'build/stub'),
  nts: join(lane, 'build/js'),
};
const armRoot = armRoots[arm];
if (armRoot === undefined) throw new Error(`unknown arm ${arm}`);
if (!existsSync(armRoot)) throw new Error(`the ${arm} arm has not been built: ${armRoot}`);

const out = join(lane, 'build/conformance');
mkdirSync(out, {recursive: true});
const json = join(out, `${arm}-${suite}.${mode}.jest.json`);

const run = spawnSync(
  process.execPath,
  [
    './scripts/jest/jest.js',
    '--config',
    join(here, 'jest.config.cjs'),
    '--json',
    `--outputFile=${json}`,
    '--silent',
    ...patterns,
  ],
  {
    cwd: upstream,
    stdio: ['ignore', 'ignore', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 1 << 30,
    env: {...process.env, NODE_ENV: mode, RELEASE_CHANNEL: 'stable', NTS_REACT_ARM: arm},
  },
);
if (!existsSync(json)) {
  process.stderr.write(run.stderr.slice(-4000));
  throw new Error(`jest wrote no result (status ${run.status})`);
}

// A test file that requires another renderer or the server packages tests
// that package, not this runtime. It stays in the ledger, marked out of scope,
// so it can neither inflate nor depress the in-scope count.
const foreign = /require\(['"](react-dom|react-server|react-client|react-test-renderer|react-art)(\/[^'"]*)?['"]\)/;
const scopeOf = new Map<string, string>();
function scope(file: string): string {
  if (!scopeOf.has(file)) {
    const match = foreign.exec(readFileSync(join(upstream, file), 'utf8'));
    scopeOf.set(file, match === null ? 'in' : `out:${match[1]}`);
  }
  return scopeOf.get(file)!;
}

interface JestTest {
  ancestorTitles: string[];
  title: string;
  status: string;
}
interface JestSuite {
  name: string;
  status: string;
  assertionResults: JestTest[];
}
type Tally = Record<string, number>;

const report: { testResults: JestSuite[] } = JSON.parse(readFileSync(json, 'utf8'));
const ledger: Record<string, string> = {};
const counts: Tally = {passed: 0, failed: 0, pending: 0, todo: 0, suiteErrors: 0};
const outOfScope: Tally = {passed: 0, failed: 0, pending: 0, todo: 0, suiteErrors: 0};
for (const suite of report.testResults) {
  const file = relative(upstream, suite.name);
  const where = scope(file);
  const tally = where === 'in' ? counts : outOfScope;
  const mark = where === 'in' ? '' : ` [${where}]`;
  if (suite.assertionResults.length === 0 && suite.status === 'failed') {
    ledger[`${file} :: (suite did not load)`] = 'failed' + mark;
    tally['suiteErrors'] = (tally['suiteErrors'] ?? 0) + 1;
    continue;
  }
  for (const test of suite.assertionResults) {
    const key = `${file} :: ${[...test.ancestorTitles, test.title].join(' › ')}`;
    // Upstream's `@gate` inverts a test whose gate is off in this channel: it
    // must fail, and reports `passed` when it does. Any broken implementation
    // passes those, so they are their own bucket and never count as passing.
    const status = test.title.startsWith('[GATED, SHOULD FAIL]')
      ? `gated-${test.status}`
      : test.status;
    ledger[key] = status + mark;
    tally[status] = (tally[status] ?? 0) + 1;
  }
}
const sorted = Object.fromEntries(Object.entries(ledger).sort(([a], [b]) => (a < b ? -1 : 1)));

const ledgerPath =
  arm === 'nts'
    ? join(here, 'ledger', `${suite}.${mode}.json`)
    : join(out, `${arm}-${suite}.${mode}.ledger.json`);
const previous: Record<string, string> = existsSync(ledgerPath)
  ? JSON.parse(readFileSync(ledgerPath, 'utf8')).tests
  : {};
const changes: string[] = [];
for (const key of new Set([...Object.keys(previous), ...Object.keys(sorted)])) {
  if (previous[key] !== sorted[key]) changes.push(`${previous[key] ?? '-'} -> ${sorted[key] ?? '-'}  ${key}`);
}

console.log(`${arm} ${suite} ${mode}: in scope ${JSON.stringify(counts)}`);
console.log(`${arm} ${suite} ${mode}: out of scope ${JSON.stringify(outOfScope)}`);
console.log(`${changes.length} test(s) changed against ${relative(lane, ledgerPath)}`);
for (const line of changes.slice(0, 50)) console.log(`  ${line}`);
if (changes.length > 50) console.log(`  ... ${changes.length - 50} more`);

if (filters.length === 0 && (arm !== 'nts' || update)) {
  mkdirSync(dirname(ledgerPath), {recursive: true});
  writeFileSync(
    ledgerPath,
    JSON.stringify({upstream: lock.commit, arm, suite, mode, counts, outOfScope, tests: sorted}, null, 1) + '\n',
  );
}
