import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
const { instantiate, WasmInputDecline } = await import(pathToFileURL(path.join(artifact, 'node.mjs')));
const wasm = await instantiate(await readFile(path.join(artifact, 'program.wasm')), JSON.parse(await readFile(path.join(artifact, 'program.json'), 'utf8')));
let cases = 0, named_declines = 0;
function same(actual, expected) { assert.ok(Object.is(actual, expected), `${String(actual)} != ${String(expected)}`); cases++; }
function declines(name, ...args) { assert.throws(() => wasm[name](...args), e => e instanceof WasmInputDecline && e.message.includes(name)); named_declines++; }
const numbers = [NaN, Infinity, -Infinity, -0, 0, 1, -1, .5, 2 ** 30, Number.MIN_VALUE, Number.MAX_VALUE];
for (let n = -32; n <= 32; n++) numbers.push(n);
for (const n of numbers) {
  const a = []; same(wasm.pushLength(n), a.push(n));
  const expected = a.pop(); same(wasm.number(n), expected); same(wasm.optionalNumber(n), expected); same(wasm.erasedPush(n), expected); same(wasm.emptyValue(n), 0);
  for (const len of [1,2,4,8]) for (let at = 0; at < len; at++) same(wasm.fillNumber(len,n,at), new Array(len).fill(n)[at]);
  for (let count = 0; count <= 4; count++) { const a = new Array(4).fill(n); a.length = count; a.push(17); same(wasm.truncateNumber(count,n), a.length); for(let at=0;at<a.length;at++) same(wasm.retainedNumber(count,n,17,at),a[at]); }
  for(let len=0;len<=16;len++) same(wasm.clearHoles(len,n),n);
}
for (const s of ['', 'abc', '😀', '\ud800', '\udfff', 'a\ud800b']) {
  for(let n=0;n<=16;n++) same(wasm.clearReferenceHoles(n,s),s);
  const a=[]; a.push(s); same(wasm.reference(s),a.pop());
  for (const len of [1,2,4,8]) for (let at=0;at<len;at++) same(wasm.fillReference(len,s,at),new Array(len).fill(s)[at]);
  for(let n=0;n<=4;n++) {const a=new Array(4).fill(s); a.length=n;a.push('new');same(wasm.truncateReference(n,s),a.length);for(let at=0;at<a.length;at++) same(wasm.retainedReference(n,s,'new',at),a[at]);}
}
for(const b of [false,true]) for(const len of [1,2,4,8]) for(let at=0;at<len;at++) same(wasm.fillBoolean(len,b,at),new Array(len).fill(b)[at]);
for(const b of [false,true]) for(let len=0;len<=4;len++) same(wasm.truncateBoolean(len,b),len);
for(let n=0;n<=1025;n++) same(wasm.referenceGrowth(n,'\ud800'),n);
for(let n=0;n<=32;n++) same(wasm.fillIdentity(n),true);
same(wasm.emptyReference(),0); same(wasm.nestedReference(),true);
for (const n of [-1,.5,NaN,Infinity,-Infinity,5,2**32]) {declines('truncateNumber',n,17);declines('truncateReference',n,'s');}
declines('fillNumber',0,17,0); declines('fillReference',0,'s',0); declines('fillBoolean',0,true,0);
declines('emptyNumber');
console.log(JSON.stringify({cases,named_declines,growth_lengths:1026,optional_number_and_reference_empty_checked:true}));
