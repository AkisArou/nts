import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const experimentRoot = resolve(here, '..');
const ntsRoot = resolve(experimentRoot, '../..');
const generatedRoot = join(experimentRoot, 'generated/nts-runtime');
const hirPath = join(generatedRoot, 'hir.txt');
const stderrPath = join(generatedRoot, 'diagnostics.txt');
const reportPath = join(experimentRoot, 'reports/runtime-native-probe.json');
const markdownPath = join(experimentRoot, 'reports/runtime-native-probe.md');
const checkOnly = process.argv.includes('--check');

const requiredReactExports = [
  'createContainer',
  'createHydrationContainer',
  'updateContainer',
  'updateContainerSync',
  'flushSyncFromReconciler',
  'injectIntoDevTools',
  'createPortal',
];

const categoryRules = [
  {
    id: 'react-key-representation',
    classification: 'representation',
    test: message =>
      message.includes('NTSReactOptimisticKey') ||
      message.startsWith('`key` on a union'),
  },
  {
    id: 'react-node-representation',
    classification: 'representation',
    test: message =>
      message.includes('`children` of unrepresentable type') ||
      message.includes(
        'a parameter of unrepresentable type (a union of `Iterable`',
      ),
  },
  {
    id: 'module-cycle-tdz',
    classification: 'semantic-integration-check',
    test: (_message, diagnostic) => diagnostic.code === 'NTS1004',
  },
  {
    id: 'module-evaluation-cascade',
    classification: 'secondary-refusal',
    test: (_message, diagnostic) => diagnostic.code === 'NTS1005',
  },
  {
    id: 'intersection-representation',
    classification: 'claimed-supported-conformance-defect',
    test: message => message.includes('intersection'),
  },
  {
    id: 'null-and-undefined-representation',
    classification: 'representation',
    test: message =>
      message.includes('`null` or `undefined` where what it stands in for') ||
      message.includes('a function returning null') ||
      message.includes('unrepresentable type (null)') ||
      message.includes('unrepresentable type (a union of null | undefined)'),
  },
  {
    id: 'module-function-storage',
    classification: 'documented-gap',
    test: message => message.includes('module-scope `let` holding a function'),
  },
  {
    id: 'module-value-representation',
    classification: 'representation',
    test: message =>
      message.includes('module-scope variable of unrepresentable type') ||
      message.includes('module-scope variable whose initializer was refused') ||
      message.includes('module-scope variable whose initializer is not constant'),
  },
  {
    id: 'abort-controller-and-signal',
    classification: 'host-or-library-interface',
    test: message =>
      message.includes('`AbortController`') || message.includes('`AbortSignal`'),
  },
  {
    id: 'thenable-representation-and-lowering',
    classification: 'representation-or-frontend-defect',
    test: message =>
      message.includes('Thenable') ||
      message.startsWith('`then`, a declaration outside every walk'),
  },
  {
    id: 'object-literal-and-structural-layout',
    classification: 'documented-gap',
    test: message =>
      message.includes('method on an object literal') ||
      message.includes('object literal that is not an object') ||
      message.includes('property the type does not declare') ||
      message.includes('property of unexpected shape') ||
      message.includes('pointer cast between two structs'),
  },
  {
    id: 'function-expression-this',
    classification: 'documented-gap',
    test: message => message.includes('`this` outside a method'),
  },
  {
    id: 'function-object-and-prototype-semantics',
    classification: 'explicit-non-goal',
    test: message =>
      message.includes('prototype`') ||
      message.includes('`__reactDisabledLog`') ||
      message.includes('`prepareStackTrace`'),
  },
  {
    id: 'closure-and-name-lowering',
    classification: 'supported-language-defect',
    test: message => message.includes('name from an enclosing scope'),
  },
  {
    id: 'native-host-capabilities',
    classification: 'native-host-interface',
    test: message =>
      message.includes('`performance`') ||
      message.includes('`console`') ||
      message.includes('`MessageChannel`') ||
      message.includes('`window.dispatchEvent`') ||
      message.includes('`Math.random`'),
  },
  {
    id: 'standard-library-wiring',
    classification: 'library-gap-or-import-linking',
    test: message =>
      message.includes('builtin this compiler does not provide') ||
      message.includes("not a member of this compiler's") ||
      message.includes('imported name whose implementation is not in this program') ||
      message.includes('`JSON.stringify`') ||
      message.includes('`AggregateError`') ||
      message.includes('`Symbol`'),
  },
  {
    id: 'generic-and-broad-function-representation',
    classification: 'representation-or-object-model',
    test: message =>
      message.includes('type parameter') ||
      message.includes('(`Function`)') ||
      message.includes('(`ClassInstance`)') ||
      message.includes('`DiffObject`') ||
      message.includes('`InspectedObject`'),
  },
  {
    id: 'structural-method-dispatch',
    classification: 'claimed-supported-conformance-defect',
    test: message =>
      message.includes('property the type does not declare') ||
      (message.includes('method `') &&
        !message.includes('method `bind` with no declaration')),
  },
  {
    id: 'dynamic-method-and-call-dispatch',
    classification: 'lowering-or-object-model',
    test: message =>
      message.includes('method `') ||
      message.includes('computed callee') ||
      message.includes('call of something that is not a function') ||
      message.includes('declared by `ReactThenableObject`'),
  },
  {
    id: 'regular-expressions',
    classification: 'documented-runtime-gap',
    test: message => message.includes('regular expression'),
  },
  {
    id: 'property-presence-and-metaobject-semantics',
    classification: 'explicit-non-goal',
    test: message =>
      message.includes('an `in` naming') ||
      message.includes('an `Object` static'),
  },
  {
    id: 'iteration-and-loop-lowering',
    classification: 'documented-gap',
    test: message =>
      message.includes('for in statement') ||
      message.includes('loop assigning a name declared outside it') ||
      message.includes('new Set` with contents'),
  },
  {
    id: 'rest-parameter-lowering',
    classification: 'supported-language-defect',
    test: message => message.includes('rest parameter'),
  },
  {
    id: 'array-and-collection-layout',
    classification: 'library-or-representation',
    test: message =>
      message.includes('array literal that is not an array') ||
      message.includes('where an array has only `length`') ||
      message.includes('`Map<') ||
      message.includes('`Set<') ||
      message.includes('`WeakSet`') ||
      message.includes('new Set` with contents'),
  },
  {
    id: 'string-conversion',
    classification: 'documented-semantic-gap',
    test: message => message.includes('conversion to string'),
  },
  {
    id: 'remaining-union-and-erased-representation',
    classification: 'representation',
    test: message =>
      message.includes('unrepresentable type') ||
      message.includes('union, whose members lay their fields out differently') ||
      message.includes('property of a value with no fields') ||
      message.includes('an erased value where a concrete representation is wanted') ||
      message.includes('a call result of unrepresentable type') ||
      message.includes('a function returning a union'),
  },
  {
    id: 'frontend-internal-refusals',
    classification: 'frontend-defect',
    test: message =>
      message.includes('declaration outside every walk') ||
      message.includes('shorthand naming nothing in scope'),
  },
  {
    id: 'other-lowering-refusals',
    classification: 'individual-lowering-gap',
    test: () => true,
  },
];

