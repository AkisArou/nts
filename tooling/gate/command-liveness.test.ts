import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CommandLiveness,COMMAND_STARTUP_BOUND_MS,type CommandSample} from './command-liveness.ts';
const reading=(now:number,values:Partial<Omit<CommandSample,'now'>>={}):CommandSample=>({now,cpu:0,own:0,busy:false,processOwn:{pid:51,cpu:0},...values});

test('silence expires at its supplied monotonic boundary',()=>{
  const subject=new CommandLiveness('compiler',{idleMs:300},100,100);
  assert.equal(subject.sample(reading(399)),undefined);
  assert.deepEqual(subject.sample(reading(400)),{kind:'hung',reason:'command NOT RUN (hung): compiler; no output, process-group CPU activity or busy thread for 300 ms'});
});

test('busy samples remain live across an arbitrarily delayed scheduler without CPU progress',()=>{
  const subject=new CommandLiveness('compiler',{idleMs:300},0,100);
  for(const now of [300,300_000,9_000_000])assert.equal(subject.sample(reading(now,{busy:true})),undefined);
  assert.equal(subject.sample(reading(9_000_299)),undefined);
  assert.equal(subject.sample(reading(9_000_300))?.kind,'hung');
});

test('output and changed or decreasing CPU counters independently restart inactivity',()=>{
  const subject=new CommandLiveness('compiler',{idleMs:300},0,100);subject.baseline(12);
  subject.output(299);assert.equal(subject.sample(reading(598,{cpu:12})),undefined);
  assert.equal(subject.sample(reading(599,{cpu:19})),undefined);
  assert.equal(subject.sample(reading(898,{cpu:19})),undefined);
  assert.equal(subject.sample(reading(899,{cpu:7})),undefined,'reaping establishes a lower baseline');
  assert.equal(subject.sample(reading(1198,{cpu:7})),undefined);
  assert.equal(subject.sample(reading(1199,{cpu:7}))?.kind,'hung');
});

test('a captured initial CPU baseline does not manufacture later progress',()=>{
  const subject=new CommandLiveness('compiler',{idleMs:300},0,100);subject.baseline(12);
  assert.equal(subject.sample(reading(299,{cpu:12})),undefined);
  assert.equal(subject.sample(reading(300,{cpu:12}))?.kind,'hung');
});
test('an enclosing step owns the collector budget without a hidden default CPU cutoff',()=>{
  const subject=new CommandLiveness('tooling entry',{idleMs:300_000,budgetOwner:'enclosing-step'},0,100);
  assert.equal(subject.budget,undefined);
  assert.equal(subject.sample(reading(300_001,{cpu:9_000_000,own:9_000_000,processOwn:{pid:51,cpu:9_000_000}})),undefined);
  assert.equal(subject.sample(reading(600_001,{cpu:9_000_000,own:9_000_000,processOwn:{pid:51,cpu:9_000_000}}))?.kind,'hung');
  assert.equal(new CommandLiveness('ordinary command',{},0,100).sample(reading(1,{cpu:180_000}))?.kind,'runaway');
  assert.throws(()=>new CommandLiveness('ambiguous budget',{budgetOwner:'enclosing-step',cpuBudgetSeconds:1},0,100),/delegated command budget/);
});

test('own CPU, per-process CPU, group budget and inactivity preserve their precedence and wording',()=>{
  const policy={idleMs:300,ownCpuSeconds:0.3,eachProcessCpuSeconds:0.5,cpuBudgetSeconds:1};
  const own=new CommandLiveness('compiler',policy,0,100);
  assert.deepEqual(own.sample(reading(1000,{own:30,cpu:100,processOwn:{pid:71,cpu:50}})),{kind:'timeout',reason:'compiler used its 0.3 s CPU bound: its own CPU reached 0.300 s'});
  const process=new CommandLiveness('compiler',policy,0,100);
  assert.deepEqual(process.sample(reading(1000,{own:29,cpu:100,processOwn:{pid:71,cpu:50}})),{kind:'timeout',reason:'compiler used its 0.5 s CPU bound: process 71 own CPU reached 0.500 s'});
  const group=new CommandLiveness('compiler',policy,0,100);
  assert.deepEqual(group.sample(reading(1000,{own:29,cpu:100,processOwn:{pid:71,cpu:49}})),{kind:'runaway',reason:'command NOT RUN (runaway): compiler; process-group user+sys CPU 1.000 s reached its 1 s budget'});
});

test('child CPU counts in the group but cannot exhaust the waiting leader or an unrelated process',()=>{
  const subject=new CommandLiveness('driver',{idleMs:300,ownCpuSeconds:0.3,eachProcessCpuSeconds:0.3,cpuBudgetSeconds:1},0,100);
  assert.equal(subject.sample(reading(500,{own:0,cpu:60,processOwn:{pid:71,cpu:20}})),undefined);
  assert.equal(subject.sample(reading(1000,{own:0,cpu:99,processOwn:{pid:72,cpu:29}})),undefined);
  assert.equal(subject.sample(reading(1500,{own:0,cpu:100,processOwn:{pid:72,cpu:29}}))?.kind,'runaway');
});

test('invalid or backwards observations fail instead of consulting another clock or counter',()=>{
  const subject=new CommandLiveness('compiler',{},100,100);
  assert.throws(()=>subject.output(99),/clock moved backwards/);
  for(const field of ['now','cpu','own'] as const)assert.throws(()=>subject.sample({...reading(100),[field]:NaN}),/observation/);
  assert.throws(()=>subject.sample(reading(100,{processOwn:{pid:71,cpu:NaN}})),/process CPU/);
  assert.throws(()=>subject.sample(reading(100,{busy:undefined as unknown as boolean})),/busy state/);
  assert.throws(()=>new CommandLiveness('compiler',{},0,NaN),/CPU clock frequency/);
});

test('bounded startup can take several seconds before the execution idle window arms',()=>{
  const subject=new CommandLiveness('compiler',{idleMs:50,startupMs:COMMAND_STARTUP_BOUND_MS},0,100);
  for(const now of [0,5_000,20_000])assert.equal(subject.sample(reading(now,{entered:false})),undefined);
  assert.equal(subject.sample(reading(25_000,{entered:true})),undefined);
  assert.equal(subject.sample(reading(25_049)),undefined);
  assert.equal(subject.sample(reading(25_050))?.kind,'hung');
});
test('a wedged startup is an instrument decision even when the launcher is busy',()=>{
  const subject=new CommandLiveness('compiler',{idleMs:50,startupMs:COMMAND_STARTUP_BOUND_MS},0,100);
  assert.equal(subject.sample(reading(COMMAND_STARTUP_BOUND_MS-1,{entered:false,busy:true})),undefined);
  assert.deepEqual(subject.sample(reading(COMMAND_STARTUP_BOUND_MS,{entered:false,busy:true})),{
    kind:'startup',reason:'compiler: bounded worker did not enter within its 60000 ms startup bound'});
});
test('a bounded command requires its readiness observation',()=>{
  const subject=new CommandLiveness('compiler',{startupMs:COMMAND_STARTUP_BOUND_MS},0,100);
  assert.throws(()=>subject.sample(reading(0)),/bounded entry is missing/);
});
