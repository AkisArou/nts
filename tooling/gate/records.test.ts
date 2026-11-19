import {RUST_RUNTIME_DECLARATIONS} from './rust-selector-selection.ts';
import {RUST_SELECTOR_RECORD} from './rust-selector-record.ts';
import {fixtureInput} from './reader-inputs/main.ts';
import {gitArguments} from "./git-arguments/main.ts";
import {copyModuleClosure} from './module-closure-fixture.ts';
import {testEnvironment} from "./test-environment.ts";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {existsSync,mkdirSync,readdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {dirname,join,relative} from "node:path";
import {fileURLToPath} from "node:url";
import {test} from "node:test";
import {COLUMNS,COMPARATORS,POLICY,publishRun,sealRun,renderFull} from "../bench/run-record.ts";
import {KNOWN_DUPLICATE_RECORDS,recordNumbers} from "./record-numbers.ts";
// The records step and tooling both exercise the canonical validator controls.
import "../bench/run-record.test.ts";
import {newTestScratch} from "./test-scratch.ts";
import {writeRecords} from "../differential/oracle-records.ts";
import {CENSUS_PRODUCER_INPUTS,CENSUS_STORE,memoryPrograms} from "../records/memory-census.ts";

test("record numbering preserves named collisions and refuses new or stale allowances",()=>{
  const names=KNOWN_DUPLICATE_RECORDS.flatMap(number=>[number+"-first.md",number+"-second.md"]);
  assert.deepEqual(recordNumbers([...names,"notes","123-not-a-record.md","1234-once.md"]),{count:9,unexpected:[],stale:[]});
  assert.deepEqual(recordNumbers([...names,"1234-a.md","1234-b.md"]).unexpected,[["1234",["1234-a.md","1234-b.md"]]]);
  assert.deepEqual(recordNumbers(names.filter(name=>name!=="0099-second.md")).stale,["0099"]);
  assert.deepEqual(recordNumbers(names.filter(name=>!name.startsWith("0099"))).stale,["0099"]);
});

test("the real records step validates benchmark evidence and its rendered table",()=>{
  const root=newTestScratch("records-step");
  const ratchet=join(root,'results/record-sizes.json'),tableBound=16*1024;
  const runGit=(...args:string[])=>{
    const result=spawnSync("git",gitArguments(args),{env:testEnvironment(),cwd:root,encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);return result.stdout;
  };
  const call=()=>spawnSync("sh",["tooling/gate/all.sh","--call","records"],{env:testEnvironment(),cwd:root,encoding:"utf8"});
  const record=(...args:string[])=>spawnSync(process.execPath,['tooling/gate/records.ts',root,'--record',...args],{env:testEnvironment(),cwd:root,encoding:'utf8'});
  try {
    for(const input of ["docs/records","docs/foundations","results/benchmarks/runs","tests/programs","benchmarks/cases"])mkdirSync(join(root,input),{recursive:true});
    copyModuleClosure([fixtureInput(new URL("./records.ts",import.meta.url),{dataNamespaces:{"docs/records":"records CLI control","docs/foundations":"records CLI control","results/benchmarks":"records CLI control","tests/programs":"records CLI control","benchmarks/cases":"records CLI control"}})],root);
    assert.ok(!existsSync(join(root,'Cargo.toml')),'census provenance must not stage a Cargo workspace');
    const source=fileURLToPath(new URL('../..',import.meta.url));
    const compilerInputs=CENSUS_PRODUCER_INPUTS.map(url=>relative(source,fileURLToPath(url))).filter(path=>path.startsWith('compiler/')).sort();
    const stagedCompiler=existsSync(join(root,'compiler'))?readdirSync(join(root,'compiler'),{withFileTypes:true,recursive:true}).filter(entry=>entry.isFile()).map(entry=>relative(root,join(entry.parentPath,entry.name))).sort():[];
    assert.deepEqual(stagedCompiler,compilerInputs,'only the production-declared census projection is staged under compiler/');
    // The copied CLI includes selector assets and the census store, but this
    // benchmark-only repository declares no Rust harness and no memory group.
    // Its private mutation retains those genuine negatives.
    for(const path of [RUST_RUNTIME_DECLARATIONS,RUST_SELECTOR_RECORD])rmSync(join(root,path),{force:true});
    rmSync(join(root,CENSUS_STORE),{recursive:true,force:true});
    assert.deepEqual(memoryPrograms(root),[],'the fixture declares an empty census population');
    assert.deepEqual(readdirSync(join(root,'docs/records')),[],'the record-number control starts with no production records');
    writeFileSync(join(root,"docs/primitives.md"),"fixture\n");
    assert.deepEqual(readdirSync(join(root,"results/benchmarks/runs")),[]);
    for(const path of ["tooling/gate/all.sh"]) {
      mkdirSync(dirname(join(root,path)),{recursive:true});
      writeFileSync(join(root,path),readFileSync(fileURLToPath(new URL("../../"+path,import.meta.url))));
    }
    mkdirSync(join(root,"docs/records"),{recursive:true});
    mkdirSync(join(root,"tests/programs"),{recursive:true});
    mkdirSync(join(root,"benchmarks/cases"),{recursive:true});
    writeRecords(root,{version:1,generator_version:1,generator_digest:"a".repeat(32),seed:null,rows:[]});
    for(const number of KNOWN_DUPLICATE_RECORDS)for(const suffix of ["first","second"])writeFileSync(join(root,`docs/records/${number}-${suffix}.md`),"fixture\n");
    assert.equal(record('--initialize').status,1,'initialization cannot replace the staged production ratchet');
    rmSync(ratchet);
    const legacy=join(root,'docs/records/legacy.json'),legacyBytes=tableBound+1;
    writeFileSync(legacy,'x'.repeat(legacyBytes));
    const initialized=record('--initialize');assert.equal(initialized.status,0,initialized.stderr);
    assert.equal(JSON.parse(readFileSync(ratchet,'utf8')).files['docs/records/legacy.json'],legacyBytes);
    runGit("init","-q");runGit("config","user.name","records control");runGit("config","user.email","test@example.invalid");
    runGit("add",".");runGit("commit","-qm","records fixture");
    const pin="a".repeat(40),digest="b".repeat(64),at="2026-10-29T12:00:00.000Z";
    const run=sealRun({schemaVersion:1,id:"2026-10-29-"+pin+"-records",startedAt:at,finishedAt:at,complete:true,
      inventory:["one"],columns:[...COLUMNS],sourceCommit:pin,compiler:{commit:pin,sha256:digest},
      harness:{identity:digest,contract:"opaque-bit-input-v1",files:[{path:"loop.ts",sha256:digest}]},machine:{identity:"records-control",conditions:null},
      comparators:Object.fromEntries(COMPARATORS.map(name=>[name,{version:"1",commit:pin,sha256:digest,command:[name]}])),verdictPolicy:POLICY,provenance:{kind:"test"},
      rows:[{name:"one",workloadIdentity:digest,eligibleForBest:true,conditions:null,
        cells:Object.fromEntries(COLUMNS.map(name=>[name,{status:"OK",nanoseconds:name==="nts C"?80:100,spread:1,checksum:"4000000000000000",verified:true,reason:null,details:null}])),verdicts:{}}]});
    const path=publishRun(root,run),page=join(root,"results/benchmarks/full.md");
    const original=readFileSync(path,"utf8"),rendered=readFileSync(page,"utf8");
    const good=call();assert.equal(good.status,0,good.stderr);
    // The census guard still refuses a record outside the fixture's population.
    const outside=join(root,CENSUS_STORE,'foreign.json');mkdirSync(dirname(outside),{recursive:true});writeFileSync(outside,'{}\n');
    const foreign=call();assert.equal(foreign.status,1);assert.match(foreign.stderr,/foreign memory census record: foreign\.json/);
    rmSync(join(root,CENSUS_STORE),{recursive:true,force:true});
    writeFileSync(path,"{broken");assert.equal(call().status,1);
    const forged=JSON.parse(original);forged.rows[0].verdicts["nts C"].node.kind="LOSS";
    writeFileSync(path,JSON.stringify(forged));const verdict=call();assert.equal(verdict.status,1);assert.match(verdict.stderr,/recorded verdict/);
    writeFileSync(path,original);writeFileSync(page,rendered+"hand edit\n");
    const drift=call();assert.equal(drift.status,1);assert.match(drift.stderr,/shared renderer/);
    writeFileSync(page,rendered);rmSync(path);
    const missing=call();assert.equal(missing.status,1);assert.match(missing.stderr,/missing immutable/);
    forged.rows[0].cells["nts C"].nanoseconds=70;const resealed=sealRun(forged);
    writeFileSync(path,JSON.stringify(resealed,null,2)+"\n");writeFileSync(page,renderFull([resealed]));
    const rewritten=call();assert.equal(rewritten.status,1);assert.match(rewritten.stderr,/immutable.*rewritten/);
    writeFileSync(path,original);writeFileSync(page,rendered);
    const restored=call();assert.equal(restored.status,0,restored.stderr);
    const raw=join(root,'docs/records/raw.json');writeFileSync(raw,'x'.repeat(tableBound+1));
    const rejected=call();assert.equal(rejected.status,1);assert.match(rejected.stderr,/docs\/records\/raw.json: 16385 bytes; bound 0 bytes/);
    assert.match(rejected.stderr,/raw output stays in kept scratch, cited by path and SHA-256/);rmSync(raw);
    writeFileSync(join(root,'docs/records/written.md'),'written evidence\n'.repeat(2000));
    assert.equal(call().status,0,'written Markdown needs no size row');
    const oversized=join(root,'docs/records/oversized.tsv');writeFileSync(oversized,'x'.repeat(tableBound+1));
    const tooLarge=call();assert.equal(tooLarge.status,1);assert.match(tooLarge.stderr,/oversized.tsv: 16385 bytes; bound 16384 bytes/);rmSync(oversized);
    writeFileSync(join(root,'docs/records/decision.tsv'),'arm\tverdict\ncurrent\tPASS\n');
    const table=record();assert.equal(table.status,0,table.stderr);
    const written=call();assert.equal(written.status,0,written.stderr);
    const ratchetBefore=readFileSync(ratchet);
    writeFileSync(legacy,'x'.repeat(legacyBytes+1));
    const grown=call();assert.equal(grown.status,1);assert.match(grown.stderr,/legacy.json: 16386 bytes; bound 16385 bytes/);
    const forbiddenRefresh=record();assert.equal(forbiddenRefresh.status,1);assert.match(forbiddenRefresh.stderr,/recorded size may only fall/);
    assert.deepEqual(readFileSync(ratchet),ratchetBefore,'--record never masks growth');
    writeFileSync(legacy,'x');assert.equal(call().status,1,'the lower size must be retained before it can land');
    const lower=record();assert.equal(lower.status,0,lower.stderr);
    assert.equal(JSON.parse(readFileSync(ratchet,'utf8')).files['docs/records/legacy.json'],1);
    writeFileSync(legacy,'xx');assert.equal(call().status,1,'a refreshed lower bound cannot regrow');writeFileSync(legacy,'x');
    rmSync(legacy);const departed=call();assert.equal(departed.status,1);assert.match(departed.stderr,/legacy.json: absent;.*--record/);
    const removed=record();assert.equal(removed.status,0,removed.stderr);
    assert.equal(Object.hasOwn(JSON.parse(readFileSync(ratchet,'utf8')).files,'docs/records/legacy.json'),false);
    const exact=call();assert.equal(exact.status,0,exact.stderr);
    const subject=join(root,"tests/programs/pending");mkdirSync(join(subject,"src"),{recursive:true});
    writeFileSync(join(subject,"tsconfig.json"),'{"files":["src/main.ts"]}');
    writeFileSync(join(subject,"src/main.ts"),"export function work(n:number):number{return n;}\n");
    const pending=call();assert.equal(pending.status,0,pending.stderr);
    assert.match(pending.stdout,/pending: tests\/programs\/pending is not recorded in results\/oracle-counts\/tests\/programs\/pending\.json yet/,
      "the controller must see pending work even when no other step lists it");
    writeFileSync(join(root,"docs/records/1234-a.md"),"first\n");writeFileSync(join(root,"docs/records/1234-b.md"),"second\n");
    const duplicate=call();assert.equal(duplicate.status,1);assert.match(duplicate.stderr,/1234-a.md/);assert.match(duplicate.stderr,/1234-b.md/);
    rmSync(join(root,"docs/records/1234-b.md"));rmSync(join(root,"docs/records/0099-second.md"));
    const stale=call();assert.equal(stale.status,1);assert.match(stale.stderr,/KNOWN_DUPLICATE_RECORDS: 0099/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