function portable(path) {
  return path.split(sep).join('/');
}

function rankedEntries(counts) {
  return Object.entries(counts).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
}

function rankedObject(counts) {
  return Object.fromEntries(rankedEntries(counts));
}

function collectFiles(root, predicate) {
  const files = [];
  for (const entry of readdirSync(root, {withFileTypes: true})) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(path, predicate));
    else if (entry.isFile() && predicate(path)) files.push(path);
  }
  return files.sort();
}

function inputFingerprint() {
  const roots = [
    join(experimentRoot, 'generated/client-mutation-production-linked'),
  ];
  const files = roots.flatMap(root =>
    collectFiles(root, path => path.endsWith('.ts') || path.endsWith('.tsx')),
  );
  files.push(
    join(experimentRoot, 'host-test/ReactFiberConfigMutation.ts'),
    join(experimentRoot, 'profiles/runtime-globals.d.ts'),
    join(experimentRoot, 'profiles/runtime-input.tsconfig.json'),
  );
  const hash = createHash('sha256');
  for (const path of files.sort()) {
    hash.update(`${portable(relative(experimentRoot, path))}\0`);
    hash.update(readFileSync(path));
    hash.update('\0');
  }
  return {sha256: hash.digest('hex'), files: files.length};
}

function normalizeText(text) {
  return text
    .split(experimentRoot).join('runtime/react')
    .split(ntsRoot).join('.')
    .replaceAll('nts-workspace:////runtime/react/', 'nts-workspace:///runtime/react/');
}

function runCompiler() {
  mkdirSync(join(generatedRoot, 'cargo-target'), {recursive: true});
  mkdirSync(join(generatedRoot, 'tmp'), {recursive: true});
  const result = spawnSync(
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
      'profiles/runtime-input.tsconfig.json',
    ],
    {
      cwd: experimentRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        CARGO_TARGET_DIR: join(generatedRoot, 'cargo-target'),
        TMPDIR: join(generatedRoot, 'tmp'),
      },
      maxBuffer: 128 * 1024 * 1024,
    },
  );
  if (result.error !== undefined) throw result.error;
  writeFileSync(hirPath, result.stdout ?? '');
  writeFileSync(stderrPath, result.stderr ?? '');
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function parseDiagnostic(rawFile, rawLine, rawColumn, code, rawMessage) {
  const file = rawFile.startsWith(`${experimentRoot}/`)
    ? portable(relative(experimentRoot, rawFile))
    : portable(rawFile);
  return {
    code,
    file,
    line: Number(rawLine),
    column: Number(rawColumn),
    message: normalizeText(rawMessage),
  };
}

