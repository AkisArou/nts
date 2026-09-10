import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {transformSync} from '@babel/core';
import {parse as parseTypeScript} from '@babel/parser';
import stripFlowTypes from '@babel/plugin-transform-flow-strip-types';
import stripTypeScriptTypes from '@babel/plugin-transform-typescript';
import flowToTypeScript from '@zxbodya/babel-plugin-flow-to-typescript';
import syntaxHermesParser from 'babel-plugin-syntax-hermes-parser';
import * as t from '@babel/types';

const here = dirname(fileURLToPath(import.meta.url));
const experimentRoot = resolve(here, '..');
const lock = JSON.parse(readFileSync(join(experimentRoot, 'upstream.lock.json'), 'utf8'));
const closure = JSON.parse(
  readFileSync(join(experimentRoot, 'reports/client-mutation-production.json'), 'utf8'),
);
const overrideManifest = JSON.parse(
  readFileSync(join(experimentRoot, 'overrides/manifest.json'), 'utf8'),
);
const reactRoot = process.env.NTS_REACT_SOURCE
  ? resolve(process.env.NTS_REACT_SOURCE)
  : resolve(lock.repository);
const outputRoot = join(experimentRoot, 'generated', 'client-mutation-production');
const checkOnly = process.argv.includes('--check');

const head = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: reactRoot,
  encoding: 'utf8',
}).trim();
if (head !== lock.commit) {
  throw new Error(`React checkout is ${head}; expected pinned commit ${lock.commit}`);
}
if (closure.upstream.commit !== lock.commit) {
  throw new Error('dependency report does not match upstream.lock.json');
}
if (overrideManifest.upstream.commit !== lock.commit) {
  throw new Error('override manifest does not match upstream.lock.json');
}

const overridesByPath = new Map();
for (const override of overrideManifest.overrides) {
  if (overridesByPath.has(override.path)) {
    throw new Error(`multiple override entries target ${override.path}`);
  }
  overridesByPath.set(override.path, override);
}

function outputPath(path) {
  return join(outputRoot, path.replace(/\.js$/, '.ts'));
}

function count(pattern, source) {
  return [...source.matchAll(pattern)].length;
}

function walkAst(node, visit) {
  if (node === null || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'range' || key === 'tokens' || key === 'comments') continue;
    if (Array.isArray(value)) {
      for (const child of value) walkAst(child, visit);
    } else {
      walkAst(value, visit);
    }
  }
}

function comparableRuntime(source) {
  // TypeScript preserves an otherwise type-only file as a module. The empty
  // export has no runtime behavior and Flow's stripping pass emits an empty
  // file for the same input.
  return (source ?? '').replace(/^export \{\};$/, '');
}

function modulePath(fromPath, targetPath) {
  const convertedTarget = targetPath.replace(/\.js$/, '.ts');
  let specifier = relative(dirname(fromPath), convertedTarget)
    .split(sep)
    .join('/')
    .replace(/\.ts$/, '');
  if (!specifier.startsWith('.')) specifier = `./${specifier}`;
  return specifier;
}

function rewriteInternalSpecifiers(code, sourceFile) {
  const rewrites = new Map();
  for (const dependency of sourceFile.imports) {
    if (dependency.specifier.startsWith('.')) continue;
    if (dependency.kind === 'source') {
      rewrites.set(
        dependency.specifier,
        modulePath(sourceFile.path, dependency.value),
      );
    } else if (
      dependency.kind === 'virtual' &&
      dependency.value === 'virtual:nts-recording-mutation-host'
    ) {
      rewrites.set(
        dependency.specifier,
        modulePath(
          sourceFile.path,
          'packages/react-reconciler/src/ReactFiberConfig.js',
        ),
      );
    }
  }
  if (rewrites.size === 0) return {code, count: 0};
  let rewritten = 0;
  const result = transformSync(code, {
    ast: false,
    babelrc: false,
    code: true,
    comments: true,
    configFile: false,
    filename: sourceFile.path.replace(/\.js$/, '.ts'),
    generatorOpts: {comments: true, compact: false, retainLines: false},
    parserOpts: {plugins: ['typescript', 'jsx'], sourceType: 'module'},
    plugins: [
      () => ({
        visitor: {
          ImportDeclaration(path) {
            const replacement = rewrites.get(path.node.source.value);
            if (replacement === undefined) return;
            path.node.source.value = replacement;
            rewritten++;
          },
          ExportNamedDeclaration(path) {
            if (path.node.source === null) return;
            const replacement = rewrites.get(path.node.source.value);
            if (replacement === undefined) return;
            path.node.source.value = replacement;
            rewritten++;
          },
          ExportAllDeclaration(path) {
            const replacement = rewrites.get(path.node.source.value);
            if (replacement === undefined) return;
            path.node.source.value = replacement;
            rewritten++;
          },
          CallExpression(path) {
            if (
              path.node.callee.type !== 'Identifier' ||
              path.node.callee.name !== 'require' ||
              path.node.arguments[0]?.type !== 'StringLiteral'
            ) {
              return;
            }
            const replacement = rewrites.get(path.node.arguments[0].value);
            if (replacement === undefined) return;
            path.node.arguments[0].value = replacement;
            rewritten++;
          },
        },
      }),
    ],
    sourceMaps: false,
  })?.code;
  if (result === null || result === undefined) {
    throw new Error(`module rewrite emitted no code for ${sourceFile.path}`);
  }
  return {code: result, count: rewritten};
}

function normalizeDetachedOverloads(code, sourceFile) {
  let reordered = 0;
  const result = transformSync(code, {
    ast: false,
    babelrc: false,
    code: true,
    comments: true,
    configFile: false,
    filename: sourceFile.path.replace(/\.js$/, '.ts'),
    generatorOpts: {comments: true, compact: false, retainLines: false},
    parserOpts: {plugins: ['typescript', 'jsx'], sourceType: 'module'},
    plugins: [
      () => ({
        visitor: {
          Program(path) {
            const declarationsByName = new Map();
            for (const statement of path.node.body) {
              if (
                statement.type !== 'TSDeclareFunction' ||
                statement.id?.type !== 'Identifier'
              ) {
                continue;
              }
              const declarations = declarationsByName.get(statement.id.name) ?? [];
              declarations.push(statement);
              declarationsByName.set(statement.id.name, declarations);
            }
            for (const [name, declarations] of declarationsByName) {
              const implementation = path.node.body.find(
                statement =>
                  statement.type === 'FunctionDeclaration' &&
                  statement.id?.name === name &&
                  statement.body !== null,
              );
              if (implementation === undefined) continue;
              path.node.body = path.node.body.filter(
                statement => !declarations.includes(statement),
              );
              const implementationIndex = path.node.body.indexOf(implementation);
              path.node.body.splice(implementationIndex, 0, ...declarations);
              reordered += declarations.length;
            }
          },
        },
      }),
    ],
    sourceMaps: false,
  })?.code;
  if (result === null || result === undefined) {
    throw new Error(`detached-overload normalization emitted no code for ${sourceFile.path}`);
  }
  return {code: result, reordered};
}

function normalizeFlowVoidUnions(code, sourceFile) {
  let normalized = 0;
  const result = transformSync(code, {
    ast: false,
    babelrc: false,
    code: true,
    comments: true,
    configFile: false,
    filename: sourceFile.path.replace(/\.js$/, '.ts'),
    generatorOpts: {comments: true, compact: false, retainLines: false},
    parserOpts: {plugins: ['typescript', 'jsx'], sourceType: 'module'},
    plugins: [
      () => ({
        visitor: {
          TSVoidKeyword(path) {
            const annotation = path.parentPath;
            const parameter = annotation?.parentPath;
            const callable = parameter?.parentPath;
            if (
              annotation?.node.type === 'TSTypeAnnotation' &&
              parameter?.node.type === 'Identifier' &&
              parameter.node.typeAnnotation === annotation.node &&
              callable !== null &&
              callable !== undefined &&
              (callable.node.type === 'FunctionDeclaration' ||
                callable.node.type === 'FunctionExpression' ||
                callable.node.type === 'ArrowFunctionExpression' ||
                callable.node.type === 'TSDeclareFunction' ||
                callable.node.type === 'TSFunctionType' ||
                callable.node.type === 'TSMethodSignature') &&
              (callable.node.params ?? callable.node.parameters)?.includes(
                parameter.node,
              )
            ) {
              normalized++;
              parameter.node.optional = true;
              path.replaceWith(t.tsUndefinedKeyword());
            }
          },
          TSUnionType(path) {
            const annotation = path.parentPath;
            const annotatedNode = annotation?.parentPath?.node;
            if (
              annotation?.node.type === 'TSTypeAnnotation' &&
              (annotatedNode?.returnType === annotation.node ||
                (annotatedNode?.type === 'TSFunctionType' &&
                  annotatedNode.typeAnnotation === annotation.node))
            ) {
              return;
            }
            path.node.types = path.node.types.map(type => {
              if (type.type !== 'TSVoidKeyword') return type;
              normalized++;
              return t.tsUndefinedKeyword();
            });
          },
        },
      }),
    ],
    sourceMaps: false,
  })?.code;
  if (result === null || result === undefined) {
    throw new Error(`Flow void-union normalization emitted no code for ${sourceFile.path}`);
  }
  return {code: result, normalized};
}

