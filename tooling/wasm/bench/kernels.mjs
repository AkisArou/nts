// Kernel timing on emitted code against node running the same TypeScript.
// Each export of the project's src/main.ts takes an iteration count and
// returns a number, and every arm must agree with node on it before anything
// is timed. One call per sample, so the boundary is amortized away: this
// measures the code inside the loop. Several artifacts (one per compiler
// build) run interleaved in one process, so a comparison between builds is
// paired. Exploratory unless run in a quiet window: the machine load is
// reported beside the numbers.
//
//   nts emit-wasm <project> --out <artifact>
//   node --experimental-transform-types tooling/wasm/bench/kernels.mjs \
//     <project> <n> <rounds> <label>=<artifact> [<label>=<artifact> ...]
import { loadavg } from 'node:os';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [project, n, rounds, ...builds] = process.argv.slice(2);
if (!project || !builds.length) {
  throw new TypeError('usage: kernels.mjs <project> <n> <rounds> <label>=<artifact>...');
}
const N = Number(n);
const node = await import(pathToFileURL(path.resolve(project, 'src/main.ts')));
const names = Object.keys(node).filter(name => typeof node[name] === 'function');
const sources = [['node', node]];
for (const build of builds) {
  const [label, artifact] = build.split('=');
  sources.push([label, await import(pathToFileURL(path.join(artifact, 'program.mjs')))]);
}
const arms = [];
for (const name of names) {
  const expected = node[name](N);
  for (const [label, module] of sources) {
    const actual = module[name](N);
    if (!Object.is(actual, expected)) throw new Error(`${name} ${label} disagrees: ${actual}, node ${expected}`);
    arms.push({ label: `${name} ${label}`, f: module[name] });
  }
}
for (const arm of arms) for (let w = 0; w < 3; w++) arm.f(N);
const samples = Object.fromEntries(arms.map(arm => [arm.label, []]));
for (let r = 0; r < Number(rounds); r++) {
  for (const arm of r % 2 ? [...arms].reverse() : arms) {
    const start = process.hrtime.bigint();
    arm.f(N);
    samples[arm.label].push(Number(process.hrtime.bigint() - start) / N);
  }
}
const summary = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[sorted.length >> 1], min: sorted[0], max: sorted[sorted.length - 1] };
};
console.log(JSON.stringify({
  load: loadavg(),
  n: N,
  nsPerIteration: Object.fromEntries(Object.entries(samples).map(([label, values]) => [label, summary(values)])),
}, null, 2));
