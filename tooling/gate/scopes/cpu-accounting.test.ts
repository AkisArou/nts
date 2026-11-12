import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {GateScopes} from './step-scope.ts';
import {fixtureEnvironment} from '../test-environment.ts';
import {ownMemory} from '../test-memory.ts';
import {testScratch} from '../test-scratch.ts';
import {waitFor} from '../test-wait.ts';
import {measuredStepTime,parseGnuTime,STEP_CPU_MEASURE} from '../step-time.ts';
import {gateCpus,inheritedCpus} from '../affinity.ts';

test('a live retained scope counts a CPU-burning descendant killed without being reaped',async t=>{
  const root=testScratch(t,'scope-cpu'),ready=join(root,'ready'),release=join(root,'release');
  const memory=ownMemory(join(root,'host'),{cpu:{kind:'live'},clock:{kind:'live'}});
  const scopes=new GateScopes({...fixtureEnvironment(t),...memory,NTS_GATE_RUN_DIR:root});
  const scope=scopes.step({max:2**30});let drained=false;
  t.after(async()=>{if(!drained)await scope.drain();scopes.close();});
  const parent=join(root,'parent.ts'),burner=join(root,'burner.ts'),time=join(root,'gnu.time');
  writeFileSync(burner,"process.stdout.write('ready\\n');for(;;){}\n");
  writeFileSync(parent,`import {spawn} from 'node:child_process';import {existsSync,watch,writeFileSync} from 'node:fs';import {dirname} from 'node:path';
const [burner,ready,release]=process.argv.slice(2);const child=spawn(process.execPath,[burner],{stdio:['ignore','pipe','inherit']});child.unref();
child.stdout.once('data',()=>{writeFileSync(ready,'');const stop=()=>{if(existsSync(release)){child.kill('SIGKILL');process.exit(0);}};watch(dirname(release),stop);stop();});
`);
  const launch=scope.command('/usr/bin/time',['-f','%e %U %S %M','-o',time,process.execPath,parent,burner,ready,release]);
  const worker=spawn(launch.command,launch.args,{env:{...fixtureEnvironment(t),...memory},stdio:['ignore','pipe','pipe']});
  const closed=once(worker,'close');let error='';worker.stderr!.on('data',chunk=>{error+=String(chunk);});
  await waitFor('CPU child readiness',()=>existsSync(ready),{stopped:()=>worker.exitCode!==null||worker.signalCode!==null?error||'CPU child launcher ended before readiness':undefined});
  const baseline=scope.cpuCounters().usageUsec;
  await waitFor('half a CPU second in the live scope',()=>scope.cpuCounters().usageUsec>=baseline+500_000);
  writeFileSync(release,'');assert.deepEqual(await closed,[0,null],error);
  const proof=await scope.drain();drained=true;
  assert.equal(proof.cpu_measure,STEP_CPU_MEASURE);assert.ok(proof.cpu.usageUsec>=baseline+500_000);
  const gnu=parseGnuTime(readFileSync(time,'utf8'))!;
  const measured=measuredStepTime(proof.cpu,1,gnu);
  assert.ok(measured.cpu-gnu.cpu>=0.4,`unreaped CPU was lost by GNU time: ${JSON.stringify(measured)}`);
  assert.ok(Math.abs(measured.cpu*1e6-proof.cpu.usageUsec)<=1,'recording tolerance is one microsecond');
});

test('the retained parent counts CPU burned in its sibling worker slice',async t=>{
  const root=testScratch(t,'worker-cpu'),ready=join(root,'ready'),release=join(root,'release');
  const memory=ownMemory(join(root,'host'),{cpu:{kind:'live'},clock:{kind:'live'}});
  const scopes=new GateScopes({...fixtureEnvironment(t),...memory,NTS_GATE_RUN_DIR:root});
  const scope=scopes.step({max:2**30});let drained=false;
  t.after(async()=>{if(!drained)await scope.drain();scopes.close();});
  const burner=join(root,'burner.ts');
  writeFileSync(burner,`import{existsSync,writeFileSync}from'node:fs';const[ready,release]=process.argv.slice(2);writeFileSync(ready,'');while(!existsSync(release)){}\n`);
  const worker=spawn('systemd-run',['--user','--scope','--collect','--quiet',`--unit=${scope.unit}`,`--slice=${scope.workerSlice}`,'--',
    'taskset','-c',gateCpus(inheritedCpus()),process.execPath,burner,ready,release],{env:{...fixtureEnvironment(t),...memory},stdio:['ignore','pipe','pipe']});
  const closed=once(worker,'close');let error='';worker.stderr!.on('data',chunk=>{error+=String(chunk);});
  await waitFor('worker CPU child readiness',()=>existsSync(ready),{stopped:()=>worker.exitCode!==null||worker.signalCode!==null?error||'worker ended before readiness':undefined});
  assert.ok(scope.workerGroup.startsWith(scope.group+'/'));assert.ok(scope.supervisorGroup.startsWith(scope.group+'/'));
  const baseline=scopes.host.cgroupCpu(scope.workerGroup).usageUsec;
  await waitFor('half a CPU second in the worker slice',()=>scopes.host.cgroupCpu(scope.workerGroup).usageUsec>=baseline+500_000);
  const workerCpu=scopes.host.cgroupCpu(scope.workerGroup).usageUsec;
  writeFileSync(release,'');assert.deepEqual(await closed,[0,null],error);
  const proof=await scope.drain();drained=true;
  assert.equal(proof.group,scope.group);assert.ok(proof.cpu.usageUsec>=workerCpu,JSON.stringify({parent:proof.cpu.usageUsec,worker:workerCpu}));
});


test('a missing final CPU counter cannot produce a scope drain proof',async t=>{
  const root=testScratch(t,'scope-cpu-missing'),memory=ownMemory(join(root,'host'));
  const scopes=new GateScopes({...fixtureEnvironment(t),...memory,NTS_GATE_RUN_DIR:root});
  t.after(()=>scopes.close());const scope=scopes.step({max:2**30});
  const packet=JSON.parse(readFileSync(memory.NTS_HOST_OBSERVATIONS,'utf8'));delete packet.cpu.default.systemUsec;
  writeFileSync(memory.NTS_HOST_OBSERVATIONS,JSON.stringify(packet));
  await assert.rejects(scope.drain(),/cpu.default.systemUsec/);
});
