import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact, source]=process.argv.slice(2);
const oracle=await import(pathToFileURL(source));
const {instantiate,WasmInputDecline}=await import(pathToFileURL(path.join(artifact, 'program.mjs')));
const wasm=instantiate();
let cases=0,named_declines=0;
function same(name,...args) {const expected=oracle[name](...args); if(expected===undefined) {assert.throws(()=>wasm[name](...args),e=>e instanceof WasmInputDecline); named_declines++;} else {const actual=wasm[name](...args); assert.ok(Object.is(actual,expected),`${name}: ${String(actual)} != ${String(expected)}`); cases++;}}
const endpoints=[NaN,Infinity,-Infinity,-0,0,1,-1,3,-3,4,-4,.9,-.9,1.5,-1.5,4294967296];
for(const from of endpoints) for(const to of endpoints) {
  same('sliceLength',from,to);
  const count=[1,2,3,4].slice(from,to).length;
  for(let at=0;at<=count;at++) {same('sliceAt',NaN,-0,from,to,at); same('sliceString','\ud800','😀',from,to,at);}
}
for(const [numbers,values] of [[true,[NaN,Infinity,-Infinity,-0,0,1,-1,.5,Number.MIN_VALUE,Number.MAX_VALUE]],[false,['','abc','\0','😀','\ud800','\udfff']]]) {
 for(const x of values) for(const y of values) for(const [numeric,string,count] of [['concatAt','concatString',4],['reverseAt','reverseString',5],['spreadAt','spreadString',6]]) {for(let at=0;at<=count;at++) same(numbers?numeric:string,x,y,at);}
}
same('reverseIdentity'); same('copyDistinct');
console.log(JSON.stringify({cases,named_declines}));
