import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact]=process.argv.slice(2);
const { instantiate,WasmInputDecline }=await import(pathToFileURL(path.join(artifact,'node.mjs')));
const wasm=await instantiate(await readFile(path.join(artifact,'program.wasm')),JSON.parse(await readFile(path.join(artifact,'program.json'),'utf8')));
let cases=0,named_declines=0;
function same(actual,expected) { assert.ok(Object.is(actual,expected),`${String(actual)} != ${String(expected)}`); cases++; }
function decline(fn) { assert.throws(fn,e=>e instanceof WasmInputDecline); named_declines++; }
const numbers=[NaN,Infinity,-Infinity,-0,0,1,-1,.5,Number.MIN_VALUE,Number.MAX_VALUE];
const strings=['','a','b','\0','😀','\ud800','\udfff','a\ud800b'];
const indices=[NaN,Infinity,-Infinity,-0,0,1,-1,2,-2,3,-3,4,-4,.9,-.9,1.5,-1.5,4294967296,-4294967296];
for(const count of [0,1,3]) for(const [suffix,values,methods] of [
    ['Number',numbers,[['nts_array_index_of','indexOf'],['nts_array_includes','includes'],['nts_array_last_index_of','lastIndexOf']]],
    ['String',strings,[['nts_array_index_of_str','indexOf'],['nts_array_includes_str','includes']]],
]) {
  for(const x of values) for(const y of values) {
    const array=[x,y,x].slice(0,count);
    for(const needle of values) for(const [helper,method] of methods) same(wasm[`${helper}${suffix}${count}`](x,y,needle),array[method](needle));
    for(const at of indices) {
      const expected=array.at(at);
      if(expected===undefined) decline(()=>wasm[`at${suffix}${count}`](x,y,at)); else same(wasm[`at${suffix}${count}`](x,y,at),expected);
      if(suffix==='Number') {
        same(wasm[`atValuetrue${count}`](x,y,at),expected===undefined?0:2);
        if(expected===undefined) decline(()=>wasm[`atValuefalse${count}`](x,y,at));
        else same(wasm[`atValuefalse${count}`](x,y,at),expected);
      }
    }
  }
}
for(const count of [0,1,3]) for(const x of strings) for(const y of strings) {
    const array=[x,y,x].slice(0,count);
    for(const [suffix,values] of [['String',strings],['Number',numbers],['Boolean',[true,false]]]) for(const needle of values) for(const [helper,method] of [['nts_array_index_of_str_value','indexOf'],['nts_array_includes_str_value','includes']]) same(wasm[`${helper}${suffix}${count}`](x,y,needle),array[method](needle));
}
for(const [helper,method] of [['nts_array_index_of_ref','indexOf'],['nts_array_includes_ref','includes']]) for(const hit of [false,true]) {const a=[],b=[],array=[a,b,a];same(wasm[`identity_${helper}_${hit}`](),array[method](hit?a:[]));}
for(const at of indices) {const a=[],b=[],array=[a,b,a];if(array.at(at)===undefined) decline(()=>wasm.atIdentity(at));else same(wasm.atIdentity(at),array.at(at)===a);}
for(const [helper,method] of [['nts_array_index_of_str_value','indexOf'],['nts_array_includes_str_value','includes']]) for(const null_ of [false,true]) {
    same(wasm[`absent_${helper}_${null_}_false`](),['a'][method](null_?null:undefined));
    decline(()=>wasm[`absent_${helper}_${null_}_true`]());
}
console.log(JSON.stringify({cases,named_declines}));