function inferDeferredAssignmentType(expression) {
  if (
    expression.type === 'TSAsExpression' ||
    expression.type === 'TSTypeAssertion'
  ) {
    return t.cloneNode(expression.typeAnnotation, true);
  }
  if (expression.type === 'BooleanLiteral') return t.tsBooleanKeyword();
  if (expression.type === 'StringLiteral') return t.tsStringKeyword();
  if (expression.type === 'NumericLiteral') return t.tsNumberKeyword();
  if (expression.type === 'ObjectExpression' && expression.properties.length === 0) {
    return t.tsTypeReference(t.identifier('object'));
  }
  if (
    expression.type === 'NewExpression' &&
    expression.callee.type === 'Identifier' &&
    ['Map', 'Set', 'WeakMap', 'WeakSet'].includes(expression.callee.name)
  ) {
    const typeArguments = expression.typeArguments ?? expression.typeParameters;
    if (
      typeArguments?.type === 'TSTypeParameterInstantiation' &&
      typeArguments.params.length > 0
    ) {
      return t.tsTypeReference(
        t.identifier(expression.callee.name),
        t.cloneNode(typeArguments, true),
      );
    }
  }
  return null;
}

function normalizeDeferredVariableTypes(code, sourceFile) {
  let normalized = 0;
  const result = transformSync(code, {
    ast: false,
    babelrc: false,
    code: true,
    comments: true,
    configFile: false,
    filename: sourceFile.path.replace(/\.js$/, '.ts'),
    generatorOpts: {comments: true, compact: false, retainLines: false},
    parserOpts: {plugins: ['typescript', 'jsx'], sourceType: 'module'},
    plugins: [
      () => ({
        visitor: {
          VariableDeclarator(path) {
            if (
              path.node.id.type !== 'Identifier' ||
              path.node.id.typeAnnotation != null ||
              path.node.init !== null
            ) {
              return;
            }
            const binding = path.scope.getBinding(path.node.id.name);
            if (binding === undefined) return;
            const assignmentTypes = [];
            for (const violation of binding.constantViolations) {
              if (
                violation.node.type !== 'AssignmentExpression' ||
                violation.node.operator !== '=' ||
                violation.node.left.type !== 'Identifier' ||
                violation.node.left.name !== path.node.id.name
              ) {
                return;
              }
              const inferred = inferDeferredAssignmentType(violation.node.right);
              if (inferred === null) return;
              assignmentTypes.push(inferred);
            }
            if (assignmentTypes.length === 0) return;
            const first = assignmentTypes[0];
            if (
              assignmentTypes.some(
                candidate => !t.isNodesEquivalent(first, candidate),
              )
            ) {
              return;
            }
            path.node.id.typeAnnotation = t.tsTypeAnnotation(first);
            normalized++;
          },
        },
      }),
    ],
    sourceMaps: false,
  })?.code;
  if (result === null || result === undefined) {
    throw new Error(
      `deferred-variable normalization emitted no code for ${sourceFile.path}`,
    );
  }
  return {code: result, normalized};
}

function normalizeDynamicAnyTypes(code, sourceFile) {
  let normalized = 0;
  const result = transformSync(code, {
    ast: false,
    babelrc: false,
    code: true,
    comments: true,
    configFile: false,
    filename: sourceFile.path.replace(/\.js$/, '.ts'),
    generatorOpts: {comments: true, compact: false, retainLines: false},
    parserOpts: {plugins: ['typescript', 'jsx'], sourceType: 'module'},
    plugins: [
      () => ({
        visitor: {
          TSAnyKeyword(path) {
            path.replaceWith(t.tsTypeReference(t.identifier('ReactValue')));
            normalized++;
          },
        },
      }),
    ],
    sourceMaps: false,
  })?.code;
  if (result === null || result === undefined) {
    throw new Error(
      `dynamic-any normalization emitted no code for ${sourceFile.path}`,
    );
  }
  return {code: result, normalized};
}

function isReactValueType(node) {
  return (
    node?.type === 'TSTypeReference' &&
    node.typeName?.type === 'Identifier' &&
    node.typeName.name === 'ReactValue'
  );
}

const reactValueBoundaryMembers = new Set([
  'elementType',
  'memoizedProps',
  'memoizedState',
  'pendingProps',
  'stateNode',
  'type',
  'updateQueue',
]);

function isReactValueBoundaryRead(expression) {
  if (
    expression?.type !== 'MemberExpression' &&
    expression?.type !== 'OptionalMemberExpression'
  ) {
    return false;
  }
  if (!expression.computed && expression.property.type === 'Identifier') {
    return reactValueBoundaryMembers.has(expression.property.name);
  }
  if (expression.computed && expression.property.type === 'StringLiteral') {
    return reactValueBoundaryMembers.has(expression.property.value);
  }
  return false;
}

function projectReactValueBoundaryRead(expression, targetType) {
  if (isReactValueType(targetType)) return 0;
  if (isReactValueBoundaryRead(expression)) {
    if (
      expression.type === 'TSAsExpression' ||
      expression.type === 'TSTypeAssertion'
    ) {
      return 0;
    }
    const projected = t.tsAsExpression(
      t.cloneNode(expression, true),
      t.cloneNode(targetType, true),
    );
    for (const key of Object.keys(expression)) delete expression[key];
    Object.assign(expression, projected);
    return 1;
  }
  if (expression?.type === 'ConditionalExpression') {
    return (
      projectReactValueBoundaryRead(expression.consequent, targetType) +
      projectReactValueBoundaryRead(expression.alternate, targetType)
    );
  }
  return 0;
}

function normalizeReactValueBoundaryProjections(code, sourceFile) {
  let normalized = 0;
  const result = transformSync(code, {
    ast: false,
    babelrc: false,
    code: true,
    comments: true,
    configFile: false,
    filename: sourceFile.path.replace(/\.js$/, '.ts'),
    generatorOpts: {comments: true, compact: false, retainLines: false},
    parserOpts: {plugins: ['typescript', 'jsx'], sourceType: 'module'},
    plugins: [
      () => ({
        visitor: {
          VariableDeclarator: {
            exit(path) {
              if (
                path.node.id.type !== 'Identifier' ||
                path.node.id.typeAnnotation == null ||
                path.node.init == null
              ) {
                return;
              }
              normalized += projectReactValueBoundaryRead(
                path.node.init,
                path.node.id.typeAnnotation.typeAnnotation,
              );
            },
          },
          AssignmentExpression: {
            exit(path) {
              if (
                path.node.operator !== '=' ||
                path.node.left.type !== 'Identifier'
              ) {
                return;
              }
              const binding = path.scope.getBinding(path.node.left.name);
              const declaration = binding?.path.node;
              if (
                declaration?.type !== 'VariableDeclarator' ||
                declaration.id.type !== 'Identifier' ||
                declaration.id.typeAnnotation == null
              ) {
                return;
              }
              normalized += projectReactValueBoundaryRead(
                path.node.right,
                declaration.id.typeAnnotation.typeAnnotation,
              );
            },
          },
          ReturnStatement: {
            exit(path) {
              if (path.node.argument == null) return;
              const callable = path.findParent(
                candidate =>
                  candidate.node.type === 'FunctionDeclaration' ||
                  candidate.node.type === 'FunctionExpression' ||
                  candidate.node.type === 'ArrowFunctionExpression' ||
                  candidate.node.type === 'ObjectMethod',
              );
              const returnType = callable?.node.returnType?.typeAnnotation;
              if (returnType == null) return;
              normalized += projectReactValueBoundaryRead(
                path.node.argument,
                returnType,
              );
            },
          },
        },
      }),
    ],
    sourceMaps: false,
  })?.code;
  if (result === null || result === undefined) {
    throw new Error(
      `ReactValue boundary projection normalization emitted no code for ${sourceFile.path}`,
    );
  }
  return {code: result, normalized};
}

function replaceReactValueAssertion(expression, targetType) {
  if (
    expression?.type === 'TSAsExpression' &&
    isReactValueType(expression.typeAnnotation) &&
    !isReactValueType(targetType)
  ) {
    expression.typeAnnotation = t.cloneNode(targetType, true);
    return 1;
  }
  if (expression?.type === 'ConditionalExpression') {
    return (
      replaceReactValueAssertion(expression.consequent, targetType) +
      replaceReactValueAssertion(expression.alternate, targetType)
    );
  }
  return 0;
}

