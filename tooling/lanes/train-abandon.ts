// Operator decisions are durable provenance, separate from a measured verdict.
import {existsSync,readFileSync,rmSync} from "node:fs";
import {dirname,join} from "node:path";
import {spawnSync} from "node:child_process";
import {durableRecord} from "./durable-record.ts";
import {trainOwner,trainUnitState,withTrainLaunchLock} from "./train-service.ts";
import {GateResource} from "./gate-resource.ts";

/** Another train may own status even while this stopped owner is abandoned. */
function reconcileStatus(state:string,unit:string,record:string,reason:string,run:string):void {
  const lock=GateResource.tryAcquire(join(dirname(state),"nts-land.lock"));
  if(!lock)return;
  try {
    const path=join(state,"status.json");
    if(!existsSync(path))return;
    let previous;
    try{previous=JSON.parse(readFileSync(path,"utf8"));}catch(error){if(error instanceof SyntaxError)return;throw error;}
    if(previous.holder_unit!==unit)return;
    durableRecord(path,{...previous,at:new Date().toISOString(),state:"abandoned",holder_unit:null,reason,run,abandonment:record});
  } finally {lock.close();}
}

export async function abandonFrozen(state:string,id:string,reason:string,run:string,options:{unitState?:(unit:string)=>string}={}) {
  if(!reason.trim()||!run.trim())throw new Error("abandonment requires --because=<reason> and --run=<evidence path>");
  return withTrainLaunchLock(state,()=>{
    const owner=trainOwner(state);
    if(!owner||owner.id!==id)throw new Error("the requested train is not the registered owner");
    const inactive=()=>["inactive","failed"].includes((options.unitState??trainUnitState)(owner.unit));
    if(!inactive())throw new Error(`stop ${owner.unit} before abandoning its frozen train`);
    const path=join(state,"frozen-train.json"),frozen=JSON.parse(readFileSync(path,"utf8"));
    const record=join(state,"train-abandonments",id+".json");
    if(frozen.phase==="abandoned"){
      if(!existsSync(record))throw new Error("abandoned train lacks its operator record");
      const prior=JSON.parse(readFileSync(record,"utf8"));
      if(prior.reason!==reason||prior.run!==run)throw new Error("operator abandonment is immutable");
      reconcileStatus(state,owner.unit,record,reason,run);
      return record;
    }
    if(frozen.version!==1||frozen.phase!=="running"||!frozen.composition||!Array.isArray(frozen.entries)||!frozen.entries.length)throw new Error("no running frozen train to abandon");
    const landed=spawnSync("git",["merge-base","--is-ancestor",frozen.composition.tip,"main"],{cwd:owner.root,encoding:"utf8"});
    if(landed.error||!['0','1'].includes(String(landed.status)))throw new Error(`cannot establish frozen train ancestry: ${landed.error?.message??landed.stderr}`);
    if(landed.status===0)throw new Error("the frozen tip is already on main; recover its ledger instead of refusing it");
    for(const entry of frozen.entries)if(!/^\d+-\d+$/.test(entry.id)||!frozen.composition.members.some(member=>member.entry.id===entry.id&&member.entry.sha===entry.sha))throw new Error("invalid frozen member");
    for(const entry of frozen.entries){const result=join(state,"results",entry.id+".json");if(existsSync(result)&&JSON.parse(readFileSync(result,"utf8")).state==="landed")throw new Error("a frozen member already landed; recover its ledger instead");}
    if(existsSync(record)){
      const prior=JSON.parse(readFileSync(record,"utf8"));
      if(prior.reason!==reason||prior.run!==run||prior.tip!==frozen.composition.tip)throw new Error("operator abandonment is immutable");
    }else durableRecord(record,{version:1,at:new Date().toISOString(),operator:"explicit command",unit:owner.unit,tip:frozen.composition.tip,reason,run,frozen});
    // Launches are serialized, and only this inactive service owns the frozen
    // store. A legacy train may keep running under the independent gate locks.
    if(!inactive())throw new Error("train became active during abandonment; intent retained");
    for(const entry of frozen.entries){
      const result=join(state,"results",entry.id+".json");
      if(!existsSync(result))durableRecord(result,{state:"abandoned",message:`operator refused ${entry.sha.slice(0,12)}: ${reason}`,run,abandonment:record});
      const disposition=join(state,"submission-dispositions",entry.id+".json");
      if(!existsSync(disposition))durableRecord(disposition,{entry,state:"refused",operator:record});
      for(const directory of ["pending","queue"])rmSync(join(state,directory,entry.id+".json"),{force:true});
    }
    durableRecord(path,{version:1,phase:"abandoned",nextLimit:6,abandonment:record});
    owner.phase="retiring";durableRecord(join(owner.directory,"owner.json"),owner);durableRecord(join(state,"train-owner.json"),owner);
    reconcileStatus(state,owner.unit,record,reason,run);
    return record;
  });
}
