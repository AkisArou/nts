import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
const { instantiate } = await import(pathToFileURL(path.join(artifact, 'node.mjs')));
const manifest = JSON.parse(await readFile(path.join(artifact, 'program.json'), 'utf8'));
const wasm = await instantiate(await readFile(path.join(artifact, 'program.wasm')), manifest);
let cases = 0;
function same(actual, expected) { assert.ok(Object.is(actual, expected), `${String(actual)} != ${String(expected)}`); cases++; }
const numbers = [NaN, Infinity, -Infinity, -0, 0, 1, -1, 0.5, -0.5, 2 ** 30 - 1, 2 ** 30, -(2 ** 30), -(2 ** 30) - 1,
  2 ** 31 - 1, 2 ** 31, -(2 ** 31), 2 ** 32 - 1, 2 ** 32, 2 ** 52 - 1, 2 ** 53, Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE];
for (let n = -20; n <= 20; n++) numbers.push(n);
for (const n of numbers) { same(wasm.number(n), n); same(wasm.numberTag(n), 2); }
for (const value of [false, true]) { same(wasm.boolean(value), value); same(wasm.booleanTag(value), 1); }
for (const s of ['', '\0', 'abc', 'é世', '😀', '\ud800', '\udfff', 'a\ud800b']) { same(wasm.string(s), s); same(wasm.stringTag(s), 3); }
same(wasm.nullTag(), 7); same(wasm.undefinedTag(), 0);
same(wasm.nullableNullTag(), 7); same(wasm.nullableUndefinedTag(), 0); same(wasm.defaultGlobalTag(), 0);
same(wasm.unboxedNullTag(), 7); same(wasm.unboxedUndefinedTag(), 0);
console.log(JSON.stringify({ cases }));
