import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { newlyRecordedProjects, newBeforeProject, fullyMeasuredAgreement } from "../differential/new-projects.ts";
import { spawnTest } from "./test-wait.ts";
import { writeRecords } from "../differential/oracle-records.ts";

const scratch=join(homedir(),".cache/nts-scratch/agree-new-project-tests");mkdirSync(scratch,{recursive:true});
function fixture(t:{after(fn:()=>void):void}) {
  const directory=mkdtempSync(join(scratch,"case-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const root=join(directory,"repo"),home=join(directory,"home");mkdirSync(root);mkdirSync(home);
  const env:NodeJS.ProcessEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith("GIT_") && !key.startsWith("NTS_")));
  Object.assign(env,{HOME:home,XDG_CACHE_HOME:join(home,".cache"),TMPDIR:directory,NTS_AGREE_JOBS:"1",
    GIT_AUTHOR_NAME:"fixture",GIT_AUTHOR_EMAIL:"fixture@example.invalid",GIT_COMMITTER_NAME:"fixture",GIT_COMMITTER_EMAIL:"fixture@example.invalid"});
  const git=(...args:string[])=>{
    const result=spawnTest("git",args,{cwd:root,env,encoding:"utf8"});assert.equal(result.status,0,result.stderr);return result.stdout.trim();
  };
  const put=(path:string,text:string)=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);};
  const header={version:1,generator_version:1,generator_digest:"a".repeat(32),seed:null} as const;
  const row=(name:string)=>({kind:"measured" as const,source:`tests/programs/${name}/src/main.ts`,signature:"b".repeat(64),keys:{c:"c".repeat(32)},cases_sha256:"d".repeat(64),driver_sha256:"e".repeat(64),count:2,complete:true as const});
  const table=(names:string[])=>JSON.stringify({...header,rows:names.map(row)});
  mkdirSync(join(root,"benchmarks/cases"),{recursive:true});
  put("benchmarks/cases/.keep", "");
  put("tooling/lanes/inputs.sh", "#!/bin/sh\nexit 0\n");
  for(const name of ["existing","previously-unrecorded"])put(`tests/programs/${name}/src/main.ts`,"export function work(n:number):number{return n;}");
  put("tests/programs/existing/tsconfig.json","{}");put("tests/programs/previously-unrecorded/tsconfig.json","{}");
  put("results/oracle-counts.json",table(["existing"]));
  git("init","-q","-b","main");git("add",".");git("commit","-qm","base");const base=git("rev-parse","HEAD");
  put("tests/programs/new-fixture/tsconfig.json","{}");
  put("tests/programs/new-fixture/src/main.ts","export function work(n:number):number{return n;}");
  rmSync(join(root,"results/oracle-counts.json"));
  writeRecords(root,{...header,rows:["existing","new-fixture","previously-unrecorded"].map(row)});
  git("add",".");git("commit","-qm","candidate");
  for(const name of ["differential","conformance","gate"]) mkdirSync(join(root,"tooling",name),{recursive:true});
  const agree=new URL("../differential/agree.mjs",import.meta.url).pathname;
  put("tooling/differential/agree.mjs",readFileSync(agree,"utf8"));
  for(const path of ["differential/new-projects.ts","differential/legacy-oracle-root.ts","differential/oracle-records.ts","differential/check-report.ts","differential/check-report-types.ts",
    "conformance/observation-text.ts","conformance/pin.ts","gate/tokens.mjs","gate/active-command.ts","gate/step-result.ts"]) {
    symlinkSync(new URL(`../${path}`,import.meta.url).pathname,join(root,"tooling",path));
  }
  const binaries=["before","after"].map(role=>{
    const path=join(directory,role,"nts");mkdirSync(dirname(path));
    writeFileSync(path,`#!${process.execPath}
if(process.argv[2]==="--help"){console.log("  check        compile, run, and compare against node (--json)");process.exit(0);}
if(!process.argv.includes("--json"))throw new Error("test double requires structured checks");
const role=${JSON.stringify(role)},name=process.argv[3].split("/")[2];
const mode=process.env[role==="before"?(name==="new-fixture"?"TEST_NEW_BEFORE":"TEST_EXISTING_BEFORE"):"TEST_AFTER"]??(role==="before"&&name==="new-fixture"?"population":"agree");
if(process.env.TEST_CHECK_LOG)require("node:fs").appendFileSync(process.env.TEST_CHECK_LOG,role+" "+name+"\\n");
const value={version:1,status:"agrees",counts:{functions:1,expected:2,compared:2,unavailable:0,runtime_declined:0,timeouts:0,approximated:0,disagreements:0,aborts:0},oracle:{expected:2,received:2,complete:true},refusals:[],disagreements:[],aborts:[],error:null};
if(mode==="population"||mode==="capture"){value.status="error";value.counts=null;value.oracle=null;value.error={kind:mode==="population"?"oracle_coverage":"capture",source:mode==="population"?"tests/programs/"+name+"/src/main.ts":null,message:"fixture error"};process.exitCode=1;}
else if(mode==="partial"){value.status="partial";value.counts.compared=1;value.counts.runtime_declined=1;}
else if(mode==="panic"){console.error("thread panicked during capture");process.exit(101);}
else if(mode==="wrong"){value.status="disagrees";value.counts.disagreements=1;value.disagreements.push({compiled:"f 1 -> 2",node:"f 1 -> 3"});process.exitCode=1;}
else if(mode==="text"){console.log("checked 2 cases across 1 function(s)\\nagreed on every case");process.exit(0);}
else if(mode==="contradictory"){value.counts.compared=0;}
console.log(JSON.stringify(value));
`);chmodSync(path,0o755);return path;
  });
  const [before,after]=binaries;
  writeFileSync(join(dirname(before),"provenance.json"),JSON.stringify({sha:base,clean:true,applied:null,binary_sha256:createHash("sha256").update(readFileSync(before)).digest("hex")}));
  const run=(extra:NodeJS.ProcessEnv={},comparisonBase=base)=>spawnTest(process.execPath,[join(root,"tooling/differential/agree.mjs"),before,after,"--only=new-fixture,existing",`--base=${comparisonBase}`],{cwd:root,env:{...env,...extra},encoding:"utf8"});
  return {root,directory,base,before,after,run};
}

