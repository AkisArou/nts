import {removable} from "./run-temporary.ts";
import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdirSync, existsSync, readFileSync, writeFileSync, symlinkSync, utimesSync, chmodSync, rmSync} from "node:fs";
import {moduleClosure} from "./module-closure-fixture.ts";
import {homedir} from "node:os";
import {dirname, join} from "node:path";
import {pathToFileURL} from "node:url";
import {dependencyCapability} from "../differential/oracle-dependencies.ts";
import {oracleWorkspaceFixture} from "../differential/oracle-workspace-fixture.ts";
import {spawnTest, waitFor} from "./test-wait.ts";
import {spawn} from "node:child_process";
import {instrumentPolicy} from "./step-result.ts";
import * as canonicalEnvironment from "./canonical-environment.ts";
import {
  assertLandingEnvironment, ENVIRONMENT_CONTEXT, ENVIRONMENT_EXPERIMENT,
  FIXED_AMBIENT, gateEnvironment, oracleStepEnvironment, measuredCompileEnvironment, nodeHeapOomReason, reportEnvironment,oracleToolchainLocation,
} from "./canonical-environment.ts";
import {newTestScratch} from "./test-scratch.ts";


type CacheAuthority={NODE_COMPILE_CACHE_ROOT?:string;ownedCacheEnvironment?:(launcher:NodeJS.ProcessEnv,options:{temporary:string})=>{TMPDIR:string;NODE_COMPILE_CACHE:string}};
function cacheAuthority(){
  const authority=canonicalEnvironment as typeof canonicalEnvironment&CacheAuthority;
  assert.equal(typeof authority.ownedCacheEnvironment,"function","owned Node cache storage requires its shared authority");
  assert.ok(authority.ownedCacheEnvironment);
  return {environment:authority.ownedCacheEnvironment,root:authority.NODE_COMPILE_CACHE_ROOT};
}

test("owned Node cache storage retains its temporary and ignores a shell cache override",t=>{
  const {run,base}=fixture(t),authority=cacheAuthority();
  assert.equal(authority.root,join(homedir(),".cache/nts/node-compile-cache/v1"));
  assert.deepEqual(authority.environment({...base,TMPDIR:"/tmp",NODE_COMPILE_CACHE:"/tmp/shell-cache"},{temporary:run}),
    {TMPDIR:run,NODE_COMPILE_CACHE:authority.root});
});

test("owned Node cache storage refuses invalid temporary candidates by name",t=>{
  const {run,base}=fixture(t),authority=cacheAuthority(),file=join(run,"file"),link=join(run,"link");
  writeFileSync(file,"not a directory");symlinkSync("/tmp",link);
  for(const temporary of ["relative","/tmp",join(homedir(),".cache"),join(run,"missing"),file,link])
    assert.throws(()=>authority.environment(base,{temporary}),/owned Node cache temporary/);
});

test("owned Node cache storage refuses a selected home cache root",t=>{
  const {run,base}=fixture(t),authority=cacheAuthority(),home=join(run,"selected-home"),cache=join(home,".cache");
  mkdirSync(cache,{recursive:true});
  assert.throws(()=>authority.environment({...base,HOME:home},{temporary:cache}),/owned Node cache temporary/);
});

test("owned Node cache storage preserves a validated canonical temporary",t=>{
  const {run,base}=fixture(t),authority=cacheAuthority(),planned=gateEnvironment(base,{run});
  assert.equal(authority.environment(planned.env,{temporary:planned.env.TMPDIR!}).TMPDIR,planned.env.TMPDIR);
  assert.throws(()=>authority.environment({...planned.env,TMPDIR:"/tmp"},{temporary:run}),/owned Node cache temporary/);
});

test("canonical Node cache storage has one owned root across nested runs",t=>{
  const {run,base}=fixture(t),expected=join(homedir(),".cache/nts/node-compile-cache/v1");
  const parent=gateEnvironment({...base,NODE_COMPILE_CACHE:"/tmp/shell-cache"},{run});
  assert.equal(parent.env.NODE_COMPILE_CACHE,expected);
  assert.equal(parent.report.ambient.NODE_COMPILE_CACHE,expected);
  const child=gateEnvironment({...parent.env,NODE_COMPILE_CACHE:"/tmp/child-cache"},{run:join(run,"child")});
  assert.equal(child.env.NODE_COMPILE_CACHE,expected);
  assert.equal(child.env.TMPDIR,join(run,"child/tmp"));
});

