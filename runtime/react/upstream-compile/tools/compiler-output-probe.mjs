import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {parse} from '@babel/parser';
import {transformFromAstSync, transformSync} from '@babel/core';
import * as t from '@babel/types';
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
const compilerPath = join(experimentRoot, 'generated/react-compiler/index.cjs');
const sourcePath = join(experimentRoot, 'experiments/compiler-output/Counter.tsx');
const outputRoot = join(experimentRoot, 'generated/compiler-output');
const reportPath = join(experimentRoot, 'reports/compiler-output-probe.json');
const checkOnly = process.argv.includes('--check');

const head = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: reactRoot,
  encoding: 'utf8',
}).trim();
if (head !== lock.commit) {
  throw new Error(`React checkout is ${head}; expected pinned commit ${lock.commit}`);
}

const reactCompiler = require(compilerPath).default;
const source = readFileSync(sourcePath, 'utf8');
const raw = transformSync(source, {
  ast: false,
  babelrc: false,
  code: true,
  comments: true,
  configFile: false,
  filename: sourcePath,
  generatorOpts: {compact: false},
  parserOpts: {plugins: ['typescript', 'jsx']},
  plugins: [[reactCompiler, {target: '19'}]],
  sourceMaps: false,
})?.code;
if (raw === null || raw === undefined) throw new Error('React Compiler emitted no code');

const parserOptions = {
  plugins: ['typescript', 'jsx'],
  sourceType: 'module',
};
const originalAst = parse(source, parserOptions);
const recoveredAst = parse(raw, parserOptions);

function exportedFunctions(program) {
  const result = new Map();
  for (const statement of program.body) {
    if (
      statement.type === 'ExportNamedDeclaration' &&
      statement.declaration?.type === 'FunctionDeclaration' &&
      statement.declaration.id !== null
    ) {
      result.set(statement.declaration.id.name, statement.declaration);
    }
  }
  return result;
}

const originalFunctions = exportedFunctions(originalAst.program);
const outputFunctions = exportedFunctions(recoveredAst.program);
const recoveredParameters = [];
for (const [name, original] of originalFunctions) {
  const outputFunction = outputFunctions.get(name);
  if (outputFunction === undefined) continue;
  for (let index = 0; index < original.params.length; index++) {
    const originalParameter = original.params[index];
    const outputParameter = outputFunction.params[index];
    const annotation = originalParameter?.typeAnnotation;
    if (annotation !== null && annotation !== undefined && outputParameter !== undefined) {
      outputParameter.typeAnnotation = t.cloneNode(annotation, true);
      recoveredParameters.push(`${name}:${index}`);
    }
  }
}

function generate(ast) {
  return transformFromAstSync(ast, undefined, {
    ast: false,
    babelrc: false,
    code: true,
    comments: true,
    configFile: false,
    generatorOpts: {compact: false},
    sourceMaps: false,
  })?.code ?? '';
}

const parameterRecovered = generate(recoveredAst);
const ambientAny = `
declare module 'react' {
  export function useState<T>(initial: T): [T, (next: T) => void];
}
declare module 'react/compiler-runtime' {
  export function c(size: number): any[];
}
declare module 'react/jsx-runtime' {
  export function jsx<Props>(type: string, props: Props): JSX.Element;
}
declare namespace JSX {
  type Element = {kind: string};
  interface IntrinsicElements {
    button: {onClick?: () => void; children?: unknown};
  }
}
`;
const ambientChecked = ambientAny.replace(
  'export function c(size: number): any[];',
  'export function c<T extends unknown[]>(size: number): T;',
);

mkdirSync(outputRoot, {recursive: true});
const rawPath = join(outputRoot, 'Counter.raw.tsx');
const preliminaryPath = join(outputRoot, 'Counter.preliminary.tsx');
const checkedPath = join(outputRoot, 'Counter.checked.tsx');
const loweredPath = join(outputRoot, 'Counter.lowered.ts');
const ambientPath = join(outputRoot, 'ambient.d.ts');
writeFileSync(rawPath, `${raw}\n`);
writeFileSync(preliminaryPath, `${parameterRecovered}\n`);
writeFileSync(ambientPath, ambientAny);

const compilerOptions = {
  jsx: ts.JsxEmit.Preserve,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  noImplicitAny: true,
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ES2020,
};

function makeProgram(mainPath, ambientSource) {
  writeFileSync(ambientPath, ambientSource);
  return ts.createProgram([mainPath, ambientPath], compilerOptions);
}

