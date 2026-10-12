// Boundary cost in both directions on emitted code, against node running the
// same TypeScript. Exploratory unless run in a quiet window: report the
// machine load beside the numbers.
//
//   nts emit-wasm tooling/wasm/bench/boundary --out <artifact>
//   node --experimental-transform-types tooling/wasm/bench/boundary.mjs <artifact>
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const [artifact, rounds = '9'] = process.argv.slice(2);
if (!artifact) throw new TypeError('usage: boundary.mjs <artifact directory> [rounds]');
const wasm = await import(pathToFileURL(path.join(artifact, 'program.mjs')));
const node = await import(new URL('./boundary/src/main.ts', import.meta.url));
// The raw arm instantiates the same bytes with no wrapper, as a floor.
const manifest = JSON.parse(readFileSync(path.join(artifact, 'program.wasm.json'), 'utf8'));
const host = Object.fromEntries(manifest.imports.filter(i => i.module === 'nts:host/v1')
  .map(i => [i.name, Math[i.name.replace('nts_math_', '')]]));
const raw = (await WebAssembly.instantiate(readFileSync(path.join(artifact, 'program.wasm')),
  { 'nts:host/v1': host }, { builtins: ['js-string'], importedStringConstants: "'" })).instance.exports;

const N = 2_000_000;
const loops = {
  add: f => { let s = 0; for (let i = 0; i < N; i++) s += f(i, 0.5); return s; },
  both: f => { let s = 0; for (let i = 0; i < N; i++) s += f((i & 1) === 0, (i & 2) === 0) ? 1 : 0; return s; },
  join: f => { let s = 0; for (let i = 0; i < N / 4; i++) s += f('ab', (i & 1) ? 'x' : 'yz').length; return s; },
  nothing: f => { for (let i = 0; i < N; i++) f(); return 0; },
  // wasm -> JS: one host import call per iteration inside the compiled loop.
  sines: f => f(N),
};
const calls = { add: N, both: N, join: N / 4, nothing: N, sines: N };
const arms = {};
for (const name of Object.keys(loops)) {
  arms[`${name} wasm (generated wrapper)`] = [name, wasm[name]];
  arms[`${name} wasm (raw export)`] = [name, raw[name]];
  arms[`${name} node (same TS)`] = [name, node[name]];
}
for (const [label, [name, f]] of Object.entries(arms)) {
  const expected = loops[name](node[name]);
  const actual = loops[name](f);
  if (!Object.is(actual, expected) && Math.abs(actual - expected) > 1e-9 * Math.abs(expected)) throw new Error(`${label} disagrees: ${actual} != ${expected}`);
}
for (const [, [name, f]] of Object.entries(arms)) for (let w = 0; w < 4; w++) loops[name](f);
const samples = Object.fromEntries(Object.keys(arms).map(k => [k, []]));
const labels = Object.keys(arms);
for (let r = 0; r < Number(rounds); r++) {
  for (const label of r % 2 ? [...labels].reverse() : labels) {
    const [name, f] = arms[label];
    const start = process.hrtime.bigint();
    loops[name](f);
    samples[label].push(Number(process.hrtime.bigint() - start) / calls[name]);
  }
}
const median = values => [...values].sort((a, b) => a - b)[values.length >> 1];
console.log(JSON.stringify({
  node: process.version, v8: process.versions.v8, load: loadavg(), rounds: Number(rounds),
  nsPerCall: Object.fromEntries(labels.map(l => [l, { median: median(samples[l]), min: Math.min(...samples[l]), max: Math.max(...samples[l]) }])),
}, null, 2));
