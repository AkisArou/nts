// The holders census as a pure reading of supplied observations: which
// cgroups hold the machine's memory, and how much of each the ledger's
// admitted jobs account for.
//
//   node --test tooling/gate/memory-holders.test.ts
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {test,type TestContext} from 'node:test';
import {fixtureCgroupChildren,hostObservations,HostObservationError,type HostObservationFixture} from './host-observations.ts';
import {describeHolderRows,describeHolders,memoryHolders,userManager,type HeldJob} from './memory-holders.ts';
import {ownMemory} from './test-memory.ts';
import {testScratch} from './test-scratch.ts';

const GiB=2**30,MiB=2**20;
const SLICE='/user.slice/user-1000.slice',MANAGER=`${SLICE}/user@1000.service`;
const at=(path:string)=>`${MANAGER}/${path}`;

/** A complete owned view: `cgroups` are every cgroup the fixture has, each with its resident charge. */
function observed(t:TestContext,cgroups:Record<string,number>,{availableGiB=12,totalGiB=32,own=at('app.slice/nts-822-check.service')}:{availableGiB?:number;totalGiB?:number;own?:string}={}){
  const dir=testScratch(t,'memory-holders');
  const env=ownMemory(dir,{availableKiB:availableGiB*2**20,totalKiB:totalGiB*2**20,resident:{kind:'fixed',defaultBytes:0,cgroups}});
  const file=env.NTS_HOST_OBSERVATIONS,value=JSON.parse(readFileSync(file,'utf8')) as HostObservationFixture;
  if(value.pressure.kind!=='fixed')throw new Error('the fixture pressure is fixed');
  value.pressure.ownGroup=own;writeFileSync(file,JSON.stringify(value)+'\n');
  return hostObservations(env);
}

// #823's contended period, as the census would have read it: a lower-rank
// gate run whose root is a run slice inside nts.slice, a borrower drawing on
// it from inside its step, an admit.ts job in its own unit, and processes no
// reservation counts.
const CONTENDED:Record<string,number>={
  [`${SLICE}/session-2.scope`]:0.25*GiB,
  [at('init.scope')]:16*MiB,
  [at('app.slice')]:5.5*GiB,
  [at('app.slice/tmux-spawn-agent.scope')]:0.9*GiB,
  [at('app.slice/nts-822-check.service')]:0.6*GiB,
  [at('app.slice/nts-761-decide.service')]:2.5*GiB,
  [at('nts.slice')]:10*GiB,
  [at('nts.slice/nts-rqv3ya54j.slice')]:9*GiB,
  [at('nts.slice/nts-rqv3ya54j.slice/nts-rqv3ya54j-rgfmkb1if.slice')]:8.9*GiB,
  [at('nts.slice/nts-rqv3ya54j.slice/nts-rqv3ya54j-rgfmkb1if.slice/nts-sb7yqpxst.scope')]:8.9*GiB,
  [at('nts.slice/nts-sunledgered.scope')]:GiB,
};
const RUN:HeldJob={id:'run',what:'gate run here-804bfdae9fac',priority:'agent',parts:[
  // Its steps' slice, which leaves out what the borrower measures itself...
  {group:at('nts.slice/nts-rqv3ya54j.slice/nts-rqv3ya54j-rgfmkb1if.slice'),bytes:8.4*GiB},
  // ...and its runner, outside that slice, in the unit it was started in.
  {group:at('app.slice/nts-822-check.service'),bytes:0.3*GiB},
]};
const BORROWER:HeldJob={id:'borrower',what:'oracle dependency capture',priority:'agent',
  parts:[{group:at('nts.slice/nts-rqv3ya54j.slice/nts-rqv3ya54j-rgfmkb1if.slice/nts-sb7yqpxst.scope'),bytes:0.5*GiB}]};
