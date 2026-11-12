// Barriers live in private staged modules, never production lock hooks.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import type {TestContext} from 'node:test';
import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {testScratch} from '../gate/test-scratch.ts';
import {fixtureEnvironment} from '../gate/test-environment.ts';
import {generatedJavaScript,type GeneratedJavaScript} from '../gate/generated-javascript.ts';
import {waitFor} from '../gate/test-wait.ts';

export function replaceOnce(source:string,from:string,to:string):string{
  assert.equal(source.split(from).length,2,'one staged lock barrier: '+from);
  return source.replace(from,to);
}
export const LOCK_BARRIER=`if(process.argv.includes('762-pause')&&!__lockPaused){__lockPaused=true;process.stdout.write('barrier\\n');__lockRead(0,Buffer.alloc(1),0,1,null);}`;
export function stagedLock(t:TestContext,point:'publication'|'observation'|'reclamation'){
  const root=testScratch(t,'owner-lock'),stage=join(root,'stage');
  copyModuleClosure(['tooling/landing/lock.ts'],stage);
  const file=join(stage,'tooling/landing/lock.ts');let source=readFileSync(file,'utf8');
  // The original anchor makes this same control fail on the pre-fix pin.
  const anchor=point==='publication'?(source.includes('linkSync(temporary, path);')?'linkSync(temporary, path);':'const fd = openSync(path, "wx", 0o600);')
    :point==='observation'?(source.includes("const text=bytes.toString('utf8').trim();")?"const text=bytes.toString('utf8').trim();":'try { held = readFileSync(path, "utf8").trim(); } catch { continue; }')
    :'const current=readOwner(path);';
  source=replaceOnce(source,anchor,point==='publication'&&anchor.startsWith('linkSync')?LOCK_BARRIER+'\n'+anchor:anchor+'\n'+LOCK_BARRIER);
  writeFileSync(file,"import {readSync as __lockRead} from 'node:fs';let __lockPaused=false;\n"+source);
  return {root,stage,file};
}

export function lockChild(t:TestContext,source:GeneratedJavaScript,args:string[],env=fixtureEnvironment(t)){
  const child=spawn(process.execPath,['--input-type=module','-e',source,...args],{env,stdio:['pipe','pipe','pipe']});
  let output='',errors='',ended=false;
  child.stdout.on('data',part=>output+=String(part));child.stderr.on('data',part=>errors+=String(part));
  const closed=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{ended=true;resolve(code);});});
  t.after(async()=>{child.stdin.end();await closed;});
  return {child,closed,output:()=>output,errors:()=>errors,
    wait:(text:string)=>waitFor('lock child '+text,()=>output.includes(text),{stopped:()=>ended?'exit '+child.exitCode+' '+output+errors:undefined})};
}

export const ACQUIRE_CHILD=generatedJavaScript(`import {readSync} from 'node:fs';
const {acquire}=await import(process.argv[1]);const lock=acquire(process.argv[2]);
process.stdout.write('entered:'+Boolean(lock)+'\\n');readSync(0,Buffer.alloc(1),0,1,null);lock?.release();`);