function parseOutput(output) {
  const diagnostics = [];
  const diagnosticPattern = /^  -- (.*):(\d+):(\d+) (NTS\d+) (.*)$/gm;
  let match;
  while ((match = diagnosticPattern.exec(output)) !== null) {
    diagnostics.push(parseDiagnostic(...match.slice(1)));
  }

  const byCode = {};
  const byFile = {};
  const byMessage = {};
  const categoryMap = new Map(
    categoryRules.map(rule => [
      rule.id,
      {
        classification: rule.classification,
        count: 0,
        diagnosticsByCode: {},
        examples: [],
      },
    ]),
  );
  for (const diagnostic of diagnostics) {
    byCode[diagnostic.code] = (byCode[diagnostic.code] ?? 0) + 1;
    byFile[diagnostic.file] = (byFile[diagnostic.file] ?? 0) + 1;
    byMessage[diagnostic.message] = (byMessage[diagnostic.message] ?? 0) + 1;
    const rule = categoryRules.find(candidate =>
      candidate.test(diagnostic.message, diagnostic),
    );
    const category = categoryMap.get(rule.id);
    category.count++;
    category.diagnosticsByCode[diagnostic.code] =
      (category.diagnosticsByCode[diagnostic.code] ?? 0) + 1;
    if (category.examples.length < 5) category.examples.push(diagnostic);
  }

  const summaryMatch = /\n(\d+) function\(s\), (\d+) construct\(s\) refused\n/.exec(
    output,
  );
  const verifierFailures = [...output.matchAll(
    /^    (\w+) \{ func: "([^"]+)", block: BlockId\((\d+)\) \}$/gm,
  )].map(([, kind, functionName, block]) => ({
    kind,
    function: functionName,
    block: Number(block),
  }));
  const exports = [...output.matchAll(/^export func ([^(]+)\(/gm)].map(
    result => result[1],
  );
  const requiredExports = Object.fromEntries(
    requiredReactExports.map(name => [name, exports.includes(name)]),
  );

  return {
    diagnostics,
    diagnosticsByCode: rankedObject(byCode),
    diagnosticsByFile: rankedObject(byFile),
    topExactMessages: rankedEntries(byMessage)
      .slice(0, 25)
      .map(([message, count]) => ({count, message})),
    categories: Object.fromEntries(
      [...categoryMap]
        .filter(([, category]) => category.count !== 0)
        .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
        .map(([id, category]) => [
          id,
          {
            ...category,
            diagnosticsByCode: rankedObject(category.diagnosticsByCode),
          },
        ]),
    ),
    refusedFunctions: summaryMatch === null ? null : Number(summaryMatch[1]),
    refusedConstructs: summaryMatch === null ? null : Number(summaryMatch[2]),
    verifierFailures,
    exportedFunctions: exports.length,
    requiredReactExports: requiredExports,
  };
}

function renderMarkdown(report) {
  const categoryRows = Object.entries(report.refusals.categories)
    .map(
      ([name, category]) =>
        `| ${name} | ${category.count} | ${category.classification} |`,
    )
    .join('\n');
  const exportRows = Object.entries(report.exports.requiredReactExports)
    .map(([name, present]) => `| \`${name}\` | ${present ? 'present' : 'absent'} |`)
    .join('\n');
  const verifierRows = report.verifier.failures
    .map(failure => `- \`${failure.function}\`: ${failure.kind} in block ${failure.block}`)
    .join('\n');
  return `# Full React runtime NTS probe

NTS at \`${report.ntsCommit}\` parsed the strict linked production profile but
did not produce a usable React runtime. The command exited with status
${report.command.exitStatus}, while HIR reported ${report.refusals.functions}
refused functions and ${report.refusals.constructs} refused constructs. This
probe therefore treats the compiler process status as transport status, not as
evidence that React compiled.

## Acceptance state

- Native TypeScript input: ${report.typescriptInput.clean ? 'clean' : 'not clean'} (${report.typescriptInput.diagnostics} diagnostics)
- Prepared HIR verifies: ${report.verifier.valid ? 'yes' : 'no'}
- Required reconciler exports present: ${report.exports.allRequiredPresent ? 'yes' : 'no'}
- Usable native runtime: ${report.usable ? 'yes' : 'no'}

## Refusal categories

| Category | Count | Classification |
| --- | ---: | --- |
${categoryRows}

The categories are exhaustive over all ${report.refusals.constructs}
diagnostics. \`secondary-refusal\` entries are consequences of an earlier module
initializer refusal and must not be counted as independent React requirements.

## Required React exports

| Export | HIR |
| --- | --- |
${exportRows}

The recording HostConfig kernel is present in HIR, including
\`RecordingMutationHost#createContainer\`. That does not substitute for the
public reconciler entry points above.

## Verifier failures

${verifierRows}

The complete machine-readable diagnostic distribution, top source files,
examples and input fingerprint are in \`runtime-native-probe.json\`.
`;
}

function ntsHead() {
  return execFileSync('git', ['-C', ntsRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
}

let ntsCommit;
let compilerResult;
for (let attempt = 1; attempt <= 5; attempt++) {
  const before = ntsHead();
  const result = runCompiler();
  const after = ntsHead();
  if (before === after) {
    ntsCommit = before;
    compilerResult = result;
    break;
  }
}
if (ntsCommit === undefined || compilerResult === undefined) {
  throw new Error(
    'NTS changed during five consecutive runtime probe attempts',
  );
}
const normalizedOutput = normalizeText(compilerResult.stdout);
const parsed = parseOutput(compilerResult.stdout);
const typecheck = JSON.parse(
  readFileSync(join(experimentRoot, 'reports/runtime-typecheck.json'), 'utf8'),
);
const linkedDiagnostics = typecheck.stages.linked.diagnostics;
const allRequiredPresent = Object.values(parsed.requiredReactExports).every(Boolean);
const report = {
  schema: 1,
  profile: 'client-mutation-production-linked',
  ntsCommit,
  input: inputFingerprint(),
  command: {
    executable: 'cargo',
    arguments: [
      'run',
      '--manifest-path',
      '../../Cargo.toml',
      '-q',
      '-p',
      'nts-cli',
      '--',
      'hir',
      'profiles/runtime-input.tsconfig.json',
    ],
    exitStatus: compilerResult.status,
    signal: compilerResult.signal,
    stderrBytes: Buffer.byteLength(compilerResult.stderr),
  },
  typescriptInput: {
    compiler: typecheck.compiler,
    version: typecheck.typescript,
    diagnostics: linkedDiagnostics,
    clean: linkedDiagnostics === 0,
  },
  hir: {
    lines: compilerResult.stdout === '' ? 0 : compilerResult.stdout.split('\n').length - 1,
    normalizedBytes: Buffer.byteLength(normalizedOutput),
    normalizedSha256: createHash('sha256').update(normalizedOutput).digest('hex'),
  },
  refusals: {
    functions: parsed.refusedFunctions,
    constructs: parsed.refusedConstructs,
    diagnosticsByCode: parsed.diagnosticsByCode,
    diagnosticsByFile: parsed.diagnosticsByFile,
    categories: parsed.categories,
    topExactMessages: parsed.topExactMessages,
  },
  verifier: {
    valid: !compilerResult.stdout.includes('the prepared program does NOT verify'),
    failures: parsed.verifierFailures,
  },
  exports: {
    emittedFunctions: parsed.exportedFunctions,
    requiredReactExports: parsed.requiredReactExports,
    allRequiredPresent,
  },
};
report.usable =
  report.command.exitStatus === 0 &&
  report.typescriptInput.clean &&
  report.refusals.constructs === 0 &&
  report.verifier.valid &&
  report.exports.allRequiredPresent;

if (parsed.diagnostics.length !== parsed.refusedConstructs) {
  throw new Error(
    `parsed ${parsed.diagnostics.length} diagnostics but NTS reported ` +
      `${parsed.refusedConstructs} refused constructs`,
  );
}
if (statSync(stderrPath).size !== report.command.stderrBytes) {
  throw new Error('captured stderr size does not match the report');
}

const reportText = `${JSON.stringify(report, null, 2)}\n`;
const markdown = renderMarkdown(report);
if (checkOnly) {
  if (readFileSync(reportPath, 'utf8') !== reportText) {
    throw new Error(
      'runtime native probe report is stale; run npm run runtime:native-probe',
    );
  }
  if (readFileSync(markdownPath, 'utf8') !== markdown) {
    throw new Error(
      'runtime native probe summary is stale; run npm run runtime:native-probe',
    );
  }
  console.log(
    `runtime native probe current: ${report.refusals.constructs} refusals, ` +
      `${report.verifier.failures.length} verifier failures, ` +
      `${report.usable ? 'usable' : 'not usable'}`,
  );
} else {
  writeFileSync(reportPath, reportText);
  writeFileSync(markdownPath, markdown);
  console.log(
    `runtime native probe: ${report.refusals.constructs} refusals, ` +
      `${report.verifier.failures.length} verifier failures, ` +
      `${report.usable ? 'usable' : 'not usable'}; wrote ` +
      `${portable(relative(process.cwd(), reportPath))}`,
  );
}
