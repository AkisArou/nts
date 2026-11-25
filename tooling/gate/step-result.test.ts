import {fixtureEnvironment} from "./test-environment.ts";
import {spawnTest} from "./test-wait.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join,resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CaseBudgetError, DiskBuildAdmissionError, INSTRUMENT_DISPOSITIONS, PressureError, ToolingInstrumentError, instrumentPolicy, publishHung, publishRunaway, publishPressure, publishSelectorFailure, publishToolingFailure, readStepInstrument } from "./step-result.ts";
import { memoryDisposition, caseBudgetMessage } from "../census/worker-memory.ts";
import { testScratch } from "./test-scratch.ts";
test("one exhaustive disposition table validates every kind and decides operator holds",t=>{
  const dir=testScratch(t,"step-result-policies"),path=join(dir,"result.json");
  for(const [kind,policy] of Object.entries(INSTRUMENT_DISPOSITIONS)){
    const instrument={version:1,kind,verdict:policy.verdict,step:"control",attempt:"one",reason:"observed result",
      ...(kind==='disk-capacity'?{disk:{kind:'shortfall',root:dir,target:join(dir,'target'),outputs:['nts-dev'],shortBytes:1,freeBytes:40*2**30,floorBytes:40*2**30,buildReservedBytes:1,temporaryReservedBytes:0}}:{})};
    writeFileSync(path,JSON.stringify(instrument));assert.equal(readStepInstrument(path,"control","one")?.kind,kind);
    assert.deepEqual(instrumentPolicy(kind),policy);
    for(const verdict of ["PASS","FAIL","NOT RUN","INSTRUMENT"].filter(value=>value!==policy.verdict)){
      writeFileSync(path,JSON.stringify({...instrument,verdict}));assert.throws(()=>readStepInstrument(path,"control","one"),/invalid instrument/);
    }
  }
  writeFileSync(path,JSON.stringify({version:1,kind:"unclassified",step:"control",attempt:"one",reason:"unknown"}));
  assert.throws(()=>readStepInstrument(path,"control","one"),/invalid instrument/);
});
test("the native checker rejects adding an instrument kind without its disposition",t=>{
  const root=fileURLToPath(new URL("../../",import.meta.url)),binary=resolve(root,process.env.NTS_BIN??"target/release/nts");
  assert.ok(existsSync(binary),`compiler missing: ${binary}; set NTS_BIN`);
  const dir=testScratch(t, "step-result-typed");
  const source=readFileSync(new URL("./step-result.ts",import.meta.url),"utf8");
  const protocol=readFileSync(new URL('../differential/command-entry/instrument.ts',import.meta.url),'utf8');
  const result=protocol.slice(protocol.indexOf('export type DiskBuildRefusal'),protocol.indexOf('/** A refusal'))+protocol.slice(protocol.indexOf('export type InstrumentResult'),protocol.indexOf('export class ToolingInstrumentError'));
  const policy=result+source.slice(source.indexOf('type Disposition'),source.indexOf("export function instrumentPolicy"));
  writeFileSync(join(dir,"tsconfig.json"),JSON.stringify({compilerOptions:{strict:true,target:"ES2022",module:"ESNext",moduleResolution:"bundler",types:[]},files:["main.ts"]}));
  const check=text=>{writeFileSync(join(dir,"main.ts"),text);return spawnTest(binary,["frontend",dir,"--checkers","1","--no-acquire"],{cwd:root,encoding:"utf8",env:fixtureEnvironment(t)});};
  const good=check(policy);assert.equal(good.status,0,good.stdout+good.stderr);
  const changed=policy.replace("kind:'memory-pressure'|","kind:'unclassified-control'|'memory-pressure'|");assert.notEqual(changed,policy);
  const bad=check(changed);assert.equal(bad.status,2,bad.stdout+bad.stderr);assert.match(bad.stdout+bad.stderr,/unclassified-control/);
});

