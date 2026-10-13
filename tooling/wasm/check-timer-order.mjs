// The timer-order fixture against node: each export's promise, awaited on both
// sides, one case at a time so timers of one case never meet another's.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact, source] = process.argv.slice(2);
const oracle = await import(pathToFileURL(source));
const { instantiate } = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
const wasm = instantiate();
let cases = 0;
for (const name of Object.keys(oracle)) {
  for (const n of [0, 1, 5]) {
    const expected = await oracle[name](n);
    const actual = await wasm[name](n);
    assert.ok(Object.is(actual, expected), `${name}(${n}): ${actual} != ${expected}`);
    cases++;
  }
}
console.log(JSON.stringify({ cases }));
