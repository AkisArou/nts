import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const experimentRoot = resolve(here, '..');
const reportPath = join(experimentRoot, 'reports/runtime-escape-audit.json');
const checkOnly = process.argv.includes('--check');
const stages = [
  ['normalized', 'client-mutation-production'],
  ['specialized', 'client-mutation-production-specialized'],
  ['linked', 'client-mutation-production-linked'],
];

function portable(path) {
  return path.split(sep).join('/');
}

function collectTypeScriptFiles(root, files = []) {
  for (const entry of readdirSync(root, {withFileTypes: true})) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) collectTypeScriptFiles(path, files);
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

function isTypeAssertion(node) {
  return ts.isAsExpression(node) || ts.isTypeAssertionExpression(node);
}

function unwrapParentheses(node) {
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
}

function location(sourceFile, node) {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    file: portable(relative(experimentRoot, sourceFile.fileName)),
    line: start.line + 1,
    column: start.character + 1,
  };
}

function auditStage(directory) {
  const files = collectTypeScriptFiles(join(experimentRoot, 'generated', directory));
  const examples = [];
  let anyKeywords = 0;
  let typeScriptDirectives = 0;
  let nestedTypeAssertions = 0;

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const directiveMatches = text.matchAll(/@ts-(?:ignore|expect-error|nocheck)/g);
    for (const match of directiveMatches) {
      typeScriptDirectives++;
      if (examples.length < 20) {
        const prefix = text.slice(0, match.index);
        const line = prefix.split('\n').length;
        const lastNewline = prefix.lastIndexOf('\n');
        examples.push({
          kind: 'typescript-directive',
          file: portable(relative(experimentRoot, file)),
          line,
          column: match.index - lastNewline,
        });
      }
    }

    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = node => {
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        anyKeywords++;
        if (examples.length < 20) {
          examples.push({kind: 'any-keyword', ...location(sourceFile, node)});
        }
      }
      if (
        isTypeAssertion(node) &&
        isTypeAssertion(unwrapParentheses(node.expression))
      ) {
        nestedTypeAssertions++;
        if (examples.length < 20) {
          examples.push({kind: 'nested-type-assertion', ...location(sourceFile, node)});
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return {
    directory: `generated/${directory}`,
    files: files.length,
    anyKeywords,
    typeScriptDirectives,
    nestedTypeAssertions,
    examples,
  };
}

const results = Object.fromEntries(
  stages.map(([name, directory]) => [name, auditStage(directory)]),
);
const violations = Object.values(results).reduce(
  (sum, stage) =>
    sum + stage.anyKeywords + stage.typeScriptDirectives + stage.nestedTypeAssertions,
  0,
);
const report = {schema: 1, violations, stages: results};
const reportText = `${JSON.stringify(report, null, 2)}\n`;

if (checkOnly) {
  if (readFileSync(reportPath, 'utf8') !== reportText) {
    throw new Error('runtime escape audit report is stale; run npm run runtime:escape-audit');
  }
} else {
  writeFileSync(reportPath, reportText);
}

if (violations !== 0) {
  throw new Error(`generated runtime contains ${violations} forbidden type escape(s)`);
}

console.log(
  `runtime escape audit: ${Object.values(results).reduce((sum, stage) => sum + stage.files, 0)} files, zero any keywords, directives, or nested assertions${checkOnly ? ' (current)' : `; wrote ${relative(process.cwd(), reportPath)}`}`,
);
