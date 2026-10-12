// Instrument controls use a fake host API; real emitted raising code is probed separately.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const checker=fileURLToPath(new URL('./check-corpus-example.mjs',import.meta.url));

// `glue` stands in for a generated program.mjs.
function probe(glue,source,exports=[]) {
  const dir=mkdtempSync(path.join(tmpdir(),'nts-wasm-census-control-'));
  try {
    writeFileSync(path.join(dir,'program.wasm'),new Uint8Array());
    writeFileSync(path.join(dir,'program.wasm.json'),JSON.stringify({exports,globals:[]}));
    writeFileSync(path.join(dir,'program.mjs'),`export class WasmInputDecline extends TypeError { code = 'NTS5001'; }\n${glue}`);
    const oracle=path.join(dir,'oracle.mjs');writeFileSync(oracle,source);
    const output=path.join(dir,'execution.json');
    const result=spawnSync(process.execPath,[checker,dir,oracle,output],{encoding:'utf8',timeout:10000});
    assert.equal(result.error,undefined);
    return {status:result.status,report:JSON.parse(readFileSync(output,'utf8'))};
  } finally { rmSync(dir,{recursive:true,force:true}); }
}
const exports=[{name:'throwsUndefined',params:[]},{name:'identity',params:[{ty:{kind:'string'}}]}];
const source='export function throwsUndefined(){throw undefined;} export function identity(value){return value;}';
test('the population executes strings and compares throw undefined explicitly',()=>{
  const out=probe('export function instantiate(){return {throwsUndefined(){throw undefined;},identity:value=>value};}',source,exports);
  assert.equal(out.status,0);assert.equal(out.report.cases,14);assert.equal(out.report.thrownCases,1);assert.deepEqual(out.report.wrong,[]);
});
test('returning undefined in place of throwing undefined fails the oracle',()=>{
  const out=probe('export function instantiate(){return {throwsUndefined(){return undefined;},identity:value=>value};}',source,exports);
  assert.equal(out.status,1);assert.equal(out.report.wrong.length,1);assert.equal(out.report.wrong[0].wasmKind,'return');assert.equal(out.report.wrong[0].jsKind,'throw');
});
test('matching primitive initialization throws are comparisons',()=>{
  const out=probe('throw undefined;','throw undefined;');
  assert.equal(out.status,0);assert.equal(out.report.cases,1);assert.equal(out.report.thrownCases,1);assert.equal(out.report.phase,'module-initialization');
});
test('an initialization input refusal remains a named decline',()=>{
  const out=probe('throw new WasmInputDecline("NTS5001: init boundary");','export const unused=1;');
  assert.equal(out.status,0);assert.match(out.report.moduleInitDecline,/init boundary/);assert.equal(out.report.cases,0);assert.deepEqual(out.report.wrong,[]);
});
