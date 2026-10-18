import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const [artifact, checkedArtifact] = process.argv.slice(2);
const {instantiate, WasmInputDecline} = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')).href);
const {instantiate: checkedInstance} = await import(pathToFileURL(path.join(checkedArtifact, 'program.instance.mjs')).href);
const unchecked = instantiate(), checked = checkedInstance();
const strings = ['', 'abc', '\0éÿ', 'Ā世', '😀x', 'x\ud800', '\udc00x'];
const indices = [-Infinity,-4294967296,-1.5,-1,-.5,-0,0,.5,1,1.5,2,3,5,NaN,Infinity,2147483648,4294967295,9007199254740991];
let units = 0, ranges = 0, badProofTraps = 0;
for (const text of strings) {
  for (let at = 0; at < text.length; at++) {
    assert.equal(unchecked.unit(text, at), text.charCodeAt(at)); units++;
  }
  // Deliberately false HIR proof: the raw builtin must fail loudly, never
  // return a backing default or a code unit from somewhere else.
  assert.throws(() => unchecked.unit(text, text.length), WebAssembly.RuntimeError);
  badProofTraps++;
  for (const at of indices) {
    assert(Object.is(checked.checked(text, at), text.charCodeAt(at)), `${JSON.stringify(text)}[${at}]`);
    ranges++;
  }
}
assert.throws(() => unchecked.nullUnit(), (e: unknown) =>
  e instanceof WasmInputDecline && e.code === 'NTS5001' && e.reason === 'a character of a null string');
console.log(JSON.stringify({units, ranges, badProofTraps, nullFloor: true}));
