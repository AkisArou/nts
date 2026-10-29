import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {test} from "node:test";
import {COLUMNS,COMPARATORS,POLICY,publishRun,sealRun,renderFull} from "../bench/run-record.ts";
import {KNOWN_DUPLICATE_RECORDS,recordNumbers} from "./records.ts";
// The records step and tooling both exercise the canonical validator controls.
import "../bench/run-record.test.ts";

test("record numbering preserves named collisions and refuses new or stale allowances",()=>{
  const names=KNOWN_DUPLICATE_RECORDS.flatMap(number=>[number+"-first.md",number+"-second.md"]);
  assert.deepEqual(recordNumbers([...names,"notes","123-not-a-record.md","1234-once.md"]),{count:9,unexpected:[],stale:[]});
  assert.deepEqual(recordNumbers([...names,"1234-a.md","1234-b.md"]).unexpected,[["1234",["1234-a.md","1234-b.md"]]]);
  assert.deepEqual(recordNumbers(names.filter(name=>name!=="0099-second.md")).stale,["0099"]);
  assert.deepEqual(recordNumbers(names.filter(name=>!name.startsWith("0099"))).stale,["0099"]);
});

test("the real records step validates benchmark evidence and its rendered table",()=>{
  const parent=join(homedir(),".cache/nts-scratch/records-step");mkdirSync(parent,{recursive:true});
  const root=mkdtempSync(join(parent,"test-"));
  const runGit=(...args:string[])=>{
    const result=spawnSync("git",args,{cwd:root,encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);return result.stdout;
  };
  const call=()=>spawnSync("sh",["tooling/gate/all.sh","--call","records"],{cwd:root,encoding:"utf8"});
  try {
    for(const path of ["tooling/gate/all.sh","tooling/gate/records.ts","tooling/bench/run-record.ts"]) {
      mkdirSync(dirname(join(root,path)),{recursive:true});
      writeFileSync(join(root,path),readFileSync(fileURLToPath(new URL("../../"+path,import.meta.url))));
    }
    mkdirSync(join(root,"docs/records"),{recursive:true});
    for(const number of KNOWN_DUPLICATE_RECORDS)for(const suffix of ["first","second"])writeFileSync(join(root,`docs/records/${number}-${suffix}.md`),"fixture\n");
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
    writeFileSync(join(root,"docs/records/1234-a.md"),"first\n");writeFileSync(join(root,"docs/records/1234-b.md"),"second\n");
    const duplicate=call();assert.equal(duplicate.status,1);assert.match(duplicate.stderr,/1234-a.md/);assert.match(duplicate.stderr,/1234-b.md/);
    rmSync(join(root,"docs/records/1234-b.md"));rmSync(join(root,"docs/records/0099-second.md"));
    const stale=call();assert.equal(stale.status,1);assert.match(stale.stderr,/KNOWN_DUPLICATE_RECORDS: 0099/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
