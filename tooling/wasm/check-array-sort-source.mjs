// The array-sort fixture against node running the same TypeScript.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact, source] = process.argv.slice(2);
const oracle = await import(pathToFileURL(source));
const { instantiate } = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
const wasm = instantiate();
let cases = 0;
function same(name, ...args) { const expected = oracle[name](...args); const actual = wasm[name](...args); assert.ok(Object.is(actual, expected), `${name}(${args}): ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); cases++; }
for (let n = 0; n <= 40; n++) for (const seed of [1, 7, 1000, 65000]) { same('sorted', n, seed); same('sortsInPlace', n, seed); }
for (const n of [0, 1]) same('withAbsent', n);
console.log(JSON.stringify({ cases }));
