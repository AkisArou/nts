// Unchecked array accesses against their proofs (`arrays.rs`, "Proven"): a
// true proof reads back what was written, at an f64 index and an integer one;
// a false one, past the backing's storage, must trap -- never write there or
// read a value from somewhere else.
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const [artifact] = process.argv.slice(2);
const {instantiate} = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')).href);
const wasm = instantiate();
let proven = 0, falseProofTraps = 0;
for (const name of ['provenFloat', 'provenInteger']) {
  for (const v of [23, -0.5]) {
    assert(Object.is(wasm[name](v), v), `${name}(${v})`);
    proven++;
  }
}
for (const name of ['falseFloat', 'falseInteger']) {
  for (const v of [23, -0.5]) {
    assert.throws(() => wasm[name](v), WebAssembly.RuntimeError, name);
    falseProofTraps++;
  }
}
assert.equal(wasm.checkedFloat(23), 23);
console.log(JSON.stringify({proven, falseProofTraps}));
