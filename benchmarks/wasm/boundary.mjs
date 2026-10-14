// Boundary cost in both directions on emitted code, against node running the
// same TypeScript. Exploratory unless run in a quiet window: report the
// machine load beside the numbers.
//
//   nts emit-wasm benchmarks/wasm/boundary --out <artifact>
//   node --experimental-transform-types benchmarks/wasm/boundary.mjs <artifact>
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
function rawHost(name) {
  if (name.startsWith('nts_math_')) return Math[name.slice('nts_math_'.length)];
  if (name === 'inputDecline') return () => { throw new TypeError('input refusal'); };
  throw new Error(`no raw-arm value for host import ${name}`);
}
const host = Object.fromEntries(manifest.imports.filter(i => i.module === 'nts:host/v1')
  .map(i => [i.name, rawHost(i.name)]));
const raw = (await WebAssembly.instantiate(readFileSync(path.join(artifact, 'program.wasm')),
  { 'nts:host/v1': host }, { builtins: ['js-string'], importedStringConstants: "'" })).instance.exports;

const N = 2_000_000;
// Each arm gets its own function literal, so its call site is monomorphic,
// as a real caller's is: node may then inline the TS function, which is the
// bar a boundary crossing is measured against.
const bodies = {
  add: 'let s = 0; for (let i = 0; i < N; i++) s += f(i, 0.5); return s;',
  both: 'let s = 0; for (let i = 0; i < N; i++) s += f((i & 1) === 0, (i & 2) === 0) ? 1 : 0; return s;',
  join: "let s = 0; for (let i = 0; i < N / 4; i++) s += f('ab', (i & 1) ? 'x' : 'yz').length; return s;",
  nothing: 'for (let i = 0; i < N; i++) f(); return 0;',
  // wasm -> JS: one host import call per iteration inside the compiled loop.
  sines: 'return f(N);',
};
const calls = { add: N, both: N, join: N / 4, nothing: N, sines: N };
const arms = {};
for (const [name, body] of Object.entries(bodies)) {
  for (const [arm, f] of [['wasm (generated wrapper)', wasm[name]], ['wasm (raw export)', raw[name]], ['node (same TS)', node[name]]]) {
    const label = `${name} ${arm}`;
    // A distinct literal per arm: the comment makes the source unique.
    const loop = new Function('f', 'N', `/* ${label} */ ${body}`);
    arms[label] = { name, run: () => loop(f, N) };
  }
}
for (const name of Object.keys(bodies)) {
  const expected = arms[`${name} node (same TS)`].run();
  for (const arm of ['wasm (generated wrapper)', 'wasm (raw export)']) {
    const actual = arms[`${name} ${arm}`].run();
    if (!Object.is(actual, expected) && Math.abs(actual - expected) > 1e-9 * Math.abs(expected)) throw new Error(`${name} ${arm} disagrees: ${actual} != ${expected}`);
  }
}
for (const arm of Object.values(arms)) for (let w = 0; w < 4; w++) arm.run();
const samples = Object.fromEntries(Object.keys(arms).map(k => [k, []]));
const labels = Object.keys(arms);
for (let r = 0; r < Number(rounds); r++) {
  for (const label of r % 2 ? [...labels].reverse() : labels) {
    const start = process.hrtime.bigint();
    arms[label].run();
    samples[label].push(Number(process.hrtime.bigint() - start) / calls[arms[label].name]);
  }
}
const median = values => [...values].sort((a, b) => a - b)[values.length >> 1];
console.log(JSON.stringify({
  node: process.version, v8: process.versions.v8, load: loadavg(), rounds: Number(rounds),
  nsPerCall: Object.fromEntries(labels.map(l => [l, { median: median(samples[l]), min: Math.min(...samples[l]), max: Math.max(...samples[l]) }])),
}, null, 2));
