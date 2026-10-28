import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { newlyRecordedProjects, newBeforeProject, fullyMeasuredAgreement } from "../differential/new-projects.ts";
import { spawnTest } from "./test-wait.ts";

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
  const row=(name:string)=>({kind:"measured",source:`tests/programs/${name}/src/main.ts`,signature:"signature",keys:{c:"key"},count:2,complete:true});
  const table=(names:string[])=>JSON.stringify({version:1,rows:names.map(row)});
  put("tests/programs/existing/tsconfig.json","{}");put("tests/programs/previously-unrecorded/tsconfig.json","{}");
  put("results/oracle-counts.json",table(["existing"]));
  git("init","-q","-b","main");git("add",".");git("commit","-qm","base");const base=git("rev-parse","HEAD");
  put("tests/programs/new-fixture/tsconfig.json","{}");
  put("results/oracle-counts.json",table(["existing","new-fixture","previously-unrecorded"]));
  git("add",".");git("commit","-qm","candidate");
  for(const name of ["differential","conformance","gate"]) mkdirSync(join(root,"tooling",name),{recursive:true});
  const agree=new URL("../differential/agree.mjs",import.meta.url).pathname;
  put("tooling/differential/agree.mjs",readFileSync(agree,"utf8"));
  for(const path of ["differential/new-projects.ts","conformance/pin.ts","gate/tokens.mjs"]) {
    symlinkSync(new URL(`../${path}`,import.meta.url).pathname,join(root,"tooling",path));
  }
  const binaries=["before","after"].map(role=>{
    const path=join(directory,role,"nts");mkdirSync(dirname(path));
    writeFileSync(path,`#!${process.execPath}
const role=${JSON.stringify(role)},name=process.argv[3].split("/")[2];
const mode=process.env[role==="before"?(name==="new-fixture"?"TEST_NEW_BEFORE":"TEST_EXISTING_BEFORE"):"TEST_AFTER"]??(role==="before"&&name==="new-fixture"?"population":"agree");
if(process.env.TEST_CHECK_LOG)require("node:fs").appendFileSync(process.env.TEST_CHECK_LOG,role+" "+name+"\\n");
if(mode==="population"){console.error("Error: oracle not measured: tests/programs/"+name+"/src/main.ts (c) has no unique recorded population old-key; run: node tooling/differential/record-oracles.ts");process.exitCode=1;}
else if(mode==="capture"){console.error("Error: failed to capture the requested project");process.exitCode=1;}
else if(mode==="partial"){console.log("1 case(s) the compiled program declined\\nchecked 1 of 2 cases; the rest were not reached\\nagreed on every case it compared: 1 of 2");}
else if(mode==="panic"){console.error("thread panicked during capture");process.exitCode=101;}
else if(mode==="wrong"){console.log("checked 2 cases across 1 function(s)\\n  nts  f 1 -> 2\\n  node f 1 -> 3\\nError: 1 case(s) disagree between the compiled program and node");process.exitCode=1;}
else console.log("checked 2 cases across 1 function(s)\\nagreed on every case");
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
  assert.equal(result.status,2,result.stdout+result.stderr);
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
