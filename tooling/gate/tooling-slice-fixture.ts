// One real scoped-run experiment, shared by the regression and old-owner proof.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {generatedJavaScript} from './generated-javascript.ts';
import {spawnTest,waitFor} from './test-wait.ts';
import {newToolingSlice,stopToolingSlice,toolingSliceArgs,unitComponent} from './tooling-slice.ts';
import {requireOwnUnit,startBoundSlice} from './scopes/bound-slice.ts';

/**
 * A slice of a fixture's own for the gate runs it starts: inside a tooling
 * run, a child of that run's slice; alone, a root at an agent's rank, bound to
 * this test's unit. Given to the fixture as its owned `NTS_TOOLING_SLICE`,
 * every slice its runs start nests there at this test's rank, so a priority
 * the fixture names orders only its private ledger, never the machine's CPU.
 * Stopped, with everything in it, when the test ends.
 */
export function fixtureToolingSlice(t:{after(fn:()=>void):void}):{slice:string;group:string}{
  const slice=newToolingSlice(true,process.env),group=startBoundSlice(slice,requireOwnUnit(),{rank:'agent'});
  t.after(()=>{stopToolingSlice(slice);});
  return {slice,group};
}

const ENTRY=new URL('../differential/command-entry/main.ts',import.meta.url),PUBLISH=new URL('./durable-record.ts',import.meta.url);

export async function killedScopedToolingOwner(root:string,runner:URL,env:NodeJS.ProcessEnv):Promise<{slice:string;unit:string;owner:string;state:string;output:string}>{
  const subject=join(root,'subject.test.mjs'),ready=join(root,'subject-ready'),scope=join(root,'scope.json'),helper=join(root,'owner.mjs');
  const owner='nts-test-scoped-owner-'+unitComponent('t')+'.scope';
  writeFileSync(subject,generatedJavaScript(`import {test} from 'node:test';import {watch,writeFileSync} from 'node:fs';
test('owned running file',async()=>{const watcher=watch(${JSON.stringify(root)},()=>{});writeFileSync(${JSON.stringify(ready)},'ready');await new Promise(()=>{});watcher.close();});`));
  writeFileSync(helper,generatedJavaScript(`import {runScopedTooling} from ${JSON.stringify(runner.href)};
import {runAsCommand} from ${JSON.stringify(ENTRY.href)};import {durableRecord} from ${JSON.stringify(PUBLISH.href)};
runAsCommand(import.meta.url,async()=>{await runScopedTooling([${JSON.stringify(subject)}],{fixture:true,onScope:(slice,unit)=>{durableRecord(${JSON.stringify(scope)},{slice,unit});}});});`));
  let output='',ended=false,receipt:{slice:string;unit:string}|undefined;
  const child=spawn('systemd-run',['--user','--scope','--collect','--quiet','--unit='+owner,...toolingSliceArgs(env,"agent"),'--',process.execPath,helper],{env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>output+=bytes);
  const closed=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{ended=true;resolve(code);});});
  try{
    await waitFor('a real runScopedTooling file to enter',()=>existsSync(scope)&&existsSync(ready),{stopped:()=>ended?output:undefined});
    receipt=JSON.parse(readFileSync(scope,'utf8')) as NonNullable<typeof receipt>;
    const killed=spawnTest('systemctl',['--user','kill','--kill-whom=all','--signal=SIGKILL',owner],{encoding:'utf8'});assert.equal(killed.status,0,killed.stderr);
    assert.notEqual(await closed,0,'the owned scope was killed');
    let observed='';const slice=receipt.slice;
    await waitFor('the manager to settle the scoped tooling hierarchy',()=>{
      observed=spawnTest('systemctl',['--user','show',slice,'-p','ActiveState','-p','BindsTo'],{encoding:'utf8'}).stdout;
      // The old owner has no stop dependency and remains active. Retain that
      // actual state promptly; a hang timeout must not manufacture the result.
      return /^ActiveState=inactive$/m.test(observed)||/^ActiveState=active$/m.test(observed)&&/^BindsTo=$/m.test(observed);
    });
    return {...receipt,owner,state:observed,output};
  }finally{
    spawnTest('systemctl',['--user','stop',owner],{encoding:'utf8'});
    if(!receipt&&existsSync(scope))receipt=JSON.parse(readFileSync(scope,'utf8')) as NonNullable<typeof receipt>;
    if(receipt)stopToolingSlice(receipt.slice);
    await closed;
  }
}
