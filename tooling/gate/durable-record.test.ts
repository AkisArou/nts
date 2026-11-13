import assert from 'node:assert/strict';
import {readFileSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
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

