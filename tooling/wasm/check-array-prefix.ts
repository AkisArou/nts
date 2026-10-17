import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [artifact, source] = process.argv.slice(2);
const {instantiate, WasmInputDecline} = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')).href);
const js = await import(pathToFileURL(path.resolve(source)).href);
const wasm = instantiate();
const pool = [0,-0,1,-1,2,3,.5,-.5,1.5,-1.5,3.7,-3.7,7,27,100,255,256,1000,4096,65535,2147483647,-2147483648,2147483648,4294967295,9007199254740991,-9007199254740991,1e-8,12345,NaN];
const positives = ['appended','aliased','grown','strings','references','filled','clearedThenAppended','overwritten','denseErasure','sequentialControl','nestedDenseErasure'];
let cases = 0, holes = 0, falseStops = 0;
for (const name of positives) for (const n of pool) {
  assert(Object.is(wasm[name](n),js[name](n)), `${name}(${n})`); cases++;
}
function floor(name: string, n: number) {
  assert.throws(()=>wasm[name](n), (error: unknown) => error instanceof WasmInputDecline && error.code === 'NTS5001' && error.reason === 'typed array holes: observed slot is not proven initialized', `${name}(${n})`);
}
for (const name of ['countWithoutWrite','overwrittenOtherSlot','helperNeedsDense','erasureNeedsDense','nestedErasureNeedsDense']) for (const n of pool) { floor(name,n); holes++; }
for (const n of pool) {
  if (n >= 0) { assert(Object.is(wasm.branchOnlyWrite(n),js.branchOnlyWrite(n))); cases++; }
  else { floor('branchOnlyWrite',n); holes++; }
}
for (const name of ['writtenPastPrefix','gapFilledOutOfOrder']) for (const n of pool) { assert(Object.is(js[name](n),n)); floor(name,n); falseStops++; }
const indices = [-Infinity,-1,-.5,-0,0,.5,1,2,NaN,Infinity,2147483648,4294967295];
let indexFloors = 0;
for (const n of indices) {
  if (n === 0) { assert.equal(wasm.indexed(n),js.indexed(n)); cases++; }
  else if (n === 1) { floor('indexed',n); holes++; }
  else {
    assert.throws(()=>wasm.indexed(n), (error: unknown) => error instanceof WasmInputDecline && error.code === 'NTS5001'); indexFloors++;
  }
}
console.log(JSON.stringify({cases,holes,falseStops,indexFloors,falseStopShapes:2}));