function normalizeReactValueProjections(code, sourceFile) {
  let normalized = 0;
  const result = transformSync(code, {
    ast: false,
    babelrc: false,
    code: true,
    comments: true,
    configFile: false,
    filename: sourceFile.path.replace(/\.js$/, '.ts'),
    generatorOpts: {comments: true, compact: false, retainLines: false},
    parserOpts: {plugins: ['typescript', 'jsx'], sourceType: 'module'},
    plugins: [
      () => ({
        visitor: {
          TSAsExpression: {
            exit(path) {
              if (
                path.node.expression.type !== 'TSAsExpression' ||
                !isReactValueType(path.node.expression.typeAnnotation) ||
                isReactValueType(path.node.typeAnnotation)
              ) {
                return;
              }
              path.node.expression = t.cloneNode(
                path.node.expression.expression,
                true,
              );
              normalized++;
            },
          },
          VariableDeclarator: {
            exit(path) {
              if (
                path.node.id.type !== 'Identifier' ||
                path.node.id.typeAnnotation == null ||
                path.node.init == null
              ) {
                return;
              }
              normalized += replaceReactValueAssertion(
                path.node.init,
                path.node.id.typeAnnotation.typeAnnotation,
              );
            },
          },
          AssignmentExpression: {
            exit(path) {
              if (
                path.node.operator !== '=' ||
                path.node.left.type !== 'Identifier'
              ) {
                return;
              }
              const binding = path.scope.getBinding(path.node.left.name);
              const identifier = binding?.path.node;
              if (
                identifier?.type !== 'VariableDeclarator' ||
                identifier.id.type !== 'Identifier' ||
                identifier.id.typeAnnotation == null
              ) {
                return;
              }
              normalized += replaceReactValueAssertion(
                path.node.right,
                identifier.id.typeAnnotation.typeAnnotation,
              );
            },
          },
        },
      }),
    ],
    sourceMaps: false,
  })?.code;
  if (result === null || result === undefined) {
    throw new Error(
      `ReactValue projection normalization emitted no code for ${sourceFile.path}`,
    );
  }
  return {code: result, normalized};
}

function parseType(typeSource) {
  const ast = parseTypeScript(`type OverrideType = ${typeSource};`, {
    plugins: ['typescript'],
    sourceType: 'module',
  });
  const alias = ast.program.body[0];
  if (alias?.type !== 'TSTypeAliasDeclaration') {
    throw new Error(`cannot parse override type ${typeSource}`);
  }
  return alias.typeAnnotation;
}

function parseTypeParameters(typeParametersSource) {
  const ast = parseTypeScript(
    `function OverrideFunction${typeParametersSource}(): void {}`,
    {plugins: ['typescript'], sourceType: 'module'},
  );
  const declaration = ast.program.body[0];
  if (
    declaration?.type !== 'FunctionDeclaration' ||
    declaration.typeParameters === null ||
    declaration.typeParameters === undefined
  ) {
    throw new Error(
      `cannot parse override type parameters ${typeParametersSource}`,
    );
  }
  return declaration.typeParameters;
}

function parseReturnType(returnTypeSource) {
  const ast = parseTypeScript(
    `function OverrideFunction<T>(value: T): ${returnTypeSource};`,
    {plugins: ['typescript'], sourceType: 'module'},
  );
  const declaration = ast.program.body[0];
  if (
    declaration?.type !== 'TSDeclareFunction' ||
    declaration.returnType === null ||
    declaration.returnType === undefined
  ) {
    throw new Error(`cannot parse override return type ${returnTypeSource}`);
  }
  return declaration.returnType.typeAnnotation;
}

function parseOverloadDeclaration(name, signature) {
  const exportPrefix = signature.export === true ? 'export ' : '';
  const typeParameters = signature.typeParameters ?? '';
  const parameters = Object.entries(signature.parameters ?? {})
    .map(([parameterName, configured]) => {
      const typeSource =
        typeof configured === 'string' ? configured : configured.type;
      const optional =
        typeof configured === 'object' &&
        configured !== null &&
        configured.optional === true
          ? '?'
          : '';
      return `${parameterName}${optional}: ${typeSource}`;
    })
    .join(', ');
  const ast = parseTypeScript(
    `${exportPrefix}function ${name}${typeParameters}(${parameters}): ${signature.return};`,
    {plugins: ['typescript'], sourceType: 'module'},
  );
  const declaration = ast.program.body[0];
  if (
    declaration?.type !== 'TSDeclareFunction' &&
    !(
      declaration?.type === 'ExportNamedDeclaration' &&
      declaration.declaration?.type === 'TSDeclareFunction'
    )
  ) {
    throw new Error(`cannot parse overload for ${name}`);
  }
  return declaration;
}

function memberExpressionName(node) {
  if (node?.type === 'Identifier') return node.name;
  if (
    node?.type === 'TSAsExpression' ||
    node?.type === 'TSTypeAssertion' ||
    node?.type === 'TSNonNullExpression'
  ) {
    return memberExpressionName(node.expression);
  }
  if (
    node?.type === 'MemberExpression' &&
    node.computed &&
    node.property?.type === 'Identifier'
  ) {
    const object = memberExpressionName(node.object);
    return object === null ? null : `${object}[${node.property.name}]`;
  }
  if (
    node?.type !== 'MemberExpression' ||
    node.computed ||
    node.property?.type !== 'Identifier'
  ) {
    return null;
  }
  const object = memberExpressionName(node.object);
  return object === null ? null : `${object}.${node.property.name}`;
}

function assertionExpressionName(node) {
  const memberName = memberExpressionName(node);
  if (memberName !== null) return memberName;
  if (node?.type === 'NullLiteral') return 'null';
  if (node?.type === 'BooleanLiteral') return String(node.value);
  if (node?.type === 'NumericLiteral') return String(node.value);
  if (node?.type === 'StringLiteral') return JSON.stringify(node.value);
  return null;
}

function enclosingFunctionName(path) {
  const declaration = path.findParent(
    candidate =>
      candidate.node.type === 'FunctionDeclaration' &&
      candidate.node.id?.type === 'Identifier',
  );
  if (declaration !== null) return declaration.node.id.name;
  const namedExpression = path.findParent(
    candidate =>
      candidate.node.type === 'FunctionExpression' &&
      candidate.node.id?.type === 'Identifier',
  );
  if (namedExpression !== null) return namedExpression.node.id.name;
  const variableFunction = path.findParent(candidate => {
    if (
      candidate.node.type !== 'FunctionExpression' &&
      candidate.node.type !== 'ArrowFunctionExpression'
    ) {
      return false;
    }
    return (
      candidate.parentPath?.node.type === 'VariableDeclarator' &&
      candidate.parentPath.node.id.type === 'Identifier'
    );
  });
  if (variableFunction !== null) {
    return variableFunction.parentPath?.node.id?.name;
  }
  const anonymousFunction = path.findParent(
    candidate =>
      candidate.node.type === 'FunctionExpression' ||
      candidate.node.type === 'ArrowFunctionExpression',
  );
  const containingVariable = anonymousFunction?.findParent(
    candidate =>
      candidate.node.type === 'VariableDeclarator' &&
      candidate.node.id.type === 'Identifier',
  );
  return containingVariable?.node.id?.name;
}

function annotateFunction(node, signature, overrideId, label) {
  if (signature.typeParameters !== undefined) {
    const replaceExisting = signature.replaceTypeParameters === true;
    const hasExisting =
      node.typeParameters !== null && node.typeParameters !== undefined;
    if (hasExisting && !replaceExisting) {
      throw new Error(
        `override ${overrideId} found existing type parameters on ${label}`,
      );
    }
    if (!hasExisting && replaceExisting) {
      throw new Error(
        `override ${overrideId} did not find existing type parameters on ${label}`,
      );
    }
    node.typeParameters = t.cloneNode(
      parseTypeParameters(signature.typeParameters),
      true,
    );
  }
  if (signature.this !== undefined) {
    if (node.params.some(parameter => parameter.type === 'Identifier' && parameter.name === 'this')) {
      throw new Error(`override ${overrideId} found an existing this parameter on ${label}`);
    }
    const receiver = t.identifier('this');
    receiver.typeAnnotation = t.tsTypeAnnotation(
      t.cloneNode(parseType(signature.this), true),
    );
    node.params.unshift(receiver);
  }
  const parameters = new Map(Object.entries(signature.parameters ?? {}));
  for (const parameter of node.params) {
    if (parameter.type !== 'Identifier' || parameter.name === 'this') continue;
    const configured = parameters.get(parameter.name);
    if (configured === undefined) continue;
    const typeSource =
      typeof configured === 'string' ? configured : configured.type;
    const replaceExisting =
      typeof configured === 'object' &&
      configured !== null &&
      configured.replaceExisting === true;
    const hasExisting =
      parameter.typeAnnotation !== null && parameter.typeAnnotation !== undefined;
    if (hasExisting && !replaceExisting) {
      throw new Error(`override ${overrideId} found an existing type on ${label}.${parameter.name}`);
    }
    if (!hasExisting && replaceExisting) {
      throw new Error(
        `override ${overrideId} did not find the existing type on ${label}.${parameter.name}`,
      );
    }
    parameter.typeAnnotation = t.tsTypeAnnotation(
      t.cloneNode(parseType(typeSource), true),
    );
    if (
      typeof configured === 'object' &&
      configured !== null &&
      configured.optional === true
    ) {
      parameter.optional = true;
    }
    parameters.delete(parameter.name);
  }
  if (parameters.size > 0) {
    throw new Error(
      `override ${overrideId} did not find parameters on ${label}: ${[...parameters.keys()].join(', ')}`,
    );
  }
  if (signature.return !== undefined) {
    const configured = signature.return;
    const typeSource =
      typeof configured === 'string' ? configured : configured.type;
    const replaceExisting =
      typeof configured === 'object' &&
      configured !== null &&
      configured.replaceExisting === true;
    const hasExisting = node.returnType !== null && node.returnType !== undefined;
    if (hasExisting && !replaceExisting) {
      throw new Error(`override ${overrideId} found an existing return type on ${label}`);
    }
    if (!hasExisting && replaceExisting) {
      throw new Error(`override ${overrideId} did not find the existing return type on ${label}`);
    }
    node.returnType = t.tsTypeAnnotation(
      t.cloneNode(parseReturnType(typeSource), true),
    );
  }
}

