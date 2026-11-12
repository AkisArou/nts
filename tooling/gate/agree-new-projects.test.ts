import {gitArguments} from "./git-arguments/main.ts";
import {ORACLE_EXECUTION_FILES} from '../differential/oracle-runtime.ts';
import {symlinkSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {copyModuleClosure} from './module-closure-fixture.ts';
import {testEnvironmentHandoff,fixtureEnvironment} from './test-environment.ts';
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { candidateAddedProjects, fullyMeasuredAgreement } from "../differential/new-projects.ts";
import { spawnTest } from "./test-wait.ts";
import { writeRecords } from "../differential/oracle-records.ts";
import { testScratch } from "./test-scratch.ts";
import { ownMemory } from "./test-memory.ts";
import { gateEnvironment } from "./canonical-environment.ts";

function fixture(t:{after(fn:()=>void):void}) {
  const directory=testScratch(t, "agree-new-project-case");
  const root=join(directory,"repo"),home=join(directory,"home");mkdirSync(root);mkdirSync(home);
  const env:NodeJS.ProcessEnv=Object.fromEntries(Object.entries(fixtureEnvironment(t)).filter(([key])=>!key.startsWith("GIT_") && !key.startsWith("NTS_")));
  // agree.mjs reserves its workers' memory in a ledger of this fixture's own.
  Object.assign(env,ownMemory(join(directory,"memory")),{HOME:home,XDG_CACHE_HOME:join(home,".cache"),TMPDIR:directory,NTS_AGREE_JOBS:"1",
    GIT_AUTHOR_NAME:"fixture",GIT_AUTHOR_EMAIL:"fixture@example.invalid",GIT_COMMITTER_NAME:"fixture",GIT_COMMITTER_EMAIL:"fixture@example.invalid"});
  const git=(...args:string[])=>{
    const result=spawnTest("git",gitArguments(args),{cwd:root,env,encoding:"utf8"});assert.equal(result.status,0,result.stderr);return result.stdout.trim();
  };
  const put=(path:string,text:string)=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);};
  const header={version:1,generator_version:1,generator_digest:"a".repeat(32),seed:null} as const;
  const row=(name:string)=>({kind:"measured" as const,source:`tests/programs/${name}/src/main.ts`,signature:"b".repeat(64),keys:{c:"c".repeat(32)},cases_sha256:"d".repeat(64),driver_sha256:"e".repeat(64),count:2,complete:true as const});
  const table=(names:string[])=>JSON.stringify({...header,rows:names.map(row)});
  mkdirSync(join(root,"benchmarks/cases"),{recursive:true});
  put("benchmarks/cases/.keep", "");
  put("tooling/inputs/link.sh", "#!/bin/sh\nexit 0\n");
  for(const name of ["existing","previously-unrecorded","previously-no-config"])put(`tests/programs/${name}/src/main.ts`,"export function work(n:number):number{return n;}");
  put("tests/programs/existing/tsconfig.json","{}");put("tests/programs/previously-unrecorded/tsconfig.json","{}");
  put("results/oracle-counts.json",table(["existing"]));
  git("init","-q","-b","main");git("add",".");git("commit","-qm","base");const base=git("rev-parse","HEAD");
  put("tests/programs/new-fixture/tsconfig.json","{}");
  put("tests/programs/previously-no-config/tsconfig.json","{}");
  put("tests/programs/new-fixture/src/main.ts","export function work(n:number):number{return n;}");
  rmSync(join(root,"results/oracle-counts.json"));
  writeRecords(root,{...header,rows:["existing","new-fixture","previously-unrecorded","previously-no-config"].map(row)});
  git("add",".");git("commit","-qm","candidate");
  copyModuleClosure(["tooling/differential/agree.mjs",...ORACLE_EXECUTION_FILES.map(name=>"tooling/differential/"+name)],root);
  symlinkSync(join(fileURLToPath(new URL("../..",import.meta.url)),"node_modules"),join(root,"node_modules"));
  const binaries=["before","after"].map(role=>{
    const path=join(directory,role,"nts");mkdirSync(dirname(path));
    writeFileSync(path,`#!${process.execPath}
if(process.argv[2]==="--help"){console.log("  check        compile, run, and compare against node (--json)");process.exit(0);}
// The check a child that captures oracle dependencies makes of its environment, logged when a test asks.
if(process.env.TEST_CONTEXT_LOG){const held=require("node:child_process").spawnSync(process.execPath,[process.env.TEST_CONTEXT_CHECK],{env:${testEnvironmentHandoff(["TEST_CONTEXT_LOG","TEST_CONTEXT_CHECK","NTS_MEMORY_RESERVATION"])},encoding:"utf8"});require("node:fs").appendFileSync(process.env.TEST_CONTEXT_LOG,(held.status===0?"held":"refused: "+held.stderr.trim().split("\\n").filter(Boolean).pop())+"\\n");}
if(!process.argv.includes("--json"))throw new Error("test double requires structured checks");
const role=${JSON.stringify(role)},name=process.argv[3].split("/")[2];
const mode=(role==="before"?process.env[name==="new-fixture"?"TEST_NEW_BEFORE":"TEST_EXISTING_BEFORE"]:process.env[name==="new-fixture"?"TEST_NEW_AFTER":"TEST_EXISTING_AFTER"]??process.env.TEST_AFTER)??(role==="before"&&name==="new-fixture"?"population":"agree");
if(process.env.TEST_CHECK_LOG)require("node:fs").appendFileSync(process.env.TEST_CHECK_LOG,role+" "+name+"\\n");
const value={version:1,status:"agrees",counts:{functions:1,expected:2,compared:2,unavailable:0,runtime_declined:0,timeouts:0,approximated:0,disagreements:0,aborts:0},oracle:{expected:2,received:2,complete:true},refusals:[],disagreements:[],aborts:[],error:null};
if(mode==="population"||mode==="capture"||mode==="execution"){value.status="error";value.counts=null;value.oracle=null;value.error={kind:mode==="population"?"oracle_coverage":mode,source:mode==="population"?"tests/programs/"+name+"/src/main.ts":null,message:role+" fixture error"};process.exitCode=1;}
else if(mode==="partial"){value.status="partial";value.counts.compared=1;value.counts.runtime_declined=1;}
else if(mode==="pending"){value.status="pending";value.counts=null;value.oracle=null;}
else if(mode==="panic"){console.error(role+" thread panicked during capture");process.exit(101);}
else if(mode==="wrong"){value.status="disagrees";value.counts.disagreements=1;value.disagreements.push({compiled:"f 1 -> 2",node:"f 1 -> 3"});process.exitCode=1;}
else if(mode==="text"){console.log("checked 2 cases across 1 function(s)\\nagreed on every case");process.exit(0);}
else if(mode==="contradictory"){value.counts.compared=0;}
console.log(JSON.stringify(value));
`);chmodSync(path,0o755);return path;
  });
  const [before,after]=binaries;
  writeFileSync(join(dirname(before),"provenance.json"),JSON.stringify({sha:base,clean:true,applied:null,binary_sha256:createHash("sha256").update(readFileSync(before)).digest("hex")}));
  const run=(extra:NodeJS.ProcessEnv={},comparisonBase=base)=>spawnTest(process.execPath,[join(root,"tooling/differential/agree.mjs"),before,after,"--only=new-fixture,existing",`--base=${comparisonBase}`],{cwd:root,env:{...env,...extra},encoding:"utf8"});
  return {root,directory,base,before,after,run,put,git,env};
}

