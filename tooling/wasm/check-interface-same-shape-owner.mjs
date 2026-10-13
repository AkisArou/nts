// The interface-same-shape-owner fixture against node, over loop bounds small
// enough to run: every read through `Pair` must take the receiver's own order.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact, source] = process.argv.slice(2);
const oracle = await import(pathToFileURL(source));
const { instantiate } = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
const wasm = instantiate();
let cases = 0;
for (let n = 0; n <= 64; n++) {
  const expected = oracle.withAnotherOrder(n);
  const actual = wasm.withAnotherOrder(n);
  assert.ok(Object.is(actual, expected), `withAnotherOrder(${n}): ${actual} != ${expected}`);
  cases++;
}
console.log(JSON.stringify({ cases }));