test("newness needs a newly recorded project, not a changed row for an existing fixture",t=>{
  const f=fixture(t);
  assert.deepEqual([...newlyRecordedProjects(f.root,f.before,f.base,"c")],["new-fixture"]);
  assert.equal(newlyRecordedProjects(f.root,f.before,f.base,"jvm").size,0);
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

test("new fixtures cannot excuse capture failures, crashes or an unmeasured or partial after arm",t=>{
  const f=fixture(t);
  for(const env of [{TEST_NEW_BEFORE:"capture"},{TEST_NEW_BEFORE:"panic"},{TEST_AFTER:"capture"},{TEST_AFTER:"partial"},{TEST_AFTER:"panic"},{TEST_AFTER:"wrong"}]) {
    const result=f.run(env);assert.notEqual(result.status,0,result.stdout+result.stderr);
    assert.doesNotMatch(result.stdout,/NEW\s+new-fixture/);
  }
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

test("new before eligibility and full after coverage reject every missing or timed-out measurement",()=>{
  const measured={status:0,outcome:"agrees",checked:2,expected:2,declined:0,refused:0,timeouts:0,oracleStopped:0};
  const missing={...measured,status:1,outcome:"not measured",missingPopulation:"tests/programs/new-fixture/src/main.ts"};
  const added=new Set(["new-fixture"]);
  assert.equal(newBeforeProject("new-fixture",added,missing),true);
  for(const delta of [{status:null},{timeouts:1},{oracleStopped:1},{missingPopulation:null},{missingPopulation:"tests/programs/existing/src/main.ts"}]) {
    assert.equal(newBeforeProject("new-fixture",added,{...missing,...delta}),false);
  }
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
