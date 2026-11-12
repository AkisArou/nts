import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {acquire,holder} from './lock.ts';
import {stagedLock,lockChild,ACQUIRE_CHILD} from './lock-fixture.ts';
import {SourceFacts} from '../gate/source-facts.ts';
import {testScratch} from '../gate/test-scratch.ts';

const users=[
  {name:'landing service',reader:new URL('./service.ts',import.meta.url),path:'serve.lock'},
  {name:'landing queue',reader:new URL('./queue.ts',import.meta.url),path:'serve.lock'},
  {name:'landing check',reader:new URL('./check.ts',import.meta.url),path:'serve.lock'},
  {name:'disk capacity',reader:new URL('../gate/disk-capacity.ts',import.meta.url),path:'.lock'},
  {name:'Node cache retention',reader:new URL('../full-check/node-cache-retention.ts',import.meta.url),path:'retention.lock'},
];

for(const user of users)test(user.name+' uses a complete exclusive owner publication',async t=>{
  const {API}=createRequire(import.meta.url)('typescript/sync') as typeof import('typescript/sync'),api=new API();
  const source=readFileSync(user.reader,'utf8'),lease=api.createSourceFile(fileURLToPath(user.reader),source);
  try{
    const edges=new SourceFacts(fileURLToPath(user.reader),source,lease.sourceFile).moduleDeclarations();
    assert.ok(edges.imports.some(edge=>new URL(edge,user.reader).href===new URL('./lock.ts',import.meta.url).href),user.name+' still uses this owner');
  }finally{lease.dispose();api.close();}
  const f=stagedLock(t,'publication'),path=join(f.root,user.path),entry=pathToFileURL(f.file).href;
  const first=lockChild(t,ACQUIRE_CHILD,[entry,path,'762-pause']);await first.wait('barrier');
  const second=lockChild(t,ACQUIRE_CHILD,[entry,path]);await second.wait('entered:');
  first.child.stdin.write('x');await first.wait('entered:');
  assert.equal(first.output().includes('entered:true'),false,'the paused publisher cannot enter after its competitor');
  assert.equal(second.output(),'entered:true\n');
  first.child.stdin.end();second.child.stdin.end();
  assert.deepEqual(await Promise.all([first.closed,second.closed]),[0,0]);
  assert.equal(existsSync(path),false);
  assert.deepEqual(readdirSync(f.root).filter(name=>name.startsWith(user.path+'.')),[],'publication candidates are removed');
});

test('a stale dead-owner observation cannot unlink a replacement live owner',async t=>{
  const f=stagedLock(t,'observation'),path=join(f.root,'owner.lock'),entry=pathToFileURL(f.file).href;
  writeFileSync(path,'00000000-0000-0000-0000-000000000000 2147483647 1\n');
  const first=lockChild(t,ACQUIRE_CHILD,[entry,path,'762-pause']);await first.wait('barrier');
  const second=lockChild(t,ACQUIRE_CHILD,[entry,path]);await second.wait('entered:true');
  const replacement=readFileSync(path);
  first.child.stdin.write('x');await first.wait('entered:');
  assert.equal(first.output().includes('entered:true'),false);
  assert.deepEqual(readFileSync(path),replacement);
  first.child.stdin.end();second.child.stdin.end();assert.deepEqual(await Promise.all([first.closed,second.closed]),[0,0]);
});

test('the reclamation flock remains owned by the parent after flock exits',async t=>{
  const f=stagedLock(t,'reclamation'),path=join(f.root,'owner.lock'),entry=pathToFileURL(f.file).href;
  const dead='00000000-0000-0000-0000-000000000000 2147483647 1\n';writeFileSync(path,dead);
  const first=lockChild(t,ACQUIRE_CHILD,[entry,path,'762-pause']);await first.wait('barrier');
  const second=lockChild(t,ACQUIRE_CHILD,[entry,path]);await second.wait('entered:');
  assert.equal(second.output(),'entered:false\n');assert.equal(readFileSync(path,'utf8'),dead);
  first.child.stdin.write('x');await first.wait('entered:true');
  first.child.stdin.end();second.child.stdin.end();assert.deepEqual(await Promise.all([first.closed,second.closed]),[0,0]);
});

test('empty and malformed owners refuse by path and exact bytes without deleting anything',t=>{
  const root=testScratch(t,'corrupt-owner'),path=join(root,'owner.lock');
  for(const bytes of [Buffer.alloc(0),Buffer.from('garbage\n'),Buffer.from([0xff]),Buffer.from('00000000-0000-0000-0000-000000000000 0 1\n')]){
    writeFileSync(path,bytes);
    for(const action of [()=>acquire(path),()=>holder(path)])assert.throws(action,error=>{
      assert.ok(error instanceof Error);assert.ok(error.message.includes(path));assert.ok(error.message.includes(JSON.stringify(bytes.toString('utf8'))));
      assert.match(error.message,/confirm that no process.*alive, then remove this file/);return true;
    });
    assert.deepEqual(readFileSync(path),bytes);
  }
});

test('release is idempotent and cannot delete a later acquisition by the same process',t=>{
  const path=join(testScratch(t,'owner-release'),'owner.lock'),first=acquire(path)!;first.release();
  const second=acquire(path)!;assert.ok(second);first.release();assert.equal(holder(path),process.pid);second.release();
});

test('dead unpublished candidates are collected while live and unrelated files stay',t=>{
  const root=testScratch(t,'owner-candidates'),path=join(root,'owner.lock');
  const dead=path+'.2147483647.00000000-0000-0000-0000-000000000000';
  const live=path+'.'+process.pid+'.00000000-0000-0000-0000-000000000001',unrelated=path+'.unrelated';
  for(const name of [dead,live,unrelated])writeFileSync(name,'candidate');
  const held=acquire(path)!;assert.ok(held);
  assert.equal(existsSync(dead),false,'an orphan before public publication is still collected');
  assert.equal(readFileSync(live,'utf8'),'candidate');assert.equal(readFileSync(unrelated,'utf8'),'candidate');
  held.release();
  writeFileSync(path,'00000000-0000-0000-0000-000000000000 2147483647 1\n');writeFileSync(dead,'abandoned');
  const reclaimed=acquire(path)!;assert.ok(reclaimed);assert.equal(existsSync(dead),false);assert.equal(existsSync(live),true);reclaimed.release();
});
