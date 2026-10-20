// Array lengths whole by their value or their type (`arrays.rs`,
// `length_test`): allocated at that length with no test of it, while a
// constant or a signed integer that is not a length refuses by name.
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const [artifact] = process.argv.slice(2);
const {instantiate, WasmInputDecline} = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')).href);
const wasm = instantiate();
let allocated = 0, refused = 0;
function same(actual: unknown, expected: number, name: string) {
  assert(Object.is(actual, expected), `${name}: ${String(actual)} != ${expected}`);
  allocated++;
}
function refuses(name: string, ...args: number[]) {
  assert.throws(() => wasm[name](...args), (e: Error) => e instanceof WasmInputDecline && e.message.includes(name), name);
  refused++;
}
same(wasm.zero(), 0, 'zero');
same(wasm.three(), 3, 'three');
same(wasm.negativeZero(), 0, 'negativeZero');
for (let n = 0; n <= 64; n++) {
  same(wasm.signed(n), n, 'signed');
  same(wasm.unsigned(n), n, 'unsigned');
}
refuses('half');
refuses('negative');
refuses('roundedPast');
refuses('signed', -1);
refuses('signed', -2147483648);
console.log(JSON.stringify({allocated, refused}));
