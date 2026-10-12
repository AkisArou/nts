import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact, source] = process.argv.slice(2);
const oracle = await import(pathToFileURL(source));
const { instantiate } = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
const wasm = instantiate();
let cases = 0;
function same(actual, expected) { assert.ok(Object.is(actual, expected), `${String(actual)} != ${String(expected)}`); cases++; }
for (const x of [NaN, Infinity, -Infinity, -0, 0, 1, -1, .5, Number.MIN_VALUE, Number.MAX_VALUE]) {
  same(wasm.numericPop(x), oracle.numericPop(x));
  for(let n=0;n<=32;n++) same(wasm.clearHoles(n,x),oracle.clearHoles(n,x));
  for(let n=1;n<=32;n++) same(wasm.fillRoundtrip(n,x),oracle.fillRoundtrip(n,x));
  for(let n=0;n<=4;n++) same(wasm.trimAfterFill(n,x),oracle.trimAfterFill(n,x));
  for(let n=0;n<=6;n++) {
    same(wasm.shiftOrDefault(n,x),oracle.shiftOrDefault(n,x));
    if(n>0) same(wasm.shiftAsserted(n,x),oracle.shiftAsserted(n,x));
    for(let at=0;at<n;at++) same(wasm.shiftThenRead(n,x,at),oracle.shiftThenRead(n,x,at));
    for(let at=0;at<=n;at++) same(wasm.unshiftThenRead(n,x,at),oracle.unshiftThenRead(n,x,at));
  }
}
for(let n=0;n<=6;n++) for(let at=0;at<=n;at++) { same(wasm.shiftText(n,at),oracle.shiftText(n,at)); same(wasm.unshiftText(n,at),oracle.unshiftText(n,at)); }
console.log(JSON.stringify({cases}));
