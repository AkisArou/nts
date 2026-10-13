// The promise-boundary fixture against node: promises an export answers,
// settled at once or later, fulfilled or rejected.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact, source] = process.argv.slice(2);
const oracle = await import(pathToFileURL(source));
const { instantiate, WasmInputDecline } = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
const wasm = instantiate();
let cases = 0;
const outcome = promise => promise.then(value => ['fulfil', value], value => ['reject', value]);
for (const n of [-1, 0, 2.5]) {
  assert.deepEqual(await outcome(wasm.settledNow(n)), await outcome(oracle.settledNow(n))); cases++;
  assert.deepEqual(await outcome(wasm.rejectsWithText(n)), await outcome(oracle.rejectsWithText(n))); cases++;
}
// A promise still pending when its export returned settles in a later export.
for (const n of [1, 7]) {
  const wasmLater = wasm.later(n), nodeLater = oracle.later(n);
  let settled = false;
  wasmLater.then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'pending until settled'); cases++;
  assert.equal(wasm.settle(10), oracle.settle(10)); cases++;
  assert.deepEqual(await outcome(wasmLater), await outcome(nodeLater)); cases++;
}
assert.deepEqual(await outcome(wasm.rejectsWithError(-1)), ['fulfil', -1]); cases++;
const [kind, reason] = await outcome(wasm.rejectsWithError(1));
assert.equal(kind, 'reject');
assert.ok(reason instanceof WasmInputDecline && reason.message.includes('needs an identity bridge'), String(reason)); cases++;
console.log(JSON.stringify({ cases }));
