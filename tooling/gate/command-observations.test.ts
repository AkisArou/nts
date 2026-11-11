import assert from 'node:assert/strict';
import {existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {activeCommand,type CommandObservations} from './active-command.ts';
import {commandObservationFixture} from './command-observations-fixture.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {testScratch} from './test-scratch.ts';
import {waitFor} from './test-wait.ts';
import {readStepInstrument} from './step-result.ts';

function fixture(t:Parameters<typeof fixtureEnvironment>[0]){
  const root=testScratch(t,'command-observations'),ready=join(root,'ready'),release=join(root,'release');
  const env=fixtureEnvironment(t,{NTS_GATE_STEP:'integrity',NTS_GATE_STEP_ATTEMPT:'controlled',NTS_GATE_STEP_RESULT:join(root,'result.json')});
  // Install the release listener before announcing readiness. Neither branch
  // depends on a timer, CPU progress or how quickly the child gets scheduled.
  const body=`import {watch,existsSync,writeFileSync} from 'node:fs';
const [ready,release]=process.argv.slice(1);
const opened=new Promise(resolve=>{const observer=watch(${JSON.stringify(root)},()=>{if(existsSync(release)){observer.close();resolve();}});});
writeFileSync(ready,'ready');await opened;process.stdout.write('complete');`;
  return {root,ready,release,env,body,frame:()=>readStepInstrument(env.NTS_GATE_STEP_RESULT,'integrity','controlled')};
}
async function ready(f:ReturnType<typeof fixture>,running:Promise<unknown>){
  let stopped=false;void running.finally(()=>{stopped=true;}).catch(()=>{});
  await waitFor('the command release listener to be installed',()=>existsSync(f.ready),{stopped:()=>stopped?'the command exited before readiness':undefined});
}

test('the bridge uses supplied busy activity and time across arbitrarily delayed readiness',async t=>{
  const f=fixture(t),control=commandObservationFixture();
  const running=activeCommand(process.execPath,['--input-type=module','-e',f.body,f.ready,f.release],{cwd:f.root,env:f.env,idleMs:300,observations:control.observations});
  await control.attached;control.clock(9_000_000);await ready(f,running);
  control.sample(9_000_000,{busy:true});control.sample(18_000_000,{busy:true});
  writeFileSync(f.release,'release');const result=await running;
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'complete');assert.equal(result.hung,undefined);assert.equal(result.elapsedMs,18_000_000);assert.equal(f.frame(),undefined);
});

for(const kind of ['hung','runaway','timeout'] as const)test('the bridge publishes the supplied '+kind+' decision after readiness',async t=>{
  const f=fixture(t),control=commandObservationFixture();
  const running=activeCommand(process.execPath,['--input-type=module','-e',f.body,f.ready,f.release],{cwd:f.root,env:f.env,idleMs:300,cpuBudgetSeconds:1,...(kind==='timeout'?{ownCpuSeconds:0.3}:{}),observations:control.observations});
  await control.attached;await ready(f,running);
  control.sample(300,{cpu:kind==='runaway'?100:0,own:kind==='timeout'?30:0});
  const result=await running;assert.equal(result.signal,'SIGKILL');assert.ok(result[kind]);
  assert.equal(f.frame()?.kind,kind==='timeout'?undefined:kind);
  assert.equal(f.frame()?.verdict,kind==='timeout'?undefined:'NOT RUN');
});

test('every missing command observation fails before any live process can be started',async t=>{
  const f=fixture(t),control=commandObservationFixture();
  for(const name of ['now','frequency','initialCpu','watch'] as const){
    const partial={...control.observations,[name]:undefined} as unknown as CommandObservations;
    await assert.rejects(activeCommand('/must-not-be-started',[],{cwd:f.root,env:f.env,observations:partial}),/command observation/);
    assert.equal(f.frame()?.kind,'tooling-setup');
  }
});

test('the bridge takes its initial CPU counter from the supplied capability',async t=>{
  const f=fixture(t),control=commandObservationFixture(12);
  const running=activeCommand(process.execPath,['--input-type=module','-e',f.body,f.ready,f.release],{cwd:f.root,env:f.env,idleMs:300,observations:control.observations});
  try{
    await control.attached;await ready(f,running);
    control.sample(300,{cpu:12});
    assert.equal(f.frame()?.kind,'hung','an unchanged initial counter supplies no progress');
  }finally{writeFileSync(f.release,'release');await running;}
});
