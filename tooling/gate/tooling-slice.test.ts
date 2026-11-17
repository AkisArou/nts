import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {generatedJavaScript} from './generated-javascript.ts';
import {killedScopedToolingOwner} from './tooling-slice-fixture.ts';
import {requireOwnUnit} from './scopes/bound-slice.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {testScratch} from './test-scratch.ts';
import {spawnTest,waitFor} from './test-wait.ts';
import {stopToolingSlice,toolingSliceArgs,unitComponent} from './tooling-slice.ts';

const BOUND=new URL('./scopes/bound-slice.ts',import.meta.url),NAMING=new URL('./tooling-slice.ts',import.meta.url),ENTRY=new URL('../differential/command-entry/main.ts',import.meta.url),PUBLISH=new URL('./durable-record.ts',import.meta.url);
const RUNNER=new URL('./tooling-runner.ts',import.meta.url);

test('a killed real runScopedTooling owner leaves its tooling slice inactive',async t=>{
  const result=await killedScopedToolingOwner(testScratch(t,'scoped-owner'),RUNNER,fixtureEnvironment(t));
  assert.match(result.state,/^ActiveState=inactive$/m,JSON.stringify(result));
});

test('a shell outside the user manager gets a named scope command instead of an unbound slice',()=>{
  assert.throws(()=>requireOwnUnit('0::/user.slice/user-1000.slice/session-2.scope'),error=>{
    assert.match(String(error),/tooling slice requires a user-manager scope or service/);
    assert.match(String(error),/systemd-run --user --scope --unit=nts-tooling-r[a-z0-9]{8} -- /);
    return true;
  });
});

for(const ownerKind of ['service','scope'] as const)for(const end of ['return','kill'] as const){
  test(`a ${ownerKind} owner ${end} stops its slice and nested members`,async t=>{
    const root=testScratch(t,'slice-owner'),helper=join(root,'owner.mjs'),created=join(root,'created.json'),ready=join(root,'ready'),closedMarker=join(root,'closed');
    const unit='nts-test-slice-owner-'+unitComponent('t')+'.'+ownerKind,env=fixtureEnvironment(t);
    writeFileSync(helper,generatedJavaScript(`import {existsSync,watch,writeFileSync} from 'node:fs';
import {join} from 'node:path';import {spawnSync} from 'node:child_process';
import {requireOwnUnit,startBoundSlice} from ${JSON.stringify(BOUND.href)};
import {newToolingSlice,stopToolingSlice} from ${JSON.stringify(NAMING.href)};
import {runAsCommand,registerCommandCloser} from ${JSON.stringify(ENTRY.href)};
import {durableRecord} from ${JSON.stringify(PUBLISH.href)};
const root=${JSON.stringify(root)},slice=newToolingSlice(true),nested=newToolingSlice(true,{NTS_TOOLING_SLICE:slice}),owner=requireOwnUnit(),member=slice.slice(0,-6)+'-member.service',child=nested.slice(0,-6)+'-member.service';
const wait=name=>new Promise(resolve=>{const file=join(root,name),watcher=watch(root,()=>{if(existsSync(file)){watcher.close();resolve();}});if(existsSync(file)){watcher.close();resolve();}});
runAsCommand(import.meta.url,async()=>{
 startBoundSlice(slice,owner,{rank:'agent'});
 registerCommandCloser('owned probe slice',{close:()=>{stopToolingSlice(slice);writeFileSync(join(root,'closed'),'closed');}});
 durableRecord(join(root,'created.json'),{slice,nested,member,child,owner});await wait('attach');
 for(const [unit,parent]of [[member,slice],[child,nested]]){
  const r=spawnSync('systemd-run',['--user','--collect','--quiet','--service-type=exec','--property=LimitCORE=0','--unit='+unit,'--slice='+parent,'/usr/bin/sleep','infinity'],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr||r.error?.message);
 }
 writeFileSync(join(root,'ready'),'ready');await wait('finish');
});`));
    let output='',ended=false,receipt:{slice:string;nested:string;member:string;child:string;owner:string}|undefined;
    const args=['--user','--collect','--quiet','--unit='+unit,...toolingSliceArgs(env,"agent"),...(ownerKind==='scope'?['--scope']:['--wait','--pipe','--service-type=exec','--property=LimitCORE=0']),'--',process.execPath,helper];
    const child=spawn('systemd-run',args,{env,stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>output+=bytes);
    const closed=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{ended=true;resolve(code);});});
    const show=(name:string)=>spawnTest('systemctl',['--user','show',name,'-p','ActiveState','-p','BindsTo','-p','After'],{encoding:'utf8'}).stdout;
    try{
      await waitFor('the acquired empty owner slice',()=>existsSync(created),{stopped:()=>ended?output:undefined});
      receipt=JSON.parse(readFileSync(created,'utf8')) as NonNullable<typeof receipt>;
      assert.equal(receipt.owner,unit);
      assert.match(show(receipt.slice),/^ActiveState=active$/m,'an empty start must survive before the first member');
      assert.ok(show(receipt.slice).split('\n').some(line=>line.startsWith('BindsTo=')&&line.slice(8).split(' ').includes(unit)));
      writeFileSync(join(root,'attach'),'attach');
      await waitFor('both real member units',()=>existsSync(ready),{stopped:()=>ended?output:undefined});
      const stopped=spawnTest('systemctl',['--user','stop',receipt.member],{encoding:'utf8'});assert.equal(stopped.status,0,stopped.stderr);
      assert.match(show(receipt.slice),/^ActiveState=active$/m,'a nested member keeps its parent alive');
      assert.match(show(receipt.nested),/^ActiveState=active$/m);
      if(end==='return')writeFileSync(join(root,'finish'),'finish');
      else{
        const killed=spawnTest('systemctl',['--user','kill','--kill-whom=all','--signal=SIGKILL',unit],{encoding:'utf8'});assert.equal(killed.status,0,killed.stderr);
      }
      const status=await closed;
      if(end==='return')assert.equal(status,0,output);else assert.notEqual(status,0,output);
      const owned=receipt;
      await waitFor('all owned slices and member units to stop',()=>[owned.slice,owned.nested,owned.child].every(name=>/^ActiveState=inactive$/m.test(show(name))));
      assert.equal(existsSync(closedMarker),end==='return','a killed owner never runs its closer');
    }finally{
      spawnTest('systemctl',['--user','stop',unit],{encoding:'utf8'});
      if(receipt)stopToolingSlice(receipt.slice);
      await closed;
    }
  });
}
