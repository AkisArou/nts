import {test} from 'node:test';
import assert from 'node:assert/strict';
import {closeSync,existsSync,mkdirSync,openSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {TreePin} from './tree-pin.ts';
import {processIdentity,withLock} from './lock.ts';
import {observeTreeProcesses} from './tree-users.ts';
import {testScratch} from '../gate/test-scratch.ts';

test('one pin ignores only its own descriptor after pid and birth validation',t=>{
  const root=join(testScratch(t,'tree-pin-owner'),'tree');mkdirSync(root);
  const pin=withLock(root+'.lock',()=>TreePin.open(root));let other:number|undefined;
  try{
    const own=observeTreeProcesses([root],{pids:[process.pid],ownPin:pin});assert.deepEqual(own.users,[]);
    assert.equal(TreePin.users(root).length,1,'another same-process operation sees the pin');
    assert.deepEqual(TreePin.users(root,pin),[],'only this capability ignores its pin');
    const file=join(root,'unrelated');writeFileSync(file,'another owner');other=openSync(file,'r');
    const reading=observeTreeProcesses([root],{pids:[process.pid],ownPin:pin});
    assert.equal(reading.users[0]?.link,'fd/'+other,'inspection continues after the owned pin');
    assert.equal(pin.owns(process.pid,'fd/'+other,processIdentity(process.pid)!.split(' ')[2]!),false);
  }finally{if(other!==undefined)closeSync(other);pin.close();}
  assert.deepEqual(TreePin.users(root),[]);
});

test('a second pin of the same process remains visible to the first operation',t=>{
  const root=join(testScratch(t,'tree-pin-peers'),'tree');mkdirSync(root);
  const first=TreePin.open(root),second=TreePin.open(root);
  try{
    assert.equal(TreePin.users(root,first).length,1);assert.equal(TreePin.users(root,second).length,1);
    assert.equal(observeTreeProcesses([root],{pids:[process.pid],ownPin:second}).users.length,1);
  }finally{second.close();first.close();}
});

test('placeholder retirement removes only the created empty directory',t=>{
  const base=testScratch(t,'tree-pin-placeholder'),root=join(base,'tree'),saved=join(base,'saved');
  const pin=TreePin.open(root,true);
  try{
    assert.equal(pin.emptyPlaceholder(),true);
    writeFileSync(join(root,'new-data'),'retain');assert.equal(pin.emptyPlaceholder(),false);
    pin.removePlaceholder();assert.equal(readFileSync(join(root,'new-data'),'utf8'),'retain');
    rmSync(join(root,'new-data'));renameSync(root,saved);mkdirSync(root);
    pin.removePlaceholder();assert.equal(existsSync(root),true,'a replacement empty directory is another owner');
  }finally{pin.close();}
  const empty=join(base,'empty'),owned=TreePin.open(empty,true);
  try{assert.equal(owned.emptyPlaceholder(),true);owned.removePlaceholder();assert.equal(existsSync(empty),false);}
  finally{owned.close();}
});
