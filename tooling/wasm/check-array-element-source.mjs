// The array-element fixture against node running the same TypeScript, at
// every kind of index; a null slot is refused by name rather than answered.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact, source] = process.argv.slice(2);
const oracle = await import(pathToFileURL(source));
const { instantiate, WasmInputDecline } = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
const wasm = instantiate();
let cases = 0, named_declines = 0;
function same(name, ...args) { const expected = oracle[name](...args); const actual = wasm[name](...args); assert.ok(Object.is(actual, expected), `${name}(${args.map(String)}): ${String(actual)} != ${String(expected)}`); cases++; }
const numbers = [NaN, -0, 0, 1, -1, 0.5, 2 ** 31, Number.MAX_VALUE];
const indices = [NaN, Infinity, -Infinity, -0, 0, 1, 2, 3, -1, 0.5, 1.5, 4294967295, 4294967296];
for (const at of indices) {
  for (const x of numbers) { same('defaultedAt', x, at); for (const y of numbers) same('numberAt', x, y, at); }
  for (const x of [false, true]) same('booleanAt', x, at);
  for (const x of ['', 'a', '\ud800']) for (const y of numbers) same('unknownAt', x, y, at);
  for (let kind = 0; kind < 8; kind++) same('openAt', kind, at);
  if (oracle.nullSlot(at) === 2) {
    assert.throws(() => wasm.nullSlot(at), e => e instanceof WasmInputDecline && e.message.includes('nullSlot'));
    named_declines++;
  } else same('nullSlot', at);
}
for (let kind = 0; kind <= 10; kind++) same('openLength', kind);
for (const n of numbers) same('knownLength', n);
console.log(JSON.stringify({ cases, named_declines }));