test('a disk refusal carries the exact owner request and cannot be forged from its message',t=>{
  const directory=testScratch(t,'disk-result'),path=join(directory,'result.json');
  const env={NTS_GATE_STEP_RESULT:path,NTS_GATE_STEP:'tests',NTS_GATE_STEP_ATTEMPT:'one'};
  const disk={kind:'shortfall' as const,root:directory,target:join(directory,'target'),outputs:['nts-dev' as const],shortBytes:2**30,freeBytes:45*2**30,floorBytes:40*2**30,buildReservedBytes:6*2**30,temporaryReservedBytes:0};
  const error=new DiskBuildAdmissionError(disk);
  assert.equal(error.kind,'disk-capacity');assert.ok(error instanceof ToolingInstrumentError);
  publishToolingFailure(error,env);
  const row=readStepInstrument(path,'tests','one')!;
  assert.deepEqual(row.disk,disk);assert.deepEqual(instrumentPolicy(row.kind),{verdict:'INSTRUMENT',disposition:'operator-hold'});
  for(const value of [undefined,{...disk,shortBytes:1},{...disk,target:'relative'},{...disk,outputs:['debug']}]){
    writeFileSync(path,JSON.stringify({...row,disk:value}));assert.throws(()=>readStepInstrument(path,'tests','one'),/disk build refusal/);
  }
  writeFileSync(path,JSON.stringify({...row,kind:'tooling-setup'}));assert.throws(()=>readStepInstrument(path,'tests','one'),/unexpected disk refusal/);
});
test('main version-1 kind-less disk receipts normalize to an exact positive shortfall',t=>{
  const root=testScratch(t,'legacy-disk-result'),path=join(root,'result.json');
  const disk={root,target:join(root,'target'),outputs:['nts-dev'],shortBytes:2**30,freeBytes:45*2**30,floorBytes:40*2**30,buildReservedBytes:6*2**30,temporaryReservedBytes:0};
  const receipt={version:1,verdict:'INSTRUMENT',kind:'disk-capacity',step:'build',attempt:'main',reason:'main disk refusal',disk};
  writeFileSync(path,JSON.stringify(receipt));
  assert.deepEqual(readStepInstrument(path,'build','main')?.disk,{...disk,kind:'shortfall'});
  for(const bad of [{...disk,shortBytes:0,buildReservedBytes:5*2**30},{...disk,intent:{}},{...disk,bytes:0}]){
    writeFileSync(path,JSON.stringify({...receipt,disk:bad}));
    assert.throws(()=>readStepInstrument(path,'build','main'),/disk build refusal/);
  }
});
test('target fences have an identity, no byte figures, and cannot be mixed with shortfalls',t=>{
  const root=testScratch(t,'disk-fenced-result'),path=join(root,'result.json');
  const env={NTS_GATE_STEP_RESULT:path,NTS_GATE_STEP:'build',NTS_GATE_STEP_ATTEMPT:'fenced'};
  const disk={kind:'target-fenced' as const,root,target:join(root,'target'),outputs:['clippy' as const],
    intent:{token:'control-intent',root,pid:42,identity:'00000000-0000-0000-0000-000000000000 42 123'}};
  const error=new DiskBuildAdmissionError(disk);publishToolingFailure(error,env);
  const receipt=readStepInstrument(path,'build','fenced')!;
  assert.deepEqual(receipt.disk,disk);assert.match(receipt.reason,/target-fenced.*control-intent.*holder pid 42/);
  assert.equal('shortBytes' in receipt.disk!,false);
  const shortfall={kind:'shortfall',root,target:disk.target,outputs:disk.outputs,shortBytes:1,freeBytes:0,floorBytes:0,buildReservedBytes:1,temporaryReservedBytes:0};
  for(const mixed of [{...disk,bytes:0},{...disk,shortBytes:0},{...disk,freeBytes:0},{...disk,intent:{...disk.intent,token:''}},
    {...shortfall,shortBytes:0,buildReservedBytes:0},{...shortfall,intent:disk.intent}]){
    assert.throws(()=>publishToolingFailure(Object.assign(new ToolingInstrumentError('disk-capacity','control'),{disk:mixed}),env),/invalid disk build refusal/);
    writeFileSync(path,JSON.stringify({...receipt,disk:mixed}));assert.throws(()=>readStepInstrument(path,'build','fenced'),/invalid disk build refusal/);
  }
  assert.throws(()=>publishToolingFailure(Object.assign(new ToolingInstrumentError('disk-capacity','control'),{disk:{...disk,kind:'unknown-fence'}}),env),/unsupported disk build refusal variant.*unknown-fence/);
  writeFileSync(path,JSON.stringify({...receipt,disk:{...disk,kind:'unknown-fence'}}));
  assert.throws(()=>readStepInstrument(path,'build','fenced'),/unsupported disk build refusal variant.*unknown-fence/);
});
test("an aggregate kill is a budget verdict only when the case is exclusive", () => {
  assert.equal(memoryDisposition("aggregate-pressure", "exclusive"), "budget");
  assert.equal(memoryDisposition("aggregate-pressure", "parallel"), "pressure");
  for (const concurrency of ["exclusive", "parallel"] as const) {
    assert.equal(memoryDisposition("system-pressure", concurrency), "pressure");
    assert.equal(memoryDisposition("own-limit", concurrency), "budget");
    assert.equal(memoryDisposition(undefined, concurrency), undefined);
  }
  assert.equal(caseBudgetMessage("mandelbrot", 2 ** 30, "outcomes"), "mandelbrot exceeds the outcomes step's 1 GiB budget");
});
test("hung and broken tooling instruments cannot become ordinary assertion failures", t => {
  const directory = testScratch(t, "step-result-tooling");
  const path=join(directory,"result.json"),env={NTS_GATE_STEP_RESULT:path,NTS_GATE_STEP:"tooling",NTS_GATE_STEP_ATTEMPT:"one"};
  publishHung("silent test file; prior assertions retained",env);
  assert.equal(readStepInstrument(path,"tooling","one")?.verdict,"NOT RUN");
  publishRunaway("command used its CPU budget",env);
  assert.equal(readStepInstrument(path,"tooling","one")?.verdict,"NOT RUN");
  assert.equal(readStepInstrument(path,"tooling","one")?.kind,"runaway");
  for(const kind of ["tooling-setup","tooling-cleanup"] as const) {
    publishToolingFailure(new ToolingInstrumentError(kind,"no completed measurement"),env);
    const row=readStepInstrument(path,"tooling","one");assert.equal(row?.verdict,"INSTRUMENT");assert.equal(row?.kind,kind);
  }
  writeFileSync(path,JSON.stringify({version:1,verdict:"FAIL",kind:"hung",step:"tooling",attempt:"one",reason:"forged assertion verdict"}));
  assert.throws(()=>readStepInstrument(path,"tooling","one"),/invalid instrument/);
});
test("instrument records bind the step and attempt, and intermediate workers cannot publish", t => {
  const directory = testScratch(t, "step-result-run");
  const path = join(directory, "result.json"), env = { NTS_GATE_STEP_RESULT: path, NTS_GATE_STEP: "outcomes", NTS_GATE_STEP_ATTEMPT: "one" };
  publishPressure(new PressureError("aggregate pressure"), { ...env, NTS_CENSUS_POOL_WORKER: "1" });
  assert.equal(readStepInstrument(path, "outcomes", "one"), undefined);
  publishPressure(new Error("a real verdict"), env);
  assert.equal(readStepInstrument(path, "outcomes", "one"), undefined);
  publishPressure(new PressureError("system pressure"), env);
  assert.equal(readStepInstrument(path, "outcomes", "one")?.verdict, "INSTRUMENT");
  assert.throws(() => readStepInstrument(path, "outcomes", "two"), /invalid instrument/);
  assert.throws(() => readStepInstrument(path, "other", "one"), /invalid instrument/);
  publishPressure(new CaseBudgetError(caseBudgetMessage("mandelbrot", 2 ** 30, "outcomes")), env);
  assert.equal(readStepInstrument(path, "outcomes", "one")?.verdict, "FAIL");
  writeFileSync(path, "not json");
  assert.throws(() => readStepInstrument(path, "outcomes", "one"));
});

