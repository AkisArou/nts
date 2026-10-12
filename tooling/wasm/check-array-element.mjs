// Element reads through `nts_array_element` against what node answers for the
// same arrays: in range, past the end, a fraction, -0, NaN and the
// infinities. A read is compared by its typeof tag, and by value for numbers.
// A null reference slot is refused by name: its storage does not say whether
// it held `null` or `undefined`.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
const { instantiate, WasmInputDecline } = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
const wasm = instantiate();
let cases = 0, named_declines = 0;
function same(actual, expected, what) { assert.ok(Object.is(actual, expected), `${what}: ${String(actual)} != ${String(expected)}`); cases++; }
const tags = { undefined: 0, boolean: 1, number: 2, string: 3, object: 6 };
const indices = [0, -0, 1, 2, -1, 0.5, 1.5, NaN, Infinity, -Infinity, 4294967295];
const arrays = {
  stringElement: ['s', null],
  nestedElement: [[], null],
  numberElement: [10, 20],
  booleanElement: [true],
  erasedElement: ['s', undefined],
};
for (const [name, xs] of Object.entries(arrays)) {
  for (const at of indices) {
    if (Object.hasOwn(xs, at) && xs[at] === null) {
      assert.throws(() => wasm[name](at), e => e instanceof WasmInputDecline && e.message.includes(name));
      named_declines++;
    } else same(wasm[name](at), tags[typeof xs[at]], `${name}(${at})`);
  }
}
for (const at of [0, -0, 1]) same(wasm.numberValue(at), [10, 20][at], `numberValue(${at})`);
console.log(JSON.stringify({ cases, named_declines }));
