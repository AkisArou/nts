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


test('a missing final CPU counter cannot produce a scope drain proof',async t=>{
  const root=testScratch(t,'scope-cpu-missing'),memory=ownMemory(join(root,'host'));
  const scopes=new GateScopes({...fixtureEnvironment(t),...memory,NTS_GATE_RUN_DIR:root});
  t.after(()=>scopes.close());const scope=scopes.step({max:2**30});
  const packet=JSON.parse(readFileSync(memory.NTS_HOST_OBSERVATIONS,'utf8'));delete packet.cpu.default.systemUsec;
  writeFileSync(memory.NTS_HOST_OBSERVATIONS,JSON.stringify(packet));
  await assert.rejects(scope.drain(),/cpu.default.systemUsec/);
});
