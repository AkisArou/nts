// Private load-owner negatives. A message, not a timer, triggers the live arm.
import {parentPort,workerData} from 'node:worker_threads';

const {index,stage}=workerData as {index:number;stage:'startup'|'live'};
if(stage==='startup')throw Error('deliberate load startup failure');
if(!parentPort||stage!=='live')throw Error('invalid load failure fixture request');
parentPort.once('message',()=>{throw Error('deliberate live load failure');});
parentPort.postMessage({ready:index});
