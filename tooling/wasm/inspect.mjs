// Deterministic artifact inventory; timings belong in the quiet M2 experiment.
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const [artifact] = process.argv.slice(2);
if (!artifact) throw new TypeError('usage: node tooling/wasm/inspect.mjs <artifact directory>');
const files = ['program.wasm', 'program.json', 'node.mjs'];
const bytes = await Promise.all(files.map(file => readFile(path.join(artifact, file))));
const module = await WebAssembly.compile(bytes[0], { builtins: ['js-string'] });
const manifest = JSON.parse(bytes[1]);
const sizes = files.map((name, at) => ({ name, raw: bytes[at].length, gzip: gzipSync(bytes[at], { level: 9 }).length }));
let debug = null;
try {
  const origins = await readFile(path.join(artifact, 'program.origins.json'));
  debug = { name: 'program.origins.json', raw: origins.length, gzip: gzipSync(origins, { level: 9 }).length };
} catch (error) { if (error.code !== 'ENOENT') throw error; }
console.log(JSON.stringify({ files: sizes,
  debug,
  total: { raw: sizes.reduce((n, f) => n + f.raw, 0), gzip: sizes.reduce((n, f) => n + f.gzip, 0) },
  functions: manifest.functions.length, structured: manifest.functions.filter(f => f.route === 'structured').length,
  dispatcher: manifest.functions.filter(f => f.route === 'dispatcher').length,
  functionRoutes: manifest.functions,
  imports: WebAssembly.Module.imports(module), exports: WebAssembly.Module.exports(module).length,
}, null, 2));