function diagnosticRows(program) {
  return ts.getPreEmitDiagnostics(program).map(diagnostic => ({
    code: diagnostic.code,
    file: diagnostic.file === undefined
      ? null
      : relative(experimentRoot, diagnostic.file.fileName),
    line: diagnostic.file === undefined || diagnostic.start === undefined
      ? null
      : diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  }));
}

const preliminary = makeProgram(preliminaryPath, ambientAny);
const checker = preliminary.getTypeChecker();
const preliminarySource = preliminary.getSourceFile(preliminaryPath);
if (preliminarySource === undefined) throw new Error('preliminary source missing');
const slotTypes = new Map();
const concreteIdentifierTypes = new Map();

function printedType(node) {
  return checker.typeToString(
    checker.getTypeAtLocation(node),
    node,
    ts.TypeFormatFlags.NoTruncation |
      ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
  );
}

function isConcrete(type) {
  return type !== 'any' && type !== 'unknown';
}

function rememberConcreteIdentifier(name, type) {
  if (!isConcrete(type)) return;
  const existing = concreteIdentifierTypes.get(name);
  if (existing !== undefined && existing !== type) {
    throw new Error(`local ${name} has conflicting reaching types: ${existing} / ${type}`);
  }
  concreteIdentifierTypes.set(name, type);
}

function visit(node) {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(node.left)
  ) {
    const type = printedType(node.right);
    rememberConcreteIdentifier(node.left.text, type);
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isElementAccessExpression(node.left) &&
    ts.isIdentifier(node.left.expression) &&
    node.left.expression.text === '$' &&
    ts.isNumericLiteral(node.left.argumentExpression)
  ) {
    const slot = Number(node.left.argumentExpression.text);
    let printed = printedType(node.right);
    if (!isConcrete(printed) && ts.isIdentifier(node.right)) {
      printed = concreteIdentifierTypes.get(node.right.text) ?? printed;
    }
    const existing = slotTypes.get(slot);
    if (existing !== undefined && existing !== printed) {
      throw new Error(`cache slot ${slot} has conflicting types: ${existing} / ${printed}`);
    }
    slotTypes.set(slot, printed);
  }
  ts.forEachChild(node, visit);
}
visit(preliminarySource);

const cacheTypes = [];
const highestSlot = Math.max(...slotTypes.keys());
for (let index = 0; index <= highestSlot; index++) {
  const type = slotTypes.get(index);
  if (type === undefined || type === 'any' || type === 'unknown') {
    throw new Error(`cache slot ${index} did not resolve to a concrete type (${type})`);
  }
  cacheTypes.push(type);
}

let specializedCalls = 0;
const recoveredLocals = [];
function parsedType(typeSource) {
  const tupleAlias = parse(
    `type Recovered = ${typeSource};`,
    {plugins: ['typescript'], sourceType: 'module'},
  ).program.body[0];
  if (tupleAlias.type !== 'TSTypeAliasDeclaration') {
    throw new Error(`failed to parse recovered type ${typeSource}`);
  }
  return tupleAlias.typeAnnotation;
}

function walkBabel(node) {
  if (node === null || typeof node !== 'object') return;
  if (
    node.type === 'VariableDeclarator' &&
    node.id?.type === 'Identifier' &&
    node.id.typeAnnotation == null &&
    node.init === null
  ) {
    const type = concreteIdentifierTypes.get(node.id.name);
    if (type !== undefined) {
      node.id.typeAnnotation = t.tsTypeAnnotation(t.cloneNode(parsedType(type), true));
      recoveredLocals.push({name: node.id.name, type});
    }
  }
  if (
    node.type === 'CallExpression' &&
    node.callee?.type === 'Identifier' &&
    node.callee.name === '_c' &&
    node.arguments.length === 1 &&
    node.arguments[0]?.type === 'NumericLiteral'
  ) {
    const declaredSize = node.arguments[0].value;
    if (declaredSize !== cacheTypes.length) {
      throw new Error(`_c(${declaredSize}) disagrees with ${cacheTypes.length} inferred slots`);
    }
    node.typeParameters = t.tsTypeParameterInstantiation([
      t.cloneNode(parsedType(`[${cacheTypes.join(', ')}]`), true),
    ]);
    specializedCalls++;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) value.forEach(walkBabel);
    else walkBabel(value);
  }
}
walkBabel(recoveredAst.program);
const checked = generate(recoveredAst);
writeFileSync(checkedPath, `${checked}\n`);

let loweredJsxElements = 0;
function jsxChild(node) {
  if (t.isJSXExpressionContainer(node)) return node.expression;
  if (t.isJSXText(node)) {
    const value = node.value.replace(/\s+/g, ' ');
    return value.trim() === '' ? null : t.stringLiteral(value);
  }
  if (t.isJSXElement(node) || t.isJSXFragment(node)) return node;
  throw new Error(`unsupported JSX child in probe: ${node.type}`);
}

