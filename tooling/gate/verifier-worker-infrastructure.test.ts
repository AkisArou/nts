import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {CaseMemoryBroker} from './case-memory-broker.ts';
import {createTokenPool} from './token-pool.ts';
import {GateScopes} from './scopes/step-scope.ts';
import {hostObservations} from './host-observations.ts';
import {HOST_INFRASTRUCTURE,hostInfrastructure} from './host-infrastructure.ts';
import {gateEnvironment,sealOracleRun} from './canonical-environment.ts';
import {verifierEnvironment} from './artifact-reuse.ts';
import {assignTestValues,fixtureEnvironment} from './test-environment.ts';
import {ownMemory} from './test-memory.ts';
import {testScratch} from './test-scratch.ts';

const ROOT=fileURLToPath(new URL('../..',import.meta.url));

test('the verifier environment alone cannot start a user scope; infrastructure is a separate handoff',t=>{
  const parent=fixtureEnvironment(t),java=join(parent.JAVA_HOME!,'bin/java'),runtime=verifierEnvironment(java,parent);
  for(const name of HOST_INFRASTRUCTURE)assert.equal(runtime[name],undefined);
  assert.deepEqual(hostInfrastructure({}),{});
  assert.deepEqual(hostInfrastructure({XDG_RUNTIME_DIR:'/owned',DBUS_SESSION_BUS_ADDRESS:'unix:path=/owned/bus',BASH_ENV:'/not-an-input'}),
    {XDG_RUNTIME_DIR:'/owned',DBUS_SESSION_BUS_ADDRESS:'unix:path=/owned/bus'});
  const result=spawnSync('systemd-run',['--user','--scope','--quiet','--unit=nts-verifier-no-bus-'+process.pid,'/usr/bin/true'],{env:runtime,encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/DBUS_SESSION_BUS_ADDRESS.*XDG_RUNTIME_DIR|XDG_RUNTIME_DIR.*DBUS_SESSION_BUS_ADDRESS/);
});

test('a real jvm-verifies case reaches verification through a case lease without shell startup files',async t=>{
  const root=testScratch(t,'leased-jvm-verifier'),run=join(root,'run'),trap=join(root,'startup-read');
  const memory=ownMemory(join(root,'host'),{resident:{kind:'live'},scopePeak:{kind:'live'}});
  const source=fixtureEnvironment(t,memory);
  const bin=process.env.NTS_BIN??join(ROOT,'target/nts-dev/nts');
  const planned=gateEnvironment(source,{run,oracleRoot:ROOT,owned:{...memory,NTS_BIN:bin}});
  const env=(await sealOracleRun(planned)).env;
  const scopes=new GateScopes(env),step=scopes.step({max:2**30});let drained=false;
  const broker=new CaseMemoryBroker({root:ROOT,env,host:hostObservations(env),boundary:()=>({group:step.workerGroup,raise:bytes=>step.caseLimit(bytes)}),report:()=>{}});
  let attached=0,completed=0;
  const pool=createTokenPool({free:()=>1-pool.total,claim:()=>0,
    prepare:request=>broker.prepare(request),
    attach:async(request,scope)=>{await broker.attach(request,scope);attached++;},
    retire:(request,group)=>broker.retire(request,group),
    completed:async request=>{await broker.completed(request);completed++;},
  });
  t.after(async()=>{pool.close();if(!drained)await step.drain();scopes.close();});
  const address=await pool.start();assert.ok(address);
  const startup=join(root,'bash-env');writeFileSync(startup,`printf read > '${trap}'\nexit 77\n`);
  assignTestValues(env,{NTS_TOOLING_SLICE:step.slice,NTS_GATE_STEP:'jvm-verifies',NTS_GATE_STEP_MEMORY_BYTES:String(2**30),NTS_GATE_TOKENS:address,BASH_ENV:startup});
  delete env.NTS_GATE_TOKEN_HELD;
  const command=step.command(process.execPath,[fileURLToPath(new URL('../conformance/jvm-verifies.ts',import.meta.url)),'tests/programs/induction-boundary-near-start']);
  const child=spawn(command.command,command.args,{env,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',part=>{stdout+=part;});child.stderr.on('data',part=>{stderr+=part;});
  assert.deepEqual(await once(child,'close'),[0,null],stdout+stderr);
  assert.match(stdout,/every module verifies, or is known not to/);
  assert.ok(attached>=2,'both emission and the sanitized verifier enter the actual case lease');
  assert.equal(completed,1);assert.equal(pool.total,0);
  assert.equal(existsSync(trap),false,'bounded entry imports no BASH_ENV startup file');
  await step.drain();drained=true;
});
