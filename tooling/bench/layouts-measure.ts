// Native-only layout sampling; cell validation follows the accepted paired protocol.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {compareLayouts} from './layouts.ts';

const [input,planFile,output]=process.argv.slice(2);
if(!input||!planFile||!output)throw Error('layouts-measure.ts <layout artifacts.json> <matched plan.json> <fresh output>');
const dir=dirname(resolve(input)),out=resolve(output);
const data=JSON.parse(readFileSync(input,'utf8'));
const plans=JSON.parse(readFileSync(planFile,'utf8'));
if(data.state!=='PASS')throw Error('unvalidated layout artifacts');
const specs:any[]=[],artifacts:any[]=[];
for(const pair of data.pairs){
 const seeds=[...new Set(pair.layouts.map((a:any)=>a.seed))];
 if(seeds.length<5||pair.layouts.length!==seeds.length*2||!['c','llvm'].includes(pair.backend))throw Error('layout population');
 for(const seed of seeds){
  const key=pair.name+'-'+pair.backend+'-'+seed;
  const arms=pair.layouts.filter((a:any)=>a.seed===seed);
  if(arms.map((a:any)=>a.arm).sort().join()!=='base,contents')throw Error('paired arms required');
  if(!Number.isSafeInteger(plans[pair.name]?.n)||plans[pair.name].n<=0)throw Error('matched count missing');
  specs.push({key,name:pair.name,backend:pair.backend,seed,n:plans[pair.name].n,checksum:plans[pair.name].checksum,arms});
  for(const arm of arms)artifacts.push({name:key,backend:pair.backend,arm:arm.arm,binary:arm.binary});
 }
}
if(!specs.length||new Set(specs.map(s=>s.key)).size!==specs.length)throw Error('duplicate/empty cases');
const rows: any[] = [];
let current: any = null;
let serial = 0;
function save(state = 'RUNNING') {
  writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 2));
  writeFileSync(join(out, 'checkpoint.json'), JSON.stringify({ state, current, completed: rows.length, utc: new Date().toISOString() }, null, 2));
}
function conditions() {
  const mem = /^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync('/proc/meminfo', 'utf8'));
  if (!mem) throw new Error('MemAvailable missing');
  const disk = statfsSync(dir);
  let gate: string | null = null;
  try { gate = readFileSync('/home/akisarou/.cache/nts-parallel-20261004/mainctl/GATE-RUNNING', 'utf8').trim(); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  return { utc: new Date().toISOString(), memGiB: Number(mem[1]) / 1024 ** 2, diskGiB: disk.bavail * disk.bsize / 1024 ** 3, load: readFileSync('/proc/loadavg', 'utf8').trim(), gate };
}
async function admit() {
  for (;;) {
    const c = conditions();
    if (c.diskGiB < 40) throw new Error('40 GiB disk floor');
    if (c.memGiB >= 14) return c;
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
}
function command(name: string, arm: string, backend: string, n: number): string[] {
  const a = artifacts.find(a => a.name === name && a.arm === arm && a.backend === backend);
  if (!a) throw new Error('missing native artifact');
  return [a.binary, String(n)];
}
async function cell(name: string, arm: string, backend: string, n: number, warmup: number, phase: string, round: number, counted: boolean) {
  const start = await admit();
  const stem = `${String(serial++).padStart(3, '0')}-${name}-${backend}-${arm}-${phase}`;
  const folder = join(out, stem);
  mkdirSync(folder);
  const argv = command(name, arm, backend, n);
  const env = { ...process.env, NTS_BENCH_COUNT_MODE: 'count', NTS_BENCH_COUNT_N: String(n), NTS_BENCH_COUNT_WARMUP: String(warmup) };
  delete env.NTS_BENCH_COUNT_CONTROL;
  delete env.NTS_BENCH_COUNT_ACK;
  let invoked = ['taskset', '-c', '4', ...argv];
  const held: number[] = [];
  if (counted) {
    const ctl = join(folder, 'control'), ack = join(folder, 'ack');
    const made = spawnSync('mkfifo', [ctl, ack], { encoding: 'utf8' });
    if (made.status !== 0) throw new Error('mkfifo: ' + made.stderr);
    held.push(openSync(ctl, 'r+'), openSync(ack, 'r+'));
    env.NTS_BENCH_COUNT_CONTROL = ctl;
    env.NTS_BENCH_COUNT_ACK = ack;
    env.NTS_PROGRAM_STDERR = join(folder, 'program.stderr');
    invoked = ['perf', 'stat', '-D', '-1', '--control', `fifo:${ctl},${ack}`, '-x,', '-o', join(folder, 'perf.csv'), '-e', 'cpu_core/cycles/u,cpu_core/instructions/u,cpu_core/branches/u,cpu_core/branch-misses/u', '--', 'taskset', '-c', '4', '/usr/bin/time', '-f', '%M', '-o', join(folder, 'rss-kib'), 'sh', '-c', 'exec "$@" 2>"$NTS_PROGRAM_STDERR"', 'bench', ...argv];
  }
  const stdout = openSync(join(folder, 'stdout'), 'wx'), stderr = openSync(join(folder, 'stderr'), 'wx');
  current = { name, arm, backend, n, warmup, phase, round, argv: ['timeout', '-k', '5', '120', ...invoked], folder, start };
  save();
  const child = spawn('timeout', ['-k', '5', '120', ...invoked], { cwd: dir, env, stdio: ['ignore', stdout, stderr] });
  held.forEach(closeSync);
  closeSync(stdout); closeSync(stderr);
  const result = await new Promise<{ code: number | null; signal: string | null; error?: string }>(resolve => {
    child.on('error', e => resolve({ code: null, signal: null, error: e.message }));
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  const raw = readFileSync(join(folder, 'stdout'), 'utf8');
  const errors = readFileSync(join(folder, 'stderr'), 'utf8');
  const record = { ...current, ...result, end: conditions(), errors };
  writeFileSync(join(folder, 'run.json'), JSON.stringify(record, null, 2));
  const programErrors = counted ? readFileSync(join(folder, 'program.stderr'), 'utf8') : errors;
  if (result.code !== 0 || result.signal || result.error || programErrors) throw new Error(`${stem}: execution failed; raw streams retained`);
  if (raw.trim().split('\n').length !== 1) throw new Error(`${stem}: not one JSON line`);
  const value = JSON.parse(raw);
  if (!/^[0-9a-f]{16}$/.test(value.checksum) || !Number.isFinite(value.nsPerOp) || value.nsPerOp <= 0 || value.n !== n || value.warmup !== warmup || !Number.isFinite(value.sink)) throw new Error(`${stem}: invalid work/output`);
  const checksum = Buffer.from(value.checksum, 'hex').readDoubleBE(0);
  let expectedSink = checksum;
  for (let i = 0; i < n; i++) expectedSink += checksum;
  if (!Number.isFinite(checksum) || !Object.is(value.sink, expectedSink) || !Number.isFinite(value.elapsedNs) || value.elapsedNs <= 0 || Math.abs(value.nsPerOp * n - value.elapsedNs) > 1 + n * 1e-6) throw new Error(`${stem}: aggregate/time consistency failed`);
  let counters: object | null = null;
  let rssKiB: number | null = null;
  if (counted) {
    const csv = readFileSync(join(folder, 'perf.csv'), 'utf8');
    const parsed: Record<string, number> = {};
    for (const event of ['cycles', 'instructions', 'branches', 'branch-misses']) {
      const matches = csv.split('\n').map(line => line.split(',').map(x => x.trim())).filter(c => c[2]?.includes(`/${event}/`));
      if (matches.length !== 1 || !/^\d+(?:\.\d+)?$/.test(matches[0][0]) || !/^\d+(?:\.\d+)?$/.test(matches[0][4]) || Number(matches[0][4]) < 99) throw new Error(`${stem}: missing/invalid/multiplexed ${event}`);
      parsed[event] = Number(matches[0][0]);
      if (!Number.isFinite(parsed[event]) || parsed[event] < 0 || (event !== 'branch-misses' && parsed[event] === 0)) throw new Error(`${stem}: invalid ${event}`);
    }
    counters = parsed;
    rssKiB = Number(readFileSync(join(folder, 'rss-kib'), 'utf8').trim());
    if (!Number.isSafeInteger(rssKiB) || rssKiB <= 0) throw new Error(`${stem}: invalid RSS`);
  }
  const row = { ...record, value, counters, rssKiB };
  rows.push(row); current = null; save();
  return row;
}

const mean=(values:number[])=>values.reduce((a,b)=>a+b,0)/values.length;
async function main(){
 if(process.env.NTS_BENCH_CPUS!=='4'||!/^Cpus_allowed_list:\s*0-3,6-31$/m.test(readFileSync('/proc/self/status','utf8')))throw Error('with-lock and off-core orchestration required');
 mkdirSync(out);writeFileSync(join(out,'specifications.json'),JSON.stringify(specs,null,2));
 for(const spec of specs)for(const arm of ['base','contents']){
  const row=await cell(spec.key,arm,spec.backend,2,1,'equivalence',-1,false);
  if(row.value.checksum!==spec.checksum)throw Error('layout output mismatch');
 }
 for(let round=0;round<5;round++)for(const pair of data.pairs){
  const group=specs.filter(s=>s.name===pair.name&&s.backend===pair.backend);
  const rotated=group.slice(round%group.length).concat(group.slice(0,round%group.length));
  if(round%2)rotated.reverse();
  for(const spec of rotated)for(const arm of ['base','contents','base']){
   const row=await cell(spec.key,arm,spec.backend,spec.n,1,'paired',round,true);
   if(row.value.checksum!==spec.checksum)throw Error('paired output mismatch');
  }
  console.log('round '+(round+1)+' '+pair.name+' '+pair.backend+': all layouts complete');
 }
 if(current!==null||rows.length!==specs.length*17)throw Error('incomplete matrix');
 save('PASS');report();
}
function report(){
 const summaries=[];
 for(const pair of data.pairs){
  const layouts=[];let drift=0,cycleDrift=0;
  for(const spec of specs.filter(s=>s.name===pair.name&&s.backend===pair.backend)){
   const rounds=[];
   for(let round=0;round<5;round++){
    const [a,b,r]=rows.filter(row=>row.name===spec.key&&row.phase==='paired'&&row.round===round);
    if(!a||!b||!r||a.arm!=='base'||b.arm!=='contents'||r.arm!=='base')throw Error('bad bracket');
    drift=Math.max(drift,Math.abs(r.value.nsPerOp/a.value.nsPerOp-1));
    cycleDrift=Math.max(cycleDrift,Math.abs(r.counters.cycles/a.counters.cycles-1));
    rounds.push({timeA:Math.sqrt(a.value.nsPerOp*r.value.nsPerOp),timeB:b.value.nsPerOp,
     cyclesA:Math.sqrt(a.counters.cycles*r.counters.cycles)/spec.n,cyclesB:b.counters.cycles/spec.n,
     instructionsA:Math.sqrt(a.counters.instructions*r.counters.instructions)/spec.n,instructionsB:b.counters.instructions/spec.n,
     load:[a.start.load,b.start.load,r.start.load],gates:[a.start.gate,b.start.gate,r.start.gate],rssA:Math.sqrt(a.rssKiB*r.rssKiB),rssB:b.rssKiB});
   }
   layouts.push({seed:spec.seed,n:spec.n,addresses:spec.arms.map((a:any)=>({arm:a.arm,hot:a.hot})),rounds,
    timeA:mean(rounds.map(r=>r.timeA)),timeB:mean(rounds.map(r=>r.timeB)),cyclesA:mean(rounds.map(r=>r.cyclesA)),cyclesB:mean(rounds.map(r=>r.cyclesB)),
    instructionsA:mean(rounds.map(r=>r.instructionsA)),instructionsB:mean(rounds.map(r=>r.instructionsB)),rssA:mean(rounds.map(r=>r.rssA)),rssB:mean(rounds.map(r=>r.rssB))});
  }
  summaries.push({name:pair.name,backend:pair.backend,layouts,
   time:compareLayouts(layouts.map(l=>l.timeA),layouts.map(l=>l.timeB),drift),cycles:compareLayouts(layouts.map(l=>l.cyclesA),layouts.map(l=>l.cyclesB),cycleDrift),
   instructions:mean(layouts.map(l=>l.instructionsB))/mean(layouts.map(l=>l.instructionsA))});
 }
 writeFileSync(join(out,'summary.json'),JSON.stringify(summaries,null,2));
 const pct=(n:number)=>((n-1)*100).toFixed(2)+'%';
 let text=`# Native layout sampling

Five predefined seeded function orders per arm; five A/B/A brackets per layout, rotated/reversed layout scheduling. Same compiled inputs, shipping optimization flags and matched hot counts as the prior matrix. All layouts pass output equivalence. Hot instructions (including anonymous read-only constant bytes) are unchanged within each arm. PMU counts cover only the acknowledged hot window, running >=99%; RSS and host load/train state are retained per process. No Node/Bun ratio is inferred from another sitting.

Each layout contributes the mean of its five brackets (A is the geometric mean of the two anchors). Arm means give equal weight to every layout. Reported layout spread is the full min/max range relative to the mean; the decision floor is the larger arm spread or largest intra-layout A-repeat drift. All seeds are retained, with no favored link.

| Row | Backend | Mean A/B µs | Mean delta | Layout floor | A/B layout range | Cycles delta | Instructions delta | Verdict |
|---|---|---|---:|---:|---|---:|---:|---|
`;
 for(const s of summaries)text+='| '+[s.name,s.backend,(s.time.base.mean/1000).toFixed(3)+'/'+(s.time.changed.mean/1000).toFixed(3),pct(s.time.ratio),(s.time.floor*100).toFixed(2)+'%',(s.time.base.relativeRange*100).toFixed(2)+'%/'+(s.time.changed.relativeRange*100).toFixed(2)+'%',pct(s.cycles.ratio),pct(s.instructions),s.time.verdict].join(' | ')+` |
`;
 text+=`
| Row | Backend | Seed | A/B µs | A/B cycles per call | A/B hot addresses |
|---|---|---:|---|---|---|
`;
 for(const s of summaries)for(const l of s.layouts)text+='| '+[s.name,s.backend,l.seed,(l.timeA/1000).toFixed(3)+'/'+(l.timeB/1000).toFixed(3),l.cyclesA.toFixed(1)+'/'+l.cyclesB.toFixed(1),l.addresses.map((a:any)=>a.arm+':'+a.hot.map((h:any)=>h.name+'@0x'+h.address.toString(16)).join(',')).join(' / ')].join(' | ')+` |
`;
 writeFileSync(join(out,'report.md'),text);console.log(text);
}
if(process.argv.includes('--check'))console.log('Validated '+specs.length+' layout pairs; no workload executed.');
else main().catch(error=>{if(current||rows.length)save('FAIL');console.error(error);process.exitCode=1;});
