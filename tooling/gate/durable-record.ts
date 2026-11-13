import { randomUUID } from "node:crypto";
import { closeSync, createWriteStream, fsyncSync, mkdirSync, open, openSync, renameSync, rmSync, write, writev, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {PassThrough} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';

type Publication={path:string;directory:string;temporary:string;file:number|undefined};
function publication(path:string):Publication{
  const directory = dirname(path); mkdirSync(directory, { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}`;
  return {path,directory,temporary,file:openSync(temporary,'wx',0o600)};
}
function publish(record:Publication):void{
  fsyncSync(record.file!);
  const file=record.file!;record.file=undefined;closeSync(file);
  renameSync(record.temporary,record.path);
  for(const path of [record.directory,dirname(record.directory)]){
    const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
  }
}
function removePending(record:Publication):void{
  try{if(record.file!==undefined){const fd=record.file;record.file=undefined;closeSync(fd);}}
  finally{rmSync(record.temporary,{force:true});}
}
export function durableRecord(path: string, value: unknown): void {
  const record=publication(path);
  try {
    writeFileSync(record.file!,JSON.stringify(value,null,2)+'\n');publish(record);
  }finally{removePending(record);}
}

/** A producer supplies bounded chunks, never a complete rendered document.
 * The owner joins compression/output before the same fsync and atomic rename
 * as ordinary records. A producer failure leaves the previous record intact. */
export async function durableRecordStream(path:string,produce:(append:(chunk:string|Uint8Array)=>Promise<void>)=>Promise<void>,options:{gzip?:boolean}={}):Promise<void>{
  const record=publication(path),input=new PassThrough();
  // WriteStream joins pending filesystem operations even when pipeline aborts.
  // Its descriptor is borrowed: only this publication owner fsyncs/closes it.
  // pipeline explicitly destroys streams on failure, so autoClose:false alone
  // does not retain the descriptor. The public fs.close adapter keeps ownership.
  const output=createWriteStream(record.temporary,{fd:record.file!,autoClose:false,
    fs:{open,write,writev,close:(_fd,callback)=>callback(null)}});
  const closed=options.gzip?pipeline(input,createGzip({level:1}),output):pipeline(input,output);
  // Attach immediately; the producer may be between appends when disk fails.
  // The same promise is always joined below before the file can be published.
  void closed.catch(()=>{});
  try{
    await produce(chunk=>new Promise<void>((resolve,reject)=>input.write(chunk,error=>error?reject(error):resolve())));
    input.end();await closed;publish(record);
  }catch(error){
    input.destroy(error instanceof Error?error:new Error(String(error)));
    await closed.catch(()=>{});throw error;
  }finally{removePending(record);}
}
