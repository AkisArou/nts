// Ready intents are private-check proofs awaiting a train boundary, not a
// second blocking lock queue. Atomic publication makes each snapshot complete.
import {existsSync,mkdirSync,readdirSync,readFileSync,renameSync,rmSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import type {Author} from "./verification-ledger.ts";
export type ReadyProof={base:string;tip:string;checked:string;run:string;author:Author};
export type ReadyEntry={version:1;id:string;sha:string;tree:string;pid:number;at:number;proof:ReadyProof;blockedReason?:string};
export function publishReady(directory:string,entry:ReadyEntry):void {
 mkdirSync(directory,{recursive:true});
 if(!/^ready-[a-zA-Z0-9-]+$/.test(entry.id))throw new Error("invalid ready identity");
 const path=join(directory,entry.id+".json");
 writeFileSync(path+".tmp",JSON.stringify(entry));renameSync(path+".tmp",path);
}
export function removeReady(directory:string,id:string):void {rmSync(join(directory,id+".json"),{force:true});}
export function snapshotReady(directory:string):ReadyEntry[] {
 if(!existsSync(directory))return [];
 return readdirSync(directory).filter(file=>/^ready-[a-zA-Z0-9-]+\.json$/.test(file)).map(file=>{
  const entry=JSON.parse(readFileSync(join(directory,file),"utf8")) as ReadyEntry;
  const sha=(s:unknown)=>typeof s==="string"&&/^[a-f0-9]{40}$/.test(s);
  if(entry.version!==1||entry.id+".json"!==file||!sha(entry.sha)||!sha(entry.proof?.base)||!sha(entry.proof?.tip)||!Number.isInteger(entry.pid)||entry.pid<=0||!Number.isFinite(entry.at)||typeof entry.tree!=="string"||typeof entry.proof?.checked!=="string"||typeof entry.proof?.run!=="string"||!entry.proof?.author)throw new Error(`invalid ready entry ${file}`);
  return entry;
 }).sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
}