test("a selector infrastructure error is typed while a policy error stays an ordinary failure",t=>{
  const directory=testScratch(t,"step-result-selector");
  const path=join(directory,"result.json"),env={NTS_GATE_STEP_RESULT:path,NTS_GATE_STEP:"tooling",NTS_GATE_STEP_ATTEMPT:"one"};
  publishSelectorFailure(new Error("broken rule self-check"),env);assert.equal(readStepInstrument(path,"tooling","one"),undefined);
  const error=Object.assign(new Error("cargo metadata --no-deps --offline: missing toolchain"),{code:"NTS_SELECTION_INFRASTRUCTURE"});
  publishSelectorFailure(error,env);const result=readStepInstrument(path,"tooling","one")!;
  assert.equal(result.verdict,"INSTRUMENT");assert.equal(result.kind,"selector-setup");assert.match(result.reason,/cargo metadata/);
});


test("the real selector preload publishes its infrastructure error before the command exits",t=>{
  const directory=testScratch(t,"step-result-preload");
  const path=join(directory,"result.json");
  const result=spawnTest(process.execPath,["--import",new URL("./step-result.ts",import.meta.url).href,"--input-type=module","-e",`throw Object.assign(new Error('cargo metadata setup control'),{code:'NTS_SELECTION_INFRASTRUCTURE'});`],{encoding:"utf8",env:{...fixtureEnvironment(t),NTS_GATE_STEP_RESULT:path,NTS_GATE_STEP:"tooling",NTS_GATE_STEP_ATTEMPT:"preload"}});
  assert.notEqual(result.status,0);assert.match(result.stderr,/cargo metadata setup control/);
  assert.equal(readStepInstrument(path,"tooling","preload")?.kind,"selector-setup");
});


