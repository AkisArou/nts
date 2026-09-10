import {execFileSync, spawnSync} from 'node:child_process';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const experimentRoot = resolve(here, '..');
const ntsRoot = resolve(experimentRoot, '../..');
const compiler = join(experimentRoot, 'node_modules/.bin/tsc');
const configRoot = join(experimentRoot, 'generated/typescript7-typecheck');
const reportPath = join(experimentRoot, 'reports/runtime-typecheck.json');
const checkOnly = process.argv.includes('--check');
const stages = [
  ['normalized', 'client-mutation-production'],
  ['specialized', 'client-mutation-production-specialized'],
  ['linked', 'client-mutation-production-linked'],
];

function portable(path) {
  return path.split(sep).join('/');
}

function ranked(counts) {
  return Object.fromEntries(
    Object.entries(counts).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    ),
  );
}

function countTypeScriptFiles(root) {
  let count = 0;
  for (const entry of readdirSync(root, {withFileTypes: true})) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) count += countTypeScriptFiles(path);
    else if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
    ) {
      count++;
    }
  }
  return count;
}

function stageConfig(treeRoot) {
  const packages = join(treeRoot, 'packages');
  return {
    extends: join(ntsRoot, 'tsconfig.fixtures.json'),
    compilerOptions: {
      jsx: 'preserve',
      rootDir: experimentRoot,
      paths: {
        react: [join(packages, 'react/index.ts')],
        'react/*': [join(packages, 'react/*')],
        'react-reconciler': [join(packages, 'react-reconciler/index.ts')],
        'react-reconciler/*': [join(packages, 'react-reconciler/*')],
        scheduler: [join(packages, 'scheduler/index.ts')],
        'scheduler/*': [join(packages, 'scheduler/*')],
        'shared/*': [join(packages, 'shared/*')],
      },
    },
    include: [
      join(experimentRoot, 'profiles/runtime-globals.d.ts'),
      join(packages, 'react/index.ts'),
      join(packages, 'react-reconciler/src/ReactFiberReconciler.ts'),
      join(packages, 'scheduler/index.ts'),
    ],
  };
}

function checkStage(name, directory) {
  const treeRoot = join(experimentRoot, 'generated', directory);
  const configPath = join(configRoot, `${name}.json`);
  writeFileSync(configPath, `${JSON.stringify(stageConfig(treeRoot), null, 2)}\n`);
  const result = spawnSync(
    compiler,
    ['-p', configPath, '--pretty', 'false', '--noEmit'],
    {
      cwd: experimentRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (result.error !== undefined) throw result.error;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const byCode = {};
  const byFile = {};
  const examples = [];
  for (const line of output.split('\n')) {
    let match = /^(.*)\((\d+),(\d+)\): error TS(\d+): (.*)$/.exec(line);
    if (match !== null) {
      const [, file, lineNumber, column, codeNumber, message] = match;
      const code = `TS${codeNumber}`;
      const normalizedFile = portable(file);
      byCode[code] = (byCode[code] ?? 0) + 1;
      byFile[normalizedFile] = (byFile[normalizedFile] ?? 0) + 1;
      if (examples.length < 50) {
        examples.push({
          code,
          file: normalizedFile,
          line: Number(lineNumber),
          column: Number(column),
          message,
        });
      }
      continue;
    }
    match = /^error TS(\d+): (.*)$/.exec(line);
    if (match !== null) {
      const code = `TS${match[1]}`;
      byCode[code] = (byCode[code] ?? 0) + 1;
      byFile['<global>'] = (byFile['<global>'] ?? 0) + 1;
      if (examples.length < 50) {
        examples.push({
          code,
          file: '<global>',
          line: null,
          column: null,
          message: match[2],
        });
      }
    }
  }
  const diagnostics = Object.values(byCode).reduce(
    (sum, count) => sum + count,
    0,
  );
  if (result.status !== 0 && diagnostics === 0) {
    throw new Error(
      `TypeScript 7 failed for ${name} without a parsed diagnostic:\n${output}`,
    );
  }
  if (result.status === 0 && diagnostics !== 0) {
    throw new Error(
      `TypeScript 7 returned success with ${diagnostics} diagnostics for ${name}`,
    );
  }
  return {
    directory: `generated/${directory}`,
    sourceFiles: countTypeScriptFiles(treeRoot),
    diagnostics,
    diagnosticsByCode: ranked(byCode),
    diagnosticsByFile: ranked(byFile),
    examples,
  };
}

mkdirSync(configRoot, {recursive: true});
const version = execFileSync(compiler, ['--version'], {encoding: 'utf8'}).trim();
const results = Object.fromEntries(
  stages.map(([name, directory]) => [name, checkStage(name, directory)]),
);
const requiredCleanFiles = [
  'generated/client-mutation-production-linked/packages/react/src/ReactBaseClasses.ts',
  'generated/client-mutation-production-linked/packages/react/src/ReactNoopUpdateQueue.ts',
  'generated/client-mutation-production-linked/packages/shared/ReactInstanceMap.ts',
  'generated/client-mutation-production-linked/packages/react-reconciler/src/ReactPostPaintCallback.ts',
  'generated/client-mutation-production-linked/packages/react-reconciler/src/ReactFiberClassComponent.ts',
  'generated/client-mutation-production-linked/packages/scheduler/src/SchedulerProfiling.ts',
  'generated/client-mutation-production-linked/packages/react-reconciler/src/ReactFiberDevToolsHook.ts',
  'generated/client-mutation-production-linked/packages/react-reconciler/src/ReactFiberAsyncAction.ts',
  'generated/client-mutation-production-linked/packages/react-reconciler/src/ReactFiberRoot.ts',
  'generated/client-mutation-production-linked/packages/shared/isArray.ts',
];
for (const file of requiredCleanFiles) {
  if ((results.linked.diagnosticsByFile[file] ?? 0) !== 0) {
    throw new Error(`${file} must remain free of TypeScript 7 diagnostics`);
  }
}

const report = {
  schema: 2,
  compiler: '@typescript/native',
  typescript: version.replace(/^Version\s+/, ''),
  configTemplate: 'profiles/runtime-input.tsconfig.json',
  requiredCleanFiles,
  stages: results,
};
const reportText = `${JSON.stringify(report, null, 2)}\n`;

if (checkOnly) {
  if (readFileSync(reportPath, 'utf8') !== reportText) {
    throw new Error(
      'runtime typecheck report is stale; run npm run runtime:typecheck',
    );
  }
  const dirtyStages = Object.entries(results).filter(
    ([, result]) => result.diagnostics !== 0,
  );
  if (dirtyStages.length !== 0) {
    throw new Error(
      `runtime TypeScript gate failed: ${dirtyStages
        .map(([name, result]) => `${name}=${result.diagnostics}`)
        .join(', ')}`,
    );
  }
  console.log(
    `native TypeScript ${report.typescript} current: ` +
      `${results.linked.diagnostics} linked diagnostics`,
  );
} else {
  writeFileSync(reportPath, reportText);
  console.log(
    `native TypeScript ${report.typescript}: ` +
      `${results.normalized.diagnostics} normalized, ` +
      `${results.specialized.diagnostics} specialized, ` +
      `${results.linked.diagnostics} linked diagnostics; ` +
      `wrote ${relative(process.cwd(), reportPath)}`,
  );
}
