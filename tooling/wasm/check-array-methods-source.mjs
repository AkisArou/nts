import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact, source] = process.argv.slice(2);
const oracle = await import(pathToFileURL(source));
const { instantiate } = await import(pathToFileURL(path.join(artifact, 'node.mjs')));
const wasm = await instantiate(await readFile(path.join(artifact, 'program.wasm')), JSON.parse(await readFile(path.join(artifact, 'program.json'), 'utf8')));
let cases = 0;
function same(actual, expected) { assert.ok(Object.is(actual, expected), `${String(actual)} != ${String(expected)}`); cases++; }
for (const x of [NaN, Infinity, -Infinity, -0, 0, 1, -1, .5, Number.MIN_VALUE, Number.MAX_VALUE]) {
  same(wasm.numericPop(x), oracle.numericPop(x));
  for(let n=0;n<=32;n++) same(wasm.clearHoles(n,x),oracle.clearHoles(n,x));
  for(let n=1;n<=32;n++) same(wasm.fillRoundtrip(n,x),oracle.fillRoundtrip(n,x));
  for(let n=0;n<=4;n++) same(wasm.trimAfterFill(n,x),oracle.trimAfterFill(n,x));
}
console.log(JSON.stringify({cases}));