test("newness comes from added Git projects independently of oracle rows or backend keys",t=>{
  const f=fixture(t);
  assert.deepEqual([...candidateAddedProjects(f.root,f.before,f.base)],["new-fixture"]);
  rmSync(join(f.root,"results/oracle-counts"),{recursive:true});
  f.put("tests/programs/untracked/tsconfig.json","{}");
  f.put("tests/programs/previously-unrecorded/added.ts","export const n=1;");
  f.git("add","tests/programs/previously-unrecorded/added.ts");f.git("commit","-qm","existing project addition");
  assert.deepEqual([...candidateAddedProjects(f.root,f.before,f.base)],["new-fixture"]);
});

test("a new fixture's before population is not comparable, while the complete after arm decides",t=>{
  const f=fixture(t),result=f.run();
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/NEW\s+new-fixture\s+before: not comparable \(new\)/);
  assert.match(result.stdout,/1 unchanged, 0 fixed, 0 regressed, 0 changed, 0 unstable, 1 not comparable \(new\), 0 not measured/);
});

test("an existing fixture made unmeasurable remains a failure beside a new fixture",t=>{
  const f=fixture(t),result=f.run({TEST_EXISTING_BEFORE:"population"});
  assert.equal(result.status,124,result.stdout+result.stderr);
  assert.match(result.stdout,/NOT MEASURED\s+existing/);assert.match(result.stdout,/NEW\s+new-fixture/);
  assert.doesNotMatch(result.stdout,/NEW\s+existing/);
});

test("a Git-added project's failed baseline is informational and never publishes a hold",t=>{
  const f=fixture(t),frame=join(f.directory,"instrument.json"),log=join(f.directory,"checks");
  for(const TEST_NEW_BEFORE of ["capture","execution","panic","text","contradictory","wrong"]) {
    rmSync(log,{force:true});rmSync(frame,{force:true});
    const result=f.run({TEST_NEW_BEFORE,TEST_CHECK_LOG:log,NTS_GATE_STEP_RESULT:frame,NTS_GATE_STEP:"agreement",NTS_GATE_STEP_ATTEMPT:"fixture"});
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.match(result.stdout,/NEW\s+new-fixture/);
    assert.match(result.stdout,/before:/);
    assert.equal(existsSync(frame),false);
    const checks=readFileSync(log,"utf8").trim().split("\n");
    assert.equal(checks.filter(line=>line==="before new-fixture").length,1);
    assert.equal(checks.filter(line=>line==="after new-fixture").length,2);
  }
});

