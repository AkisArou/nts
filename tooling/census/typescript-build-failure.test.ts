import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnTest } from "../gate/test-wait.ts";
import { compareTypeScriptObservation, observationFromRow, parseTypeScriptRecord, serializeTypeScriptRecord } from "./typescript-record.ts";

for (const [stage, raw] of [
  ["emit", { bucket: "unsupported", why: "emit", first: "display only", buildDiagnostic: "/first/run/program.ll:12:3: error: invalid operand 42" }],
  ["link", { bucket: "unsupported", why: "link", first: "display only", buildDiagnostic: "/first/run/program.c:12:3: error: invalid operand 42" }],
  ["compiler-crash", { bucket: "crash", why: "emit", first: "SIGABRT", buildDiagnostic: "thread 'main' (42) panicked at /first/compiler/lower.rs:12:3: invalid operand" }],
] as const) test(`${stage} is a stable recorded defect`, () => {
  const observation = observationFromRow(raw);
  assert.equal(observation.kind, "build-failure");
  assert.equal(Reflect.get(observation, "stage"), stage);
  const moved = observationFromRow({ ...raw, first: raw.first.replace("/first/run/", "/another/run/").replace("12:3", "98:7").replace("42", "51"),
    buildDiagnostic: raw.buildDiagnostic.replace("/first/", "/another/").replace("42", "51").replace("12:3", "98:7") });
  assert.deepEqual(moved, observation, "scratch paths and generated numbers are not defect identity");
  const record = { metadata: { version: 3 as const, backend: "c" as const, commit: "a".repeat(40), compiler: "b".repeat(16),
    harness: "c".repeat(16), under: "tests/typescript" }, cases: new Map([["tests/typescript/build-failure/subject.ts", observation]]) };
  assert.deepEqual(parseTypeScriptRecord(serializeTypeScriptRecord(record)), record);
  assert.equal(compareTypeScriptObservation(observation, moved).word, "reproduces");
  const pass = observationFromRow({ bucket: "strict-pass" });
  assert.equal(compareTypeScriptObservation(observation, pass).word, "FIXED");
  assert.equal(compareTypeScriptObservation(pass, observation).word, "REGRESSED");
  const changed = observationFromRow({ ...raw, first: "error: different defect", ...("buildDiagnostic" in raw ? { buildDiagnostic: "fatal: different compiler defect" } : {}) });
  assert.equal(compareTypeScriptObservation(observation, changed).word, "CHANGED");
});

test("resource stops and failed instruments remain unrecordable", () => {
  for (const row of [
    { bucket: "timeout", why: "emit" }, { bucket: "memory-cap", why: "emit resident scope" },
    { bucket: "infrastructure-error", why: "the toolchain did not survive the link" },
    { bucket: "unsupported", why: "harness", first: "error: fake failure" },
    { bucket: "unsupported", why: "link", first: "" },
    { bucket: "unsupported", why: "emit", first: "redacted display without raw diagnostic" },
  ]) assert.throws(() => observationFromRow(row));
});

test("existing pass records keep their bytes and observation", () => {
  const contents = '# nts-typescript-outcomes {"version":3,"backend":"c","commit":"' + "a".repeat(40) +
    '","compiler":"' + "b".repeat(16) + '","harness":"' + "c".repeat(16) + '","under":"tests/typescript"}\n' +
    'tests/typescript/build-failure/control.ts\t{"kind":"pass"}\n';
  assert.equal(serializeTypeScriptRecord(parseTypeScriptRecord(contents)), contents);
});

