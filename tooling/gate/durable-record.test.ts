import assert from 'node:assert/strict';
import {constants} from 'node:buffer';
import {createReadStream,existsSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGunzip} from 'node:zlib';
import {test} from 'node:test';
import {durableRecord,durableRecordStream} from './durable-record.ts';
import {newTestScratch} from './test-scratch.ts';

test('stream publication keeps the previous record until checked completion and removes failed stages',async t=>{
  const root=newTestScratch('durable-stream');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const path=join(root,'record.json');durableRecord(path,{before:true});
  let finish!:()=>void;const barrier=new Promise<void>(resolve=>{finish=resolve;});
  let ready!:()=>void;const staged=new Promise<void>(resolve=>{ready=resolve;});
  const publication=durableRecordStream(path,async append=>{await append('{"after":');ready();await barrier;await append('true}\n');});
  await staged;assert.deepEqual(JSON.parse(readFileSync(path,'utf8')),{before:true});
  finish();await publication;assert.deepEqual(JSON.parse(readFileSync(path,'utf8')),{after:true});
  await assert.rejects(durableRecordStream(path,async append=>{await append(Buffer.alloc(1024*1024));throw Error('producer refused');}),/producer refused/);
  assert.deepEqual(JSON.parse(readFileSync(path,'utf8')),{after:true});
  assert.deepEqual(readdirSync(root),['record.json']);
});

test('a compressed record can exceed one JavaScript string while keeping bounded chunks',async t=>{
  const root=newTestScratch('durable-stream-scale');t.after(()=>rmSync(root,{recursive:true,force:true}));
  assert.throws(()=>'x'.repeat(constants.MAX_STRING_LENGTH+1),RangeError);
  const path=join(root,'large.jsonl.gz'),row=JSON.stringify({value:'x'.repeat(64*1024)})+'\n';
  const repeats=Math.ceil(constants.MAX_STRING_LENGTH/Buffer.byteLength(row))+1;
  await durableRecordStream(path,async append=>{for(let index=0;index<repeats;index++)await append(row);},{gzip:true});
  assert.ok(existsSync(path));let bytes=0,lines=0,maxChunk=0;
  await pipeline(createReadStream(path),createGunzip(),new Writable({write(chunk:Buffer,_encoding,callback){
    bytes+=chunk.length;maxChunk=Math.max(maxChunk,chunk.length);
    for(let at=chunk.indexOf(10);at>=0;at=chunk.indexOf(10,at+1))lines++;
    callback();
  }}));
  assert.equal(bytes,repeats*Buffer.byteLength(row));assert.ok(bytes>constants.MAX_STRING_LENGTH);assert.equal(lines,repeats);
  assert.ok(maxChunk<=64*1024);assert.deepEqual(readdirSync(root),['large.jsonl.gz']);
});
