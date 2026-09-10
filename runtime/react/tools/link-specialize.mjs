import {createHash} from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {dirname, join, posix, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from '@babel/parser';
import {transformSync} from '@babel/core';
import * as t from '@babel/types';

const here = dirname(fileURLToPath(import.meta.url));
const experimentRoot = resolve(here, '..');
const closure = JSON.parse(
  readFileSync(join(experimentRoot, 'reports/client-mutation-production.json'), 'utf8'),
);
const inputRoot = join(
  experimentRoot,
  'generated/client-mutation-production-specialized',
);
const outputRoot = join(
  experimentRoot,
  'generated/client-mutation-production-linked',
);
const reportPath = join(experimentRoot, 'reports/link-specialization.json');
const checkOnly = process.argv.includes('--check');

const inputs = closure.files.map(file => file.path.replace(/\.js$/, '.ts'));
inputs.push('packages/react-reconciler/src/ReactFiberConfig.ts');
inputs.sort();

function evaluate(node, values) {
  if (t.isBooleanLiteral(node) || t.isNumericLiteral(node) || t.isStringLiteral(node)) {
    return {known: true, value: node.value};
  }
  if (t.isNullLiteral(node)) return {known: true, value: null};
  if (t.isIdentifier(node) && values.has(node.name)) {
    return {known: true, value: values.get(node.name)};
  }
  if (t.isUnaryExpression(node)) {
    const argument = evaluate(node.argument, values);
    if (!argument.known) return {known: false};
    if (node.operator === '!') return {known: true, value: !argument.value};
    if (node.operator === '-' && typeof argument.value === 'number') {
      return {known: true, value: -argument.value};
    }
  }
  if (t.isLogicalExpression(node)) {
    const left = evaluate(node.left, values);
    if (!left.known) return {known: false};
    if (node.operator === '&&' && !left.value) return left;
    if (node.operator === '||' && left.value) return left;
    if (node.operator === '??' && left.value !== null && left.value !== undefined) return left;
    return evaluate(node.right, values);
  }
  return {known: false};
}

function exportedInitializers(source, path) {
  const ast = parse(source, {
    plugins: ['typescript', 'jsx'],
    sourceFilename: path,
    sourceType: 'module',
  });
  const initializers = new Map();
  for (const statement of ast.program.body) {
    if (
      !t.isExportNamedDeclaration(statement) ||
      !t.isVariableDeclaration(statement.declaration) ||
      statement.declaration.kind !== 'const'
    ) {
      continue;
    }
    for (const declaration of statement.declaration.declarations) {
      if (t.isIdentifier(declaration.id) && declaration.init !== null) {
        initializers.set(declaration.id.name, declaration.init);
      }
    }
  }
  return initializers;
}

const moduleConstants = new Map();
for (const modulePath of inputs) {
  const source = readFileSync(join(inputRoot, modulePath), 'utf8');
  const initializers = exportedInitializers(source, modulePath);
  const values = new Map();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, initializer] of initializers) {
      if (values.has(name)) continue;
      const result = evaluate(initializer, values);
      if (!result.known) continue;
      values.set(name, result.value);
      changed = true;
    }
  }
  if (values.size !== 0) moduleConstants.set(modulePath, values);
}
const constantModuleSet = new Set(moduleConstants.keys());

function resolvedModule(fromPath, specifier) {
  if (!specifier.startsWith('.')) return null;
  const target = posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  return target.endsWith('.ts') ? target : `${target}.ts`;
}

const summary = {
  files: inputs.length,
  exportedConstants: [...moduleConstants.values()].reduce(
    (total, values) => total + values.size,
    0,
  ),
  importedConstantReferences: 0,
  derivedLocalConstants: 0,
  localConstantReferences: 0,
  ifStatementsFolded: 0,
  conditionalExpressionsFolded: 0,
  logicalExpressionsFolded: 0,
  unaryExpressionsFolded: 0,
  unreachableStatementsRemoved: 0,
};

function alwaysTerminates(statement) {
  if (t.isReturnStatement(statement) || t.isThrowStatement(statement)) {
    return true;
  }
  if (t.isBlockStatement(statement)) {
    return statement.body.some(alwaysTerminates);
  }
  if (t.isIfStatement(statement) && statement.alternate !== null) {
    return (
      alwaysTerminates(statement.consequent) &&
      alwaysTerminates(statement.alternate)
    );
  }
  return false;
}

