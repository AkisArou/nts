// A folded tag still evaluates the element read, including its hole check.
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const [artifact, source] = process.argv.slice(2);
const {instantiate, WasmInputDecline} = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')).href);
const js = await import(pathToFileURL(path.resolve(source)).href);
const wasm = instantiate();
const pool = [0,-0,1,-1,2,3,.5,-.5,1.5,-1.5,3.7,-3.7,7,27,100,255,256,1000,4096,65535,2147483647,-2147483648,2147483648,4294967295,9007199254740991,-9007199254740991,1e-8,12345,NaN];
let cases = 0, holes = 0;
for (const name of ['parameterControl','fieldControl','extractedControl']) for (const n of pool) {
  assert(Object.is(wasm[name](n),js[name](n)), `${name}(${n})`);
  cases++;
}
for (const name of ['parameterHole','fieldHole','extractedHole']) for (const n of pool) {
  assert.equal(js[name](n), 'undefined'.repeat(n > 0 ? 2 : 3));
  assert.throws(() => wasm[name](n), (error: unknown) => error instanceof WasmInputDecline && error.code === 'NTS5001' && error.reason === 'typed array holes: observed slot is not proven initialized', `${name}(${n})`);
  holes++;
}
console.log(JSON.stringify({cases,holes}));