const DECIDE:HeldJob={id:'decide',what:'761-decide-v1',priority:'agent',parts:[{group:at('app.slice/nts-761-decide.service'),bytes:2.2*GiB}]};

test('each cgroup is listed once, to a bounded depth, with what the ledger counts in it and what it does not',t=>{
  const holders=memoryHolders(observed(t,CONTENDED),[RUN,BORROWER,DECIDE]);
  const row=(path:string)=>holders.rows.find(row=>row.cgroup===path);
  assert.equal(holders.root,SLICE);
  assert.equal(holders.not_available_bytes,20*GiB);
  assert.deepEqual(holders.rows.map(row=>row.cgroup).sort(),[
    `${SLICE}/session-2.scope`,at('app.slice'),at('app.slice/nts-761-decide.service'),at('app.slice/nts-822-check.service'),
    at('app.slice/tmux-spawn-agent.scope'),at('init.scope'),at('nts.slice'),at('nts.slice/nts-rqv3ya54j.slice'),at('nts.slice/nts-sunledgered.scope'),
  ].sort(),'slices expand one level: a run root is a row, its steps are not');
  const run=row(at('nts.slice/nts-rqv3ya54j.slice'))!;
  assert.deepEqual(run.jobs.map(job=>[job.id,job.bytes]),[['run',8.4*GiB],['borrower',0.5*GiB]],'a run root inside nts.slice holds its run and the borrower inside it');
  assert.equal(run.ledgered_bytes,8.9*GiB);
  assert.equal(Math.round(run.unledgered_bytes/MiB),Math.round(0.1*GiB/MiB));
  assert.deepEqual(row(at('app.slice/nts-822-check.service'))!.jobs.map(job=>job.id),['run'],'the runner is counted where it lives');
  assert.equal(row(at('app.slice/tmux-spawn-agent.scope'))!.ledgered_bytes,0);
  assert.equal(row(at('app.slice/tmux-spawn-agent.scope'))!.unledgered_bytes,0.9*GiB);
  assert.equal(Math.round(row(at('app.slice'))!.charge_bytes/MiB),Math.round(1.5*GiB/MiB),"an expanded slice keeps what its children do not hold");
  assert.equal(Math.round(row(at('nts.slice'))!.charge_bytes),0,'nothing beyond its children');
  assert.equal(row(at('nts.slice/nts-sunledgered.scope'))!.unledgered_bytes,GiB);
  const charged=holders.rows.reduce((sum,row)=>sum+row.charge_bytes,0);
  assert.equal(Math.round((holders.elsewhere_bytes+charged)/MiB),20*1024,'rows and the remainder make up what is not available');
  assert.deepEqual(holders.unplaced,[]);
});

test('every ledgered byte is attributed once, to the deepest row that holds it',t=>{
  const host=observed(t,CONTENDED);
  const holders=memoryHolders(host,[RUN,BORROWER,DECIDE]);
  const ledgered=holders.rows.reduce((sum,row)=>sum+row.ledgered_bytes,0);
  const supplied=[RUN,BORROWER,DECIDE].flatMap(job=>job.parts).reduce((sum,part)=>sum+part.bytes,0);
  assert.equal(ledgered,supplied,'nested rows (nts.slice and its run root) never both count a part');
  assert.equal(holders.rows.find(row=>row.cgroup===at('nts.slice'))!.ledgered_bytes,0,'the enclosing slice counts nothing its run root holds');
  // A part directly in an expanded slice belongs to that slice's own row.
  const direct=memoryHolders(host,[{id:'direct',what:'in the slice itself',priority:'full-check',parts:[{group:at('app.slice'),bytes:GiB}]}]);
  assert.deepEqual(direct.rows.find(row=>row.cgroup===at('app.slice'))!.jobs.map(job=>job.id),['direct']);
  // Bytes in no listed cgroup stay ledgered, and are named so.
  const away=memoryHolders(host,[{id:'away',what:'elsewhere',priority:'landing',parts:[{group:'/system.slice/x.service',bytes:GiB},{group:null,bytes:MiB}]}]);
  assert.deepEqual(away.unplaced.map(job=>[job.id,job.bytes]),[['away',GiB+MiB]]);
});

