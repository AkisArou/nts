import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [artifact] = process.argv.slice(2);
const { instantiate } = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')).href);
const wasm = instantiate();
const other = instantiate();
const inputs = [undefined, null, false, true, -0, 0, -1, 0.5, NaN, Infinity, -Infinity,
  1073741823, 1073741824, -1073741824, -1073741825, '', 'payload', '\0', '\ud800', '\udfff', '😀'];
let calls = 0;
let objectPayloadCalls = 0;
let repeatedNestedCalls = 0;
const expected = {
  direct: { text: 'B', failed: 2, trace: 2 },
  flat: { text: 'A,B,C', failed: 12, trace: 123 },
  nested: { text: 'P,A,B,C,Q', failed: 412, trace: 41235 },
  cycle: { text: 'A,,B,C', failed: 12, trace: 123 },
};
for (const [name, result] of Object.entries(expected)) {
  for (const fail of [false, true]) {
    for (const payload of inputs) {
      assert.equal(wasm[name](payload, fail), result.text, `${name} fail=${fail}`);
      assert.equal(wasm.caught, fail, `${name}: original payload kept (SameValue or identity)`);
      if (fail) assert.ok(Object.is(wasm.caughtPayload(), payload), `${name}: original primitive, including NaN/-0`);
      assert.equal(wasm.firstTrace, fail ? result.failed : -1, `${name}: no later printer ran`);
      assert.equal(wasm.trace, result.trace, `${name}: retry of same objects and array`);
      calls++;
    }
    assert.equal(wasm[`${name}Object`](fail), result.text);
    assert.equal(wasm.caught, fail, `${name}: object payload identity`);
    assert.equal(wasm.firstTrace, fail ? result.failed : -1);
    assert.equal(wasm.trace, result.trace);
    objectPayloadCalls++;
  }
}
// More than the join stack's 64 slots: every call must pop all of its frames,
// while the recursive self-cycle shortcut must not pop a frame it did not push.
for (let at = 0; at < 80; at++) {
  assert.equal(wasm.nestedObject(true), expected.nested.text);
  assert.equal(wasm.firstTrace, expected.nested.failed);
  assert.equal(wasm.caught, true);
  repeatedNestedCalls++;
}
assert.equal(other.nested('other instance', false), expected.nested.text);
assert.equal(other.caught, false);
assert.equal(other.firstTrace, -1);
console.log(JSON.stringify({ calls, objectPayloadCalls, repeatedNestedCalls, instanceIsolation: true }));