function linkingPlugin(inputPath, fileMetrics) {
  const importedConstants = new Map();
  const localConstants = new Map();
  return {
    visitor: {
      Program(path) {
        for (const statement of path.node.body) {
          if (!t.isImportDeclaration(statement)) continue;
          const target = resolvedModule(inputPath, statement.source.value);
          if (target === null || !constantModuleSet.has(target)) continue;
          const values = moduleConstants.get(target);
          for (const specifier of statement.specifiers) {
            if (!t.isImportSpecifier(specifier)) continue;
            const imported = t.isIdentifier(specifier.imported)
              ? specifier.imported.name
              : specifier.imported.value;
            if (values.has(imported)) {
              importedConstants.set(specifier.local.name, values.get(imported));
            }
          }
        }
        const initializers = new Map();
        for (const statement of path.node.body) {
          if (!t.isVariableDeclaration(statement) || statement.kind !== 'const') {
            continue;
          }
          for (const declaration of statement.declarations) {
            if (t.isIdentifier(declaration.id) && declaration.init !== null) {
              initializers.set(declaration.id.name, declaration.init);
            }
          }
        }
        const values = new Map(importedConstants);
        const derived = new Set(importedConstants.keys());
        let changed = true;
        while (changed) {
          changed = false;
          for (const [name, initializer] of initializers) {
            if (values.has(name)) continue;
            let dependsOnProfileConstant = false;
            t.traverseFast(initializer, node => {
              if (t.isIdentifier(node) && derived.has(node.name)) {
                dependsOnProfileConstant = true;
              }
            });
            if (!dependsOnProfileConstant) continue;
            const result = evaluate(initializer, values);
            if (!result.known) continue;
            values.set(name, result.value);
            derived.add(name);
            localConstants.set(name, result.value);
            summary.derivedLocalConstants++;
            fileMetrics.derivedLocalConstants++;
            changed = true;
          }
        }
      },
      ReferencedIdentifier(path) {
        const binding = path.scope.getBinding(path.node.name);
        if (path.parentPath.isExportSpecifier()) return;
        if (
          importedConstants.has(path.node.name) &&
          binding !== undefined &&
          binding.path.isImportSpecifier()
        ) {
          path.replaceWith(t.valueToNode(importedConstants.get(path.node.name)));
          summary.importedConstantReferences++;
          fileMetrics.importedConstantReferences++;
          return;
        }
        if (
          !localConstants.has(path.node.name) ||
          binding === undefined ||
          !binding.path.isVariableDeclarator() ||
          !binding.scope.path.isProgram() ||
          path.parentPath.isExportSpecifier()
        ) {
          return;
        }
        path.replaceWith(t.valueToNode(localConstants.get(path.node.name)));
        summary.localConstantReferences++;
        fileMetrics.localConstantReferences++;
      },
      UnaryExpression: {
        exit(path) {
          if (path.node.operator !== '!' || !t.isBooleanLiteral(path.node.argument)) return;
          path.replaceWith(t.booleanLiteral(!path.node.argument.value));
          summary.unaryExpressionsFolded++;
          fileMetrics.unaryExpressionsFolded++;
        },
      },
      LogicalExpression: {
        exit(path) {
          const {left, operator, right} = path.node;
          if (!t.isBooleanLiteral(left)) return;
          if (operator === '&&') path.replaceWith(left.value ? right : left);
          else if (operator === '||') path.replaceWith(left.value ? left : right);
          else if (operator === '??') path.replaceWith(left);
          else return;
          summary.logicalExpressionsFolded++;
          fileMetrics.logicalExpressionsFolded++;
        },
      },
      ConditionalExpression: {
        exit(path) {
          if (!t.isBooleanLiteral(path.node.test)) return;
          path.replaceWith(path.node.test.value ? path.node.consequent : path.node.alternate);
          summary.conditionalExpressionsFolded++;
          fileMetrics.conditionalExpressionsFolded++;
        },
      },
      IfStatement: {
        exit(path) {
          if (!t.isBooleanLiteral(path.node.test)) return;
          if (path.node.test.value) path.replaceWith(path.node.consequent);
          else if (path.node.alternate !== null) path.replaceWith(path.node.alternate);
          else path.remove();
          summary.ifStatementsFolded++;
          fileMetrics.ifStatementsFolded++;
        },
      },
      BlockStatement: {
        exit(path) {
          const terminatingIndex = path.node.body.findIndex(alwaysTerminates);
          if (
            terminatingIndex === -1 ||
            terminatingIndex === path.node.body.length - 1
          ) {
            return;
          }
          const removed = path.node.body.length - terminatingIndex - 1;
          path.node.body = path.node.body.slice(0, terminatingIndex + 1);
          summary.unreachableStatementsRemoved += removed;
          fileMetrics.unreachableStatementsRemoved += removed;
        },
      },
    },
  };
}

rmSync(outputRoot, {recursive: true, force: true});
const files = [];
for (const inputPath of inputs) {
  const source = readFileSync(join(inputRoot, inputPath), 'utf8');
  const metrics = {
    importedConstantReferences: 0,
    derivedLocalConstants: 0,
    localConstantReferences: 0,
    ifStatementsFolded: 0,
    conditionalExpressionsFolded: 0,
    logicalExpressionsFolded: 0,
    unaryExpressionsFolded: 0,
    unreachableStatementsRemoved: 0,
  };
  const result = transformSync(source, {
    ast: false,
    babelrc: false,
    code: true,
    comments: true,
    configFile: false,
    filename: inputPath,
    generatorOpts: {compact: false, retainLines: false},
    parserOpts: {plugins: ['typescript', 'jsx'], sourceType: 'module'},
    plugins: [() => linkingPlugin(inputPath, metrics)],
    sourceMaps: false,
  })?.code;
  if (result === null || result === undefined) {
    throw new Error(`link specialization emitted no code for ${inputPath}`);
  }
  const output = `${result}\n`;
  const target = join(outputRoot, inputPath);
  mkdirSync(dirname(target), {recursive: true});
  writeFileSync(target, output);
  files.push({
    path: inputPath,
    inputSha256: createHash('sha256').update(source).digest('hex'),
    outputSha256: createHash('sha256').update(output).digest('hex'),
    metrics,
  });
}

const constants = Object.fromEntries(
  [...moduleConstants].map(([path, values]) => [path, Object.fromEntries(values)]),
);
const report = {
  schema: 1,
  profile: closure.profile.name,
  constantModules: constants,
  summary,
  files,
};
const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (checkOnly) {
  if (readFileSync(reportPath, 'utf8') !== reportText) {
    throw new Error('link specialization report is stale');
  }
  console.log(
    `link specialization current: ${summary.importedConstantReferences} references, ` +
      `${summary.ifStatementsFolded} if statements`,
  );
} else {
  writeFileSync(reportPath, reportText);
  console.log(
    `linked ${inputs.length} files; folded ${summary.importedConstantReferences} imported ` +
      `constant references and ${summary.ifStatementsFolded} if statements; wrote ` +
      relative(process.cwd(), reportPath).split(sep).join('/'),
  );
}
