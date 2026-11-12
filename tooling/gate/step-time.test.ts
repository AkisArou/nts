import assert from 'node:assert/strict';
import {test} from 'node:test';
import {GNU_CPU_MEASURE,STEP_CPU_MEASURE,parseGnuTime,measuredStepTime,readStepBaseline,currentStepCpu,cpuByMeasure} from './step-time.ts';

test('the canonical record counts scope CPU and keeps GNU time only as a versioned comparison',()=>{
  const gnu=parseGnuTime('Command terminated by signal 9\n0.6 0.07 0.03 100\n')!;
  const measured=measuredStepTime({usageUsec:660816,userUsec:263746,systemUsec:397070},0.7,gnu);
  assert.equal(measured.cpu_measure,STEP_CPU_MEASURE);assert.equal(measured.cpu,0.660816);
  assert.equal(measured.gnu_time!.cpu_measure,GNU_CPU_MEASURE);assert.equal(measured.gnu_time!.cpu,0.1);
  assert.equal(currentStepCpu(measured),0.660816);
  assert.equal(currentStepCpu(gnu),undefined);assert.equal(currentStepCpu({cpu:5}),undefined);
  assert.equal(parseGnuTime('missing'),undefined);
  assert.throws(()=>measuredStepTime({usageUsec:NaN,userUsec:0,systemUsec:0},0.1),/invalid step CPU/);
});

test('legacy and current CPU baselines retain their identity instead of producing a false trend',()=>{
  const rows=readStepBaseline(`old\t2\t0.1\t1\nnew\t2\t0.7\t1\t${STEP_CPU_MEASURE}\n`);
  assert.equal(rows.get('old')!.cpu_measure,GNU_CPU_MEASURE);
  assert.equal(currentStepCpu(rows.get('old')),undefined);
  assert.equal(currentStepCpu(rows.get('new')),0.7);
  assert.equal(rows.get('old')!.wall,2,'wall ordering survives a CPU instrument change');
});

test('CPU totals preserve measurement partitions, including legacy receipts',()=>{
  assert.deepEqual(cpuByMeasure([{cpu:3},{cpu:7,cpu_measure:STEP_CPU_MEASURE}]),{[GNU_CPU_MEASURE]:3,[STEP_CPU_MEASURE]:7});
  assert.equal(cpuByMeasure([{cpu:NaN}]),null);
  assert.deepEqual(cpuByMeasure([{verdict:'SKIPPED'}]),{});
});
