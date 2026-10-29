import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnTest } from "./test-wait.ts";
import {
  assertLandingEnvironment, ENVIRONMENT_CONTEXT, ENVIRONMENT_EXPERIMENT,
  FIXED_AMBIENT, gateEnvironment, measuredCompileEnvironment, nodeHeapOomReason, reportEnvironment,
} from "./canonical-environment.ts";

const scratch=join(homedir(),".cache/nts-scratch/canonical-environment-tests");

test("upstream Rayon limits belong only to the measured compile environment",t=>{
  const {run,base}=fixture(t);
  const ordinary=gateEnvironment({...base,RAYON_NUM_THREADS:"8"},{run});
  assert.equal(ordinary.env.RAYON_NUM_THREADS,undefined);
  const counted=measuredCompileEnvironment(ordinary.env);
  assert.equal(counted.RAYON_NUM_THREADS,"1");
  assert.equal(ordinary.env.RAYON_NUM_THREADS,undefined);
  assert.throws(()=>assertLandingEnvironment({RAYON_NUM_THREADS:"1"}),/RAYON_NUM_THREADS/);
});
mkdirSync(scratch,{recursive:true});
function fixture(t:{after(fn:()=>void):void}) {
  const run=mkdtempSync(join(scratch,"run-"));t.after(()=>rmSync(run,{recursive:true,force:true}));
  return {run,base:{PATH:process.env.PATH,HOME:homedir(),JAVA_HOME:"/jdk with spaces",CARGO_HOME:"/cargo",RUSTUP_HOME:"/rustup"}};
}

test("different launcher ambients produce identical step environments",t=>{
  const {run,base}=fixture(t);
  const a=gateEnvironment({...base,LANG:"en_US.UTF-8",NODE_OPTIONS:"--max-old-space-size=8192",JAVA_TOOL_OPTIONS:"-Xmx4g",DISPLAY:":99",LD_LIBRARY_PATH:"/one",PRIVATE_TOKEN:"secret one"},{run});
  const b=gateEnvironment({...base,LANG:"C",NODE_OPTIONS:"--no-warnings",JAVA_TOOL_OPTIONS:"-Xmx1g",WAYLAND_DISPLAY:"wayland-0",LD_PRELOAD:"/two",OTHER_SECRET:"secret two"},{run});
  const withoutReport=(env:NodeJS.ProcessEnv)=>Object.fromEntries(Object.entries(env).filter(([name])=>name!==ENVIRONMENT_CONTEXT));
  assert.deepEqual(withoutReport(a.env),withoutReport(b.env));
  assert.equal(a.report.canonical,true);assert.equal(b.report.canonical,true);
  assert.equal(a.env.TMPDIR,join(run,"tmp"));assert.ok(existsSync(a.env.TMPDIR));
  for (const [name,value] of Object.entries(FIXED_AMBIENT)) assert.equal(a.env[name],value);
  for (const name of ["NODE_OPTIONS","JAVA_TOOL_OPTIONS","DISPLAY","WAYLAND_DISPLAY","LD_PRELOAD","LD_LIBRARY_PATH","PRIVATE_TOKEN","OTHER_SECRET"]) assert.equal(a.env[name],undefined,name);
  assert.equal(a.report.host.JAVA_HOME,base.JAVA_HOME);assert.equal(a.report.host.CARGO_HOME,"/cargo");assert.equal(a.report.host.RUSTUP_HOME,"/rustup");
  let log="";reportEnvironment(a.report,text=>log+=text);
  assert.match(log,/PRIVATE_TOKEN/);assert.doesNotMatch(log,/secret one|8192|Xmx4g/);
  assert.doesNotMatch(JSON.stringify(a.report),/secret one|8192|Xmx4g/);
});

test("land refuses every verdict override by name, without its value",()=>{
  for (const name of ["NTS_RC_NAIVE","NTS_GATE_STEPS","NTS_JOBS","NTS_GATE_SLOTS","NTS_GATE_JOBS","NTS_BENCH_AGREE_FLOOR","NTS_DEX_METHOD_FLOOR","NTS_COREDUMPS","CARGO_PROFILE_DEV_DEBUG","CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUSTFLAGS","RUSTFLAGS",ENVIRONMENT_CONTEXT,ENVIRONMENT_EXPERIMENT]) {
    assert.throws(()=>assertLandingEnvironment({[name]:"private-value"}),error=>{
      assert.match(String(error),new RegExp(name));assert.doesNotMatch(String(error),/private-value/);return true;
    });
  }
  assert.doesNotThrow(()=>assertLandingEnvironment({NTS_APPLE_SSH:"mac",NTS_LAND_AUTHOR_ADDRESS:"lane",LANG:"C",NODE_OPTIONS:"--no-warnings"}));
});