test("the oracle toolchain location is supplied by the tooling tree",t=>{
  const {run,base}=fixture(t);
  const configured=gateEnvironment({...base,NTS_ORACLE_TYPESCRIPT:"/application/typescript"},{run,owned:{NTS_ORACLE_TYPESCRIPT:"/global/tsc"}});
  assert.equal(configured.env.NTS_ORACLE_TYPESCRIPT,oracleToolchainLocation());
  assert.equal(configured.report.host.NTS_ORACLE_TYPESCRIPT,oracleToolchainLocation());
  const child=gateEnvironment(configured.env,{run});
  assert.equal(child.env.NTS_ORACLE_TYPESCRIPT,configured.env.NTS_ORACLE_TYPESCRIPT);
  assert.equal(child.report.canonical,true);
});

test("only source-owned context grants gate capture policy and children retain its temporary identity",t=>{
  const {run,base}=fixture(t);
  const raw=gateEnvironment({...base,NTS_ORACLE_DEPENDENCIES:JSON.stringify({admission:{kind:"gate"}})},{run,owned:{NTS_ORACLE_DEPENDENCIES:"raw owned values grant no capability"}});
  const standalone=JSON.parse(raw.env.NTS_ORACLE_DEPENDENCIES!);
  assert.deepEqual(standalone.admission,{kind:"standalone"});
  const gate=gateEnvironment(raw.env,{run,oracleAdmissionContext:"gate"});
  const capability=JSON.parse(gate.env.NTS_ORACLE_DEPENDENCIES!);
  assert.deepEqual(capability.admission,{kind:"gate",temporary:gate.temporary});
  assert.equal(capability.directory,standalone.directory);
  const child=gateEnvironment({...gate.env,NTS_ORACLE_DEPENDENCIES:"launcher cannot change the owned handoff"},{run});
  assert.equal(child.env.NTS_ORACLE_DEPENDENCIES,gate.env.NTS_ORACLE_DEPENDENCIES);
  assert.equal(child.report.host.NTS_ORACLE_DEPENDENCIES,child.env.NTS_ORACLE_DEPENDENCIES);
  const outside=gateEnvironment(child.env,{run,oracleAdmissionContext:"standalone"});
  assert.deepEqual(JSON.parse(outside.env.NTS_ORACLE_DEPENDENCIES!).admission,{kind:"standalone"});
  assert.throws(()=>gateEnvironment(base,{run,oracleAdmissionContext:"typo" as "gate"}),/invalid oracle admission context/);
});

test("copied helpers omit undeclared oracle tools, reject missing declared tools and preserve owned handoffs",async t=>{
  const {run,base}=fixture(t),root=join(run,"fixture"),gate=join(root,"tooling/gate");mkdirSync(gate,{recursive:true});
  for(const name of ["canonical-environment.ts","run-temporary.ts"])writeFileSync(join(gate,name),readFileSync(new URL(name,import.meta.url)));
  // Keep the helper's real static imports while the copied environment still
  // discovers declarations only from this isolated fixture's package root.
  for(const name of ['differential','lanes'])symlinkSync(new URL('../'+name,import.meta.url),join(root,'tooling',name));
  writeFileSync(join(root,"package.json"),JSON.stringify({type:"module"}));
  const copied=await import(pathToFileURL(join(gate,"canonical-environment.ts")).href);
  const absent=copied.gateEnvironment({...base,NTS_ORACLE_TYPESCRIPT:"/application/typescript"},{run});
  assert.equal(absent.env.NTS_ORACLE_TYPESCRIPT,undefined);assert.equal(absent.report.host.NTS_ORACLE_TYPESCRIPT,null);
  const owned=gateEnvironment(base,{run});
  const child=copied.gateEnvironment(owned.env,{run});assert.equal(child.env.NTS_ORACLE_TYPESCRIPT,oracleToolchainLocation());
  // An older parent may grant only the SDK, with no dependency-root field.
  // An explicit source-owned root still selects its own declarations.
  const legacy={...owned.env},context=JSON.parse(legacy[ENVIRONMENT_CONTEXT]!);
  delete legacy.NTS_ORACLE_DEPENDENCIES;delete context.owned.NTS_ORACLE_DEPENDENCIES;
  context.report.host.NTS_ORACLE_DEPENDENCIES=null;legacy[ENVIRONMENT_CONTEXT]=JSON.stringify(context);
  const local=gateEnvironment(legacy,{run,oracleRoot:root});
  assert.equal(local.env.NTS_ORACLE_TYPESCRIPT,undefined);assert.equal(local.env.NTS_ORACLE_DEPENDENCIES,undefined);
  writeFileSync(join(root,"package.json"),JSON.stringify({type:"module",devDependencies:{typescript:"7.0.2"}}));
  assert.throws(()=>copied.gateEnvironment(base,{run}),/declared oracle TypeScript capability is missing/);
});

