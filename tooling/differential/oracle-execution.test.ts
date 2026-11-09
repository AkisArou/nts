import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {closeMemoryRun} from '../census/worker-memory.ts';
import {oracleExecutionLimits,runOracleCommand} from './oracle-execution.ts';

after(closeMemoryRun);
test('the recorder and native launcher share the stated population policy',()=>{
  assert.deepEqual(oracleExecutionLimits('benchmarks/cases/subject/case.ts'),{cpuSeconds:60,residentBytes:2*2**30});
  assert.deepEqual(oracleExecutionLimits('tests/programs/subject/main.ts'),{cpuSeconds:15,residentBytes:2*2**30});
});
test('virtual reservation alone does not exhaust the oracle resident scope',async()=>{
  const source=`const m=new WebAssembly.Memory({initial:1,maximum:65536}); const fs=await import('node:fs'); console.log(fs.readFileSync('/proc/self/status','utf8').match(/^VmSize:\\s+(\\d+)/m)[1]); console.log(m.buffer.byteLength);`;
  const result=await runOracleCommand(process.execPath,['--input-type=module','-e',source],{source:'benchmarks/cases/private/case.ts',env:process.env});
  assert.equal(result.run.status,0,result.run.stderr);assert.equal(result.budget,undefined);
  assert.ok(Number(result.run.stdout.split('\n')[0])*1024>2*2**30,'more than 2 GiB is reserved virtually');
  assert.ok(result.residentPeakBytes<2*2**30);
});
test('only an observed CPU or own resident bound is a case budget',async()=>{
  const timed=await runOracleCommand(process.execPath,['-e','for(;;){}'],{source:'private',env:process.env,limits:{cpuSeconds:0.1,residentBytes:2*2**30}});
  assert.equal(timed.budget?.outcome,'timeout');assert.equal(timed.budget?.bound,0.1);
  const capped=await runOracleCommand(process.execPath,['-e','const held=[];for(;;)held.push(Buffer.alloc(16*1024*1024,1));'],{source:'private',env:process.env,limits:{cpuSeconds:15,residentBytes:128*2**20}});
  assert.equal(capped.budget?.outcome,'memory-cap');assert.equal(capped.budget?.bound,128*2**20);
  const stopped=await runOracleCommand(process.execPath,['-e',"process.kill(process.pid,'SIGABRT')"],{source:'private',env:process.env});
  assert.equal(stopped.budget,undefined,'an unproven signal is never a resident hit');
});

test('the shared execution transports stdout and stderr byte for byte',async()=>{
  const value=await runOracleCommand(process.execPath,['-e','process.stdout.write(Buffer.from([0,255,128]));process.stderr.write(Buffer.from([254,0]));'],{source:'tests/programs/private/main.ts',env:process.env});
  assert.equal(value.run.status,0);assert.equal(value.stdoutHex,'00ff80');assert.equal(value.stderrHex,'fe00');
});
