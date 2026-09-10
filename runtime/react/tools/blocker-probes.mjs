import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const experimentRoot = resolve(here, '..');
const ntsRoot = resolve(experimentRoot, '../..');
const outputRoot = join(experimentRoot, 'generated/blocker-probes');
const reportPath = join(experimentRoot, 'reports/blocker-probes.json');
const checkOnly = process.argv.includes('--check');
const typescript = join(experimentRoot, 'node_modules/.bin/tsc');

const probes = [
  'jsx-lowering',
  'react-value-representation',
  'intersection-representation',
  'object-literal-methods',
  'function-object-semantics',
  'module-function-storage',
  'production-empty-return',
  'module-cycle',
  'language-surface',
];

function portable(path) {
  return path.split(sep).join('/');
}

function normalize(text) {
  return text
    .split(experimentRoot).join('runtime/react')
    .split(ntsRoot).join('.')
    .replaceAll('nts-workspace:////runtime/react/', 'nts-workspace:///runtime/react/');
}

function collectFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, {withFileTypes: true})) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

function inputFingerprint(config) {
  const root = dirname(join(experimentRoot, config));
  const files = collectFiles(root);
  const hash = createHash('sha256');
  for (const path of files) {
    hash.update(`${portable(relative(root, path))}\0`);
    hash.update(readFileSync(path));
    hash.update('\0');
  }
  return {files: files.length, sha256: hash.digest('hex')};
}

function run(executable, args, extraEnvironment = {}) {
  const result = spawnSync(executable, args, {
    cwd: experimentRoot,
    encoding: 'utf8',
    env: {...process.env, ...extraEnvironment},
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function parseNts(output) {
  const diagnostics = [...output.matchAll(
    /^  -- (.*):(\d+):(\d+) (NTS\d+) (.*)$/gm,
  )].map(([, file, line, column, code, message]) => ({
    code,
    file: file.startsWith(`${experimentRoot}/`)
      ? portable(relative(experimentRoot, file))
      : portable(file),
    line: Number(line),
    column: Number(column),
    message: normalize(message),
  }));
  const summary = /\n(\d+) function\(s\), (\d+) construct\(s\) refused\n/.exec(output);
  const nothing = /\n(\d+) function\(s\), nothing refused\n/.exec(output);
  const failures = [...output.matchAll(
    /^    (\w+) \{ func: "([^"]+)", block: BlockId\((\d+)\) \}$/gm,
  )].map(([, kind, functionName, block]) => ({
    kind,
    function: functionName,
    block: Number(block),
  }));
  const byCode = {};
  for (const diagnostic of diagnostics) {
    byCode[diagnostic.code] = (byCode[diagnostic.code] ?? 0) + 1;
  }
  return {
    refusedFunctions:
      summary !== null ? Number(summary[1]) : nothing !== null ? Number(nothing[1]) : null,
    refusedConstructs: summary !== null ? Number(summary[2]) : nothing !== null ? 0 : null,
    diagnosticsByCode: Object.fromEntries(
      Object.entries(byCode).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    ),
    diagnostics,
    verifier: {
      valid: !output.includes('the prepared program does NOT verify'),
      failures,
    },
  };
}

mkdirSync(outputRoot, {recursive: true});
mkdirSync(join(outputRoot, 'tmp'), {recursive: true});
function ntsHead() {
  return execFileSync('git', ['-C', ntsRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
}

function runAllProbes() {
  const results = {};
  for (const name of probes) {
    const config = `blockers/${name}/repro/tsconfig.json`;
    const ts = run(typescript, ['-p', config, '--noEmit', '--pretty', 'false']);
    if (ts.status !== 0) {
      throw new Error(`TypeScript 7 rejected ${name}:\n${ts.stdout}${ts.stderr}`);
    }
    const nts = run(
      'cargo',
      [
        'run',
        '--manifest-path',
        '../../Cargo.toml',
        '-q',
        '-p',
        'nts-cli',
        '--',
        'hir',
        config,
      ],
      {
        CARGO_TARGET_DIR: join(outputRoot, 'cargo-target'),
        TMPDIR: join(outputRoot, 'tmp'),
      },
    );
    writeFileSync(join(outputRoot, `${name}.hir.txt`), nts.stdout);
    writeFileSync(join(outputRoot, `${name}.stderr.txt`), nts.stderr);
    const parsed = parseNts(nts.stdout);
    results[name] = {
      config,
      input: inputFingerprint(config),
      typescript: {status: ts.status, diagnostics: 0},
      nts: {
        status: nts.status,
        signal: nts.signal,
        stderrBytes: Buffer.byteLength(nts.stderr),
        ...parsed,
      },
    };
  }
  return results;
}

let ntsCommit;
let results;
for (let attempt = 1; attempt <= 5; attempt++) {
  const before = ntsHead();
  const candidate = runAllProbes();
  const after = ntsHead();
  if (before === after) {
    ntsCommit = before;
    results = candidate;
    break;
  }
}
if (ntsCommit === undefined || results === undefined) {
  throw new Error(
    'NTS changed during five consecutive blocker probe attempts',
  );
}
const report = {
  schema: 1,
  ntsCommit,
  typescript: execFileSync(typescript, ['--version'], {encoding: 'utf8'})
    .trim()
    .replace(/^Version\s+/, ''),
  probes: results,
};
const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (checkOnly) {
  if (readFileSync(reportPath, 'utf8') !== reportText) {
    throw new Error('blocker probe report is stale; run npm run blockers:probe');
  }
  console.log(`blocker probes current: ${probes.length} strict fixtures`);
} else {
  writeFileSync(reportPath, reportText);
  console.log(
    `blocker probes: ${probes.length} strict fixtures; wrote ` +
      portable(relative(process.cwd(), reportPath)),
  );
}
