import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact, source] = process.argv.slice(2);
const oracle = await import(pathToFileURL(source));
const { instantiate } = await import(pathToFileURL(path.join(artifact, 'program.mjs')));
const wasm = instantiate();
let cases = 0, thrownCases = 0;
function answer(fn) { try { return [false, fn()]; } catch (value) { return [true, value]; } }
function same(name, ...args) {
  const actual = answer(() => wasm[name](...args)), expected = answer(() => oracle[name](...args));
  assert.equal(actual[0], expected[0], name);
  assert.ok(Object.is(actual[1], expected[1]), `${name}: ${String(actual[1])} != ${String(expected[1])}`);
  cases++; if (expected[0]) thrownCases++;
}
for (const x of [NaN, Infinity, -Infinity, -0, 0, 1, -1, .5, -.5, 1073741823, 1073741824, -1073741824, -1073741825, Number.MIN_VALUE, Number.MAX_VALUE]) {
  for (const name of ['throwNumber', 'caughtNumber', 'nestedFinally', 'overrideFinally', 'rethrow', 'closureCatch']) same(name, x);
  for (const child of [false, true]) same('classCatch', x, child);
}
for (const x of [false, true]) same('throwBoolean', x);
for (const x of ['', '\0', 'abc', '😀', '\ud800', '\udfff', 'a\ud800b']) {
  same('throwString', x); same('caughtString', x); same('closureStringCatch', x);
}
for (let n = 0; n < 16; n++) { same('throwNull'); same('throwUndefined'); same('caughtNumber', -n); }
console.log(JSON.stringify({ cases, thrownCases }));
