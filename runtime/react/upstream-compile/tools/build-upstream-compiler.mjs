import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'tsup';

const here = dirname(fileURLToPath(import.meta.url));
const experimentRoot = resolve(here, '..');
const lock = JSON.parse(
  readFileSync(join(experimentRoot, 'upstream.lock.json'), 'utf8'),
);
const reactRoot = process.env.NTS_REACT_SOURCE
  ? resolve(process.env.NTS_REACT_SOURCE)
  : resolve(lock.repository);
const entry = join(
  reactRoot,
  'compiler/packages/babel-plugin-react-compiler/src/index.ts',
);
const outputRoot = join(experimentRoot, 'generated', 'react-compiler');
const output = join(outputRoot, 'index.cjs');
const sourceMapPath = `${output}.map`;
const reportPath = join(experimentRoot, 'reports', 'react-compiler-build.json');
const checkOnly = process.argv.includes('--check');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const head = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: reactRoot,
  encoding: 'utf8',
}).trim();
if (head !== lock.commit) {
  throw new Error(`React checkout is ${head}; expected pinned commit ${lock.commit}`);
}

mkdirSync(outputRoot, {recursive: true});
await build({
  bundle: true,
  clean: true,
  dts: false,
  entry: {index: entry},
  external: [
    '@babel/code-frame',
    '@babel/core',
    '@babel/parser',
    '@babel/traverse',
    '@babel/types',
    'invariant',
    'pretty-format',
    'zod/v4',
    'zod-validation-error/v4',
  ],
  esbuildOptions(options) {
    // The source checkout remains read-only. Resolve its bare imports from the
    // experiment's pinned dependencies instead of creating React/node_modules.
    options.nodePaths = [join(experimentRoot, 'node_modules')];
  },
  format: ['cjs'],
  minify: false,
  outDir: outputRoot,
  outExtension() {
    return {js: '.cjs'};
  },
  platform: 'node',
  silent: true,
  sourcemap: true,
  splitting: false,
  target: 'node20',
  tsconfig: join(experimentRoot, 'profiles', 'react-compiler-build.tsconfig.json'),
});

const bytes = readFileSync(output);
const sourceMap = JSON.parse(readFileSync(sourceMapPath, 'utf8'));
if (
  !Array.isArray(sourceMap.sources) ||
  !Array.isArray(sourceMap.sourcesContent) ||
  sourceMap.sources.length !== sourceMap.sourcesContent.length
) {
  throw new Error('React Compiler source map has no complete source inventory');
}
const sources = sourceMap.sources.map((source, index) => {
  const absolute = resolve(dirname(sourceMapPath), source);
  const path = relative(reactRoot, absolute).split(sep).join('/');
  if (path === '..' || path.startsWith('../')) {
    throw new Error(`Unexpected bundled source outside React checkout: ${source}`);
  }
  const sourceBytes = readFileSync(absolute);
  const digest = sha256(sourceBytes);
  if (sha256(sourceMap.sourcesContent[index]) !== digest) {
    throw new Error(`Bundled source differs from pinned checkout: ${path}`);
  }
  return {path, bytes: sourceBytes.length, sha256: digest};
}).sort((a, b) => a.path.localeCompare(b.path));
const packageLock = readFileSync(join(experimentRoot, 'package-lock.json'));
const report = {
  schema: 2,
  upstream: {
    repository: lock.repository,
    commit: lock.commit,
    entry: relative(reactRoot, entry),
  },
  builder: 'tsup@8.4.0',
  toolchainLock: {
    path: 'package-lock.json',
    sha256: sha256(packageLock),
  },
  sources: {
    count: sources.length,
    files: sources,
  },
  artifact: {
    path: relative(experimentRoot, output),
    bytes: bytes.length,
    sha256: sha256(bytes),
  },
};
const reportText = `${JSON.stringify(report, null, 2)}\n`;

if (checkOnly) {
  if (readFileSync(reportPath, 'utf8') !== reportText) {
    throw new Error('React Compiler build report is stale; run npm run build:compiler');
  }
  console.log(`React Compiler bundle current: ${report.artifact.sha256}`);
} else {
  writeFileSync(reportPath, reportText);
  console.log(
    `built pinned React Compiler (${report.artifact.bytes} bytes); ` +
      `wrote ${relative(process.cwd(), reportPath)}`,
  );
}
