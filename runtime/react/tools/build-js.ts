// Emit the lane's packages as the CommonJS layout upstream React publishes,
// which is what the upstream test harness resolves:
//
//   build/js/<package>/<entry>.js              picks a build by NODE_ENV
//   build/js/<mode>/<package>/<entry>.js       one bundle per public entry
//
// Type checking is `tsc -b`, not this. Each public entry is bundled on its own
// and every other package stays an external bare specifier, as in upstream's
// bundles. So state shared across entries or packages (React's internals, the
// scheduler a test has mocked) lives in exactly one module.

import {build, type Plugin} from 'esbuild';
import {existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const lane = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = join(lane, 'packages');
const out = join(lane, 'build/js');
const modes = ['development', 'production'];

// An export's source, possibly per condition (`development` or `default`).
type ExportTarget = string | { [condition: string]: string };

interface Package {
  dir: string;
  name: string;
  version: string;
  internal: boolean;
  exports: Record<string, ExportTarget>;
}

function sourceFor(target: ExportTarget, mode: string): string {
  if (typeof target === 'string') return target;
  const source = target[mode] ?? target['default'];
  if (source === undefined) throw new Error(`no ${mode} or default condition in ${JSON.stringify(target)}`);
  return source;
}

// A package is a directory with a manifest, as npm workspaces define it; a
// design draft such as packages/react-gtk is not one yet.
const packages: Package[] = readdirSync(packagesDir).filter(dir => existsSync(join(packagesDir, dir, 'package.json'))).map(dir => {
  const manifest = JSON.parse(readFileSync(join(packagesDir, dir, 'package.json'), 'utf8'));
  return {
    dir,
    name: manifest.name,
    version: manifest.version ?? '0.0.0',
    internal: manifest.internal === true,
    exports: manifest.exports,
  };
});
// Published packages stay external bare specifiers; internal ones (shared,
// the reconciler) are bundled into every entry that uses them.
const published = packages.filter(p => !p.internal);
const external = published.flatMap(p => [p.name, `${p.name}/*`]);

// Upstream's forks: a module that resolves differently depending on the
// bundle it is in. Keyed by the entry (`<package>/<entry>`) and the module's
// path under packages/.
const forks: {entry: string; module: string; use: string}[] = [
  // Inside `react` itself the internals are the local object; everywhere
  // else they are read from the `react` package.
  {
    entry: 'react/index',
    module: 'react/src/ReactSharedInternals.ts',
    use: 'react/src/ReactSharedInternalsClient.ts',
  },
  // Each renderer entry bundles its own reconciler with its own host config
  // in place of the reconciler's ReactFiberConfig.ts contract.
  {
    entry: 'react-noop-renderer/index',
    module: 'react-reconciler/src/ReactFiberConfig.ts',
    use: 'react-noop-renderer/src/ReactFiberConfigNoopMutation.ts',
  },
  {
    entry: 'react-noop-renderer/persistent',
    module: 'react-reconciler/src/ReactFiberConfig.ts',
    use: 'react-noop-renderer/src/ReactFiberConfigNoopPersistent.ts',
  },
];

// The file a relative or package-qualified `.ts` specifier names, by the
// workspace packages' own `exports` patterns (the rule Node applies), or null
// for anything else.
function resolveSource(specifier: string, resolveDir: string): string | null {
  if (specifier.startsWith('.')) return resolve(resolveDir, specifier);
  for (const pkg of packages) {
    if (!specifier.startsWith(pkg.name + '/')) continue;
    const subpath = './' + specifier.slice(pkg.name.length + 1);
    for (const [pattern, target] of Object.entries(pkg.exports)) {
      if (typeof target !== 'string' || !pattern.endsWith('*')) continue;
      const prefix = pattern.slice(0, -1);
      if (subpath.startsWith(prefix)) {
        return join(packagesDir, pkg.dir, target.slice(0, -1) + subpath.slice(prefix.length));
      }
    }
  }
  return null;
}

function forkPlugin(entry: string): Plugin {
  const active = forks.filter(fork => fork.entry === entry);
  return {
    name: 'forks',
    setup(pluginBuild) {
      // A fork point may be imported relatively or by its package path.
      pluginBuild.onResolve({filter: /\.ts$/}, args => {
        const resolved = resolveSource(args.path, args.resolveDir);
        const fork = active.find(f => resolved === join(packagesDir, f.module));
        if (fork !== undefined) return {path: join(packagesDir, fork.use)};
        // A package path to a source file (`react/ReactHooks.ts`) is a module
        // of this bundle, never a published entry: published entries do not
        // end in `.ts`. Without this, `react/*` would be left external.
        if (resolved !== null && !args.path.startsWith('.')) return {path: resolved};
        return undefined;
      });
    },
  };
}

rmSync(out, {recursive: true, force: true});
for (const pkg of published) {
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    // Patterns (`./src/*`) expose sources to other packages; only exact
    // subpaths are published entries.
    if (subpath.includes('*')) continue;
    const entry = subpath === '.' ? 'index' : subpath.slice(2);
    for (const mode of modes) {
      await build({
        entryPoints: [join(packagesDir, pkg.dir, sourceFor(target, mode))],
        outfile: join(out, mode, pkg.name, `${entry}.js`),
        bundle: true,
        format: 'cjs',
        platform: 'node',
        target: 'es2022',
        external,
        plugins: [forkPlugin(`${pkg.name}/${entry}`)],
        // Fold `isDevelopment` to a literal and drop the dead branches.
        define: {'process.env.NODE_ENV': JSON.stringify(mode)},
        minifySyntax: true,
        logLevel: 'warning',
      });
    }
    const shim = join(out, pkg.name, `${entry}.js`);
    mkdirSync(dirname(shim), {recursive: true});
    writeFileSync(
      shim,
      `'use strict';\nmodule.exports = require(process.env.NODE_ENV === 'production'\n` +
        `  ? '../production/${pkg.name}/${entry}.js'\n  : '../development/${pkg.name}/${entry}.js');\n`,
    );
  }
}
// Each published package gets a manifest with its version, which React
// reports (`React.version`) and a test checks.
for (const pkg of published) {
  writeFileSync(
    join(out, pkg.name, 'package.json'),
    JSON.stringify({name: pkg.name, version: pkg.version, main: 'index.js'}, null, 2) + '\n',
  );
}

// When the build finished, for the harness to check that it is not
// measuring bundles older than the sources.
writeFileSync(join(out, '.built'), new Date().toISOString() + '\n');

// The bundles are CommonJS; the lane's own package.json says "module".
writeFileSync(join(out, 'package.json'), JSON.stringify({type: 'commonjs'}) + '\n');
console.log(`built ${published.map(p => p.name).join(', ')} into ${out}`);
