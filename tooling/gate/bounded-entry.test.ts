import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {GateScopes} from './scopes/step-scope.ts';
import {hostObservations} from './host-observations.ts';
import {ownMemory} from './test-memory.ts';
import {assignTestValues,fixtureEnvironment,testEnvironmentHandoff} from './test-environment.ts';
import {testScratch} from './test-scratch.ts';
import {waitFor} from './test-wait.ts';

const fields=['NTS_GATE_SCOPE_EXPECTED','NTS_GATE_STEP_MEMORY_BYTES','NTS_CENSUS_WORKER_GROUP',
  'NTS_CENSUS_WORKER_MAX_BYTES','NTS_CENSUS_RUN_GROUP','NTS_CENSUS_RUN_MAX_BYTES'];

for(const route of ['active','compile','failed'] as const)test(`bounded ${route} entry preserves the command or launcher's own result`,async t=>{
  const root=testScratch(t,'bounded-entry'),bin=join(root,'bin'),ready=join(root,'ready'),release=join(root,'release');
  mkdirSync(bin);
  // This control explicitly uses kernel activity and a live clock. The fixed
  // sequence controls cover arbitrarily long startup without paying real time.
  const memory=ownMemory(join(root,'host'),{clock:{kind:'live'},resident:{kind:'live'},cpu:{kind:'live'}});
  const env=fixtureEnvironment(t,{...memory,NTS_GATE_RUN_DIR:root,NTS_GATE_STEP_MEMORY_BYTES:String(2**30)});
  const scopes=new GateScopes(env),step=scopes.step({max:2**30});let drained=false;
  assignTestValues(env,{NTS_TOOLING_SLICE:step.slice});
  t.after(async()=>{if(!drained)await step.drain();scopes.close();});
  writeFileSync(join(bin,'systemd-run'),`#!${process.execPath}
import {existsSync,watch,writeFileSync} from 'node:fs';
if(${JSON.stringify(route)}==='failed'){process.stderr.write('launcher missing declared capability: owned-entry-control\\n');process.exit(71);}
await new Promise(resolve=>{const opened=watch(${JSON.stringify(root)},()=>{
  if(existsSync(${JSON.stringify(release)})){opened.close();resolve();}
});writeFileSync(${JSON.stringify(ready)},'ready');});
process.execve('/usr/bin/systemd-run',['systemd-run',...process.argv.slice(2)],${testEnvironmentHandoff(fields)});
`,{mode:0o755});
  const script=`import {activeCommand} from ${JSON.stringify(new URL('./active-command.ts',import.meta.url).href)};
import {compileActive,closeMemoryRun} from ${JSON.stringify(new URL('../census/worker-memory.ts',import.meta.url).href)};
const env=${testEnvironmentHandoff(fields)};env.PATH=${JSON.stringify(bin)}+':'+env.PATH;
const options={cwd:${JSON.stringify(root)},env,idleMs:50,pollMs:10};
try{
 const args=['-e',"process.stdout.write('owned result');process.exit(124)"];
 const result=${JSON.stringify(route)}==='compile'?await compileActive({memoryCapKb:256*1024},process.execPath,args,options):await activeCommand(process.execPath,args,options);
 const {status,stdout,hung,timeout}=result;
 process.stdout.write(JSON.stringify({status,stdout,hung,timeout}));
}catch(error){process.stdout.write(JSON.stringify({error:error.message,kind:error.kind}));}
finally{closeMemoryRun();}
`;
  const launch=step.command(process.execPath,['--input-type=module','-e',script]);
  const child=spawn(launch.command,launch.args,{env,stdio:['ignore','pipe','pipe']});
  let output='',error='';child.stdout.on('data',part=>{output+=String(part);});child.stderr.on('data',part=>{error+=String(part);});
  const closed=once(child,'close'),stopped=()=>child.exitCode!==null||child.signalCode!==null?error||output||'launcher ended before release':undefined;
  if(route!=='failed'){
    await waitFor('the launcher barrier before bounded entry',()=>existsSync(ready),{stopped});
    const host=hostObservations(env),began=host.now();
    // Ten times the execution idle window, behind readiness. A slower host
    // only extends startup; it cannot arm execution inactivity before entry.
    await waitFor('startup to outlast its 50 ms execution idle window',()=>host.now()-began>=500,{stopped});
    writeFileSync(release,'release');
  }
  assert.deepEqual(await closed,[0,null],error);
  const seen=JSON.parse(output);
  if(route==='failed'){
    assert.equal(seen.kind,'tooling-setup');
    assert.match(seen.error,/worker command failed before bounded entry: launcher missing declared capability: owned-entry-control/);
  }else assert.deepEqual(seen,{status:124,stdout:'owned result'});
  await step.drain();drained=true;
});