function applySemanticOverride(code, sourceFile, digest) {
  const override = overridesByPath.get(sourceFile.path);
  if (override === undefined) return {code, applications: []};
  if (override.sourceSha256 !== digest) {
    throw new Error(`override ${override.id} source hash is stale`);
  }
  if (
    override.kind !== 'function-this-type' &&
    override.kind !== 'function-signatures'
  ) {
    throw new Error(`unsupported override kind ${override.kind}`);
  }

  const pending = new Map(Object.entries(override.functions ?? {}));
  const pendingAssignments = new Map(Object.entries(override.assignments ?? {}));
  const pendingObjectMethods = new Map(
    Object.entries(override.objectMethods ?? {}).map(([name, configured]) => [
      name,
      {
        signature: configured.signature,
        occurrences: configured.occurrences ?? 1,
        applied: 0,
      },
    ]),
  );
  const pendingNewCallees = new Map(Object.entries(override.newCallees ?? {}));
  const pendingVariables = new Map(Object.entries(override.variables ?? {}));
  const pendingOverloads = new Map(Object.entries(override.overloads ?? {}));
  const pendingPrependedOverloads = new Map(
    Object.entries(override.prependOverloads ?? {}),
  );
  const pendingMemberObjectAssertions = new Map(
    Object.entries(override.memberObjectAssertions ?? {}).map(([name, configured]) => [
      name,
      (Array.isArray(configured) ? configured : [configured]).map(entry => ({
        type: typeof entry === 'string' ? entry : entry.type,
        skip:
          typeof entry === 'object' && entry !== null ? (entry.skip ?? 0) : 0,
        occurrences:
          typeof entry === 'object' && entry !== null
            ? (entry.occurrences ?? 1)
            : 1,
        seen: 0,
        applied: 0,
      })),
    ]),
  );
  const pendingMemberResultAssertions = new Map(
    Object.entries(override.memberResultAssertions ?? {}).map(
      ([name, configured]) => [
        name,
        {
          type: typeof configured === 'string' ? configured : configured.type,
          skip:
            typeof configured === 'object' && configured !== null
              ? (configured.skip ?? 0)
              : 0,
          occurrences:
            typeof configured === 'object' && configured !== null
              ? (configured.occurrences ?? 1)
              : 1,
          seen: 0,
          applied: 0,
        },
      ],
    ),
  );
  const pendingCallArgumentAssertions = new Map(
    Object.entries(override.callArgumentAssertions ?? {}).map(
      ([name, configured]) => [
        name,
        (Array.isArray(configured) ? configured : [configured]).map(entry => ({
          index: entry.index,
          type: entry.type,
          occurrences: entry.occurrences ?? 1,
          applied: 0,
        })),
      ],
    ),
  );
  const pendingCallCalleeAssertions = new Map(
    Object.entries(override.callCalleeAssertions ?? {}).map(
      ([name, configured]) => [
        name,
        {
          type: typeof configured === 'string' ? configured : configured.type,
          occurrences:
            typeof configured === 'object' && configured !== null
              ? (configured.occurrences ?? 1)
              : 1,
          applied: 0,
        },
      ],
    ),
  );
  const pendingCallResultAssertions = new Map(
    Object.entries(override.callResultAssertions ?? {}).map(
      ([name, configured]) => [
        name,
        {
          type: typeof configured === 'string' ? configured : configured.type,
          occurrences:
            typeof configured === 'object' && configured !== null
              ? (configured.occurrences ?? 1)
              : 1,
          applied: 0,
        },
      ],
    ),
  );
  const pendingAssignmentRightAssertions = new Map(
    Object.entries(override.assignmentRightAssertions ?? {}).map(
      ([name, configured]) => [
        name,
        {
          type: typeof configured === 'string' ? configured : configured.type,
          occurrences:
            typeof configured === 'object' && configured !== null
              ? (configured.occurrences ?? 1)
              : 1,
          applied: 0,
        },
      ],
    ),
  );
  const pendingObjectPropertyValueAssertions = new Map(
    Object.entries(override.objectPropertyValueAssertions ?? {}).map(
      ([name, configured]) => [
        name,
        {
          type: typeof configured === 'string' ? configured : configured.type,
          occurrences:
            typeof configured === 'object' && configured !== null
              ? (configured.occurrences ?? 1)
              : 1,
          applied: 0,
        },
      ],
    ),
  );
  const pendingAsExpressionTypes = new Map(
    Object.entries(override.asExpressionTypes ?? {}).map(([name, configured]) => [
      name,
      (Array.isArray(configured) ? configured : [configured]).map(entry => ({
        type: typeof entry === 'string' ? entry : entry.type,
        skip:
          typeof entry === 'object' && entry !== null ? (entry.skip ?? 0) : 0,
        seen: 0,
        occurrences:
          typeof entry === 'object' && entry !== null
            ? (entry.occurrences ?? 1)
            : 1,
        applied: 0,
      })),
    ]),
  );
  const pendingVariableInitializerAssertions = new Map(
    Object.entries(override.variableInitializerAssertions ?? {}),
  );
  const pendingIdentifierAssertions = new Map(
    Object.entries(override.identifierAssertions ?? {}).map(
      ([name, configured]) => [
        name,
        {
          type: typeof configured === 'string' ? configured : configured.type,
          skip:
            typeof configured === 'object' && configured !== null
              ? (configured.skip ?? 0)
              : 0,
          occurrences:
            typeof configured === 'object' && configured !== null
              ? (configured.occurrences ?? 1)
              : 1,
          seen: 0,
          applied: 0,
        },
      ],
    ),
  );
  const phaseInvariantIdentifierAssertions = new Map(
    Object.entries(override.phaseInvariantIdentifierAssertions ?? {}).map(
      ([name, configured]) => [
        name,
        {
          type: typeof configured === 'string' ? configured : configured.type,
          applied: 0,
        },
      ],
    ),
  );
  const pendingExportDefaultExpressionType =
    override.exportDefaultExpressionType;
  const pendingTypeMembers = new Map(
    Object.entries(override.typeMembers ?? {}),
  );
  const pendingTypeAliases = new Map(
    Object.entries(override.typeAliases ?? {}),
  );
  const assertedMemberNodes = new WeakSet();
  const applications = [];
  const result = transformSync(code, {
    ast: false,
    babelrc: false,
    code: true,
    comments: true,
    configFile: false,
    filename: sourceFile.path.replace(/\.js$/, '.ts'),
    generatorOpts: {comments: true, compact: false, retainLines: false},
    parserOpts: {plugins: ['typescript', 'jsx'], sourceType: 'module'},
    plugins: [
      () => ({
        visitor: {
          Program: {
            exit(path) {
              for (const [name, signatures] of pendingPrependedOverloads) {
                const insertionIndex = path.node.body.findIndex(statement =>
                  ((statement.type === 'TSDeclareFunction' ||
                    statement.type === 'FunctionDeclaration') &&
                    statement.id?.type === 'Identifier' &&
                    statement.id.name === name) ||
                  (statement.type === 'ExportNamedDeclaration' &&
                    (statement.declaration?.type === 'TSDeclareFunction' ||
                      statement.declaration?.type === 'FunctionDeclaration') &&
                    statement.declaration.id?.type === 'Identifier' &&
                    statement.declaration.id.name === name),
                );
                if (insertionIndex === -1) continue;
                const declarations = signatures.map(signature =>
                  t.cloneNode(parseOverloadDeclaration(name, signature), true),
                );
                path.node.body.splice(insertionIndex, 0, ...declarations);
                for (const signature of signatures) {
                  applications.push({prependedOverload: name, signature});
                }
                pendingPrependedOverloads.delete(name);
              }
            },
          },
          FunctionDeclaration(path) {
            const name = path.node.id?.name;
            const configured = name === undefined ? undefined : pending.get(name);
            if (configured === undefined) return;
            if (override.kind === 'function-this-type') {
              annotateFunction(
                path.node,
                {this: configured},
                override.id,
                name,
              );
              applications.push({function: name, type: configured});
            } else {
              annotateFunction(path.node, configured, override.id, name);
              applications.push({function: name, signature: configured});
            }
            pending.delete(name);
          },
          FunctionExpression(path) {
            const name = path.node.id?.name;
            const configured = name === undefined ? undefined : pending.get(name);
            if (configured === undefined) return;
            if (override.kind === 'function-this-type') {
              annotateFunction(path.node, {this: configured}, override.id, name);
              applications.push({functionExpression: name, type: configured});
            } else {
              annotateFunction(path.node, configured, override.id, name);
              applications.push({functionExpression: name, signature: configured});
            }
            pending.delete(name);
          },
          ObjectMethod(path) {
            if (path.node.computed || path.node.key.type !== 'Identifier') return;
            const name = path.node.key.name;
            const configured = pendingObjectMethods.get(name);
            if (
              configured === undefined ||
              configured.applied >= configured.occurrences
            ) {
              return;
            }
            annotateFunction(
              path.node,
              configured.signature,
              override.id,
              name,
            );
            configured.applied++;
            applications.push({
              objectMethod: name,
              signature: configured.signature,
            });
          },
          ObjectProperty(path) {
            if (path.node.computed) return;
            const property = path.node.key;
            const propertyName =
              property.type === 'Identifier'
                ? property.name
                : property.type === 'StringLiteral'
                  ? property.value
                  : undefined;
            if (propertyName === undefined) return;
            const functionName = enclosingFunctionName(path);
            const key =
              functionName === undefined
                ? propertyName
                : `${functionName}.${propertyName}`;
            const configured = pendingObjectPropertyValueAssertions.get(key);
            if (
              configured === undefined ||
              configured.applied >= configured.occurrences
            ) {
              return;
            }
            path.node.value = t.tsAsExpression(
              t.cloneNode(path.node.value, true),
              t.cloneNode(parseType(configured.type), true),
            );
            configured.applied++;
            applications.push({
              objectPropertyValueAssertion: key,
              type: configured.type,
            });
          },
          ReferencedIdentifier(path) {
            const identifierName = path.node.name;
            const phaseInvariant = phaseInvariantIdentifierAssertions.get(
              identifierName,
            );
            if (phaseInvariant !== undefined) {
              path.replaceWith(
                t.tsAsExpression(
                  t.cloneNode(path.node, true),
                  t.cloneNode(parseType(phaseInvariant.type), true),
                ),
              );
              phaseInvariant.applied++;
              applications.push({
                phaseInvariantIdentifierAssertion: identifierName,
                type: phaseInvariant.type,
              });
              path.skip();
              return;
            }
            const functionName = enclosingFunctionName(path);
            const key =
              functionName === undefined
                ? path.node.name
                : `${functionName}.${path.node.name}`;
            const configured = pendingIdentifierAssertions.get(key);
            if (configured === undefined) return;
            configured.seen++;
            if (
              configured.seen <= configured.skip ||
              configured.applied >= configured.occurrences
            ) {
              return;
            }
            path.replaceWith(
              t.tsAsExpression(
                t.cloneNode(path.node, true),
                t.cloneNode(parseType(configured.type), true),
              ),
            );
            configured.applied++;
            applications.push({
              identifierAssertion: key,
              type: configured.type,
            });
            path.skip();
          },
          TSAsExpression(path) {
            const expressionName = assertionExpressionName(path.node.expression);
            if (expressionName === null) return;
            const functionName = enclosingFunctionName(path);
            const key =
              functionName === undefined
                ? expressionName
                : `${functionName}.${expressionName}`;
            const configuredEntries = pendingAsExpressionTypes.get(key);
            if (configuredEntries === undefined) return;
            for (const configured of configuredEntries) {
              if (configured.applied >= configured.occurrences) continue;
              configured.seen++;
              if (configured.seen <= configured.skip) return;
              path.node.typeAnnotation = t.cloneNode(
                parseType(configured.type),
                true,
              );
              configured.applied++;
              applications.push({
                asExpressionType: key,
                type: configured.type,
              });
              return;
            }
          },
          ExportDefaultDeclaration(path) {
            if (pendingExportDefaultExpressionType === undefined) return;
            let expression = path.node.declaration;
            if (expression.type === 'TSDeclareFunction') {
              throw new Error(
                `override ${override.id} cannot project a declared function export`,
              );
            }
            while (
              expression.type === 'TSAsExpression' ||
              expression.type === 'TSTypeAssertion'
            ) {
              expression = expression.expression;
            }
            path.node.declaration = t.tsAsExpression(
              t.cloneNode(expression, true),
              t.cloneNode(parseType(pendingExportDefaultExpressionType), true),
            );
            applications.push({
              exportDefaultExpressionType: pendingExportDefaultExpressionType,
            });
          },
          TSDeclareFunction(path) {
            const name = path.node.id?.name;
            const configured =
              name === undefined ? undefined : pendingOverloads.get(name);
            if (configured === undefined) return;
            path.node.returnType = t.tsTypeAnnotation(
              t.cloneNode(parseReturnType(configured.return), true),
            );
            applications.push({overload: name, return: configured.return});
            pendingOverloads.delete(name);
          },
          TSTypeAliasDeclaration(path) {
            const name = path.node.id.name;
            const configured = pendingTypeAliases.get(name);
            if (configured === undefined) return;
            const typeSource =
              typeof configured === 'string' ? configured : configured.type;
            path.node.typeAnnotation = t.cloneNode(parseType(typeSource), true);
            if (
              typeof configured === 'object' &&
              configured !== null &&
              configured.typeParameters !== undefined
            ) {
              const hasTypeParameters =
                path.node.typeParameters !== null &&
                path.node.typeParameters !== undefined;
              const addTypeParameters = configured.addTypeParameters === true;
              if (!hasTypeParameters && !addTypeParameters) {
                throw new Error(
                  `override ${override.id} did not find type parameters on ${name}`,
                );
              }
              if (hasTypeParameters && addTypeParameters) {
                throw new Error(
                  `override ${override.id} unexpectedly found type parameters on ${name}`,
                );
              }
              path.node.typeParameters = t.cloneNode(
                parseTypeParameters(configured.typeParameters),
                true,
              );
            }
            applications.push({typeAlias: name, type: typeSource});
            pendingTypeAliases.delete(name);
          },
          TSPropertySignature(path) {
            const member = path.node.key;
            const memberName =
              !path.node.computed && member.type === 'Identifier'
                ? member.name
                : !path.node.computed && member.type === 'StringLiteral'
                  ? member.value
                  : undefined;
            if (memberName === undefined) return;
            const container = path.findParent(
              candidate =>
                candidate.node.type === 'TSTypeAliasDeclaration' ||
                candidate.node.type === 'TSInterfaceDeclaration',
            );
            const containerName = container?.node.id?.name;
            if (containerName === undefined) return;
            const key = `${containerName}.${memberName}`;
            const configured = pendingTypeMembers.get(key);
            if (configured === undefined) return;
            const typeSource =
              typeof configured === 'string' ? configured : configured.type;
            if (path.node.typeAnnotation === null || path.node.typeAnnotation === undefined) {
              throw new Error(`override ${override.id} found no type on ${key}`);
            }
            path.node.typeAnnotation = t.tsTypeAnnotation(
              t.cloneNode(parseType(typeSource), true),
            );
            applications.push({typeMember: key, type: typeSource});
            pendingTypeMembers.delete(key);
          },
          AssignmentExpression(path) {
            const name = memberExpressionName(path.node.left);
            const functionName = enclosingFunctionName(path);
            const assertionKey =
              functionName === undefined || name === null
                ? undefined
                : `${functionName}.${name}`;
            const rightAssertion =
              assertionKey === undefined
                ? undefined
                : pendingAssignmentRightAssertions.get(assertionKey);
            if (
              rightAssertion !== undefined &&
              rightAssertion.applied < rightAssertion.occurrences
            ) {
              path.node.right = t.tsAsExpression(
                t.cloneNode(path.node.right, true),
                t.cloneNode(parseType(rightAssertion.type), true),
              );
              rightAssertion.applied++;
              applications.push({
                assignmentRightAssertion: assertionKey,
                type: rightAssertion.type,
              });
            }
            const signature = name === null ? undefined : pendingAssignments.get(name);
            if (
              signature === undefined ||
              (path.node.right.type !== 'FunctionExpression' &&
                path.node.right.type !== 'ArrowFunctionExpression')
            ) {
              return;
            }
            annotateFunction(path.node.right, signature, override.id, name);
            applications.push({assignment: name, signature});
            pendingAssignments.delete(name);
          },
          NewExpression(path) {
            if (path.node.callee.type !== 'Identifier') return;
            const name = path.node.callee.name;
            const typeSource = pendingNewCallees.get(name);
            if (typeSource === undefined) return;
            path.node.callee = t.tsAsExpression(
              path.node.callee,
              t.tsIntersectionType([
                t.tsTypeQuery(t.identifier(name)),
                t.cloneNode(parseType(typeSource), true),
              ]),
            );
            applications.push({newCallee: name, type: typeSource});
            pendingNewCallees.delete(name);
          },
          CallExpression(path) {
            const calleeName = memberExpressionName(path.node.callee);
            if (calleeName === null) return;
            const functionName = enclosingFunctionName(path);
            const key =
              functionName === undefined
                ? calleeName
                : `${functionName}.${calleeName}`;
            const calleeAssertion = pendingCallCalleeAssertions.get(key);
            if (
              calleeAssertion !== undefined &&
              calleeAssertion.applied < calleeAssertion.occurrences
            ) {
              path.node.callee = t.tsAsExpression(
                t.cloneNode(path.node.callee, true),
                t.cloneNode(parseType(calleeAssertion.type), true),
              );
              calleeAssertion.applied++;
              applications.push({
                callCalleeAssertion: key,
                type: calleeAssertion.type,
              });
            }
            const configuredEntries = pendingCallArgumentAssertions.get(key);
            if (configuredEntries !== undefined) {
              for (const configured of configuredEntries) {
                if (configured.applied >= configured.occurrences) continue;
                const argument = path.node.arguments[configured.index];
                if (
                  argument === undefined ||
                  argument.type === 'SpreadElement' ||
                  argument.type === 'JSXNamespacedName' ||
                  argument.type === 'ArgumentPlaceholder'
                ) {
                  throw new Error(
                    `override ${override.id} cannot assert argument ${configured.index} of ${key}`,
                  );
                }
                path.node.arguments[configured.index] = t.tsAsExpression(
                  t.cloneNode(argument, true),
                  t.cloneNode(parseType(configured.type), true),
                );
                configured.applied++;
                applications.push({
                  callArgumentAssertion: key,
                  index: configured.index,
                  type: configured.type,
                });
              }
            }
            const resultAssertion = pendingCallResultAssertions.get(key);
            if (
              resultAssertion !== undefined &&
              resultAssertion.applied < resultAssertion.occurrences
            ) {
              const call = t.cloneNode(path.node, true);
              path.replaceWith(
                t.tsAsExpression(
                  call,
                  t.cloneNode(parseType(resultAssertion.type), true),
                ),
              );
              resultAssertion.applied++;
              applications.push({
                callResultAssertion: key,
                type: resultAssertion.type,
              });
              path.skip();
              return;
            }
          },
          MemberExpression(path) {
            if (assertedMemberNodes.has(path.node)) return;
            const name = memberExpressionName(path.node);
            const objectName = memberExpressionName(path.node.object);
            if (name === null || objectName === null) return;
            const functionName = enclosingFunctionName(path);
            const key =
              functionName === undefined ? name : `${functionName}.${name}`;
            const resultAssertion = pendingMemberResultAssertions.get(key);
            if (resultAssertion !== undefined) {
              resultAssertion.seen++;
              if (
                resultAssertion.seen > resultAssertion.skip &&
                resultAssertion.applied < resultAssertion.occurrences
              ) {
                const member = t.cloneNode(path.node, true);
                path.replaceWith(
                  t.tsAsExpression(
                    member,
                    t.cloneNode(parseType(resultAssertion.type), true),
                  ),
                );
                resultAssertion.applied++;
                applications.push({
                  memberResultAssertion: key,
                  type: resultAssertion.type,
                });
                path.skip();
                return;
              }
            }
            const configuredEntries = pendingMemberObjectAssertions.get(key);
            if (configuredEntries === undefined) return;
            for (const configured of configuredEntries) {
              if (configured.applied >= configured.occurrences) continue;
              configured.seen++;
              if (configured.seen <= configured.skip) return;
              path.node.object = t.tsAsExpression(
                t.cloneNode(path.node.object, true),
                t.cloneNode(parseType(configured.type), true),
              );
              configured.applied++;
              assertedMemberNodes.add(path.node);
              applications.push({
                memberObjectAssertion: key,
                type: configured.type,
              });
              path.skip();
              return;
            }
          },
          VariableDeclarator(path) {
            if (path.node.id.type !== 'Identifier') return;
            const name = path.node.id.name;
            const functionName = enclosingFunctionName(path);
            const scopedName =
              functionName === undefined ? undefined : `${functionName}.${name}`;
            const key =
              scopedName !== undefined &&
              (pendingVariables.has(scopedName) ||
                pendingVariableInitializerAssertions.has(scopedName))
                ? scopedName
                : name;
            const configured = pendingVariables.get(key);
            const initializerAssertion = pendingVariableInitializerAssertions.get(key);
            if (initializerAssertion !== undefined) {
              if (path.node.init === null) {
                throw new Error(
                  `override ${override.id} found no initializer on ${key}`,
                );
              }
              path.node.init = t.tsAsExpression(
                t.cloneNode(path.node.init, true),
                t.cloneNode(parseType(initializerAssertion), true),
              );
              applications.push({
                variableInitializerAssertion: key,
                type: initializerAssertion,
              });
              pendingVariableInitializerAssertions.delete(key);
            }
            if (configured === undefined) return;
            if (
              typeof configured === 'object' &&
              configured !== null &&
              (configured.skip ?? 0) > 0
            ) {
              configured.skip--;
              return;
            }
            const typeSource =
              typeof configured === 'string' ? configured : configured.type;
            const replaceExisting =
              typeof configured === 'object' &&
              configured !== null &&
              configured.replaceExisting === true;
            const hasExisting =
              path.node.id.typeAnnotation !== null &&
              path.node.id.typeAnnotation !== undefined;
            if (hasExisting && !replaceExisting) {
              throw new Error(
                `override ${override.id} found an existing type on ${name}`,
              );
            }
            if (!hasExisting && replaceExisting) {
              throw new Error(
                `override ${override.id} did not find the existing type on ${name}`,
              );
            }
            path.node.id.typeAnnotation = t.tsTypeAnnotation(
              t.cloneNode(parseType(typeSource), true),
            );
            applications.push({
              variable: key,
              type: typeSource,
              replacedExisting: replaceExisting,
            });
            if (
              typeof configured === 'object' &&
              configured !== null &&
              (configured.occurrences ?? 1) > 1
            ) {
              configured.occurrences--;
            } else {
              pendingVariables.delete(key);
            }
          },
        },
      }),
    ],
    sourceMaps: false,
  })?.code;
  if (result === null || result === undefined) {
    throw new Error(`override ${override.id} emitted no code for ${sourceFile.path}`);
  }
  if (pending.size > 0) {
    throw new Error(`override ${override.id} did not find: ${[...pending.keys()].join(', ')}`);
  }
  if (pendingAssignments.size > 0) {
    throw new Error(
      `override ${override.id} did not find assignments: ${[...pendingAssignments.keys()].join(', ')}`,
    );
  }
  const incompleteObjectMethods = [...pendingObjectMethods].filter(
    ([, configured]) => configured.applied !== configured.occurrences,
  );
  if (incompleteObjectMethods.length > 0) {
    throw new Error(
      `override ${override.id} did not apply object methods: ${incompleteObjectMethods
        .map(
          ([name, configured]) =>
            `${name} (${configured.applied}/${configured.occurrences})`,
        )
        .join(', ')}`,
    );
  }
  if (pendingNewCallees.size > 0) {
    throw new Error(
      `override ${override.id} did not find new callees: ${[...pendingNewCallees.keys()].join(', ')}`,
    );
  }
  if (pendingVariables.size > 0) {
    throw new Error(
      `override ${override.id} did not find variables: ${[...pendingVariables.keys()].join(', ')}`,
    );
  }
  if (pendingOverloads.size > 0) {
    throw new Error(
      `override ${override.id} did not find overloads: ${[...pendingOverloads.keys()].join(', ')}`,
    );
  }
  if (pendingPrependedOverloads.size > 0) {
    throw new Error(
      `override ${override.id} did not find overload targets: ${[...pendingPrependedOverloads.keys()].join(', ')}`,
    );
  }
  const incompleteMemberAssertions = [...pendingMemberObjectAssertions]
    .flatMap(([name, configuredEntries]) =>
      configuredEntries.map(configured => [name, configured]),
    )
    .filter(([, configured]) => configured.applied !== configured.occurrences);
  if (incompleteMemberAssertions.length > 0) {
    throw new Error(
      `override ${override.id} did not apply member assertions: ${incompleteMemberAssertions
        .map(
          ([name, configured]) =>
            `${name} (${configured.applied}/${configured.occurrences})`,
        )
        .join(', ')}`,
    );
  }
  const incompleteMemberResultAssertions = [...pendingMemberResultAssertions]
    .filter(([, configured]) => configured.applied !== configured.occurrences);
  if (incompleteMemberResultAssertions.length > 0) {
    throw new Error(
      `override ${override.id} did not apply member result assertions: ${incompleteMemberResultAssertions
        .map(
          ([name, configured]) =>
            `${name} (${configured.applied}/${configured.occurrences})`,
        )
        .join(', ')}`,
    );
  }
  const incompleteCallArgumentAssertions = [...pendingCallArgumentAssertions]
    .flatMap(([name, configuredEntries]) =>
      configuredEntries.map(configured => [name, configured]),
    )
    .filter(([, configured]) => configured.applied !== configured.occurrences);
  if (incompleteCallArgumentAssertions.length > 0) {
    throw new Error(
      `override ${override.id} did not apply call argument assertions: ${incompleteCallArgumentAssertions
        .map(
          ([name, configured]) =>
            `${name} (${configured.applied}/${configured.occurrences})`,
        )
        .join(', ')}`,
    );
  }
  const incompleteObjectPropertyValueAssertions = [
    ...pendingObjectPropertyValueAssertions,
  ].filter(([, configured]) => configured.applied !== configured.occurrences);
  if (incompleteObjectPropertyValueAssertions.length > 0) {
    throw new Error(
      `override ${override.id} did not apply object property value assertions: ${incompleteObjectPropertyValueAssertions
        .map(
          ([name, configured]) =>
            `${name} (${configured.applied}/${configured.occurrences})`,
        )
        .join(', ')}`,
    );
  }
  const incompleteAsExpressionTypes = [...pendingAsExpressionTypes].flatMap(
    ([name, configuredEntries]) =>
      configuredEntries
        .filter(configured => configured.applied !== configured.occurrences)
        .map(configured => [name, configured]),
  );
  if (incompleteAsExpressionTypes.length > 0) {
    throw new Error(
      `override ${override.id} did not apply as-expression types: ${incompleteAsExpressionTypes
        .map(
          ([name, configured]) =>
            `${name} (${configured.applied}/${configured.occurrences})`,
        )
        .join(', ')}`,
    );
  }
  const unappliedPhaseInvariantIdentifierAssertions = [
    ...phaseInvariantIdentifierAssertions,
  ].filter(([, configured]) => configured.applied === 0);
  if (unappliedPhaseInvariantIdentifierAssertions.length > 0) {
    throw new Error(
      `override ${override.id} did not apply phase invariant identifier assertions: ${unappliedPhaseInvariantIdentifierAssertions
        .map(([name]) => name)
        .join(', ')}`,
    );
  }
  const incompleteCallCalleeAssertions = [...pendingCallCalleeAssertions].filter(
    ([, configured]) => configured.applied !== configured.occurrences,
  );
  if (incompleteCallCalleeAssertions.length > 0) {
    throw new Error(
      `override ${override.id} did not apply call callee assertions: ${incompleteCallCalleeAssertions
        .map(
          ([name, configured]) =>
            `${name} (${configured.applied}/${configured.occurrences})`,
        )
        .join(', ')}`,
    );
  }
  const incompleteCallResultAssertions = [...pendingCallResultAssertions].filter(
    ([, configured]) => configured.applied !== configured.occurrences,
  );
  if (incompleteCallResultAssertions.length > 0) {
    throw new Error(
      `override ${override.id} did not apply call result assertions: ${incompleteCallResultAssertions
        .map(
          ([name, configured]) =>
            `${name} (${configured.applied}/${configured.occurrences})`,
        )
        .join(', ')}`,
    );
  }
  const incompleteAssignmentRightAssertions = [
    ...pendingAssignmentRightAssertions,
  ].filter(([, configured]) => configured.applied !== configured.occurrences);
  if (incompleteAssignmentRightAssertions.length > 0) {
    throw new Error(
      `override ${override.id} did not apply assignment assertions: ${incompleteAssignmentRightAssertions
        .map(
          ([name, configured]) =>
            `${name} (${configured.applied}/${configured.occurrences})`,
        )
        .join(', ')}`,
    );
  }
  if (pendingVariableInitializerAssertions.size > 0) {
    throw new Error(
      `override ${override.id} did not find variable initializers: ${[...pendingVariableInitializerAssertions.keys()].join(', ')}`,
    );
  }
  const incompleteIdentifierAssertions = [...pendingIdentifierAssertions].filter(
    ([, configured]) => configured.applied !== configured.occurrences,
  );
  if (incompleteIdentifierAssertions.length > 0) {
    throw new Error(
      `override ${override.id} did not apply identifier assertions: ${incompleteIdentifierAssertions
        .map(
          ([name, configured]) =>
            `${name} (${configured.applied}/${configured.occurrences})`,
        )
        .join(', ')}`,
    );
  }
  if (pendingTypeMembers.size > 0) {
    throw new Error(
      `override ${override.id} did not find type members: ${[...pendingTypeMembers.keys()].join(', ')}`,
    );
  }
  if (pendingTypeAliases.size > 0) {
    throw new Error(
      `override ${override.id} did not find type aliases: ${[...pendingTypeAliases.keys()].join(', ')}`,
    );
  }
  return {code: result, applications};
}

