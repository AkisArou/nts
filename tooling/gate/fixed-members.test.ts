import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {fixedMembersProbe} from './fixed-members-probe.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {testScratch} from './test-scratch.ts';
import {spawnTest} from './test-wait.ts';
import {toolingSliceArgs} from './tooling-slice.ts';
import {fixedMembersUnitCommand} from './test-cgroup-members.ts';
import {ownMemory} from './test-memory.ts';
import {hostObservations} from './host-observations.ts';
import {generatedJavaScript} from './generated-javascript.ts';

test('a named unit declares only its logical entry PID and exec preserves its exit status',t=>{
  const root=testScratch(t,'fixed-unit-entry'),unit='nts-847-members-entry-'+randomUUID();
  const env=fixtureEnvironment(t,ownMemory(join(root,'memory')));
  t.after(()=>{spawnTest('systemctl',['--user','stop',unit],{env,encoding:'utf8'});});
  const code=generatedJavaScript(`import{hostObservations}from ${JSON.stringify(new URL('./host-observations.ts',import.meta.url).href)};console.log(JSON.stringify({pid:process.pid,group:hostObservations({}).ownCgroup()}));process.exitCode=7;`);
  const child=spawnTest('systemd-run',['--user',...toolingSliceArgs(env,'agent'),'--unit='+unit,'--collect','--wait','--pipe','--quiet',
    '-p','Nice=19','-p','CPUWeight=20','-p','LimitCORE=0','-p','CPUAffinity=0-3 6-31','-p','RuntimeMaxSec=120s',
    ...Object.entries(env).filter((row):row is [string,string]=>row[1]!==undefined).map(([name,value])=>'--setenv='+name+'='+value),
    ...fixedMembersUnitCommand([process.execPath,'--input-type=module','-e',code])],{env,encoding:'utf8'});
  assert.equal(child.status,7,child.stdout+child.stderr);
  const result=JSON.parse(child.stdout) as {pid:number;group:string};
  assert.deepEqual(hostObservations(env).cgroupMembers(result.group),[result.pid]);
  assert.throws(()=>hostObservations(env).cgroupMembers('/unlisted'),/resident.members has no cgroup/);
});

test('the default acquired owner needs declared membership and its 100 MiB charge is counted once',t=>{
  const root=testScratch(t,'fixed-default-owner'),unit='nts-847-fixed-owner-'+randomUUID();
  const env=fixtureEnvironment(t);
  t.after(()=>{spawnTest('systemctl',['--user','stop',unit],{encoding:'utf8'});});
  const code=fixedMembersProbe(fileURLToPath(new URL('../..',import.meta.url)),join(root,'observations'));
  const child=spawnTest('systemd-run',['--user',...toolingSliceArgs(env,'agent'),'--unit='+unit,'--collect','--wait','--pipe','--quiet',
    '-p','Nice=19','-p','CPUWeight=20','-p','LimitCORE=0','-p','CPUAffinity=0-3 6-31','-p','RuntimeMaxSec=120s',
    ...Object.entries(env).filter((row):row is [string,string]=>row[1]!==undefined).map(([name,value])=>'--setenv='+name+'='+value),
    process.execPath,'--input-type=module','-e',code],{env,encoding:'utf8'});
  assert.equal(child.status,0,child.stdout+child.stderr);
  const result=JSON.parse(child.stdout) as {missing:{error?:string};declared:number};
  assert.match(result.missing.error??'',/HostObservationError: host observation resident.members has no cgroup/);
  assert.equal(result.declared,100*2**20,'the owner is inside its declared cgroup charge, not charged a second time as an outside tree process');
});
