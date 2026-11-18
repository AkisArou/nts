import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {fixture} from '../landing/run-fixture.ts';
import {gateEnvironment} from './canonical-environment.ts';
import {departingCgroupPreload} from './cgroup-files-fixture.ts';
import {durableRecord} from './durable-record.ts';
import {readLedger,reserve} from './memory-ledger.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {ownMemory} from './test-memory.ts';
import {spawnTest,waitFor} from './test-wait.ts';
import {newToolingSlice,stopToolingSlice,toolingSlice} from './tooling-slice.ts';

// The full check's initial run reserve measures other ledger owners before
// any step can launch. Supply the foreign scope's files at that exact seam.
for(const verdict of ['pass','fail'] as const)
test(`gate admission survives a foreign descendant's procs-to-listing departure and preserves its step's ${verdict}`,async t=>{
  const f=fixture(t),memory=ownMemory(join(f.own,'memory'),{availableKiB:8*2**20,totalKiB:8*2**20,resident:{kind:'fixed',defaultBytes:0}});
  const inherited=toolingSlice(),slice=inherited??newToolingSlice(true);
  if(!inherited)t.after(()=>stopToolingSlice(slice));
  const holderUnit='nts-847-holder-'+randomUUID(),gateUnit='nts-847-admission-'+randomUUID();
  const properties=['-p','Nice=19','-p','LimitCORE=0','-p','CPUAffinity=0-3 6-31','-p','RuntimeMaxSec=120s'];
  const holder=spawn('systemd-run',['--user','--unit='+holderUnit,'--slice='+slice,'--collect','--wait','--pipe','--quiet',...properties,
    '--working-directory='+f.tree,process.execPath,'-e',"require('node:fs').watch(process.cwd(),()=>{});process.stdout.write(String(process.pid)+'\\n')"],{env:fixtureEnvironment(t),stdio:['ignore','pipe','pipe']});
  let holderOutput='',ended=false;
  holder.stdout.on('data',part=>{holderOutput+=part;});holder.stderr.on('data',part=>{holderOutput+=part;});
  const closed=once(holder,'close');holder.once('close',()=>{ended=true;});
  const stop=(unit:string)=>spawnTest('systemctl',['--user','stop',unit],{encoding:'utf8'});
  try{
    await waitFor('the foreign ledger owner to start',()=>/^\d+\n/.test(holderOutput),{stopped:()=>ended?holderOutput||'holder ended':undefined});
    const held=await reserve({bytes:2**30,what:'foreign job',owner:{pid:Number(holderOutput.trim())}},{env:memory,report:()=>{}});
    try{
      const entry=readLedger(memory.NTS_MEMORY_LEDGER).admitted.find(row=>row.id===held.id);assert.ok(entry);
      const group='/user.slice/user-1000.slice/user@1000.service/nts.slice/foreign-847.slice';
      durableRecord(join(memory.NTS_MEMORY_LEDGER,'admitted',held.id+'.json'),{...entry,measure:{tree:true,cgroup:{path:group,inode:'847'}}});
      ownMemory(join(f.own,'memory'),{resident:{kind:'live'}});
      const preload=join(f.own,'departing-cgroup.mjs');writeFileSync(preload,departingCgroupPreload(group,'membership'));
      f.control('rustfmt',verdict);
      const base=f.options(['rustfmt']).env;assert.ok(base);
      const env=gateEnvironment(base,{run:f.run,owned:{...memory,NTS_GATE_TARGET:f.target,NTS_GATE_STEPS:'rustfmt',NTS_GATE_SLOTS:'2',NTS_TOOLING_SLICE:slice},oracleRoot:f.tree}).env;
      const result=spawnTest('systemd-run',['--user','--unit='+gateUnit,'--slice='+slice,'--collect','--wait','--pipe','--quiet',...properties,
        '--working-directory='+f.tree,...Object.entries(env).filter((row):row is [string,string]=>row[1]!==undefined).map(([name,value])=>'--setenv='+name+'='+value),
        process.execPath,'--import',preload,join(f.tree,'tooling/gate/run.mjs')],{env:fixtureEnvironment(t),encoding:'utf8',maxBuffer:8*2**20});
      const output=result.stdout+result.stderr;
      assert.equal(result.status,verdict==='pass'?0:1,output);
      assert.match(output,/supplied holder departure/);
      assert.match(output,/measuredParts/);assert.match(output,/accountsOf/);assert.match(output,/reserveMemory/);
      t.diagnostic(output.slice(output.indexOf('supplied holder departure')).split('\n').filter(line=>/^supplied holder|^Error: supplied|^    at /.test(line)).slice(0,40).join('\n'));
      const summary=JSON.parse(readFileSync(join(f.run,'summary.json'),'utf8')) as {steps:{name:string;verdict:string}[];memory:{reservation:string|null}};
      assert.ok(summary.memory.reservation,'the initial gate reservation was admitted');
      assert.deepEqual(summary.steps.map(row=>[row.name,row.verdict]),[['rustfmt',verdict==='pass'?'PASS':'FAIL']]);
      assert.ok(f.calls().some(line=>line.startsWith('rustfmt ')),'the step actually launched');
    }finally{held.release();await held.closed;}
  }finally{stop(gateUnit);stop(holderUnit);await closed;}
});