test("source-owned values survive the handoff without becoming experiments",t=>{
  const {run,base}=fixture(t);
  const source=gateEnvironment(base,{run,owned:{NTS_GATE_STEPS:"examples jvm",NTS_GATE_ACCEPT_SKIP:"on-device",CARGO_INCREMENTAL:"0",NTS_GATE_LOCK_FD:"8"}});
  assert.equal(source.report.canonical,true);
  const child=gateEnvironment({...source.env,NTS_GATE_LOCK_FD:undefined},{run});
  assert.equal(child.env.NTS_GATE_STEPS,"examples jvm");assert.equal(child.env.CARGO_INCREMENTAL,"0");assert.equal(child.env.NTS_GATE_LOCK_FD,undefined);
  assert.equal(child.report.canonical,true);
  assert.equal(child.report.ambient.NODE_OPTIONS,null);
});

test("named standalone experiments remain non-canonical through children",t=>{
  const {run,base}=fixture(t);
  const manual=gateEnvironment({...base,NTS_BACKEND:"jvm",NTS_COREDUMPS:"1"},{run,standalone:true});
  assert.equal(manual.report.canonical,false);assert.equal(manual.env.NTS_COREDUMPS,"1");
  assert.deepEqual(manual.report.experiments.map(e=>e.name).sort(),["NTS_BACKEND","NTS_COREDUMPS"]);
  assert.equal(gateEnvironment(manual.env,{run}).report.canonical,false);
  assert.throws(()=>gateEnvironment({...base,NTS_MISSPELLED_POLICY:"1"},{run,standalone:true}),/unknown standalone policy override: NTS_MISSPELLED_POLICY/);
});

test("the explicit old-environment comparison is never landing evidence",t=>{
  const {run,base}=fixture(t);
  const launcher={...base,[ENVIRONMENT_EXPERIMENT]:"today",LANG:"en_US.UTF-8",NODE_OPTIONS:"--max-old-space-size=8192",UNRELATED_SECRET:"not for the report"};
  const old=gateEnvironment(launcher,{run,standalone:true});
  assert.equal(old.report.canonical,false);assert.equal(old.env.NODE_OPTIONS,"--max-old-space-size=8192");
  assert.equal(old.env.TMPDIR,join(run,"tmp"));
  const expected:NodeJS.ProcessEnv={...launcher,TMPDIR:join(run,"tmp"),XDG_CACHE_HOME:join(base.HOME,".cache"),NTS_GATE_RUN_DIR:run};
  delete expected[ENVIRONMENT_EXPERIMENT];
  assert.deepEqual(Object.fromEntries(Object.entries(old.env).filter(([name])=>name!==ENVIRONMENT_CONTEXT)),expected);
  assert.deepEqual(old.report.dropped,[ENVIRONMENT_EXPERIMENT]);
  assert.doesNotMatch(JSON.stringify(old.report),/not for the report/);
  const child=gateEnvironment(old.env,{run});assert.equal(child.report.canonical,false);assert.equal(child.env.LANG,"en_US.UTF-8");
});

test("temporary output cannot be assigned to tmpfs",()=>{
  assert.throws(()=>gateEnvironment({HOME:homedir()},{run:"/tmp/nts-no-write"}),/must be under ~\/.cache/);
});

test("a failed Node heap reports its specific diagnostic",()=>{
  for (const message of ["FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory","FATAL ERROR: Ineffective mark-compacts near heap limit", "Fatal process out of memory"]) assert.equal(nodeHeapOomReason(message),"Node/V8 heap out of memory diagnostic");
  assert.equal(nodeHeapOomReason("ordinary nonzero compiler result"),null);
});