test("upstream Rayon limits belong only to the measured compile environment",t=>{
  const {run,base}=fixture(t);
  const ordinary=gateEnvironment({...base,RAYON_NUM_THREADS:"8"},{run});
  assert.equal(ordinary.env.RAYON_NUM_THREADS,undefined);
  const counted=measuredCompileEnvironment(ordinary.env);
  assert.equal(counted.RAYON_NUM_THREADS,"1");
  assert.equal(ordinary.env.RAYON_NUM_THREADS,undefined);
  assert.throws(()=>assertLandingEnvironment({RAYON_NUM_THREADS:"1"}),/RAYON_NUM_THREADS/);
});
/** An inner run admits against this reading, never the host's memory: inside a
 * full gate the host can sit below the floor, and admission would wait. */
function ampleMemory(run:string):string {
  const meminfo=join(run,"meminfo");writeFileSync(meminfo,"MemAvailable: 64000000 kB\n");return meminfo;
}

function fixture(t:{after(fn:()=>void):void}) {
  const run=newTestScratch("canonical-environment-run");t.after(()=>{removable(run);rmSync(run,{recursive:true,force:true});});
  return {run,base:{PATH:process.env.PATH,HOME:homedir(),XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR,DBUS_SESSION_BUS_ADDRESS:process.env.DBUS_SESSION_BUS_ADDRESS,JAVA_HOME:"/jdk with spaces",CARGO_HOME:"/cargo",RUSTUP_HOME:"/rustup"}};
}

test("canonical Git status keeps its index unchanged after a stat refresh",t=>{
  const {run,base}=fixture(t),repo=join(run,"repo");mkdirSync(repo);
  const planned=gateEnvironment({...base,GIT_OPTIONAL_LOCKS:"1"},{run});
  const git=(args:string[],env=planned.env)=>{
    const result=spawnTest("git",args,{cwd:repo,env,encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);return result.stdout;
  };
  git(["init","--quiet"]);git(["config","user.name","Fixture"]);git(["config","user.email","fixture@example.invalid"]);
  const file=join(repo,"input");writeFileSync(file,"unchanged content\n");git(["add","input"]);git(["-c","core.hooksPath=/dev/null","-c","commit.gpgsign=false","commit","--quiet","-m","fixture"]);
  const index=join(repo,".git/index"),before=readFileSync(index);
  utimesSync(file,946684800,946684800);
  assert.equal(git(["status","--porcelain"],{...planned.env,GIT_OPTIONAL_LOCKS:"1"}),"");
  assert.notDeepEqual(readFileSync(index),before,"the control must refresh the index");
  const refreshed=readFileSync(index);utimesSync(file,978307200,978307200);
  assert.equal(git(["status","--porcelain"]),"");
  assert.deepEqual(readFileSync(index),refreshed,"canonical read-only status must not write the index");
  assert.equal(planned.env.GIT_OPTIONAL_LOCKS,"0");
});

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
  for (const name of ["NTS_RC_NAIVE","NTS_GATE_STEPS","NTS_JOBS","NTS_GATE_SLOTS","NTS_GATE_JOBS","NTS_DEX_METHOD_FLOOR","NTS_COREDUMPS","CARGO_PROFILE_DEV_DEBUG","CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUSTFLAGS","RUSTFLAGS",ENVIRONMENT_CONTEXT,ENVIRONMENT_EXPERIMENT]) {
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
  const expected:NodeJS.ProcessEnv={...launcher,TMPDIR:join(run,"tmp"),NODE_COMPILE_CACHE:join(homedir(),".cache/nts/node-compile-cache/v1"),XDG_CACHE_HOME:join(base.HOME,".cache"),NTS_GATE_RUN_DIR:run,NTS_ORACLE_TYPESCRIPT:oracleToolchainLocation()};
  expected.NTS_ORACLE_DEPENDENCIES=JSON.stringify(dependencyCapability(new URL('../../',import.meta.url).pathname,join(run,'tmp','oracle-dependencies')));
  delete expected[ENVIRONMENT_EXPERIMENT];
  assert.deepEqual(Object.fromEntries(Object.entries(old.env).filter(([name])=>name!==ENVIRONMENT_CONTEXT)),expected);
  assert.deepEqual(old.report.dropped,[ENVIRONMENT_EXPERIMENT]);
  assert.doesNotMatch(JSON.stringify(old.report),/not for the report/);
  const child=gateEnvironment(old.env,{run});assert.equal(child.report.canonical,false);assert.equal(child.env.LANG,"en_US.UTF-8");
});

