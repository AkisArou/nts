import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from '@babel/parser';

const here = dirname(fileURLToPath(import.meta.url));
const experimentRoot = resolve(here, '..');
const closure = JSON.parse(
  readFileSync(join(experimentRoot, 'reports/client-mutation-production.json'), 'utf8'),
);
const bindings =
  closure.summary.virtualImportBindings['virtual:nts-recording-mutation-host'];
if (bindings === undefined) throw new Error('recording HostConfig binding inventory missing');

const output = join(
  experimentRoot,
  'generated/client-mutation-production/packages/react-reconciler/src/ReactFiberConfig.ts',
);
const core = join(experimentRoot, 'host-test/ReactFiberConfigMutation.ts');
const coreImport = relative(dirname(output), core)
  .split(sep)
  .join('/')
  .replace(/^(?!\.)/, './');
const reportPath = join(experimentRoot, 'reports/materialized-host-config.json');
const checkOnly = process.argv.includes('--check');

const coreTypes = new Set([
  'Container',
  'FormInstance',
  'HostContext',
  'Instance',
  'NoTimeout',
  'Props',
  'PublicInstance',
  'RendererInspectionConfig',
  'SuspendedState',
  'TextInstance',
  'TimeoutHandle',
  'TransitionStatus',
  'Type',
]);
const coreValues = new Set([
  'NotPendingTransition',
  'HostTransitionContext',
  'appendChild',
  'appendChildToContainer',
  'appendInitialChild',
  'clearContainer',
  'commitTextUpdate',
  'commitUpdate',
  'createInstance',
  'createTextInstance',
  'detachDeletedInstance',
  'extraDevToolsConfig',
  'finalizeInitialChildren',
  'getChildHostContext',
  'getCurrentUpdatePriority',
  'getPublicInstance',
  'getRootHostContext',
  'getSuspendedCommitReason',
  'hideInstance',
  'hideTextInstance',
  'insertBefore',
  'insertInContainerBefore',
  'isPrimaryRenderer',
  'noTimeout',
  'prepareForCommit',
  'removeChild',
  'removeChildFromContainer',
  'rendererPackageName',
  'rendererVersion',
  'resetAfterCommit',
  'resetTextContent',
  'resolveUpdatePriority',
  'setCurrentUpdatePriority',
  'startSuspendingCommit',
  'shouldSetTextContent',
  'supportsHydration',
  'supportsMicrotasks',
  'supportsMutation',
  'supportsPersistence',
  'supportsResources',
  'supportsSingletons',
  'supportsTestSelectors',
  'suspendOnActiveViewTransition',
  'unhideInstance',
  'unhideTextInstance',
  'warnsIfNotActing',
  'waitForCommitToBeReady',
]);

function exportedBooleanConstants(source, path) {
  const ast = parse(source, {
    plugins: ['typescript'],
    sourceFilename: path,
    sourceType: 'module',
  });
  const constants = new Map();
  for (const statement of ast.program.body) {
    if (
      statement.type !== 'ExportNamedDeclaration' ||
      statement.declaration?.type !== 'VariableDeclaration'
    ) {
      continue;
    }
    for (const declaration of statement.declaration.declarations) {
      if (
        declaration.id.type === 'Identifier' &&
        declaration.init?.type === 'BooleanLiteral'
      ) {
        constants.set(declaration.id.name, declaration.init.value);
      }
    }
  }
  return constants;
}

const configuredHostCapabilities = Object.entries(
  closure.profile.hostCapabilities ?? {},
).sort(([left], [right]) => left.localeCompare(right));
const coreBooleanConstants = exportedBooleanConstants(
  readFileSync(core, 'utf8'),
  core,
);
for (const [name, configuredValue] of configuredHostCapabilities) {
  if (!coreValues.has(name)) {
    throw new Error(`profile host capability ${name} is not a HostConfig value`);
  }
  if (typeof configuredValue !== 'boolean') {
    throw new Error(`profile host capability ${name} must be boolean`);
  }
  const implementedValue = coreBooleanConstants.get(name);
  if (implementedValue === undefined) {
    throw new Error(
      `HostConfig capability ${name} must be implemented as an exported boolean literal`,
    );
  }
  if (implementedValue !== configuredValue) {
    throw new Error(
      `HostConfig capability ${name} is ${implementedValue}; profile declares ${configuredValue}`,
    );
  }
}

