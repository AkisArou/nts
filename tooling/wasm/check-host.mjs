import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
const url = pathToFileURL(path.join(artifact, 'program.mjs'));
const { instantiate, WasmInputDecline } = await import(url);
const wasm = instantiate();
let cases = 0;
for (const s of ['', '\0', 'abc', 'é世', '😀', '\ud800', '\udfff', 'a\ud800b']) {
  assert.equal(wasm.identity(s), s); cases++;
}
for (const value of [null, undefined, 1, false, {}, [], new String('x')]) {
  assert.throws(() => wasm.identity(value), error => error instanceof WasmInputDecline); cases++;
}
for (const value of [NaN, Infinity, -Infinity, -0, 0, 5, -5, 0.5]) {
  assert.ok(Object.is(wasm.remainder(value, 2), value % 2)); cases++;
}
console.log(JSON.stringify({ cases }));