test("temporary output cannot be assigned to tmpfs",()=>{
  assert.throws(()=>gateEnvironment({HOME:homedir()},{run:"/tmp/nts-no-write"}),/must be under ~\/.cache/);
});

test("the declared capture owner survives a child's mock step environment",t=>{
  const {run,base}=fixture(t),parent=gateEnvironment(base,{run});
  const env=oracleStepEnvironment(parent.env,'tooling');
  const child=gateEnvironment({...env,NTS_GATE_STEP:'typescript-cases'},{run});
  assert.equal(JSON.parse(child.env.NTS_ORACLE_DEPENDENCIES!).ownerStep,'tooling');
  assert.equal(child.report.host.NTS_ORACLE_DEPENDENCIES,child.env.NTS_ORACLE_DEPENDENCIES);
});

test("a failed Node heap reports its specific diagnostic",()=>{
  for (const message of ["FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory","FATAL ERROR: Ineffective mark-compacts near heap limit", "Fatal process out of memory"]) assert.equal(nodeHeapOomReason(message),"Node/V8 heap out of memory diagnostic");
  assert.equal(nodeHeapOomReason("ordinary nonzero compiler result"),null);
});


test("the real runner records the environment and distinguishes verdict failures from instruments",t=>{
  const {run,base}=fixture(t),meminfo=ampleMemory(run),root=join(run,"repo"),gate=join(root,"tooling/gate");
  const nodeCommand="'"+process.execPath.replaceAll("'","'\\''")+"'";
  mkdirSync(gate,{recursive:true});
  const source=new URL("./",import.meta.url).pathname;
  for (const file of moduleClosure(["tooling/gate/run.mjs"])) {
    const target=join(root,file),original=join(source,"../..",file);
    mkdirSync(dirname(target),{recursive:true});
    if(file==="tooling/gate/run.mjs")writeFileSync(target,readFileSync(original));
    else symlinkSync(original,target);
  }
  oracleWorkspaceFixture(t,root);
  symlinkSync(join(source,"times.tsv"),join(gate,"times.tsv"));
  const listed=spawnTest("sh",[join(source,"all.sh"),"--list"],{encoding:"utf8"});
  assert.equal(listed.status,0,listed.stderr);
  writeFileSync(join(gate,"all.sh"),`#!/bin/sh
if [ "$1" = --list ]; then
cat <<'NAMES'
${listed.stdout.trim()}
NAMES
else
  ${nodeCommand} --input-type=module -e 'import fs from "node:fs";import {PressureError,CaseBudgetError} from ${JSON.stringify(new URL("./step-result.ts",import.meta.url).href)};fs.writeFileSync(process.env.NTS_GATE_RUN_DIR+"/observed.json",JSON.stringify(process.env));const code=Number(fs.readFileSync("result-code","utf8"));if(code===0&&process.env.NTS_GATE_STEP==="rustfmt"){const cap=JSON.parse(process.env.NTS_ORACLE_DEPENDENCIES);for(const [version,wallMs,peakBytes] of [["24.0.0",1234.5,1048576],["26.0.0",2345.5,2097152]]){const directory=cap.directory+"/node-"+version;fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(directory+"/ready.json",JSON.stringify({version:1,inputSet:{identity:{node:version}},sourceRevision:cap.sourceRevision,lockfileSha256:cap.lockfileSha256,ownerStep:"rustfmt",cost:{wallMs,peakBytes}}));for(const mode of ["cold","hit","hit"])fs.appendFileSync(process.env.NTS_GATE_RUN_DIR+"/oracle-dependency-calls.jsonl",JSON.stringify({version:1,step:"rustfmt",nodeVersion:version,directory,mode,pnpmSelectionCommands:0,wallMs:mode==="cold"?wallMs:1})+String.fromCharCode(10));}}if(code===93){const cap=JSON.parse(process.env.NTS_ORACLE_DEPENDENCIES),record=cap.seal.record,bytes=fs.readFileSync(record);fs.chmodSync(record,0o644);fs.writeFileSync(record,bytes);fs.chmodSync(record,0o444);const owner=await import(${JSON.stringify(new URL("../differential/oracle-dependencies.ts",import.meta.url).href)});await owner.captureDependencies(cap);process.exit(0);}if(code>=88){const value={version:1,kind:code===92?"unknown":"hung",verdict:code===88||code===90||code===92?"FAIL":"NOT RUN",completedFailures:code===88||code===90||code===92?1:0,step:process.env.NTS_GATE_STEP,attempt:process.env.NTS_GATE_STEP_ATTEMPT,reason:"unfinished work with retained results"};fs.writeFileSync(process.env.NTS_GATE_STEP_RESULT,JSON.stringify(value));process.exit(code===90||code===91||code===92?0:1);}if(code===86)throw new PressureError("system pressure control");if(code===87)throw new CaseBudgetError("named case exceeds the outcomes step budget");console.error("FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory");process.exit(code);' 
fi
`);
  for (const code of [0,7,86,87,88,89,90,91,92,93]) {
    writeFileSync(join(root,"result-code"),String(code));
    const directory=join(run,"home/.cache",`row-${code}`),planned=gateEnvironment({...base,DBUS_SESSION_BUS_ADDRESS:process.env.DBUS_SESSION_BUS_ADDRESS,XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR,HOME:join(run,"home"),LANG:"en_US.UTF-8",NODE_OPTIONS:"--max-old-space-size=8192",PRIVATE_TOKEN:"hidden"},{run:directory,owned:{NTS_GATE_STEPS:code===0?"rustfmt records":"rustfmt",CARGO_TARGET_DIR:join(run,"target"),NTS_MEMINFO:meminfo}});
    const actual=spawnTest(process.execPath,[join(gate,"run.mjs")],{cwd:root,env:planned.env,encoding:"utf8"});
    assert.equal(actual.status,code===0?0:1,actual.stdout+actual.stderr);
    const summary=JSON.parse(readFileSync(join(directory,"summary.json"),"utf8"));
    assert.equal(summary.environment.canonical,true);assert.equal(summary.environment.host.JAVA_HOME,base.JAVA_HOME);
    assert.equal(summary.steps[0].verdict,code===0?"PASS":code===86||code===92||code===93?"INSTRUMENT":code===89||code===91?"NOT RUN":"FAIL");
    assert.equal(summary.steps[0].exit,code===86||code===87||code===88||code===89||code===93?1:code>=90?0:code);
    if(code===93){assert.match(summary.steps[0].reason,/oracle dependency seal changed/);assert.equal(summary.steps[0].instrument.kind,"tooling-setup");assert.equal(instrumentPolicy(summary.steps[0].instrument?.kind)?.disposition === "operator-hold",true,"the lander's shared policy holds the instrument failure instead of attributing a regression");}
    else assert.equal(summary.steps[0].reason,code===0?"":code===92?"invalid instrument result for rustfmt":code>=88?"unfinished work with retained results":code===86?"system pressure control":code===87?"named case exceeds the outcomes step budget":"Node/V8 heap out of memory diagnostic; exit 7");
    const observed=JSON.parse(readFileSync(join(directory,"observed.json"),"utf8"));
    // A red keeps its temporary folder, unless this run's own summary shows the
    // disk floor evicted it: then it is gone, and the eviction is logged.
    const pruning=summary.temporary.pruning,tmp=join(directory,"tmp");
    const floor=code!==0&&pruning?.free_bytes!==null&&pruning?.free_bytes<pruning?.minimum_free_bytes&&pruning.removed.includes(tmp);
    assert.equal(summary.temporary.state,code===0?"removed after green":floor?"evicted by failed-temporary bound":"retained after red");
    assert.equal(existsSync(tmp),code!==0&&!floor);
    if (floor) assert.ok(actual.stderr.includes(`gate tmp: evicted closed failure ${tmp} `),actual.stderr);
    assert.equal(JSON.parse(observed.NTS_ORACLE_DEPENDENCIES).admission.kind,"gate","the actual runner chooses its gate context explicitly");
    if(code===0){
      const owner=summary.steps.find((row:{name:string})=>row.name==="rustfmt");
      assert.equal(owner.oracle_capture.ownerStep,"rustfmt");
      assert.equal(owner.oracle_capture.images.length,2,"both owned runtime images must be recovered");
      assert.deepEqual(owner.oracle_capture.images.find((image:{nodeVersion:string})=>image.nodeVersion==="24.0.0").cost,{wallMs:1234.5,peakBytes:1048576});
      assert.deepEqual(owner.oracle_capture.images.find((image:{nodeVersion:string})=>image.nodeVersion==="26.0.0").cost,{wallMs:2345.5,peakBytes:2097152});
      assert.equal(owner.oracle_capture.calls.cold,2);assert.equal(owner.oracle_capture.calls.hits,4);
      assert.equal(summary.steps.filter((row:{oracle_capture?:unknown})=>row.oracle_capture).length,1,"the cached user's step does not own the build cost");
      const cached=summary.steps.find((row:{name:string})=>row.name==="records");
      assert.doesNotMatch(readFileSync(cached.log,"utf8"),/oracle dependency capture:/);
      const log=readFileSync(owner.log,"utf8");
      assert.equal(log.split("\n").filter(line=>line.startsWith("oracle dependency capture: ")).length,2,"each swallowed child cost reaches its owning step log exactly once");
      assert.match(log,/"wallMs":1234.5,"peakBytes":1048576/);
    }
    assert.equal(observed.LANG,"C.UTF-8");assert.equal(observed.NODE_OPTIONS,undefined);assert.equal(observed.PRIVATE_TOKEN,undefined);assert.equal(observed.TMPDIR,join(directory,"tmp"));
    assert.doesNotMatch(actual.stdout,/PRIVATE_TOKEN=hidden|NODE_OPTIONS=--max-old-space-size=8192/);
  }
});


