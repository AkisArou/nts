import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
const { instantiate, WasmInputDecline } = await import(pathToFileURL(path.join(artifact, 'program.mjs')));
const wasm = instantiate();
let cases=0, named_declines=0;
function same(actual, expected) { assert.ok(Object.is(actual,expected),`${String(actual)} != ${String(expected)}`); cases++; }
function declined(fn) { assert.throws(fn,e=>e instanceof WasmInputDecline); named_declines++; }
for(const [suffix, values] of [['Number',[NaN,Infinity,-Infinity,-0,0,1,-1,.5,Number.MIN_VALUE,Number.MAX_VALUE]],['String',['','abc','\0','😀','\ud800','\udfff','a\ud800b']]]) {
  for(const x of values) for(const y of values) {
    if(suffix==='Number') {for(let at=0;at<4;at++) same(wasm.concatValueNumber(x,y,at),[x,y,x,y][at]); declined(()=>wasm.concatValueNumber(x,y,4));}
    for(const length of [false,true]) {
      for(const self of [false,true]) for(const helper of ['concat','extend']) {
        const expected=[x,y,x].concat(self?[x,y,x]:[y,x]);
        const name=`${helper}${suffix}${length}${self}`;
        if(length) same(wasm[name](x,y),expected.length);
        else for(let at=0;at<=expected.length;at++) {if(at===expected.length) declined(()=>wasm[name](x,y,at));else same(wasm[name](x,y,at),expected[at]);}
      }
    }
    for(const count of [0,1,2,5]) {
      const expected=[x,y,x,y,y].slice(0,count).reverse();
      same(wasm[`reverse${suffix}${count}true`](x,y,0),true);
      for(let at=0;at<=count;at++) {if(at===count) declined(()=>wasm[`reverse${suffix}${count}false`](x,y,at));else same(wasm[`reverse${suffix}${count}false`](x,y,at),expected[at]);}
    }
  }
  const endpoints=[NaN,Infinity,-Infinity,-0,0,1,-1,2,-2,3,-3,4,-4,.9,-.9,1.5,-1.5,4294967296,-4294967296];
  for(const x of values) for(const from of endpoints) for(const to of endpoints) {
    const y=values[(values.indexOf(x)+1)%values.length] ?? values[0];
    const expected=[x,y,x].slice(from,to);
    same(wasm[`slice${suffix}true`](x,y,from,to),expected.length);
    for(let at=0;at<=expected.length;at++) {if(at===expected.length) declined(()=>wasm[`slice${suffix}false`](x,y,from,to,at));else same(wasm[`slice${suffix}false`](x,y,from,to,at),expected[at]);}
  }
}
for(const helper of ['nts_array_slice','nts_array_concat']) same(wasm[`fresh_${helper}`](),true);
for(const helper of ['nts_array_slice_ref','nts_array_concat_ref','nts_array_extend_ref','nts_array_reverse_ref']) same(wasm[`nested_${helper}`](),true);
console.log(JSON.stringify({cases,named_declines}));