const lowered = transformSync(checked, {
  ast: false,
  babelrc: false,
  code: true,
  comments: true,
  configFile: false,
  filename: checkedPath,
  generatorOpts: {compact: false},
  parserOpts: {plugins: ['typescript', 'jsx'], sourceType: 'module'},
  plugins: [
    () => ({
      visitor: {
        JSXElement: {
          exit(path) {
            const opening = path.node.openingElement;
            if (!t.isJSXIdentifier(opening.name)) {
              throw path.buildCodeFrameError('probe only supports identifier JSX names');
            }
            const properties = [];
            for (const attribute of opening.attributes) {
              if (!t.isJSXAttribute(attribute) || !t.isJSXIdentifier(attribute.name)) {
                throw path.buildCodeFrameError('probe does not support JSX spreads or namespaced attributes');
              }
              let value;
              if (attribute.value === null) value = t.booleanLiteral(true);
              else if (t.isStringLiteral(attribute.value)) value = attribute.value;
              else if (t.isJSXExpressionContainer(attribute.value)) value = attribute.value.expression;
              else throw path.buildCodeFrameError('unsupported JSX attribute value in probe');
              properties.push(t.objectProperty(t.identifier(attribute.name.name), value));
            }
            const children = path.node.children.map(jsxChild).filter(child => child !== null);
            if (children.length === 1) {
              properties.push(t.objectProperty(t.identifier('children'), children[0]));
            } else if (children.length > 1) {
              properties.push(t.objectProperty(t.identifier('children'), t.arrayExpression(children)));
            }
            const type = /^[a-z]/.test(opening.name.name)
              ? t.stringLiteral(opening.name.name)
              : t.identifier(opening.name.name);
            path.replaceWith(t.callExpression(t.identifier('_jsx'), [type, t.objectExpression(properties)]));
            loweredJsxElements++;
          },
        },
        Program: {
          exit(path) {
            path.unshiftContainer('body', t.importDeclaration(
              [t.importSpecifier(t.identifier('_jsx'), t.identifier('jsx'))],
              t.stringLiteral('react/jsx-runtime'),
            ));
          },
        },
      },
    }),
  ],
  sourceMaps: false,
})?.code;
if (lowered === null || lowered === undefined) throw new Error('JSX probe emitted no code');
writeFileSync(loweredPath, `${lowered}\n`);

const rawProgram = makeProgram(rawPath, ambientChecked);
const checkedProgram = makeProgram(checkedPath, ambientChecked);
const loweredProgram = makeProgram(loweredPath, ambientChecked);
const rawDiagnostics = diagnosticRows(rawProgram).filter(row => row.file?.endsWith('.tsx'));
const checkedDiagnostics = diagnosticRows(checkedProgram).filter(row => row.file?.endsWith('.tsx'));
const loweredDiagnostics = diagnosticRows(loweredProgram).filter(row => row.file?.endsWith('.ts'));
const report = {
  schema: 1,
  upstream: {commit: lock.commit},
  fixture: relative(experimentRoot, sourcePath),
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  raw: {
    sha256: createHash('sha256').update(raw).digest('hex'),
    memoCacheCalls: [...raw.matchAll(/\b_c\((\d+)\)/g)].map(match => Number(match[1])),
    diagnostics: rawDiagnostics,
  },
  recovery: {
    parameters: recoveredParameters,
    locals: recoveredLocals,
    specializedCalls,
    cacheSlotTypes: cacheTypes,
    sha256: createHash('sha256').update(checked).digest('hex'),
    diagnostics: checkedDiagnostics,
    jsxLowering: {
      elements: loweredJsxElements,
      sha256: createHash('sha256').update(lowered).digest('hex'),
      diagnostics: loweredDiagnostics,
    },
  },
};
const reportText = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(ambientPath, ambientChecked);

if (checkOnly) {
  if (readFileSync(reportPath, 'utf8') !== reportText) {
    throw new Error('compiler output report is stale; run npm run compiler:probe');
  }
  console.log(`compiler output probe current: ${cacheTypes.length} typed cache slots`);
} else {
  writeFileSync(reportPath, reportText);
  console.log(
    `recovered ${recoveredParameters.length} parameter and ${cacheTypes.length} cache slots; ` +
      `${checkedDiagnostics.length} final diagnostics`,
  );
}

if (checkedDiagnostics.length > 0 || loweredDiagnostics.length > 0) process.exitCode = 2;