function applyRuntimeOverride(code, sourceFile, digest) {
  const override = overridesByPath.get(sourceFile.path);
  const configuredForwardTransforms =
    override?.runtimeTransforms?.forwardSingleArgumentApply ?? [];
  const configuredRestTransforms =
    override?.runtimeTransforms?.argumentsToRest ?? [];
  if (
    configuredForwardTransforms.length === 0 &&
    configuredRestTransforms.length === 0
  ) {
    return {code, applications: []};
  }
  if (override.sourceSha256 !== digest) {
    throw new Error(`runtime override ${override.id} source hash is stale`);
  }
  const pendingForward = configuredForwardTransforms.map(configured => ({
    ...configured,
    applied: false,
  }));
  const pendingRest = configuredRestTransforms.map(configured => ({
    ...configured,
    applied: false,
  }));
  const applications = [];
  const result = transformSync(code, {
    ast: false,
    babelrc: false,
    code: true,
    comments: true,
    configFile: false,
    filename: sourceFile.path.replace(/\.js$/, '.ts'),
    generatorOpts: {comments: true, compact: false, retainLines: false},
    parserOpts: {plugins: ['typescript', 'jsx'], sourceType: 'module'},
    plugins: [
      () => ({
        visitor: {
          CallExpression(path) {
            if (
              path.node.callee.type !== 'MemberExpression' ||
              path.node.callee.computed ||
              path.node.callee.object.type !== 'Identifier' ||
              path.node.callee.property.type !== 'Identifier' ||
              path.node.callee.property.name !== 'apply' ||
              path.node.arguments.length !== 2 ||
              path.node.arguments[0]?.type !== 'ThisExpression' ||
              path.node.arguments[1]?.type !== 'Identifier' ||
              path.node.arguments[1].name !== 'arguments'
            ) {
              return;
            }
            const enclosingDeclaration = path.findParent(
              candidate =>
                candidate.node.type === 'FunctionDeclaration' &&
                candidate.node.id?.type === 'Identifier',
            );
            const enclosingName = enclosingDeclaration?.node.id?.name;
            const configured = pendingForward.find(
              candidate =>
                !candidate.applied &&
                candidate.enclosingFunction === enclosingName &&
                candidate.callee === path.node.callee.object.name,
            );
            if (configured === undefined) return;
            const forwardingFunction = path.findParent(
              candidate => candidate.node.type === 'FunctionExpression',
            );
            if (
              forwardingFunction === null ||
              forwardingFunction.node.params.length !== 0 ||
              forwardingFunction.node.body.body.length !== 1 ||
              forwardingFunction.node.body.body[0]?.type !== 'ExpressionStatement' ||
              forwardingFunction.node.body.body[0].expression !== path.node
            ) {
              throw new Error(
                `runtime override ${override.id} found a non-canonical forwarding callback`,
              );
            }
            const receiver = t.identifier('this');
            receiver.typeAnnotation = t.tsTypeAnnotation(
              t.cloneNode(parseType(configured.thisType), true),
            );
            const argument = t.identifier(configured.parameter);
            argument.typeAnnotation = t.tsTypeAnnotation(
              t.cloneNode(parseType(configured.parameterType), true),
            );
            forwardingFunction.node.params = [receiver, argument];
            path.replaceWith(
              t.callExpression(
                t.memberExpression(
                  t.identifier(configured.callee),
                  t.identifier('call'),
                ),
                [t.thisExpression(), t.identifier(configured.parameter)],
              ),
            );
            configured.applied = true;
            applications.push({
              transform: 'forward-single-argument-apply',
              enclosingFunction: configured.enclosingFunction,
              callee: configured.callee,
              parameter: configured.parameter,
            });
          },
          FunctionExpression(path) {
            const outerDeclaration = path.findParent(
              candidate =>
                candidate.node.type === 'FunctionDeclaration' &&
                candidate.node.id?.type === 'Identifier',
            );
            const outerFunction = outerDeclaration?.node.id?.name;
            const innerFunction = path.node.id?.name ?? null;
            const configured = pendingRest.find(
              candidate =>
                !candidate.applied &&
                candidate.outerFunction === outerFunction &&
                (candidate.innerFunction ?? null) === innerFunction,
            );
            if (configured === undefined) return;
            if (path.node.params.length !== 0) {
              throw new Error(
                `runtime override ${override.id} found parameters on ${outerFunction}`,
              );
            }
            let replacements = 0;
            path.traverse({
              Function(innerPath) {
                if (innerPath !== path) innerPath.skip();
              },
              Identifier(identifierPath) {
                if (identifierPath.node.name !== 'arguments') return;
                identifierPath.replaceWith(t.identifier(configured.restName));
                replacements++;
              },
            });
            if (replacements === 0) {
              throw new Error(
                `runtime override ${override.id} found no arguments references on ${outerFunction}`,
              );
            }
            const restIdentifier = t.identifier(configured.restName);
            restIdentifier.typeAnnotation = t.tsTypeAnnotation(
              t.cloneNode(parseType(configured.restType), true),
            );
            const parameters = [t.restElement(restIdentifier)];
            if (configured.thisType !== undefined) {
              const receiver = t.identifier('this');
              receiver.typeAnnotation = t.tsTypeAnnotation(
                t.cloneNode(parseType(configured.thisType), true),
              );
              parameters.unshift(receiver);
            }
            path.node.params = parameters;
            configured.applied = true;
            applications.push({
              transform: 'arguments-to-rest',
              outerFunction,
              innerFunction,
              restName: configured.restName,
              replacements,
            });
          },
        },
      }),
    ],
    sourceMaps: false,
  })?.code;
  if (result === null || result === undefined) {
    throw new Error(`runtime override ${override.id} emitted no code`);
  }
  const incomplete = [...pendingForward, ...pendingRest].filter(
    configured => !configured.applied,
  );
  if (incomplete.length > 0) {
    throw new Error(
      `runtime override ${override.id} did not apply ${incomplete.length} transform(s)`,
    );
  }
  return {code: result, applications};
}

