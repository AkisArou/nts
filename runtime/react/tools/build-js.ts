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

import {build} from 'esbuild';
import {mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const lane = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = join(lane, 'packages');
const out = join(lane, 'build/js');
const modes = ['development', 'production'];

interface Package {
  dir: string;
  name: string;
  exports: Record<string, string>;
}

const packages: Package[] = readdirSync(packagesDir).map(dir => {
  const manifest = JSON.parse(readFileSync(join(packagesDir, dir, 'package.json'), 'utf8'));
  return {dir, name: manifest.name, exports: manifest.exports};
});
const external = packages.flatMap(p => [p.name, `${p.name}/*`]);

rmSync(out, {recursive: true, force: true});
for (const pkg of packages) {
  for (const [subpath, source] of Object.entries(pkg.exports)) {
    const entry = subpath === '.' ? 'index' : subpath.slice(2);
    for (const mode of modes) {
      await build({
        entryPoints: [join(packagesDir, pkg.dir, source)],
        outfile: join(out, mode, pkg.name, `${entry}.js`),
        bundle: true,
        format: 'cjs',
        platform: 'node',
        target: 'es2022',
        external,
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
console.log(`built ${packages.map(p => p.name).join(', ')} into ${out}`);
