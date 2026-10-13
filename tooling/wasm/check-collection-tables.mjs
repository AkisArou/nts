// A collections fixture against node: every export over a range of
// inputs, compared with Object.is.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact, source] = process.argv.slice(2);
const oracle = await import(pathToFileURL(source));
const { instantiate } = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
const wasm = instantiate();
let cases = 0;
for (const [name, expected] of Object.entries(oracle)) {
  for (let n = -2; n < 10; n++) {
    const actual = wasm[name](n);
    assert.ok(Object.is(actual, expected(n)), `${name}(${n}): ${actual} != ${expected(n)}`);
    cases++;
  }
}
console.log(JSON.stringify({ cases }));