test("completed failures outrank liveness without converting missing measurements into failures",t=>{
  const directory=testScratch(t,"step-result-evidence");
  const path=join(directory,"result.json"),env={NTS_GATE_STEP_RESULT:path,NTS_GATE_STEP:"tooling",NTS_GATE_STEP_ATTEMPT:"one"};
  for(const publish of [publishHung,publishRunaway]){
    publish("unfinished control",env);
    let row=readStepInstrument(path,"tooling","one")!;
    assert.equal(row.verdict,"NOT RUN");assert.equal(instrumentPolicy(row.kind,row.completedFailures)?.disposition,"operator-hold");
    // A completed result can arrive while the aborted test stream drains.
    publish("unfinished control with a completed failure",env,1);
    row=readStepInstrument(path,"tooling","one")!;
    assert.equal(row.verdict,"FAIL");assert.equal(row.completedFailures,1);
    assert.deepEqual(instrumentPolicy(row.kind,row.completedFailures),{verdict:"FAIL",disposition:"verdict"});
    for(const count of [-1,0.5,"1",null]){
      const bad={...row,completedFailures:count};writeFileSync(path,JSON.stringify(bad));
      assert.throws(()=>readStepInstrument(path,"tooling","one"),/invalid instrument/);
      assert.equal(instrumentPolicy(bad.kind,bad.completedFailures),undefined);
    }
    for(const bad of [{...row,kind:"unknown"},{...row,completedFailures:0},{...row,verdict:"NOT RUN"}]){
      writeFileSync(path,JSON.stringify(bad));assert.throws(()=>readStepInstrument(path,"tooling","one"),/invalid instrument/);
      assert.notEqual(instrumentPolicy(bad.kind,bad.completedFailures)?.verdict,bad.verdict);
    }
  }
});
