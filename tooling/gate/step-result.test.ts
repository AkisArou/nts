import {spawnTest} from "./test-wait.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join,resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CaseBudgetError, INSTRUMENT_DISPOSITIONS, PressureError, ToolingInstrumentError, publishHung, publishRunaway, publishPressure, publishSelectorFailure, publishToolingFailure, readStepInstrument } from "./step-result.ts";
import {needsOperatorHold} from "../lanes/instrument-retry.ts";
import { memoryDisposition, caseBudgetMessage } from "../census/worker-memory.ts";
test("one exhaustive disposition table validates every kind and decides operator holds",t=>{
  const base=join(homedir(),".cache/nts-scratch/step-result");mkdirSync(base,{recursive:true});
  const dir=mkdtempSync(join(base,"policies-")),path=join(dir,"result.json");t.after(()=>rmSync(dir,{recursive:true,force:true}));
  for(const [kind,policy] of Object.entries(INSTRUMENT_DISPOSITIONS)){
    const instrument={version:1,kind,verdict:policy.verdict,step:"control",attempt:"one",reason:"observed result"};
    writeFileSync(path,JSON.stringify(instrument));assert.equal(readStepInstrument(path,"control","one")?.kind,kind);
    assert.equal(needsOperatorHold({name:"control",verdict:policy.verdict,instrument}),policy.disposition==="operator-hold");
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
  const base=join(homedir(),".cache/nts-scratch/step-result");mkdirSync(base,{recursive:true});
  const dir=mkdtempSync(join(base,"typed-"));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const source=readFileSync(new URL("./step-result.ts",import.meta.url),"utf8");
  const policy=source.slice(source.indexOf("export type InstrumentResult"),source.indexOf("export function instrumentPolicy"));
  writeFileSync(join(dir,"tsconfig.json"),JSON.stringify({compilerOptions:{strict:true,target:"ES2022",module:"ESNext",moduleResolution:"bundler",types:[]},files:["main.ts"]}));
  const check=text=>{writeFileSync(join(dir,"main.ts"),text);return spawnTest(binary,["frontend",dir,"--checkers","1","--no-acquire"],{cwd:root,encoding:"utf8",env:process.env});};
  const good=check(policy);assert.equal(good.status,0,good.stdout+good.stderr);
  const changed=policy.replace('"selector-setup"; step:','"selector-setup" | "unclassified-control"; step:');assert.notEqual(changed,policy);
  const bad=check(changed);assert.equal(bad.status,2,bad.stdout+bad.stderr);assert.match(bad.stdout+bad.stderr,/unclassified-control/);
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
  const root = join(homedir(), ".cache/nts-scratch/step-result"); mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, "tooling-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
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
  const root = join(homedir(), ".cache/nts-scratch/step-result"); mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, "run-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
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
  const directory=mkdtempSync(join(homedir(),".cache/nts-scratch/step-result/selector-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const path=join(directory,"result.json"),env={NTS_GATE_STEP_RESULT:path,NTS_GATE_STEP:"tooling",NTS_GATE_STEP_ATTEMPT:"one"};
  publishSelectorFailure(new Error("broken rule self-check"),env);assert.equal(readStepInstrument(path,"tooling","one"),undefined);
  const error=Object.assign(new Error("cargo metadata --no-deps --offline: missing toolchain"),{code:"NTS_SELECTION_INFRASTRUCTURE"});
  publishSelectorFailure(error,env);const result=readStepInstrument(path,"tooling","one")!;
  assert.equal(result.verdict,"INSTRUMENT");assert.equal(result.kind,"selector-setup");assert.match(result.reason,/cargo metadata/);
});


test("the real selector preload publishes its infrastructure error before the command exits",t=>{
  const directory=mkdtempSync(join(homedir(),".cache/nts-scratch/step-result/preload-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const path=join(directory,"result.json");
  const result=spawnTest(process.execPath,["--import",new URL("./step-result.ts",import.meta.url).href,"--input-type=module","-e",`throw Object.assign(new Error('cargo metadata setup control'),{code:'NTS_SELECTION_INFRASTRUCTURE'});`],{encoding:"utf8",env:{...process.env,NTS_GATE_STEP_RESULT:path,NTS_GATE_STEP:"tooling",NTS_GATE_STEP_ATTEMPT:"preload"}});
  assert.notEqual(result.status,0);assert.match(result.stderr,/cargo metadata setup control/);
  assert.equal(readStepInstrument(path,"tooling","preload")?.kind,"selector-setup");
});
