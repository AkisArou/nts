// The erased-integers fixture against node, at i31's and i32's edges.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact, source] = process.argv.slice(2);
const oracle = await import(pathToFileURL(source));
const { instantiate } = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
const wasm = instantiate();
let cases = 0;
function same(name, x) { const expected = oracle[name](x); const actual = wasm[name](x); assert.ok(Object.is(actual, expected), `${name}(${x}): ${actual} != ${expected}`); cases++; }
const edges = [0, 1, -1, 1023, 1024, 2 ** 30 - 1, 2 ** 30, 2 ** 30 + 1, -(2 ** 30), -(2 ** 30) - 1,
  2 ** 31 - 1, 2 ** 31, -(2 ** 31), 2 ** 32 - 1, 2 ** 32, 3 * 2 ** 30, NaN, Infinity, -0, 1.5, -1.5, 1e10];
for (const x of edges) for (const name of ['masked', 'signed', 'unsigned', 'sameAsDouble']) same(name, x);
console.log(JSON.stringify({ cases }));
