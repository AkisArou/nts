// An on-demand experiment worker. Its parent owns the shared stop flag and
// waits for thread exit; readiness follows the first completed work block.
import {parentPort,workerData} from 'node:worker_threads';

const {shared,index}=workerData as {shared:SharedArrayBuffer;index:number};
if(!parentPort||!(shared instanceof SharedArrayBuffer)||!Number.isSafeInteger(index)||index<1)
  throw Error('invalid CPU load worker request');
const state=new Uint32Array(shared);
if(index>=state.length)throw Error('CPU load worker index is outside its owned state');
let value=1,ready=false;
while(Atomics.load(state,0)===0){
  for(let n=0;n<10_000;n++)value=Math.imul(value+1,1664525);
  Atomics.add(state,index,1);
  if(!ready){ready=true;parentPort.postMessage({ready:index});}
}
// Preserve the computation without publishing data during the busy loop.
parentPort.postMessage({stopped:index,value});
