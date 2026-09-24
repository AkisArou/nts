import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, extname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {parse} = require('hermes-parser');

const here = dirname(fileURLToPath(import.meta.url));
const experimentRoot = resolve(here, '..');
const lock = JSON.parse(readFileSync(join(experimentRoot, 'upstream.lock.json'), 'utf8'));
const profile = JSON.parse(
  readFileSync(join(experimentRoot, 'profiles/client-mutation-production.json'), 'utf8'),
);
const reactRoot = process.env.NTS_REACT_SOURCE
  ? resolve(process.env.NTS_REACT_SOURCE)
  : resolve(lock.repository);
const checkOnly = process.argv.includes('--check');
const auxiliaryInputs = [
  {
    path: 'scripts/flow/environment.js',
    consumedDeclarations: ['ConsoleTask'],
  },
].map(input => {
  const source = readFileSync(join(reactRoot, input.path), 'utf8');
  return {
    ...input,
    sha256: createHash('sha256').update(source).digest('hex'),
    lines: source.split('\n').length,
  };
});

const head = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: reactRoot,
  encoding: 'utf8',
}).trim();
if (head !== lock.commit) {
  throw new Error(`React checkout is ${head}; expected pinned commit ${lock.commit}`);
}

function upstreamPath(absolute) {
  return relative(reactRoot, absolute).split(sep).join('/');
}

function existingModule(base) {
  const candidates = extname(base)
    ? [base]
    : [base, `${base}.js`, `${base}.ts`, `${base}.tsx`, join(base, 'index.js')];
  for (const candidate of candidates) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {}
  }
  return null;
}

function packageModule(specifier) {
  if (specifier.startsWith('@')) return null;
  const slash = specifier.indexOf('/');
  const name = slash === -1 ? specifier : specifier.slice(0, slash);
  const packageRoot = join(reactRoot, 'packages', name);
  if (specifier === name) {
    return existingModule(join(packageRoot, 'index'));
  }
  return existingModule(join(packageRoot, specifier.slice(name.length + 1)));
}

function resolveImport(from, specifier) {
  let resolved = null;
  if (specifier.startsWith('.')) {
    resolved = existingModule(resolve(dirname(from), specifier));
  } else {
    resolved = packageModule(specifier);
  }
  if (resolved === null) {
    return {kind: 'external', value: specifier};
  }
  const rel = upstreamPath(resolved);
  const fork = profile.forks[rel];
  if (fork?.startsWith('virtual:')) {
    return {kind: 'virtual', value: fork};
  }
  if (fork) {
    return {kind: 'source', value: fork, absolute: join(reactRoot, fork)};
  }
  return {kind: 'source', value: rel, absolute: resolved};
}

function walk(node, visit) {
  if (node === null || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'range' || key === 'tokens' || key === 'comments') continue;
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit);
    } else {
      walk(value, visit);
    }
  }
}

const flowKinds = new Set([
  'AnyTypeAnnotation',
  'MixedTypeAnnotation',
  'ExistsTypeAnnotation',
  'OpaqueType',
  'DeclareOpaqueType',
  'ObjectTypeAnnotation',
  'Variance',
  'TypeCastExpression',
  'TypeofTypeAnnotation',
  'InterfaceDeclaration',
  'NullableTypeAnnotation',
  'FunctionTypeAnnotation',
  'GenericTypeAnnotation',
  'IndexedAccessType',
  'OptionalIndexedAccessType',
]);

function increment(object, key, amount = 1) {
  object[key] = (object[key] ?? 0) + amount;
}

function memberName(node) {
  if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') return null;
  if (!node.computed && node.property?.type === 'Identifier') return node.property.name;
  if (node.computed && node.property?.type === 'StringLiteral') return node.property.value;
  return null;
}

const queue = profile.entries.map(path => join(reactRoot, path));
const seen = new Set();
const files = [];
const external = {};
const virtual = {};
const virtualBindings = {};
const totals = {flow: {}, javascript: {}, dynamicStorage: {}};