test("the attempt retains the diagnostic and keeps toolchain loss separate", t => {
  const base = join(homedir(), ".cache/nts/build-failure-tests"); mkdirSync(base, { recursive: true });
  const scratch = mkdtempSync(join(base, "run-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const helper = join(scratch, "producer.mjs");
  writeFileSync(helper, `
import {mock} from 'node:test';
import {workspace} from ${JSON.stringify(new URL("./project.ts", import.meta.url).href)};
import {observationFromRow} from ${JSON.stringify(new URL("./typescript-record.ts", import.meta.url).href)};
const child=await import('node:child_process');
let emitted,linkError;
mock.module('node:child_process',{namedExports:{...child,execFileSync(){throw linkError;}}});
mock.module(${JSON.stringify(new URL("./worker-memory.ts", import.meta.url).href)},{namedExports:{compileSync(){return emitted;}}});
const {attempt}=await import(${JSON.stringify(new URL("./attempt262.ts", import.meta.url).href)});
const dir=workspace(${JSON.stringify(join(scratch, "project"))},'ts');
const tools={nts:'controlled-compiler',cc:'controlled-linker',fresh:true,language:'ts'};
const run=()=>attempt(dir,'const value:number=1;',tools);
const result=[];
for(const [status,stderr] of [[1,'/controlled/program.ll:12:3: error: invalid operand 42'],[101,"thread 'main' (42) panicked at /controlled/lower.rs:12:3: broken route"]]){
 emitted={status,signal:null,stdout:'',stderr};const raw=run();
 result.push({raw,observation:observationFromRow(raw)});
}
emitted={status:0,signal:null,stdout:'cc program.c -o program',stderr:''};
linkError=Object.assign(new Error('link failed'),{status:1,signal:null,stdout:'',stderr:'/controlled/program.c:12:3: error: invalid operand 42'});
const link=run();result.push({raw:link,observation:observationFromRow(link)});
linkError=Object.assign(new Error('link tool died'),{status:1,signal:null,stdout:'',stderr:'the toolchain was Killed'});
const lost=run();let rejected=false;try{observationFromRow(lost);}catch{rejected=true;}
result.push({raw:lost,rejected});
linkError=Object.assign(new Error('silent link tool death'),{status:null,signal:'SIGSEGV',stdout:'',stderr:''});
const killed=run();rejected=false;try{observationFromRow(killed);}catch{rejected=true;}
result.push({raw:killed,rejected});
emitted={status:1,signal:null,stdout:'',stderr:''};
result.push({silent:observationFromRow(run())});
emitted={status:0,signal:null,stdout:'cc program.c -o program',stderr:''};
linkError=Object.assign(new Error('silent link failure'),{status:1,signal:null,stdout:'',stderr:''});
result.push({silent:observationFromRow(run())});
console.log(JSON.stringify(result));
`);
  const result = spawnTest(process.execPath, ["--experimental-test-module-mocks", helper], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const rows = JSON.parse(result.stdout) as { raw: { buildDiagnostic?: string }; observation: { stage: string }; silent: object }[];
  assert.deepEqual(rows.slice(0, 3).map(row => row.observation.stage), ["emit", "compiler-crash", "link"]);
  assert.match(rows[0]!.raw.buildDiagnostic!, /\/controlled\/program.ll:12:3/);
  assert.match(rows[1]!.raw.buildDiagnostic!, /panicked at \/controlled\/lower.rs:12:3/);
  assert.match(rows[2]!.raw.buildDiagnostic!, /\/controlled\/program.c:12:3/);
  assert.deepEqual(rows[3], { raw: { bucket: "infrastructure-error", why: "the toolchain did not survive the link" }, rejected: true });
  assert.deepEqual(rows[4], rows[3], "a silent toolchain signal is infrastructure too");
  assert.deepEqual(rows.slice(5).map(row => row.silent), [
    { kind: "build-failure", stage: "emit", diagnostic: "emitter exited N" },
    { kind: "build-failure", stage: "link", diagnostic: "linker exited N" },
  ]);
});

test("an emit killed by its real memory cap cannot become a compiler-crash record", t => {
  const base = join(homedir(), ".cache/nts/build-failure-tests"); mkdirSync(base, { recursive: true });
  const scratch = mkdtempSync(join(base, "oom-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const compiler = join(scratch, "controlled-compiler.mjs"), helper = join(scratch, "oom.mjs");
  writeFileSync(compiler, `#!${process.execPath}
import {mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
const memory=Buffer.alloc(256*2**20,1);
const args=process.argv.slice(2),out=args[args.indexOf('--out')+1];mkdirSync(out,{recursive:true});
writeFileSync(join(out,'program.c'),'int main(void){return 0;}\\n');
if(memory[0]!==1||memory.at(-1)!==1)throw Error('memory control was not touched');
console.log('cc program.c -o program');
`); chmodSync(compiler, 0o700);
  writeFileSync(helper, `
import assert from 'node:assert/strict';import {mock} from 'node:test';
import {workspace} from ${JSON.stringify(new URL("./project.ts", import.meta.url).href)};
import {observationFromRow} from ${JSON.stringify(new URL("./typescript-record.ts", import.meta.url).href)};
const location=${JSON.stringify(new URL("./worker-memory.ts", import.meta.url).href)};
const real=await import(location),terminations=[];
mock.module(location,{namedExports:{...real,compileSync(...args){const result=real.compileSync(...args);terminations.push({signal:result.signal,status:result.status,memoryKilled:result.memoryKilled});return result;}}});
const {attempt}=await import(${JSON.stringify(new URL("./attempt262.ts", import.meta.url).href)});
try{
 const dir=workspace(${JSON.stringify(join(scratch, "project"))},'ts');
 const tools={nts:${JSON.stringify(compiler)},cc:'cc',fresh:true,language:'ts',memoryCapKb:512*1024};
 const control=attempt(dir,'const value:number=1;',tools);assert.equal(control.bucket,'strict-pass',JSON.stringify(control));
 const subject=attempt(dir,'const value:number=1;',{...tools,memoryCapKb:128*1024});
 assert.equal(subject.bucket,'memory-cap',JSON.stringify(subject));
 assert.equal(terminations[1].signal,'SIGKILL');assert.equal(terminations[1].memoryKilled,true);
 assert.throws(()=>observationFromRow(subject),/unmeasured case/);
 console.log(JSON.stringify({control,subject,terminations}));
}finally{real.memoryRun().close();}
`);
  const result = spawnTest(process.execPath, ["--experimental-test-module-mocks", helper], {
    encoding: "utf8", env: { ...process.env, NTS_GATE_STEP_MEMORY_BYTES: String(768 * 2 ** 20) },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const evidence = JSON.parse(result.stdout) as { terminations: { signal: string; memoryKilled: boolean }[] };
  t.diagnostic("emit-memory-control " + JSON.stringify(evidence));
  assert.equal(evidence.terminations[1]!.signal, "SIGKILL");
  assert.equal(evidence.terminations[1]!.memoryKilled, true);
});
