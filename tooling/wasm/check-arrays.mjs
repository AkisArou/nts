import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
const { instantiate, WasmInputDecline } = await import(pathToFileURL(path.join(artifact, 'node.mjs')));
const manifest = JSON.parse(await readFile(path.join(artifact, 'program.json'), 'utf8'));
const wasm = await instantiate(await readFile(path.join(artifact, 'program.wasm')), manifest);
let cases = 0, named_declines = 0;
function same(actual, expected, name) { assert.ok(Object.is(actual, expected), `${name}: ${String(actual)} != ${String(expected)}`); cases++; }
function declines(name, ...args) { assert.throws(() => wasm[name](...args), e => e instanceof WasmInputDecline && e.message.includes(name)); named_declines++; }
const numbers = [NaN, Infinity, -Infinity, -0, 0, 1, -1, 0.5, 2 ** 30, Number.MIN_VALUE, Number.MAX_VALUE];
for (let n = -20; n <= 20; n++) numbers.push(n);
for (const n of numbers) {
  for (const at of [0, 1]) { same(wasm.f64(n, at), n, 'f64'); same(wasm.f32(Math.fround(n), at), Math.fround(n), 'f32'); }
  same(wasm.append(0, n), n, 'append'); same(wasm.append(-0, n), n, 'append -0'); same(wasm.nested(n), n, 'nested');
}
for (let n = -128; n <= 127; n++) same(wasm.i8(n, 1), n, 'packed signed8');
for (const [name, values] of Object.entries({u16: [0, 1, 255, 256, 32767, 32768, 65535], i32: [-2147483648, -1, 0, 2147483647], u32: [0, 2147483648, 4294967295], i64: [-Number.MAX_SAFE_INTEGER, -1, 0, Number.MAX_SAFE_INTEGER], u64: [0, 2 ** 32, Number.MAX_SAFE_INTEGER]})) for (const n of values) for (const at of [0, 1]) same(wasm[name](n, at), n, name);
for (const b of [false, true]) for (const at of [0, 1]) same(wasm.boolean(b, at), b, 'boolean');
for (const s of ['', 'abc', '😀', '\ud800', '\udfff', 'a\ud800b']) for (const at of [0, 1]) same(wasm.string(s, at), s, 'string');
for (let n = 0; n <= 1025; n++) same(wasm.grow(n), n * (n + 1) / 2 + 1, `growth aliases ${n}`);
for (let n = 0; n <= 64; n++) { same(wasm.length(n), n, 'length'); same(wasm.length64(n), n, 'length64'); same(wasm.lengthU64(n), n, 'lengthU64'); }
const bad = [-1, -0.5, 0.5, 1.5, NaN, Infinity, -Infinity, 2, 3, 2 ** 32, Number.MAX_VALUE];
for (const at of bad) {
  for (const name of ['i8', 'u16', 'i32', 'u32', 'f32', 'f64']) declines(name, 1, at);
  declines('string', 'a', at); declines('boolean', true, at);
  declines('append', at, 13);
}
for (const n of [-1, -0.5, 0.5, NaN, Infinity, -Infinity, 2 ** 32, Number.MAX_VALUE]) declines('length', n);
for (const n of [-1, 2 ** 32, Number.MAX_SAFE_INTEGER]) declines('length64', n);
for (const n of [2 ** 32, Number.MAX_SAFE_INTEGER]) declines('lengthU64', n);
for (const [name, indices] of [['integerIndex', [-2147483648, -1, 0, 1, 2, 2147483647]], ['longIndex', [-Number.MAX_SAFE_INTEGER, -1, 0, 1, 2, 2 ** 32, Number.MAX_SAFE_INTEGER]], ['unsignedLongIndex', [0, 1, 2, 2 ** 32, Number.MAX_SAFE_INTEGER]]]) for (const at of indices) {
  if (at === 0 || at === 1 || at === 0n || at === 1n) same(wasm[name](23, at), 23, name); else declines(name, 23, at);
}
for (const at of [0, 1, 2, ...bad]) {
  same(wasm.defaultErased(at), 0, 'undefined backing initialization');
  for (const [name, input, tag] of [['erasedNumber', -0, 2], ['erasedBoolean', false, 1], ['erasedString', '\ud800', 3]]) same(wasm[name](input, at), at === 1 ? tag : at === 2 ? 7 : 0, `${name} missing value`);
}
for (const name of ['wideMin', 'wideMax', 'wideUnsignedMax']) same(wasm[name](), true, name);
declines('referenceAppend', 'a'); declines('nullArray'); declines('wrongArray');
console.log(JSON.stringify({cases, named_declines, growth_alias_lengths: 1026, sparse_writes_declined: true, erased_missing_is_undefined: true}));
