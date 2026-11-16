// Real command entries share image content, never completed resolver sessions.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixtureEnvironment} from './test-environment.ts';
import {ownMemory} from './test-memory.ts';
import {testScratch} from './test-scratch.ts';
import {spawnTest} from './test-wait.ts';
import {toolingSliceArgs} from './tooling-slice.ts';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {fixtureInput} from './reader-inputs/main.ts';
import {generatedJavaScript} from './generated-javascript.ts';
import {durableRecord} from './durable-record.ts';
import {systemdEnvironment} from './environment.ts';

for(const sealed of [false,true])test((sealed?'sealed siblings borrow one parent session':'unsealed sibling commands acquire distinct sessions')+' through the real CLI',t=>{
 if(process.platform!=='linux'){t.skip('Linux executable holders');return;}
 const root=testScratch(t,'oracle-entry-siblings'),env=fixtureEnvironment(t),unit='nts-oracle-siblings-'+randomUUID();
 t.after(()=>{spawnTest('systemctl',['--user','stop',unit],{env,encoding:'utf8'});});
 const binary=process.env.NTS_BIN;
 assert.ok(binary,'the tooling gate supplies the compiler and its companion planner');
 const planner=join(dirname(resolve(binary)),'oracle-plan');
 const fixtures=join(root,'fixtures'),project=join(fixtures,'tests/programs/sibling');
 // These unchanged corpus markers let the real native planner name private sources.
 copyModuleClosure([fixtureInput(new URL('../../tsconfig.fixtures.json',import.meta.url)),fixtureInput(new URL('../differential/Cargo.toml',import.meta.url))],fixtures);
 mkdirSync(join(project,'src'),{recursive:true});mkdirSync(join(fixtures,'benchmarks/cases'),{recursive:true});
 writeFileSync(join(project,'package.json'),' {"type":"module"}\n');
 writeFileSync(join(project,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ESNext',module:'ESNext',moduleResolution:'Bundler',strict:true,types:[]},files:['src/main.ts']}));
 writeFileSync(join(project,'src/main.ts'),'export function answer(n:number):number{return n+1;}\n');
 const observer=join(root,'observe.mjs');
 writeFileSync(observer,generatedJavaScript(`
import assert from 'node:assert/strict';
import {existsSync,readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {durableRecord} from ${JSON.stringify(new URL('./durable-record.ts',import.meta.url).href)};
import {nodeResolutionDirectory,nodeProcessAlive} from ${JSON.stringify(new URL('../differential/oracle-runtime.ts',import.meta.url).href)};
const evidence=process.argv[5],first=${JSON.stringify(join(root,'one','session-observed.json'))};
if(evidence===${JSON.stringify(join(root,'two'))}&&existsSync(first)){
 const previous=JSON.parse(readFileSync(first,'utf8'));
 assert.equal(nodeProcessAlive(previous.holder),${sealed},'first helper has the correct lifetime before the second command starts');
}
const context=JSON.parse(process.env.NTS_GATE_ENV_CONTEXT),cap=JSON.parse(process.env.NTS_ORACLE_DEPENDENCIES);
if(cap.seal){
 const session=JSON.parse(readFileSync(join(nodeResolutionDirectory(context.resolutionOwner),'holder.json'),'utf8'));
 assert.equal(nodeProcessAlive(session.holder),true);assert.equal(nodeProcessAlive(session.owner),true);
 assert.notEqual(session.directory,join(cap.directory,'oracle-resolution','node-'+process.versions.node));
 mkdirSync(evidence,{recursive:true});durableRecord(join(evidence,'session-observed.json'),session);
}
`));
 const canonical=fileURLToPath(new URL('./canonical-environment.ts',import.meta.url)),recorder=fileURLToPath(new URL('../differential/record-oracles.ts',import.meta.url));
 const quoted=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
 const commands=['plan','plan-rc'].map((mode,index)=>[process.execPath,'--import',observer,recorder,mode,planner,fixtures,join(root,index?'two':'one')]);
 const script=join(root,'siblings.sh');writeFileSync(script,'#!/bin/sh\nset -eu\n'+commands.map(args=>args.map(quoted).join(' ')).join('\n')+'\n');
 const request=join(root,'request.json'),controller=join(root,'controller.mjs');
 durableRecord(request,{env,memory:ownMemory(join(root,'memory')),root,binary,canonical,script,sealed});
 writeFileSync(controller,generatedJavaScript(`
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {runAsCommand,registerCommandCloser} from ${JSON.stringify(new URL('../differential/command-entry/main.ts',import.meta.url).href)};
import {assignOwnedValues} from ${JSON.stringify(new URL('./environment-values.ts',import.meta.url).href)};
import {gateEnvironment,sealOracleRun} from ${JSON.stringify(new URL('./canonical-environment.ts',import.meta.url).href)};
import {hostEnvironment} from ${JSON.stringify(new URL('./host-environment.ts',import.meta.url).href)};
import {discardRunTemporary} from ${JSON.stringify(new URL('./run-temporary.ts',import.meta.url).href)};
import {nodeProcessAlive} from ${JSON.stringify(new URL('../differential/oracle-runtime.ts',import.meta.url).href)};
import {closeNodeResolutionSession} from ${JSON.stringify(new URL('../differential/oracle-resolution.ts',import.meta.url).href)};
import {durableRecord} from ${JSON.stringify(new URL('./durable-record.ts',import.meta.url).href)};
const request=JSON.parse(readFileSync(${JSON.stringify(request)},'utf8'));
runAsCommand(import.meta.url,async()=>{
 let planned=gateEnvironment(hostEnvironment(request.env),{run:join(request.root,'owner'),oracleAdmissionContext:'gate',owned:{...request.memory,NTS_BIN:request.binary}}),holder,closed,sessions,passed=false;
 registerCommandCloser('sibling resolver fixtures',{close:async()=>{
  const errors=[];
  try{if(holder)await closeNodeResolutionSession(holder);}catch(error){errors.push(error);}
  try{await closed;}catch(error){errors.push(error);}
  try{if(passed)for(const session of sessions)assert.equal(nodeProcessAlive(session.holder),false,'all helpers joined before returning');}catch(error){errors.push(error);}
  try{discardRunTemporary(planned.temporary,planned.env.HOME,planned.observations);}catch(error){errors.push(error);}
  if(errors.length)throw new AggregateError(errors,'sibling resolver fixture drain failed');
  if(passed)durableRecord(join(request.root,'drained.json'),{sealed:request.sealed,sessions,drained:true});
 }});

 if(request.sealed)planned=await sealOracleRun(planned,undefined,(session,completion)=>{holder=session;closed=completion;});
 const args=request.sealed?[request.script]:[request.canonical,'--pinned',request.script];
 const launchEnv={...planned.env};
 if(!request.sealed)assignOwnedValues(launchEnv,{NTS_GATE_RUN_DIR:join(planned.temporary.path,'cli')});
 const result=spawnSync(request.sealed?'sh':process.execPath,args,{env:launchEnv,encoding:'utf8',maxBuffer:8*1024**2});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.signal,null);
 sessions=['one','two'].map(name=>JSON.parse(readFileSync(join(request.root,name,'session-observed.json'),'utf8')));
 for(const name of ['one','two']){
  const plans=JSON.parse(readFileSync(join(request.root,name,'plans.json'),'utf8'));
  assert.equal(plans.failures.length,0);assert.equal(plans.plans.length,name==='one'?3:2);
 }
 if(request.sealed){assert.deepEqual(sessions[0],sessions[1]);assert.equal(nodeProcessAlive(holder.holder),true);}
 else{assert.notEqual(sessions[0].directory,sessions[1].directory);assert.notDeepEqual(sessions[0].holder,sessions[1].holder);}
 passed=true;
});
`));
 const result=spawnTest('systemd-run',['--user','--unit='+unit,'--collect','--wait','--pipe','-p','LimitCORE=0',...toolingSliceArgs(env),...systemdEnvironment(env),'--',process.execPath,controller],{env,encoding:'utf8',maxBuffer:16*1024**2});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.signal,null);
 const receipt=JSON.parse(readFileSync(join(root,'drained.json'),'utf8'));
 assert.equal(receipt.drained,true);assert.equal(receipt.sealed,sealed);assert.equal(receipt.sessions.length,2);
});