const report = {
  schema: 2,
  upstream: closure.upstream,
  profile: closure.profile.name,
  converter: {
    parser: 'babel-plugin-syntax-hermes-parser@0.36.1',
    transform: '@zxbodya/babel-plugin-flow-to-typescript@0.16.0',
    babel: '@babel/core@7.29.7',
  },
  summary: {
    attempted: closure.files.length,
    converted: 0,
    failed: 0,
    sourceLines: 0,
    generatedLines: 0,
    generatedAny: 0,
    generatedUnknown: 0,
    generatedTsIgnore: 0,
    generatedReactGlobals: 0,
    rewrittenInternalImports: 0,
    semanticOverrides: 0,
    reorderedDetachedOverloads: 0,
    normalizedFlowVoidUnionMembers: 0,
    normalizedDeferredVariableTypes: 0,
    normalizedDynamicAnyTypes: 0,
    normalizedReactValueBoundaryProjections: 0,
    normalizedReactValueProjections: 0,
    removedTypeScriptDirectives: 0,
    runtimeEquivalent: 0,
    runtimeDifferent: 0,
    runtimeTransforms: 0,
    runtimeAdaptedFiles: 0,
  },
  failures: [],
  files: [],
};

rmSync(outputRoot, {recursive: true, force: true});
mkdirSync(outputRoot, {recursive: true});

