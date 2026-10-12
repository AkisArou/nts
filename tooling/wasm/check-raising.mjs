import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
// Importing program.mjs runs the initializer, as importing the TS module does;
// program.instance.mjs makes fresh instances.
const glue = pathToFileURL(path.join(artifact, 'program.mjs'));
const instances = pathToFileURL(path.join(artifact, 'program.instance.mjs'));
const manifest = JSON.parse(await readFile(path.join(artifact, 'program.wasm.json'), 'utf8'));
let cases = 0;
function caught(fn) { try { return { raised: false, value: fn() }; } catch (value) { return { raised: true, value }; } }
function throwsValue(fn, value) { const answer = caught(fn); assert.equal(answer.raised, true); assert.ok(Object.is(answer.value, value), `${String(answer.value)} != ${String(value)}`); cases++; }
if (manifest.init !== null) {
  // A module initializer's throw rejects the import with the thrown value.
  const result = await import(glue).then(() => ({ raised: false }), value => ({ raised: true, value }));
  assert.equal(result.raised, true); assert.equal(result.value, 'init payload');
  console.log(JSON.stringify({ cases: 1, init_throw: true }));
} else {
  const { instantiate, WasmInputDecline } = await import(instances);
  const wasm = instantiate();
  const other = instantiate();
  for (const prefix of ['raise', 'uncaught']) {
    for (const value of [NaN, Infinity, -Infinity, -0, 0, 1, -1, .5, 1073741823, 1073741824, -1073741824, -1073741825, Number.MIN_VALUE, Number.MAX_VALUE]) {
      throwsValue(() => wasm[`${prefix}Number`](value), value);
      assert.equal(wasm.pending(), 0); cases++;
    }
    for (const value of [false, true]) { throwsValue(() => wasm[`${prefix}Boolean`](value), value); assert.equal(wasm.pending(), 0); cases++; }
    for (const value of ['', 'abc', '\0', '😀', '\ud800', '\udfff', 'a\ud800b']) { throwsValue(() => wasm[`${prefix}String`](value), value); assert.equal(wasm.pending(), 0); cases++; }
    throwsValue(() => wasm[`${prefix}Undefined`](), undefined);
    throwsValue(() => wasm[`${prefix}Null`](), null);
  }
  for (let n = 0; n < 32; n++) { assert.equal(wasm.caughtObject(), true); assert.equal(wasm.pending(), 0); cases += 2; }
  assert.throws(() => wasm.uncaughtObject(), e => e instanceof WasmInputDecline && String(e).includes('uncaughtObject') && String(e).includes('identity bridge')); cases++;
  // A host entry returning with a raise pending throws it instead.
  for (const value of [5, -0, 0.5]) { throwsValue(() => wasm.leaky(value), value); assert.equal(wasm.pending(), 0); cases++; }
  // A refusal leaving wasm with a raise pending clears it first.
  assert.throws(() => wasm.refusal(23), e => e instanceof WasmInputDecline && String(e).includes('refusal')); cases++;
  const stale_state_cleared = wasm.pending() === 0; assert.ok(stale_state_cleared); cases++;
  assert.throws(() => wasm.raiseNumber('wrong'), e => e instanceof WasmInputDecline); cases++;
  assert.equal(wasm.pending(), 0); cases++;
  // Instances share no raising state.
  assert.throws(() => wasm.refusal(9), e => e instanceof WasmInputDecline);
  const instance_isolation = other.pending() === 0 && wasm.pending() === 0;
  assert.ok(instance_isolation); cases += 2;
  console.log(JSON.stringify({ cases, stale_state_cleared, instance_isolation }));
}
