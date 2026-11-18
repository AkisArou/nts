// One read-only probe shared by the default-owner regression and its main
// control. It declares its own PID, never a kernel membership enumeration.
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {generatedJavaScript} from './generated-javascript.ts';
export function fixedMembersProbe(source:string,directory:string):string{
  const module=(name:string)=>JSON.stringify(pathToFileURL(join(source,'tooling/gate',name)).href);
  return generatedJavaScript(`import assert from 'node:assert/strict';
import {ownMemoryEnv,ownMemory} from ${module('test-memory.ts')};
import {reserve,readLedger,entryUsage} from ${module('memory-ledger.ts')};
const directory=${JSON.stringify(directory)},bytes=100*2**20;
const env=ownMemoryEnv(directory,process.env,{resident:{kind:'fixed',defaultBytes:bytes}});
const held=await reserve({bytes:2**30,what:'fixed default-owner membership probe',priority:'agent'},{env,used:()=>bytes});
try{
 const entry=readLedger(held.ledger).admitted.find(row=>row.id===held.id);
 assert.ok(entry?.measure.tree&&entry.measure.cgroup);
 let missing;
 try{missing={bytes:entryUsage(entry,{env})};}catch(error){missing={error:String(error)};}
 ownMemory(directory,{resident:{kind:'fixed',defaultBytes:bytes,members:{[entry.measure.cgroup.path]:[process.pid]}}});
 console.log(JSON.stringify({missing,declared:entryUsage(entry,{env}),group:entry.measure.cgroup.path}));
}finally{held.release();await held.closed;}
`);
}