for (const sourceFile of closure.files) {
  const absolute = join(reactRoot, sourceFile.path);
  const source = readFileSync(absolute, 'utf8');
  const digest = createHash('sha256').update(source).digest('hex');
  if (digest !== sourceFile.sha256) {
    throw new Error(`${sourceFile.path} changed after dependency analysis`);
  }
  report.summary.sourceLines += sourceFile.lines;

  let stage = 'transform-flow';
  let code = null;
  try {
    const transformed = transformSync(source, {
      ast: false,
      babelrc: false,
      code: true,
      comments: true,
      configFile: false,
      filename: absolute,
      generatorOpts: {
        comments: true,
        compact: false,
        retainLines: false,
      },
      plugins: [
        [syntaxHermesParser, {parseLangTypes: 'flow'}],
        [flowToTypeScript, {isJSX: true}],
      ],
      sourceMaps: false,
    });
    code = transformed?.code ?? '';
    stage = 'normalize-detached-overloads';
    const overloadNormalization = normalizeDetachedOverloads(code, sourceFile);
    code = overloadNormalization.code;
    report.summary.reorderedDetachedOverloads += overloadNormalization.reordered;
    stage = 'normalize-flow-void-unions';
    const voidNormalization = normalizeFlowVoidUnions(code, sourceFile);
    code = voidNormalization.code;
    report.summary.normalizedFlowVoidUnionMembers += voidNormalization.normalized;
    stage = 'normalize-deferred-variable-types';
    const deferredVariableNormalization = normalizeDeferredVariableTypes(
      code,
      sourceFile,
    );
    code = deferredVariableNormalization.code;
    report.summary.normalizedDeferredVariableTypes +=
      deferredVariableNormalization.normalized;
    stage = 'apply-semantic-overrides';
    const semanticOverride = applySemanticOverride(code, sourceFile, digest);
    code = semanticOverride.code;
    report.summary.semanticOverrides += semanticOverride.applications.length;
    stage = 'normalize-dynamic-any-types';
    const dynamicAnyNormalization = normalizeDynamicAnyTypes(code, sourceFile);
    code = dynamicAnyNormalization.code;
    report.summary.normalizedDynamicAnyTypes += dynamicAnyNormalization.normalized;
    stage = 'normalize-react-value-boundary-projections';
    const reactValueBoundaryProjectionNormalization =
      normalizeReactValueBoundaryProjections(code, sourceFile);
    code = reactValueBoundaryProjectionNormalization.code;
    report.summary.normalizedReactValueBoundaryProjections +=
      reactValueBoundaryProjectionNormalization.normalized;
    stage = 'normalize-react-value-projections';
    const reactValueProjectionNormalization = normalizeReactValueProjections(
      code,
      sourceFile,
    );
    code = reactValueProjectionNormalization.code;
    report.summary.normalizedReactValueProjections +=
      reactValueProjectionNormalization.normalized;
    const directiveMatches = code.match(/@ts-(?:ignore|expect-error|nocheck)/g);
    report.summary.removedTypeScriptDirectives += directiveMatches?.length ?? 0;
    code = code.replace(/@ts-(ignore|expect-error|nocheck)/g, 'ts-$1');
    stage = 'parse-typescript';
    parseTypeScript(code, {
      plugins: ['typescript', 'jsx'],
      sourceFilename: sourceFile.path.replace(/\.js$/, '.ts'),
      sourceType: 'module',
    });
    stage = 'compare-runtime-syntax';
    const runtimeGeneratorOptions = {
      ast: false,
      babelrc: false,
      code: true,
      comments: false,
      compact: false,
      configFile: false,
      sourceMaps: false,
    };
    const flowRuntime = transformSync(source, {
      ...runtimeGeneratorOptions,
      filename: absolute,
      plugins: [
        [syntaxHermesParser, {parseLangTypes: 'flow'}],
        stripFlowTypes,
      ],
    })?.code;
    const typeScriptRuntime = transformSync(code, {
      ...runtimeGeneratorOptions,
      filename: sourceFile.path.replace(/\.js$/, '.ts'),
      plugins: [[stripTypeScriptTypes, {allowDeclareFields: true}]],
    })?.code;
    const comparableFlow = comparableRuntime(flowRuntime);
    const comparableTypeScript = comparableRuntime(typeScriptRuntime);
    if (comparableFlow !== comparableTypeScript) {
      report.summary.runtimeDifferent++;
      let offset = 0;
      const shortest = Math.min(comparableFlow.length, comparableTypeScript.length);
      while (
        offset < shortest &&
        comparableFlow[offset] === comparableTypeScript[offset]
      ) {
        offset++;
      }
      throw new Error(`runtime output differs first at byte ${offset}`);
    }
    report.summary.runtimeEquivalent++;

    stage = 'apply-runtime-overrides';
    const runtimeOverride = applyRuntimeOverride(code, sourceFile, digest);
    code = runtimeOverride.code;
    report.summary.runtimeTransforms += runtimeOverride.applications.length;
    if (runtimeOverride.applications.length > 0) {
      report.summary.runtimeAdaptedFiles++;
    }
    stage = 'parse-runtime-adapted-typescript';
    parseTypeScript(code, {
      plugins: ['typescript', 'jsx'],
      sourceFilename: sourceFile.path.replace(/\.js$/, '.ts'),
      sourceType: 'module',
    });

    const rewritten = rewriteInternalSpecifiers(code, sourceFile);
    code = rewritten.code;
    report.summary.rewrittenInternalImports += rewritten.count;
    const typeScriptAst = parseTypeScript(code, {
      plugins: ['typescript', 'jsx'],
      sourceFilename: sourceFile.path.replace(/\.js$/, '.ts'),
      sourceType: 'module',
    });

    const generatedLines = code.split('\n').length;
    const metrics = {
      any: 0,
      unknown: 0,
      tsIgnore: count(/@ts-(?:ignore|expect-error|nocheck)/g, code),
      reactGlobals: 0,
    };
    walkAst(typeScriptAst, node => {
      if (node.type === 'TSAnyKeyword') metrics.any++;
      if (node.type === 'TSUnknownKeyword') metrics.unknown++;
      if (
        node.type === 'TSTypeReference' &&
        node.typeName?.type === 'Identifier' &&
        node.typeName.name.startsWith('React$')
      ) {
        metrics.reactGlobals++;
      }
    });
    report.summary.converted++;
    report.summary.generatedLines += generatedLines;
    report.summary.generatedAny += metrics.any;
    report.summary.generatedUnknown += metrics.unknown;
    report.summary.generatedTsIgnore += metrics.tsIgnore;
    report.summary.generatedReactGlobals += metrics.reactGlobals;
    report.files.push({
      path: sourceFile.path,
      output: relative(experimentRoot, outputPath(sourceFile.path)).split(sep).join('/'),
      sourceSha256: digest,
      generatedSha256: createHash('sha256').update(code).digest('hex'),
      sourceLines: sourceFile.lines,
      generatedLines,
      metrics,
      semanticOverrides: semanticOverride.applications,
      runtimeTransforms: runtimeOverride.applications,
    });

    const target = outputPath(sourceFile.path);
    mkdirSync(dirname(target), {recursive: true});
    const provenance =
      `/* @generated from React ${lock.commit} ${sourceFile.path} ${digest} */\n`;
    writeFileSync(target, provenance + code + '\n');
  } catch (error) {
    report.summary.failed++;
    if (code !== null) {
      const failedTarget = join(
        outputRoot,
        'failed',
        sourceFile.path.replace(/\.js$/, '.ts'),
      );
      mkdirSync(dirname(failedTarget), {recursive: true});
      writeFileSync(failedTarget, code + '\n');
    }
    report.failures.push({
      path: sourceFile.path,
      stage,
      message: String(error?.message ?? error).split('\n')[0],
    });
  }
}

report.files.sort((a, b) => a.path.localeCompare(b.path));
report.failures.sort((a, b) => a.path.localeCompare(b.path));
const reportText = `${JSON.stringify(report, null, 2)}\n`;
const reportPath = join(experimentRoot, 'reports', 'normalization-probe.json');

if (checkOnly) {
  const current = readFileSync(reportPath, 'utf8');
  if (current !== reportText) {
    throw new Error('normalization report is stale; run npm run normalize:probe');
  }
  console.log(
    `normalization current: ${report.summary.converted}/${report.summary.attempted} converted`,
  );
} else {
  writeFileSync(reportPath, reportText);
  console.log(
    `converted ${report.summary.converted}/${report.summary.attempted}; ` +
      `${report.summary.failed} failures; wrote ${relative(process.cwd(), reportPath)}`,
  );
}

if (report.summary.failed > 0) process.exitCode = 2;