test('the wait line names the top holders, ledgered with their jobs or unledgered, and the remainder',t=>{
  const holders=memoryHolders(observed(t,CONTENDED),[RUN,BORROWER,DECIDE]);
  const line=describeHolders(holders,4);
  assert.match(line,/^memory: held now, of 20\.0 GiB not available: /);
  assert.match(line,/nts\.slice\/nts-rqv3ya54j\.slice 9\.0 GiB: ledgered 8\.4 GiB agent gate run here-804bfdae9fac, 512\.0 MiB agent oracle dependency capture; 102\.4 MiB unledgered/);
  assert.match(line,/app\.slice\/nts-761-decide\.service 2\.5 GiB: ledgered 2\.2 GiB agent 761-decide-v1; 307\.2 MiB unledgered/);
  assert.match(line,/app\.slice 1\.5 GiB unledgered/);
  assert.match(line,/nts\.slice\/nts-sunledgered\.scope 1\.0 GiB unledgered/);
  assert.doesNotMatch(line,/tmux-spawn-agent/,'only the top four');
  assert.match(line,/; \d+\.\d (G|M)iB outside these cgroups \(system, kernel, caches\)$/);
  const rows=describeHolderRows(holders);
  assert.equal(rows[0],'  held now, of 20.0 GiB not available:');
  assert.match(rows.join('\n'),/tmux-spawn-agent\.scope  unledgered/);
  assert.match(rows.at(-1)!,/outside these cgroups/);
});

test('a census without its observations fails by name',t=>{
  assert.throws(()=>memoryHolders(observed(t,CONTENDED,{own:'/fixture-runner'}),[]),
    (error:unknown)=>error instanceof HostObservationError&&/own cgroup \/fixture-runner is under no user's systemd manager/.test(error.message));
  assert.throws(()=>memoryHolders(observed(t,{'/elsewhere/x.service':GiB},{own:at('app.slice/x.service')}),[]),
    (error:unknown)=>error instanceof HostObservationError&&/resident\.cgroups has no cgroup \/user\.slice\/user-1000\.slice$/.test(error.message),
    'a fixture names its user slice, or the census refuses');
  assert.deepEqual(userManager(at('nts.slice/nts-r1.slice')),{slice:SLICE,manager:MANAGER});
});

test('a fixture lists the children its keys name, one level at a time',()=>{
  const keys=['/a/b/c','/a/b/d/e','/a/f'];
  assert.deepEqual(fixtureCgroupChildren(keys,'/a'),['/a/b','/a/f']);
  assert.deepEqual(fixtureCgroupChildren(keys,'/a/b'),['/a/b/c','/a/b/d']);
  assert.deepEqual(fixtureCgroupChildren(keys,'/a/f'),[]);
  assert.deepEqual(fixtureCgroupChildren(keys,'/'),['/a']);
  assert.throws(()=>fixtureCgroupChildren(keys,'/z'),/has no cgroup \/z/);
});

test('the bounded census reads only its rows, never a run root\x27s steps',t=>{
  // A charge read below a run root would fail here: none of those keys has a charge of its own.
  const host=observed(t,CONTENDED),charged:string[]=[];
  const counting={...host,cgroupCharge:(path:string)=>{charged.push(path);return host.cgroupCharge(path);}};
  memoryHolders(counting,[]);
  assert.ok(charged.every(path=>path.split('/').length<=at('nts.slice/x').split('/').length||path.startsWith(`${SLICE}/session`)),charged.join('\n'));
  assert.equal(charged.includes(at('nts.slice/nts-rqv3ya54j.slice/nts-rqv3ya54j-rgfmkb1if.slice')),false);
});