while (queue.length > 0) {
  const file = queue.shift();
  const rel = upstreamPath(file);
  if (seen.has(rel)) continue;
  seen.add(rel);

  const source = readFileSync(file, 'utf8');
  const digest = createHash('sha256').update(source).digest('hex');
  const ast = parse(source, {
    babel: true,
    flow: 'all',
    sourceFilename: rel,
    sourceType: 'module',
  });
  const imports = new Map();
  const importBindings = new Map();
  const perFile = {flow: {}, javascript: {}, dynamicStorage: {}};

  function addImport(specifier, kind) {
    const previous = imports.get(specifier);
    imports.set(specifier, previous === 'runtime' ? previous : kind);
  }

  walk(ast, node => {
    if (
      (node.type === 'ImportDeclaration' ||
        node.type === 'ExportNamedDeclaration' ||
        node.type === 'ExportAllDeclaration') &&
      node.source?.value
    ) {
      const declaredKind =
        node.importKind === 'type' ||
        node.importKind === 'typeof' ||
        node.exportKind === 'type'
          ? 'type'
          : 'runtime';
      addImport(node.source.value, declaredKind);
      if (node.type === 'ImportDeclaration') {
        const bindings = importBindings.get(node.source.value) ?? {
          runtime: new Set(),
          type: new Set(),
        };
        for (const specifier of node.specifiers) {
          const name = specifier.type === 'ImportNamespaceSpecifier'
            ? '*'
            : specifier.imported?.name ?? specifier.imported?.value ?? specifier.local?.name;
          if (name === undefined) continue;
          const kind =
            declaredKind === 'type' ||
            specifier.importKind === 'type' ||
            specifier.importKind === 'typeof'
              ? 'type'
              : 'runtime';
          bindings[kind].add(name);
        }
        importBindings.set(node.source.value, bindings);
      }
    }
    if (
      node.type === 'CallExpression' &&
      node.callee?.type === 'Identifier' &&
      node.callee.name === 'require' &&
      node.arguments?.[0]?.type === 'StringLiteral'
    ) {
      addImport(node.arguments[0].value, 'runtime');
    }

    if (flowKinds.has(node.type)) increment(perFile.flow, node.type);
    if (node.type === 'AnyTypeAnnotation') increment(perFile.dynamicStorage, 'any');
    if (node.type === 'MixedTypeAnnotation') increment(perFile.dynamicStorage, 'mixed');
    if (
      node.type === 'GenericTypeAnnotation' &&
      ['Object', 'Function'].includes(node.id?.name)
    ) {
      increment(perFile.dynamicStorage, node.id.name);
    }

    if (node.type === 'MemberExpression' && node.computed) {
      increment(perFile.javascript, 'computed-member-access');
    }
    if (node.type === 'ForInStatement') increment(perFile.javascript, 'for-in');
    if (node.type === 'TypeofExpression') increment(perFile.javascript, 'typeof');
    if (node.type === 'BinaryExpression' && node.operator === 'instanceof') {
      increment(perFile.javascript, 'instanceof');
    }
    if (node.type === 'SpreadElement' || node.type === 'SpreadProperty') {
      increment(perFile.javascript, 'spread');
    }
    if (node.type === 'MetaProperty') increment(perFile.javascript, 'meta-property');
    if (node.type === 'CallExpression') {
      const member = memberName(node.callee);
      if (['call', 'apply', 'bind'].includes(member)) {
        increment(perFile.javascript, `Function.${member}`);
      }
      if (node.callee?.type === 'MemberExpression' && node.callee.object?.name === 'Object') {
        increment(perFile.javascript, `Object.${member ?? '<computed>'}`);
      }
      if (node.callee?.type === 'MemberExpression' && node.callee.object?.name === 'Reflect') {
        increment(perFile.javascript, `Reflect.${member ?? '<computed>'}`);
      }
    }
    if (node.type === 'NewExpression' && node.callee?.name === 'Proxy') {
      increment(perFile.javascript, 'new Proxy');
    }
  });

  for (const group of Object.keys(totals)) {
    for (const [key, count] of Object.entries(perFile[group])) {
      increment(totals[group], key, count);
    }
  }

  const resolvedImports = [];
  for (const [specifier, importKind] of [...imports].sort(([a], [b]) => a.localeCompare(b))) {
    const target = resolveImport(file, specifier);
    const {absolute, ...recordedTarget} = target;
    resolvedImports.push({specifier, importKind, ...recordedTarget});
    if (target.kind === 'source') queue.push(absolute);
    if (target.kind === 'external') increment(external, target.value);
    if (target.kind === 'virtual') increment(virtual, target.value);
    if (target.kind === 'virtual') {
      const aggregate = virtualBindings[target.value] ?? {
        runtime: new Set(),
        type: new Set(),
      };
      const bindings = importBindings.get(specifier);
      for (const name of bindings?.runtime ?? []) aggregate.runtime.add(name);
      for (const name of bindings?.type ?? []) aggregate.type.add(name);
      virtualBindings[target.value] = aggregate;
    }
  }

  files.push({
    path: rel,
    sha256: digest,
    lines: source.split('\n').length,
    imports: resolvedImports,
    inventory: perFile,
  });
}

files.sort((a, b) => a.path.localeCompare(b.path));
const fileByPath = new Map(files.map(file => [file.path, file]));
const runtimeFiles = new Set(profile.entries);
const runtimeQueue = [...profile.entries];
while (runtimeQueue.length > 0) {
  const current = runtimeQueue.shift();
  const file = fileByPath.get(current);
  if (!file) continue;
  for (const dependency of file.imports) {
    if (dependency.kind !== 'source' || dependency.importKind !== 'runtime') continue;
    if (!runtimeFiles.has(dependency.value)) {
      runtimeFiles.add(dependency.value);
      runtimeQueue.push(dependency.value);
    }
  }
}
for (const file of files) {
  file.reachability = runtimeFiles.has(file.path) ? 'runtime' : 'type-only';
}
const manifest = {
  schema: 3,
  upstream: {repository: lock.remote, commit: lock.commit},
  profile,
  summary: {
    files: files.length,
    runtimeFiles: runtimeFiles.size,
    typeOnlyFiles: files.length - runtimeFiles.size,
    lines: files.reduce((sum, file) => sum + file.lines, 0),
    externalImports: external,
    virtualImports: virtual,
    virtualImportBindings: Object.fromEntries(
      Object.entries(virtualBindings).map(([name, bindings]) => [
        name,
        {
          runtime: [...bindings.runtime].sort(),
          type: [...bindings.type].sort(),
        },
      ]),
    ),
    inventory: totals,
  },
  auxiliaryInputs,
  files,
};

const json = `${JSON.stringify(manifest, null, 2)}\n`;
const reportPath = join(experimentRoot, 'reports', 'client-mutation-production.json');
if (checkOnly) {
  const current = readFileSync(reportPath, 'utf8');
  if (current !== json) {
    throw new Error('baseline report is stale; run npm run --prefix runtime/react analyze');
  }
  console.log(`baseline current: ${files.length} files, ${manifest.summary.lines} lines`);
} else {
  writeFileSync(reportPath, json);
  console.log(`wrote ${relative(process.cwd(), reportPath)}: ${files.length} files, ${manifest.summary.lines} lines`);
}
