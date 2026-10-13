// Integers erased and read back: each answers its own value, at i31's and
// u32's edges, and the two param-fed functions match `x | 0` and `x & 1023`.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
const { instantiate } = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
const wasm = instantiate();
let cases = 0;
function same(actual, expected, what) { assert.ok(Object.is(actual, expected), `${what}: ${actual} != ${expected}`); cases++; }
const constants = { fitsHigh: 2 ** 30 - 1, fitsLow: -(2 ** 30), aboveI31: 2 ** 30, belowI31: -(2 ** 30) - 1,
  i32Min: -(2 ** 31), u32Small: 5, u32AboveI31: 2 ** 30, u32Max: 2 ** 32 - 1 };
for (const [name, expected] of Object.entries(constants)) same(wasm[name](), expected, name);
for (const x of [0, 1, -1, 1023, 1024, 2 ** 30 - 1, 2 ** 30, -(2 ** 30), -(2 ** 30) - 1, 2 ** 31 - 1, 2 ** 31]) {
  same(wasm.signed(x), x | 0, `signed(${x})`);
  same(wasm.masked(x), x & 1023, `masked(${x})`);
}
console.log(JSON.stringify({ cases }));
