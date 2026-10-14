// Cold start of emitted modules: compile and instantiate in a fresh process
// per sample, so no engine cache serves a later one, interleaved across builds
// of the same project. With bytes raw and gzip.
//
//   node benchmarks/wasm/startup.mjs <runs> <label>=<artifact> [...]
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [runs, ...builds] = process.argv.slice(2);
if (!runs || !builds.length) throw new TypeError('usage: startup.mjs <runs> <label>=<artifact>...');
const arms = builds.map(build => {
  const [label, artifact] = build.split('=');
  const bytes = readFileSync(path.join(artifact, 'program.wasm'));
  return { label, artifact, raw: bytes.length, gzip: gzipSync(bytes).length, samples: [] };
});
const probe = artifact => `
  const t0 = performance.now();
  const m = await import(${JSON.stringify(pathToFileURL(path.join(artifact, 'program.instance.mjs')).href)});
  m.instantiate();
  console.log(performance.now() - t0);`;
for (let r = 0; r < Number(runs); r++) {
  for (const arm of r % 2 ? [...arms].reverse() : arms) {
    const ran = spawnSync(process.execPath, ['--input-type=module', '-e', probe(arm.artifact)], { encoding: 'utf8' });
    if (ran.status !== 0) throw new Error(`${arm.label}: ${ran.stderr}`);
    arm.samples.push(Number(ran.stdout.trim()));
  }
}
const median = values => [...values].sort((a, b) => a - b)[values.length >> 1];
console.log(JSON.stringify(Object.fromEntries(arms.map(arm => [arm.label, {
  raw: arm.raw, gzip: arm.gzip, startMs: Number(median(arm.samples).toFixed(3)), minMs: Number(Math.min(...arm.samples).toFixed(3)),
}])), null, 2));
