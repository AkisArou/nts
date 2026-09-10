import {createHash} from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {transformSync} from '@babel/core';
import * as t from '@babel/types';

const here = dirname(fileURLToPath(import.meta.url));
const experimentRoot = resolve(here, '..');
const closure = JSON.parse(
  readFileSync(join(experimentRoot, 'reports/client-mutation-production.json'), 'utf8'),
);
const baseRoot = join(experimentRoot, 'generated/client-mutation-production');
const outputRoot = join(
  experimentRoot,
  'generated/client-mutation-production-specialized',
);
const hostRelative = 'packages/react-reconciler/src/ReactFiberConfig.ts';
const reportPath = join(experimentRoot, 'reports/profile-specialization.json');
const checkOnly = process.argv.includes('--check');
const constants = closure.profile.constants;

const inputs = closure.files.map(file => {
  const path = file.path.replace(/\.js$/, '.ts');
  return {path, source: join(baseRoot, path)};
});
inputs.push({path: hostRelative, source: join(baseRoot, hostRelative)});
inputs.sort((a, b) => a.path.localeCompare(b.path));

const summary = {
  files: inputs.length,
  constantReferences: 0,
  ifStatementsFolded: 0,
  conditionalExpressionsFolded: 0,
  logicalExpressionsFolded: 0,
  unaryExpressionsFolded: 0,
  unreachableStatementsRemoved: 0,
};
const files = [];

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

function specializationPlugin() {
  return {
    visitor: {
      ReferencedIdentifier(path) {
        const value = constants[path.node.name];
        if (typeof value !== 'boolean' || path.scope.hasBinding(path.node.name)) return;
        summary.constantReferences++;
        path.replaceWith(t.booleanLiteral(value));
      },
      UnaryExpression: {
        exit(path) {
          if (path.node.operator !== '!' || !t.isBooleanLiteral(path.node.argument)) return;
          summary.unaryExpressionsFolded++;
          path.replaceWith(t.booleanLiteral(!path.node.argument.value));
        },
      },
      LogicalExpression: {
        exit(path) {
          const {left, operator, right} = path.node;
          if (!t.isBooleanLiteral(left)) return;
          summary.logicalExpressionsFolded++;
          if (operator === '&&') {
            path.replaceWith(left.value ? right : left);
          } else if (operator === '||') {
            path.replaceWith(left.value ? left : right);
          } else if (operator === '??') {
            path.replaceWith(left);
          }
        },
      },
      ConditionalExpression: {
        exit(path) {
          if (!t.isBooleanLiteral(path.node.test)) return;
          summary.conditionalExpressionsFolded++;
          path.replaceWith(path.node.test.value ? path.node.consequent : path.node.alternate);
        },
      },
      IfStatement: {
        exit(path) {
          if (!t.isBooleanLiteral(path.node.test)) return;
          summary.ifStatementsFolded++;
          if (path.node.test.value) {
            path.replaceWith(path.node.consequent);
          } else if (path.node.alternate !== null) {
            path.replaceWith(path.node.alternate);
          } else {
            path.remove();
          }
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
          summary.unreachableStatementsRemoved +=
            path.node.body.length - terminatingIndex - 1;
          path.node.body = path.node.body.slice(0, terminatingIndex + 1);
        },
      },
    },
  };
}

rmSync(outputRoot, {recursive: true, force: true});
for (const input of inputs) {
  const source = readFileSync(input.source, 'utf8');
  const result = transformSync(source, {
    ast: false,
    babelrc: false,
    code: true,
    comments: true,
    configFile: false,
    filename: input.source,
    generatorOpts: {compact: false, retainLines: false},
    parserOpts: {plugins: ['typescript', 'jsx'], sourceType: 'module'},
    plugins: [specializationPlugin],
    sourceMaps: false,
  })?.code;
  if (result === null || result === undefined) {
    throw new Error(`profile specialization emitted no code for ${input.path}`);
  }
  const target = join(outputRoot, input.path);
  const output = `${result}\n`;
  files.push({
    path: input.path,
    inputSha256: createHash('sha256').update(source).digest('hex'),
    outputSha256: createHash('sha256').update(output).digest('hex'),
  });
  mkdirSync(dirname(target), {recursive: true});
  writeFileSync(target, output);
}

const report = {
  schema: 1,
  profile: closure.profile.name,
  constants,
  summary,
  files,
};
const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (checkOnly) {
  if (readFileSync(reportPath, 'utf8') !== reportText) {
    throw new Error('profile specialization report is stale');
  }
  console.log(
    `profile specialization current: ${summary.constantReferences} constants, ` +
      `${summary.ifStatementsFolded} if statements`,
  );
} else {
  writeFileSync(reportPath, reportText);
  console.log(
    `specialized ${inputs.length} files; folded ${summary.constantReferences} constants and ` +
      `${summary.ifStatementsFolded} if statements; wrote ` +
      relative(process.cwd(), reportPath).split(sep).join('/'),
  );
}
