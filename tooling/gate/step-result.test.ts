import {spawnTest} from "./test-wait.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CaseBudgetError, PressureError, ToolingInstrumentError, publishHung, publishPressure, publishSelectorFailure, publishToolingFailure, readStepInstrument } from "./step-result.ts";
import { memoryDisposition, caseBudgetMessage } from "../census/worker-memory.ts";
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
