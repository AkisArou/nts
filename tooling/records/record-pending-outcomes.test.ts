import {gitArguments} from "../gate/git-arguments/main.ts";
import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {testEnvironment} from "../gate/test-environment.ts";
// The records run records tests/outcomes through record-pending.ts in a
// canonical environment of its own, as the full check's records unit runs it.
// Its oracle dependency capability is unsealed, so the outcomes recorder's
// oracle preparation captures its dependencies in a child, whose package
// manager holds TMPDIR to the context's registered temporary.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {copyFileSync,cpSync,existsSync,mkdirSync,readFileSync,readdirSync,rmSync} from "node:fs";
import {homedir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {test} from "node:test";
import {gateEnvironment} from '../gate/canonical-environment.ts';
import {hostEnvironment} from '../gate/host-environment.ts';
import {removable} from "../gate/run-temporary.ts";
import {newTestScratch} from "../gate/test-scratch.ts";
import {ownMemory} from "../gate/test-memory.ts";
import {spawnTest} from "../gate/test-wait.ts";
import {oracleWorkspaceFixture} from "../differential/oracle-workspace-fixture.ts";
import {provenanceOf,publishPin} from "../conformance/pin.ts";
import {recordPending as fullCheckRecordPending,RECORDER_LOG} from '../full-check/service.ts';
import {partOf} from './record-pending.ts';
import {writeFileSync} from 'node:fs';

const SOURCE=fileURLToPath(new URL("../..",import.meta.url));
const binary=resolve(SOURCE,process.env.NTS_BIN??"target/release/nts");
// A recorded outcome that agrees with node: small, and the same on every compiler.
const FIXTURE="tests/outcomes/a-comparison-of-letters";
const RECORD=join(FIXTURE,"outcome.json");

function git(root:string,...args:string[]):string{
  return execFileSync("git",gitArguments(["-C",root,...args]),{encoding:"utf8",env:{...testEnvironment(),GIT_CONFIG_GLOBAL:"/dev/null",
    GIT_AUTHOR_NAME:"Records fixture",GIT_AUTHOR_EMAIL:"records-fixture@invalid",GIT_COMMITTER_NAME:"Records fixture",GIT_COMMITTER_EMAIL:"records-fixture@invalid"}}).trim();
}

/** Stage exactly the same private tree for the setup control and compiler proof. */
function stageRecordsTree(t:{after(fn:()=>void):void},root:string):void{
  // The whole tooling tree, as the records run has it: the oracle compiles the
  // outcomes preload, and what it imports, inside the tooling projects that
  // own them, and checks each of those projects whole.
  cpSync(join(SOURCE,"tooling"),join(root,"tooling"),{recursive:true});
  mkdirSync(join(root,'tests/typescript'),{recursive:true});
  mkdirSync(join(root,'tests/outcomes'),{recursive:true});
  mkdirSync(join(root,'tests/programs'),{recursive:true});
  mkdirSync(join(root,'benchmarks/cases'),{recursive:true});
  const otherData=['runtime/node','runtime/web-platform','tests/compile-time'];
  for(const area of otherData)mkdirSync(join(root,area),{recursive:true});
  copyModuleClosure(['tooling/records/record-pending.ts'],root,{dataNamespaces:{
    'tests/typescript':'pending-outcome records fixture','tests/outcomes':'one pending outcome fixture',
    'tests/programs':'pending-outcome records fixture','benchmarks/cases':'pending-outcome records fixture',
    ...Object.fromEntries(otherData.map(area=>[area,'pending-outcome records fixture']))}});
  assert.deepEqual(readdirSync(join(root,'tests/typescript')),[],'an outcome fixture stages no production TypeScript cases');
  assert.deepEqual(readdirSync(join(root,'tests/outcomes')),[],'the pending outcome starts without production records');
  for(const area of ['tests/programs','benchmarks/cases'])assert.deepEqual(readdirSync(join(root,area)),[],'the outcome control stages no production '+area);
  for(const area of otherData)assert.deepEqual(readdirSync(join(root,area)),[],'the outcome control stages no production '+area);
  for(const file of ["tsconfig.base.json","tsconfig.fixtures.json","runtime/jvm/test-vm-flags.txt"]){
    mkdirSync(dirname(join(root,file)),{recursive:true});copyFileSync(join(SOURCE,file),join(root,file));
  }
  oracleWorkspaceFixture(t,root);
  // The pending case: a recorded outcome's sources, without its record.
  for(const file of ["tsconfig.json","src/main.ts"]){
    mkdirSync(dirname(join(root,FIXTURE,file)),{recursive:true});copyFileSync(join(SOURCE,FIXTURE,file),join(root,FIXTURE,file));
  }
  assert.deepEqual(readdirSync(join(root,'tests/outcomes')),[FIXTURE.split('/').at(-1)]);
  assert.equal(existsSync(join(root,RECORD)),false,'the fixture owns a pending case, never its production record');
  git(root,"add","-f","tsconfig.fixtures.json",FIXTURE);git(root,"commit","-qm","one pending outcome");
}

test('records fixture stages only its declared private populations',t=>{
  const scratch=newTestScratch('record-pending-outcome-staging');
  t.after(()=>{removable(scratch);rmSync(scratch,{recursive:true,force:true});});
  stageRecordsTree(t,join(scratch,'tree'));
});

/** A tree with one pending outcome, a clean pin of the gate's compiler, and the records unit's canonical environment. */
function recordsRun(t:{after(fn:()=>void):void}){
  assert.ok(existsSync(binary),`compiler missing: ${binary}; set NTS_BIN to a built pin`);
  const scratch=newTestScratch("record-pending-outcomes");
  t.after(()=>{removable(scratch);rmSync(scratch,{recursive:true,force:true});});
  const root=join(scratch,"tree");
  stageRecordsTree(t,root);
  const pin=publishPin(binary,join(scratch,"pin"),provenanceOf(binary)??{sha:git(SOURCE,"rev-parse","HEAD"),
    subject:"test fixture copy of the gate compiler",clean:true,applied:null,built_at:new Date().toISOString()});
  // A launcher's host capabilities alone, never this test's own context: a
  // records run's oracle dependencies are not sealed, so its preparation
  // captures them. Its home, memory reading and ledger are the test's own;
  // the compiled runtime objects are the machine's shared cache.
  const home=join(scratch,"home");
  const planned=gateEnvironment({...hostEnvironment(process.env),HOME:home},{run:join(home,".cache/records-run"),oracleRoot:root,owned:{
    ...ownMemory(join(scratch,"memory")),NTS_BIN:pin,NTS_CENSUS_OBJECT_CACHE:join(homedir(),".cache/nts/c-objects"),
    ...(process.env.NTS_TOOLING_SLICE?{NTS_TOOLING_SLICE:process.env.NTS_TOOLING_SLICE}:{})}});
  return {root,planned,scratch,pin,record:(env:NodeJS.ProcessEnv)=>spawnTest(process.execPath,[join(root,"tooling/records/record-pending.ts"),"outcomes"],
    {cwd:root,env,encoding:"utf8",maxBuffer:64*2**20},"record-pending outcomes")};
}

test('the real full-check recordPending candidate route seals and removes finished and failed entry runs',t=>{
  for(const status of [0,9]){
  const {root,planned,scratch,pin}=recordsRun(t),run=join(scratch,'full-check-run'),observed=join(scratch,'sealed-recorder.json');
  mkdirSync(run);
  assert.equal(JSON.parse(planned.env.NTS_ORACLE_DEPENDENCIES!).seal,undefined,'the records unit starts with an unsealed capability');
  // Keep the real production CLI through its owned preparation boundary. Its
  // private record body observes the handoff; the adjacent outcome case proves
  // actual record writing. Stage first, then mutate and commit this private tree.
  const entry=join(root,'tooling/records/record-pending.ts'),boundary='await withPreparedOracle(()=>{}, {entry:import.meta.url,ambient:true});';
  const source=readFileSync(entry,'utf8');assert.equal(source.split(boundary).length,2);
  writeFileSync(entry,"import {assertSealedOracleRun} from '../differential/oracle-seal/main.ts';\nimport {durableRecord} from '../gate/durable-record.ts';\n"+source.replace(boundary,boundary+`
      assertSealedOracleRun(process.env);
      const context=JSON.parse(process.env.NTS_GATE_ENV_CONTEXT),capability=JSON.parse(process.env.NTS_ORACLE_DEPENDENCIES);
      durableRecord(${JSON.stringify(observed)},{sealed:Boolean(capability.seal),canonical:context.report.canonical,tmp:process.env.TMPDIR,registered:context.temporary.path,argv:process.argv.slice(2)});
      process.exitCode=${status};
      return;
  `));
  git(root,'add','tooling/records/record-pending.ts');git(root,'commit','-qm','observe only the sealed recorder handoff');
  const part=partOf('outcomes'),result=fullCheckRecordPending(root,pin,run,part,{env:planned.env});
  assert.equal(result.status,status,readFileSync(join(run,RECORDER_LOG),'utf8'));
  const value=JSON.parse(readFileSync(observed,'utf8'));
  assert.equal(value.sealed,true);assert.equal(value.canonical,true);
  assert.equal(value.tmp,value.registered);assert.deepEqual(value.argv,['--after',part,run]);
  assert.deepEqual(readdirSync(join(planned.env.HOME!,'.cache/nts/oracle-entries')),[],'the whole entry run, including failed runs, is removed after child/session/admission drain');
  }
});

test("the records run records a pending outcome, its oracle captured inside the outcome check's registered temporary",t=>{
  const {root,planned,record}=recordsRun(t);
  const result=record(planned.env),output=result.stdout+result.stderr;
  assert.equal(result.status,0,output);
  assert.match(output,/^outcomes: 1 pending$/m);
  assert.match(output,new RegExp(`^  recorded ${RECORD}: `,"m"));
  assert.doesNotMatch(output,/registered temporary/);
  const recorded=JSON.parse(readFileSync(join(root,RECORD),"utf8"));
  assert.equal(recorded.run,"build");assert.equal(recorded.category,"agrees");assert.equal(recorded.source,"measured");
  assert.equal(recorded.nts,recorded.node,"the compiled program and node said the same");
});

test("a records run whose launcher changes TMPDIR without registering it is refused by the same check, and records nothing",t=>{
  const {root,planned,record}=recordsRun(t);
  // The control differs in one thing: TMPDIR is a folder inside the
  // registered temporary that the context never registered.
  const elsewhere=join(planned.temporary.path,"unregistered");mkdirSync(elsewhere);
  const result=record({...planned.env,TMPDIR:elsewhere}),output=result.stdout+result.stderr;
  assert.notEqual(result.status,0,output);
  assert.match(output,/owned Node cache temporary: canonical TMPDIR differs from its registered temporary/);
  assert.match(output,/^  outcomes: the recorder exited [1-9]\d*$/m);
  assert.equal(existsSync(join(root,RECORD)),false,"a refused run records nothing");
});