test("new fixtures still require complete agreeing after arms",t=>{
  const f=fixture(t);
  for(const TEST_AFTER of ["capture","execution","partial","panic","wrong"]) {
    const frame=join(f.directory,"after-instrument.json");rmSync(frame,{force:true});
    const result=f.run({TEST_NEW_BEFORE:"panic",TEST_AFTER,NTS_GATE_STEP_RESULT:frame,NTS_GATE_STEP:"agreement",NTS_GATE_STEP_ATTEMPT:"fixture"});
    assert.notEqual(result.status,0,result.stdout+result.stderr);
    assert.doesNotMatch(result.stdout,/NEW\s+new-fixture/);
    if(TEST_AFTER!=="wrong") {
      assert.equal(result.status,124,result.stdout+result.stderr);
      const instrument=JSON.parse(readFileSync(frame,"utf8"));
      assert.equal(instrument.verdict,"INSTRUMENT");
      assert.equal(instrument.kind,"tooling-setup");
      if(TEST_AFTER!=="partial") assert.doesNotMatch(instrument.reason,/before thread panicked/);
    } else assert.equal(result.status,1);
  }
});

test("a new fixture with no oracle record yet is pending: listed, and not a failure",t=>{
  const f=fixture(t);
  rmSync(join(f.root,"results/oracle-counts/tests/programs/new-fixture.json"));
  const result=f.run({TEST_NEW_BEFORE:"pending",TEST_NEW_AFTER:"pending"});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/PENDING\s+new-fixture\s+pending: tests\/programs\/new-fixture is not recorded in results\/oracle-counts\/tests\/programs\/new-fixture\.json yet/);
  assert.match(result.stdout,/ 1 pending, in /);
});

test("a recorded fixture reported pending is not measured, never skipped",t=>{
  const f=fixture(t),result=f.run({TEST_EXISTING_AFTER:"pending"});
  assert.notEqual(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/NOT MEASURED\s+existing/);
  assert.match(result.stdout,/reported pending, but results\/oracle-counts\/tests\/programs\/existing\.json exists/);
});

test("unknown or mismatched before-pin provenance fails before any comparison runs",t=>{
  const f=fixture(t),log=join(f.directory,"checks");
  const path=join(dirname(f.before),"provenance.json"),record=JSON.parse(readFileSync(path,"utf8"));
  for(const metadata of [null,{...record,sha:"0".repeat(40)}]) {
    if(metadata===null)rmSync(path);else writeFileSync(path,JSON.stringify(metadata));
    const result=f.run({TEST_CHECK_LOG:log});
    assert.equal(result.status,2,result.stdout+result.stderr);assert.match(result.stdout,/verified clean before-pin provenance/);
    assert.equal(existsSync(log),false);
  }
});

test("full after coverage rejects every missing or timed-out measurement",()=>{
  const measured={status:0,outcome:"agrees",checked:2,expected:2,declined:0,refused:0,timeouts:0,oracleStopped:0};
  assert.equal(fullyMeasuredAgreement(measured),true);
  for(const delta of [{status:null},{checked:1},{declined:1},{refused:1},{timeouts:1},{oracleStopped:1},{expected:0},{outcome:"nothing to check"}]) {
    assert.equal(fullyMeasuredAgreement({...measured,...delta}),false);
  }
});


test("JSON-capable test doubles cannot return agreement prose or contradictory fields", t => {
  const f=fixture(t);
  for(const TEST_AFTER of ["text", "contradictory"]) {
    const result=f.run({TEST_AFTER});
    assert.notEqual(result.status,0,result.stdout+result.stderr);
    assert.doesNotMatch(result.stdout,/NEW\s+new-fixture/);
    assert.match(result.stdout,/NOT MEASURED/);
  }
});

test("inside an unsealed canonical run, every check's own temporary is registered in its context, so a child's owned cache check holds",t=>{
  const f=fixture(t),log=join(f.directory,"context.log"),check=join(f.directory,"context-check.mjs");
  writeFileSync(check,`import {ownedCacheEnvironment} from ${JSON.stringify(new URL("./canonical-environment.ts",import.meta.url).href)};\ntry{ownedCacheEnvironment(process.env,{temporary:process.env.TMPDIR});}catch(error){console.error(error.message);process.exit(1);}\n`);
  // The context the full check's records unit runs in: canonical, its oracle dependencies unsealed.
  const planned=gateEnvironment(f.env,{run:join(f.env.HOME!,".cache/gate-run"),owned:{NTS_AGREE_JOBS:"1",...ownMemory(join(f.directory,"context-memory"))}});
  const result=spawnTest(process.execPath,[join(f.root,"tooling/differential/agree.mjs"),f.before,f.after,"--only=new-fixture,existing",`--base=${f.base}`],
    {cwd:f.root,env:{...planned.env,TEST_CONTEXT_LOG:log,TEST_CONTEXT_CHECK:check},encoding:"utf8"});
  assert.equal(result.status,0,result.stdout+result.stderr);
  const seen=readFileSync(log,"utf8").trim().split("\n");
  assert.ok(seen.length>=3&&seen.every(line=>line==="held"),seen.join("\n"));
});
