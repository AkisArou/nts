import {test} from "node:test";
import assert from "node:assert/strict";
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {abandonFrozen} from "./train-abandon.ts";
import {ensureTrain,type TrainOwner} from "./train-service.ts";
import {durableRecord} from "./durable-record.ts";
import {GateResource} from "./gate-resource.ts";
import {spawnTest} from "../gate/test-wait.ts";

function fixture(t:{after(fn:()=>void):void}){
  const parent=join(homedir(),".cache/nts-scratch/abandon-train");mkdirSync(parent,{recursive:true});
  const root=mkdtempSync(join(parent,"case-")),state=join(root,"state");t.after(()=>rmSync(root,{recursive:true,force:true}));
  const git=(...args:string[])=>{const result=spawnTest("git",args,{cwd:root,encoding:"utf8",env:{...process.env,GIT_AUTHOR_NAME:"t",GIT_AUTHOR_EMAIL:"t@t",GIT_COMMITTER_NAME:"t",GIT_COMMITTER_EMAIL:"t@t"}});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
  git("init","-qb","main");git("commit","--allow-empty","-qm","base");const base=git("rev-parse","HEAD"),tip=git("commit-tree","HEAD^{tree}","-p",base,"-m","candidate");
  const owner:TrainOwner={version:1,id:"1-abcdef12",unit:"nts-test-land-train-1-abcdef12",root,directory:join(state,"trains/1-abcdef12"),tree:join(state,"trains/1-abcdef12/tree"),sha:tip,phase:"running",log:"log",trace:"trace"};
  const entries=[1,2].map(n=>({id:`1-${n}`,sha:String(n).repeat(40),pid:n,tree:join(root,String(n)),at:1,durable:true}));
  const frozen={version:1,phase:"running",entries,composition:{base,tip,members:entries.map(entry=>({entry,landing:entry.sha}))}};
  durableRecord(join(state,"train-owner.json"),owner);durableRecord(join(owner.directory,"owner.json"),owner);durableRecord(join(state,"frozen-train.json"),frozen);
  for(const entry of entries)durableRecord(join(state,"pending",entry.id+".json"),entry);
  const run=join(root,"raw-run");mkdirSync(run);writeFileSync(join(run,"summary.json"),"original raw evidence\n");
  return {root,state,owner,entries,frozen,run,git};
}
test("abandonment requires a stopped exact owner and an explicit evidence-backed reason",async t=>{
  const f=fixture(t);
  await assert.rejects(abandonFrozen(f.state,f.owner.id,"",f.run),/requires/);
  await assert.rejects(abandonFrozen(f.state,"2-abcdef12","hung",f.run),/registered owner/);
  await assert.rejects(abandonFrozen(f.state,f.owner.id,"hung",f.run,{unitState:()=>"active"}),/stop /);
  assert.equal(JSON.parse(readFileSync(join(f.state,"frozen-train.json"),"utf8")).phase,"running");
  assert.ok(existsSync(join(f.state,"pending",f.entries[0].id+".json")));
});
test("operator abandonment answers only frozen members without writing another holder's status",async t=>{
  const f=fixture(t),held=GateResource.tryAcquire(join(f.root,"nts-land.lock"))!;t.after(()=>held.close());
  const status=join(f.state,"status.json"),originalStatus=JSON.stringify({state:"gating",holder_unit:"another-unit",commit:f.owner.sha});writeFileSync(status,originalStatus);
  durableRecord(join(f.state,"pending/1-3.json"),{id:"1-3",sha:"c".repeat(40)});
  const path=await abandonFrozen(f.state,f.owner.id,"hung tooling fixture",f.run,{unitState:()=>"inactive"});
  const original=readFileSync(path,"utf8");
  assert.equal(await abandonFrozen(f.state,f.owner.id,"hung tooling fixture",f.run,{unitState:()=>"inactive"}),path);
  assert.equal(readFileSync(path,"utf8"),original);
  await assert.rejects(abandonFrozen(f.state,f.owner.id,"a different note",f.run,{unitState:()=>"inactive"}),/immutable/);
  for(const entry of f.entries){assert.equal(JSON.parse(readFileSync(join(f.state,"results",entry.id+".json"),"utf8")).state,"abandoned");assert.ok(!existsSync(join(f.state,"pending",entry.id+".json")));}
  assert.ok(existsSync(join(f.state,"pending/1-3.json")));
  assert.equal(readFileSync(join(f.run,"summary.json"),"utf8"),"original raw evidence\n");
  assert.equal(readFileSync(status,"utf8"),originalStatus);
  assert.equal(JSON.parse(readFileSync(join(f.state,"frozen-train.json"),"utf8")).phase,"abandoned");
});
test("abandonment clears its stale gating status only after a nonblocking landing-lock acquisition",async t=>{
  const f=fixture(t),path=join(f.state,"status.json"),original=JSON.stringify({state:"gating",holder_unit:f.owner.unit,commit:f.owner.sha});writeFileSync(path,original);
  const lock=GateResource.tryAcquire(join(f.root,"nts-land.lock"))!;
  try{await abandonFrozen(f.state,f.owner.id,"operator stopped train",f.run,{unitState:()=>"inactive"});assert.equal(readFileSync(path,"utf8"),original);}finally{lock.close();}
  await abandonFrozen(f.state,f.owner.id,"operator stopped train",f.run,{unitState:()=>"inactive"});
  const result=JSON.parse(readFileSync(path,"utf8"));assert.equal(result.state,"abandoned");assert.equal(result.holder_unit,null);assert.equal(result.run,f.run);assert.equal(result.reason,"operator stopped train");
});
test("a recorded unfinished abandonment blocks service launches until operator recovery",async t=>{
  const f=fixture(t);durableRecord(join(f.state,"train-abandonments",f.owner.id+".json"),{version:1,reason:"hung",run:f.run,tip:f.frozen.composition.tip,frozen:f.frozen});
  await assert.rejects(ensureTrain(f.root,f.state,f.root),/finish the recorded operator abandonment/);
  await abandonFrozen(f.state,f.owner.id,"hung",f.run,{unitState:()=>"inactive"});
  assert.equal(JSON.parse(readFileSync(join(f.state,"frozen-train.json"),"utf8")).phase,"abandoned");
});
test("operator abandonment cannot refuse a frozen tip already on main",async t=>{
  const f=fixture(t);f.git("update-ref","refs/heads/main",f.frozen.composition.tip);
  await assert.rejects(abandonFrozen(f.state,f.owner.id,"hung",f.run,{unitState:()=>"inactive"}),/already on main/);
  assert.ok(existsSync(join(f.state,"pending",f.entries[0].id+".json")));
});