const missingTypes = bindings.type.filter(name => !coreTypes.has(name));
const missingValues = bindings.runtime.filter(name => !coreValues.has(name));
const missingTypeDefinitions = new Map([
  ['ViewTransitionInstance', '{readonly name: string}'],
]);
const missingValueTypes = new Map([
  ['getInstanceFromNode', '(node: unknown) => Fiber | null'],
  ['getInstanceFromScope', '(scope: ReactScopeInstance) => Fiber | null'],
  [
    'findFiberRoot',
    '(hostRoot: Instance) => {stateNode: {current: Fiber}} | null',
  ],
  ['getTextContent', '(fiber: Fiber) => string | null'],
  ['matchAccessibilityRole', '(node: unknown, role: string) => boolean'],
  [
    'setupIntersectionObserver',
    '(roots: Instance[], callback: Function, options?: unknown) => {disconnect(): void; observe(root: Instance): void; unobserve(root: Instance): void}',
  ],
  [
    'requestPostPaintCallback',
    '(callback: (time: number) => void) => void',
  ],
]);
const lines = [
  '/* @generated: profile HostConfig surface; do not edit */',
  "import type {Fiber} from './ReactInternalTypes';",
  "import type {ReactScopeInstance} from '../../shared/ReactTypes';",
  `import type {Instance} from '${coreImport}';`,
  `export * from '${coreImport}';`,
  ...configuredHostCapabilities.map(
    ([name, value]) => `export const ${name} = ${String(value)};`,
  ),
  '',
  'function unavailable<Arguments extends unknown[]>(',
  '  ..._arguments: Arguments',
  '): never {',
  "  throw new Error('disabled React HostConfig capability was reached');",
  '}',
  '',
  ...missingTypes.map(
    name => `export type ${name} = ${missingTypeDefinitions.get(name) ?? 'unknown'};`,
  ),
  '',
  ...missingValues.map(name => {
    const type = missingValueTypes.get(name);
    return type === undefined
      ? `export const ${name} = unavailable;`
      : `export const ${name}: ${type} = unavailable;`;
  }),
  '',
];
const source = lines.join('\n');
const report = {
  schema: 1,
  profile: closure.profile.name,
  output: relative(experimentRoot, output).split(sep).join('/'),
  coreImport,
  importedRuntimeBindings: bindings.runtime.length,
  importedTypeBindings: bindings.type.length,
  coreRuntimeBindings: coreValues.size,
  coreTypeBindings: coreTypes.size,
  hostCapabilities: Object.fromEntries(configuredHostCapabilities),
  explicitCapabilityBindings: configuredHostCapabilities.length,
  trappingRuntimeBindings: missingValues.length,
  typedTrappingRuntimeBindings: missingValues.filter(name =>
    missingValueTypes.has(name),
  ).length,
  opaqueTypeBindings: missingTypes.length,
  sha256: createHash('sha256').update(source).digest('hex'),
};
const reportText = `${JSON.stringify(report, null, 2)}\n`;

mkdirSync(dirname(output), {recursive: true});
writeFileSync(output, source);
if (checkOnly) {
  if (readFileSync(reportPath, 'utf8') !== reportText) {
    throw new Error('materialized HostConfig report is stale');
  }
  console.log(
    `HostConfig current: ${coreValues.size} implemented, ${missingValues.length} trapping`,
  );
} else {
  writeFileSync(reportPath, reportText);
  console.log(
    `HostConfig: ${coreValues.size} implemented, ${missingValues.length} trapping; ` +
      `wrote ${relative(process.cwd(), reportPath)}`,
  );
}
