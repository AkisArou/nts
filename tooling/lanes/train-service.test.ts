import {test} from "node:test";
import assert from "node:assert/strict";
import {chmodSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {ensureTrain,type TrainOwner} from "./train-service.ts";
import {durableRecord} from "./durable-record.ts";

test("clients retain one owner through active, startup and stop-hook restart states",async t=>{
  const parent=join(homedir(),".cache/nts-scratch/train-service");mkdirSync(parent,{recursive:true});
  const root=mkdtempSync(join(parent,"case-")),state=join(root,"state"),bin=join(root,"bin");
  t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(bin);
  const owner:TrainOwner={version:1,id:"1-abcdef12",unit:"nts-test-land-train-1-abcdef12",root,directory:join(state,"trains/1-abcdef12"),tree:join(state,"trains/1-abcdef12/tree"),sha:"a".repeat(40),phase:"running",log:join(root,"unit.log"),trace:join(root,"train.log")};
  durableRecord(join(state,"train-owner.json"),owner);
  const script=join(bin,"systemctl"),prior=process.env.PATH;
  process.env.PATH=bin+":"+prior;t.after(()=>{process.env.PATH=prior;});
  for(const status of ["active","activating","deactivating"]){
    writeFileSync(script,`#!/bin/sh\nprintf '%s\\n' '${status}'\n`);chmodSync(script,0o755);
    assert.deepEqual(await ensureTrain(root,state,root),owner,status);
  }
});