test("a nested pinned entry cannot take ownership of its parent step's scratch",t=>{
 const {run,base}=fixture(t),parent=gateEnvironment(base,{run});
 const actual=spawnTest(process.execPath,[new URL("./canonical-environment.ts",import.meta.url).pathname,"--pinned","not-a-script"],{env:{...parent.env,NTS_GATE_STEP:"tooling"},encoding:"utf8"});
 assert.equal(actual.status,2,actual.stdout+actual.stderr);assert.match(actual.stderr,/nested pinned gate entry/);assert.ok(existsSync(parent.env.TMPDIR!));
});

test('the real runner preserves typed parent capture failures before launching any step',t=>{
  const {run,base}=fixture(t),meminfo=ampleMemory(run),source=new URL('./',import.meta.url).pathname;
  for(const kind of ['tooling-setup','case-budget']){
    const root=join(run,kind),gate=join(root,'tooling/gate');mkdirSync(gate,{recursive:true});
    for(const file of moduleClosure(["tooling/gate/run.mjs"])){
      if(file==="tooling/gate/canonical-environment.ts")continue;
      const target=join(root,file),original=join(source,"../..",file);
      mkdirSync(dirname(target),{recursive:true});
      if(file==="tooling/gate/run.mjs")writeFileSync(target,readFileSync(original));
      else symlinkSync(original,target);
    }
    symlinkSync(join(source,"times.tsv"),join(gate,"times.tsv"));
    const canonical=new URL('./canonical-environment.ts',import.meta.url).href,results=new URL('./step-result.ts',import.meta.url).href;
    writeFileSync(join(gate,'canonical-environment.ts'),`export * from ${JSON.stringify(canonical)};import {CaseBudgetError,ToolingInstrumentError} from ${JSON.stringify(results)};export async function sealOracleRun(){throw ${kind==='case-budget'?"new CaseBudgetError('parent capture budget control')":"new ToolingInstrumentError('tooling-setup','oracle dependency seal changed: parent control')"};}\n`);
    const listed=spawnTest('sh',[join(source,'all.sh'),'--list'],{encoding:'utf8'});assert.equal(listed.status,0,listed.stderr);
    writeFileSync(join(gate,'all.sh'),`#!/bin/sh
if [ "$1" = --list ];then
cat <<'NAMES'
${listed.stdout.trim()}
NAMES
else
echo launched > step-launched
exit 0
fi
`);
    const directory=join(run,'home/.cache',kind),planned=gateEnvironment({...base,HOME:join(run,'home')},{run:directory,owned:{NTS_GATE_STEPS:'rustfmt',NTS_MEMINFO:meminfo,CARGO_TARGET_DIR:join(run,'target')}});
    const actual=spawnTest(process.execPath,[join(gate,'run.mjs')],{cwd:root,env:planned.env,encoding:'utf8'});assert.equal(actual.status,1,actual.stdout+actual.stderr);
    const summary=JSON.parse(readFileSync(join(directory,'summary.json'),'utf8')),row=summary.steps[0];
    assert.equal(existsSync(join(root,'step-launched')),false,'parent failure must precede step launch');
    assert.equal(row.instrument.kind,kind);assert.equal(row.verdict,kind==='case-budget'?'FAIL':'INSTRUMENT');assert.equal(instrumentPolicy(row.instrument?.kind)?.disposition === "operator-hold",kind==='tooling-setup');
  }
});

