import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const [artifact, source] = process.argv.slice(2);
const raw = new WebAssembly.Module(readFileSync(path.join(artifact, 'program.wasm')));
assert(!WebAssembly.Module.imports(raw).some(i => i.module === 'wasm:js-string' && i.name === 'length'),
  'proven string reads must not add a length builtin');
const {instantiate} = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')).href);
const wasm = instantiate();
const js = await import(pathToFileURL(path.resolve(source)).href);
const pool = [0,-0,1,-1,2,3,.5,-.5,1.5,-1.5,3.7,-3.7,7,27,100,255,256,1000,4096,65535,2147483647,-2147483648,2147483648,4294967295,9007199254740991,-9007199254740991,1e-8,12345,NaN];
let cases = 0;
for (const name of ['ascii', 'latin1', 'utf16']) for (const n of pool) {
  assert(Object.is(wasm[name](n), js[name](n)), `${name}(${n})`);
  cases++;
}
console.log(JSON.stringify({cases, lengthBuiltins: 0}));