test("the real runner records the environment and distinguishes verdict failures from instruments",t=>{
  const {run,base}=fixture(t),root=join(run,"repo"),gate=join(root,"tooling/gate");
  mkdirSync(gate,{recursive:true});
  const source=new URL("./",import.meta.url).pathname;
  for (const name of readdirSync(source)) {
    if (name==="run.mjs") writeFileSync(join(gate,name),readFileSync(join(source,name)));
    else if (name!=="all.sh") symlinkSync(join(source,name),join(gate,name));
  }
  const listed=spawnTest("sh",[join(source,"all.sh"),"--list"],{encoding:"utf8"});
  assert.equal(listed.status,0,listed.stderr);
  writeFileSync(join(gate,"all.sh"),`#!/bin/sh
if [ "$1" = --list ]; then
cat <<'NAMES'
${listed.stdout.trim()}
NAMES
else
  node --input-type=module -e 'import fs from "node:fs";import {PressureError,CaseBudgetError} from ${JSON.stringify(new URL("./step-result.ts",import.meta.url).href)};fs.writeFileSync(process.env.NTS_GATE_RUN_DIR+"/observed.json",JSON.stringify(process.env));const code=Number(fs.readFileSync("result-code","utf8"));if(code>=88){const value={version:1,kind:code===92?"unknown":"hung",verdict:code===88||code===90||code===92?"FAIL":"NOT RUN",completedFailures:code===88||code===90||code===92?1:0,step:process.env.NTS_GATE_STEP,attempt:process.env.NTS_GATE_STEP_ATTEMPT,reason:"unfinished work with retained results"};fs.writeFileSync(process.env.NTS_GATE_STEP_RESULT,JSON.stringify(value));process.exit(code===90||code===91||code===92?0:1);}if(code===86)throw new PressureError("system pressure control");if(code===87)throw new CaseBudgetError("named case exceeds the outcomes step budget");console.error("FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory");process.exit(code);' 
fi
`);
  for (const code of [0,7,86,87,88,89,90,91,92]) {
    writeFileSync(join(root,"result-code"),String(code));
    const directory=join(run,"home/.cache",`row-${code}`),planned=gateEnvironment({...base,HOME:join(run,"home"),LANG:"en_US.UTF-8",NODE_OPTIONS:"--max-old-space-size=8192",PRIVATE_TOKEN:"hidden"},{run:directory,owned:{NTS_GATE_STEPS:"rustfmt",CARGO_TARGET_DIR:join(run,"target")}});
    const actual=spawnTest(process.execPath,[join(gate,"run.mjs")],{cwd:root,env:planned.env,encoding:"utf8"});
    assert.equal(actual.status,code===0?0:1,actual.stdout+actual.stderr);
    const summary=JSON.parse(readFileSync(join(directory,"summary.json"),"utf8"));
    assert.equal(summary.environment.canonical,true);assert.equal(summary.environment.host.JAVA_HOME,base.JAVA_HOME);
    assert.equal(summary.steps[0].verdict,code===0?"PASS":code===86||code===92?"INSTRUMENT":code===89||code===91?"NOT RUN":"FAIL");
    assert.equal(summary.steps[0].exit,code===86||code===87||code===88||code===89?1:code>=90?0:code);
    assert.equal(summary.steps[0].reason,code===0?"":code===92?"invalid instrument result for rustfmt":code>=88?"unfinished work with retained results":code===86?"system pressure control":code===87?"named case exceeds the outcomes step budget":"Node/V8 heap out of memory diagnostic; exit 7");
    const observed=JSON.parse(readFileSync(join(directory,"observed.json"),"utf8"));
    assert.equal(summary.temporary.state,code===0?"removed after green":"retained after red");
    assert.equal(existsSync(join(directory,"tmp")),code!==0);
    assert.equal(observed.LANG,"C.UTF-8");assert.equal(observed.NODE_OPTIONS,undefined);assert.equal(observed.PRIVATE_TOKEN,undefined);assert.equal(observed.TMPDIR,join(directory,"tmp"));
    assert.doesNotMatch(actual.stdout,/hidden|8192/);
  }
});


test("a nested pinned entry cannot take ownership of its parent step's scratch",t=>{
 const {run,base}=fixture(t),parent=gateEnvironment(base,{run});
 const actual=spawnTest(process.execPath,[new URL("./canonical-environment.ts",import.meta.url).pathname,"--pinned","not-a-script"],{env:{...parent.env,NTS_GATE_STEP:"tooling"},encoding:"utf8"});
 assert.equal(actual.status,2,actual.stdout+actual.stderr);assert.match(actual.stderr,/nested pinned gate entry/);assert.ok(existsSync(parent.env.TMPDIR!));
});
