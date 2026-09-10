import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const experimentRoot = resolve(here, '..');
const lock = JSON.parse(readFileSync(join(experimentRoot, 'upstream.lock.json'), 'utf8'));
const reactRoot = process.env.NTS_REACT_SOURCE
  ? resolve(process.env.NTS_REACT_SOURCE)
  : resolve(lock.repository);
const entryPath = join(experimentRoot, 'conformance/upstream-oracle.ts');
const outputRoot = join(experimentRoot, 'generated/upstream-oracle');
const bundlePath = join(outputRoot, 'oracle.mjs');
const reportPath = join(experimentRoot, 'reports/upstream-oracle.json');
const checkOnly = process.argv.includes('--check');

const head = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: reactRoot,
  encoding: 'utf8',
}).trim();
if (head !== lock.commit) {
  throw new Error(`React checkout is ${head}; expected pinned commit ${lock.commit}`);
}

mkdirSync(outputRoot, {recursive: true});
const oracleHostPath = join(
  experimentRoot,
  'host-test/ReactFiberConfigMutationOracle.ts',
);
const reactIndexPath = join(
  experimentRoot,
  'generated/client-mutation-production-linked/packages/react/index.ts',
);
const compilerRuntimePath = join(
  experimentRoot,
  'generated/client-mutation-production-linked/packages/react/src/ReactCompilerRuntime.ts',
);
const jsxRuntimePath = join(experimentRoot, 'conformance/oracle-jsx-runtime.ts');
const build = await esbuild.build({
  absWorkingDir: experimentRoot,
  bundle: true,
  entryPoints: [entryPath],
  format: 'esm',
  logLevel: 'silent',
  metafile: true,
  outfile: bundlePath,
  platform: 'node',
  plugins: [{
    name: 'recording-oracle-host',
    setup(builder) {
      builder.onResolve({filter: /ReactFiberConfigMutation\.ts$/}, args => {
        if (!args.importer.includes('/generated/client-mutation-production-linked/')) {
          return null;
        }
        return {path: oracleHostPath};
      });
      builder.onResolve({filter: /^react$/}, () => ({path: reactIndexPath}));
      builder.onResolve({filter: /^react\/compiler-runtime$/}, () => ({
        path: compilerRuntimePath,
      }));
      builder.onResolve({filter: /^react\/jsx-runtime$/}, () => ({path: jsxRuntimePath}));
    },
  }],
  target: 'node22',
  treeShaking: true,
  jsx: 'automatic',
  jsxImportSource: 'react',
});

const stdout = execFileSync(process.execPath, [bundlePath], {encoding: 'utf8'}).trim();
const result = JSON.parse(stdout);
const bundle = readFileSync(bundlePath);
const inputs = Object.entries(build.metafile.inputs).map(([path, data]) => ({
  path: relative(experimentRoot, resolve(experimentRoot, path)).split(sep).join('/'),
  bytes: data.bytes,
})).sort((a, b) => a.path.localeCompare(b.path));
const report = {
  schema: 1,
  upstream: {commit: lock.commit},
  entry: relative(experimentRoot, entryPath).split(sep).join('/'),
  entrySha256: createHash('sha256').update(readFileSync(entryPath)).digest('hex'),
  esbuild: esbuild.version,
  bundle: {
    bytes: bundle.length,
    sha256: createHash('sha256').update(bundle).digest('hex'),
    inputFiles: inputs.length,
    inputBytes: inputs.reduce((total, input) => total + input.bytes, 0),
  },
  scenarios: result.scenarios,
};
const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (checkOnly) {
  if (readFileSync(reportPath, 'utf8') !== reportText) {
    throw new Error('upstream oracle report is stale');
  }
  console.log(`upstream oracle current: ${report.scenarios.length} scenarios`);
} else {
  writeFileSync(reportPath, reportText);
  console.log(
    `upstream oracle: ${report.scenarios.length} scenarios, ${report.bundle.inputFiles} ` +
      `bundle inputs; wrote ${relative(process.cwd(), reportPath)}`,
  );
}
