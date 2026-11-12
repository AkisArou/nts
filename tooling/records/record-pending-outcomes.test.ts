import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {testEnvironment} from "../gate/test-environment.ts";
// The records run records tests/outcomes through record-pending.ts in a
// canonical environment of its own, as the full check's records unit runs it.
// Its oracle dependency capability is unsealed, so the outcomes recorder's
// oracle preparation captures its dependencies in a child, whose package
// manager holds TMPDIR to the context's registered temporary.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {copyFileSync,cpSync,existsSync,mkdirSync,readFileSync,rmSync} from "node:fs";
import {homedir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {test} from "node:test";
import {gateEnvironment,hostEnvironment} from "../gate/canonical-environment.ts";
import {removable} from "../gate/run-temporary.ts";
import {newTestScratch} from "../gate/test-scratch.ts";
import {ownMemory} from "../gate/test-memory.ts";
import {spawnTest} from "../gate/test-wait.ts";
import {oracleWorkspaceFixture} from "../differential/oracle-workspace-fixture.ts";
import {provenanceOf,publishPin} from "../conformance/pin.ts";

const SOURCE=fileURLToPath(new URL("../..",import.meta.url));
const binary=resolve(SOURCE,process.env.NTS_BIN??"target/release/nts");
// A recorded outcome that agrees with node: small, and the same on every compiler.
const FIXTURE="tests/outcomes/a-comparison-of-letters";
const RECORD=join(FIXTURE,"outcome.json");

function git(root:string,...args:string[]):string{
  return execFileSync("git",["-C",root,...args],{encoding:"utf8",env:{...testEnvironment(),GIT_CONFIG_GLOBAL:"/dev/null",
    GIT_AUTHOR_NAME:"Records fixture",GIT_AUTHOR_EMAIL:"records-fixture@invalid",GIT_COMMITTER_NAME:"Records fixture",GIT_COMMITTER_EMAIL:"records-fixture@invalid"}}).trim();
}

/** A tree with one pending outcome, a clean pin of the gate's compiler, and the records unit's canonical environment. */
function recordsRun(t:{after(fn:()=>void):void}){
  assert.ok(existsSync(binary),`compiler missing: ${binary}; set NTS_BIN to a built pin`);
  const scratch=newTestScratch("record-pending-outcomes");
  t.after(()=>{removable(scratch);rmSync(scratch,{recursive:true,force:true});});
  const root=join(scratch,"tree");
  // The whole tooling tree, as the records run has it: the oracle compiles the
  // outcomes preload, and what it imports, inside the tooling projects that
  // own them, and checks each of those projects whole.
  cpSync(join(SOURCE,"tooling"),join(root,"tooling"),{recursive:true});
  copyModuleClosure(['tooling/records/record-pending.ts'],root);
  for(const file of ["tsconfig.base.json","tsconfig.fixtures.json","runtime/jvm/test-vm-flags.txt"]){
    mkdirSync(dirname(join(root,file)),{recursive:true});copyFileSync(join(SOURCE,file),join(root,file));
  }
  oracleWorkspaceFixture(t,root);
  // The pending case: a recorded outcome's sources, without its record.
  for(const file of ["tsconfig.json","src/main.ts"]){
    mkdirSync(dirname(join(root,FIXTURE,file)),{recursive:true});copyFileSync(join(SOURCE,FIXTURE,file),join(root,FIXTURE,file));
  }
  git(root,"add","-f","tsconfig.fixtures.json",FIXTURE);git(root,"commit","-qm","one pending outcome");
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
  return {root,planned,record:(env:NodeJS.ProcessEnv)=>spawnTest(process.execPath,[join(root,"tooling/records/record-pending.ts"),"outcomes"],
    {cwd:root,env,encoding:"utf8",maxBuffer:64*2**20},"record-pending outcomes")};
}

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
