import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import {basename, dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {parse} from '@babel/parser';
import {transformSync} from '@babel/core';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const experimentRoot = resolve(here, '..');
const lock = JSON.parse(
  readFileSync(join(experimentRoot, 'upstream.lock.json'), 'utf8'),
);
const reactRoot = process.env.NTS_REACT_SOURCE
  ? resolve(process.env.NTS_REACT_SOURCE)
  : resolve(lock.repository);
const fixtureRoot = join(experimentRoot, 'experiments/compiler-output/fixtures');
const goldenRoot = join(experimentRoot, 'experiments/compiler-output/golden');
const compilerPath = join(experimentRoot, 'generated/react-compiler/index.cjs');
const reportPath = join(experimentRoot, 'reports/react-compiler-goldens.json');
const checkOnly = process.argv.includes('--check');

const head = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: reactRoot,
  encoding: 'utf8',
}).trim();
if (head !== lock.commit) {
  throw new Error(`React checkout is ${head}; expected pinned commit ${lock.commit}`);
}
const reactCompiler = require(compilerPath).default;

function walk(node, visit, parent = null) {
  if (node === null || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) value.forEach(child => walk(child, visit, node));
    else walk(value, visit, node);
  }
}

function exportedParameterAnnotations(ast) {
  const functions = {};
  for (const statement of ast.program.body) {
    const declaration = statement.type === 'ExportNamedDeclaration'
      ? statement.declaration
      : null;
    if (declaration?.type !== 'FunctionDeclaration' || declaration.id === null) continue;
    functions[declaration.id.name] = declaration.params.map(
      parameter => parameter.typeAnnotation !== null && parameter.typeAnnotation !== undefined,
    );
  }
  return functions;
}

function sourceParameterTypes(sourcePath) {
  const program = ts.createProgram([sourcePath], {
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ES2020,
  });
  const sourceFile = program.getSourceFile(sourcePath);
  if (sourceFile === undefined) throw new Error(`TypeScript did not load ${sourcePath}`);
  const checker = program.getTypeChecker();
  const ranges = new Map();
  function visit(node) {
    if (ts.isFunctionLike(node)) {
      for (const parameter of node.parameters) {
        ranges.set(`${parameter.getStart(sourceFile)}:${parameter.end}`, checker.typeToString(
          checker.getTypeAtLocation(parameter),
          parameter,
          ts.TypeFormatFlags.NoTruncation |
            ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
        ));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return ranges;
}

mkdirSync(goldenRoot, {recursive: true});
const files = [];
for (const name of readdirSync(fixtureRoot).filter(name => name.endsWith('.tsx')).sort()) {
  const sourcePath = join(fixtureRoot, name);
  const source = readFileSync(sourcePath, 'utf8');
  const transformed = transformSync(source, {
    ast: true,
    babelrc: false,
    code: true,
    comments: true,
    configFile: false,
    filename: sourcePath,
    generatorOpts: {compact: false},
    parserOpts: {plugins: ['typescript', 'jsx']},
    plugins: [[reactCompiler, {target: '19'}]],
    sourceMaps: false,
  });
  const output = `${transformed?.code ?? ''}\n`;
  if (transformed?.ast === null || transformed?.ast === undefined) {
    throw new Error(`React Compiler emitted no AST for ${name}`);
  }
  const originalAst = parse(source, {plugins: ['typescript', 'jsx'], sourceType: 'module'});
  const outputAst = parse(output, {plugins: ['typescript', 'jsx'], sourceType: 'module'});
  const parameterTypes = sourceParameterTypes(sourcePath);
  const sourceMappedParameters = [];
  walk(transformed.ast, (node, parent) => {
    if (
      node.type !== 'FunctionDeclaration' &&
      node.type !== 'FunctionExpression' &&
      node.type !== 'ArrowFunctionExpression'
    ) {
      return;
    }
    for (let index = 0; index < node.params.length; index++) {
      const parameter = node.params[index];
      if (
        parameter.typeAnnotation !== null && parameter.typeAnnotation !== undefined ||
        parameter.loc?.start.index === undefined ||
        parameter.loc?.end.index === undefined
      ) {
        continue;
      }
      const range = `${parameter.loc.start.index}:${parameter.loc.end.index}`;
      const type = parameterTypes.get(range);
      if (type === undefined || type === 'any' || type === 'unknown') continue;
      sourceMappedParameters.push({
        function: node.id?.name ?? '<anonymous>',
        parameter: parameter.name ?? index,
        sourceRange: range,
        type,
      });
    }
  });
  const metrics = {
    memoCacheSizes: [...output.matchAll(/\b_c\((\d+)\)/g)].map(match => Number(match[1])),
    cacheElementAccesses: [...output.matchAll(/\$\[\d+\]/g)].length,
    jsxElements: 0,
    unannotatedFunctionParameters: 0,
    uninitializedLocalDeclarations: 0,
    originalExportParameters: exportedParameterAnnotations(originalAst),
    outputExportParameters: exportedParameterAnnotations(outputAst),
    sourceMappedParameters,
  };
  walk(outputAst, node => {
    if (node.type === 'JSXElement' || node.type === 'JSXFragment') metrics.jsxElements++;
    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
      for (const parameter of node.params) {
        if (parameter.typeAnnotation === null || parameter.typeAnnotation === undefined) {
          metrics.unannotatedFunctionParameters++;
        }
      }
    }
    if (
      node.type === 'VariableDeclarator' &&
      node.id?.type === 'Identifier' &&
      node.init === null
    ) {
      metrics.uninitializedLocalDeclarations++;
    }
  });

  const goldenPath = join(goldenRoot, name.replace(/\.tsx$/, '.compiler.tsx'));
  if (checkOnly) {
    if (readFileSync(goldenPath, 'utf8') !== output) {
      throw new Error(`React Compiler golden changed: ${basename(goldenPath)}`);
    }
  } else {
    writeFileSync(goldenPath, output);
  }
  files.push({
    fixture: relative(experimentRoot, sourcePath),
    golden: relative(experimentRoot, goldenPath),
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    outputSha256: createHash('sha256').update(output).digest('hex'),
    ...metrics,
  });
}

const report = {schema: 1, upstream: {commit: lock.commit}, files};
const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (checkOnly) {
  if (readFileSync(reportPath, 'utf8') !== reportText) {
    throw new Error('React Compiler golden report is stale');
  }
  console.log(`React Compiler goldens current: ${files.length} fixtures`);
} else {
  writeFileSync(reportPath, reportText);
  console.log(
    `wrote ${files.length} React Compiler goldens and ` +
      relative(process.cwd(), reportPath),
  );
}
