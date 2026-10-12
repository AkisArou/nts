import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact,source]=process.argv.slice(2);
const oracle=await import(pathToFileURL(source));
const {instantiate,WasmInputDecline}=await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
const wasm=instantiate();
let cases=0,named_declines=0;
function same(name,...args) { const expected=oracle[name](...args); const actual=wasm[name](...args); assert.ok(Object.is(actual,expected),`${name}: ${String(actual)} != ${String(expected)}`); cases++; }
const numbers=[NaN,Infinity,-Infinity,-0,0,1,-1,.5,Number.MIN_VALUE,Number.MAX_VALUE];
const strings=['','a','b','\0','😀','\ud800','\udfff','a\ud800b'];
const indices=[NaN,Infinity,-Infinity,-0,0,1,-1,2,-2,3,-3,4,-4,.9,-.9,1.5,-1.5,4294967296,-4294967296];
for(const x of numbers) for(const y of numbers) {
  for(const z of numbers) for(const name of ['includesNumber','indexNumber','lastNumber']) same(name,x,y,z);
  for(const at of indices) for(const name of ['optionalNumber','atNumber']) same(name,x,y,at);
}
for(const x of strings) for(const y of strings) {
  for(const z of strings) for(const name of ['includesString','indexString','unknownString']) same(name,x,y,z);
  for(const z of numbers) same('unknownNumber',x,y,z);
  for(const z of [false,true]) same('unknownBoolean',x,y,z);
  for(const at of indices) { if([x,y,x].at(at)===undefined) {assert.throws(()=>wasm.atString(x,y,at),e=>e instanceof WasmInputDecline);named_declines++;} else same('atString',x,y,at); }
}
same('identityHit'); same('identityMiss');
console.log(JSON.stringify({cases,named_declines}));