test('SIGTERM releases a runner waiting for startup capture admission',async t=>{
  const {run,base}=fixture(t),root=join(run,'repo'),gate=join(root,'tooling/gate');
  mkdirSync(gate,{recursive:true});
  const source=new URL('./',import.meta.url).pathname;
  for(const file of moduleClosure(['tooling/gate/run.mjs'])){
    const target=join(root,file),original=join(source,'../..',file);
    mkdirSync(dirname(target),{recursive:true});
    if(file==='tooling/gate/run.mjs')writeFileSync(target,readFileSync(original));
    else symlinkSync(original,target);
  }
  oracleWorkspaceFixture(t,root);
  symlinkSync(join(source,'times.tsv'),join(gate,'times.tsv'));
  const listed=spawnTest('sh',[join(source,'all.sh'),'--list'],{encoding:'utf8'});
  assert.equal(listed.status,0,listed.stderr);
  writeFileSync(join(gate,'all.sh'),`#!/bin/sh
if [ "$1" = --list ];then
cat <<'NAMES'
${listed.stdout.trim()}
NAMES
else
echo launched > step-launched
fi
`);
  const memory=join(run,'meminfo');writeFileSync(memory,'MemAvailable: 0 kB\n');
  const directory=join(run,'gate-run'),planned=gateEnvironment(base,{run:directory,owned:{NTS_GATE_STEPS:'rustfmt',NTS_MEMINFO:memory,CARGO_TARGET_DIR:join(run,'target')}});
  const unit='nts-startup-capture-'+run.split('/').pop()!;
  const child=spawn('systemd-run',['--user','--quiet','--pipe','--wait','--unit='+unit,'-p','LimitCORE=0','-p','TimeoutStopSec=2',
    ...Object.entries(planned.env).filter((pair):pair is [string,string]=>typeof pair[1]==='string').map(([key,value])=>'--setenv='+key+'='+value),
    '-p','WorkingDirectory='+root,'taskset','-c','0-3,6-31',process.execPath,join(gate,'run.mjs')],{stdio:['ignore','pipe','pipe']});
  t.after(()=>{spawnTest('systemctl',['--user','stop',unit],{encoding:'utf8'});});
  let output='',terminal:{code:number|null;signal:NodeJS.Signals|null}|undefined;
  child.stdout.on('data',bytes=>{output+=bytes;});child.stderr.on('data',bytes=>{output+=bytes;});
  child.on('exit',(code,signal)=>{terminal={code,signal};});
  await waitFor('startup capture admission',()=>output.includes('waiting for 14 GB before the first case'),{stopped:()=>terminal?output:undefined});
  assert.equal(existsSync(join(directory,'summary.json')),false,'the runner is still preparing, not dispatching');
  const signaled=spawnTest('systemctl',['--user','kill','--signal=SIGTERM',unit],{encoding:'utf8'});
  assert.equal(signaled.status,0,signaled.stderr);
  await waitFor('SIGTERM startup capture exit',()=>!!terminal,{timeoutMs:5000});
  assert.equal(terminal!.code,130,output);
  assert.equal(terminal!.signal,null,output);
  const summary=JSON.parse(readFileSync(join(directory,'summary.json'),'utf8'));
  assert.equal(summary.interrupted,'signal SIGTERM');
  assert.equal(summary.steps[0].verdict,'NOT RUN');
  assert.equal(existsSync(join(root,'step-launched')),false);
});
