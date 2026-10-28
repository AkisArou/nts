// Interval mode reuses the existing immutable link/body proof and the shared
// bench/cost sitting. No workload runs in build/check mode.
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {experiment} from './layouts-plan.ts';
import {linkLayouts} from './layouts-link.ts';
import {random,inferLayouts} from './layouts-interval.ts';
import {sampleLayouts,type Trial,type SittingOptions} from './layouts-sitting.ts';
import {nativeAdapter} from './layouts-native.ts';
import {withLayoutLock} from './layouts-admission.ts';
import {intervalTable,recordIntervals} from './layouts-interval-record.ts';

const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const [mode,input,destination]=process.argv.slice(2);
if(!['check','build','measure','sample','record'].includes(mode)||!input||!destination)throw Error('layouts-interval-run.ts <check|build|measure|record> <input> <fresh output>');
const out=resolve(destination);
function options(plan:any):SittingOptions {
  const result={primary:'cycles',rounds:3,confidence:0.99,resamples:20_000,...plan.interval};
  if(!Number.isSafeInteger(result.rounds)||result.rounds<3||result.rounds>25||plan.seeds.length>1000
    ||!['cycles','nanoseconds','instructions'].includes(result.primary))throw Error('invalid bounded native sitting options');
  inferLayouts(plan.seeds.map((seed:number)=>({id:String(seed),rounds:Array.from({length:result.rounds},()=>({before:1,changed:1,after:1}))})),result);
  return result;
}
function sourcePlan(value:any){
  experiment(value);options(value);
  if(typeof value.heapLibrary!=='string'||!value.heapLibrary.startsWith('/'))throw Error('absolute compiled heap helper required');
  if(process.platform!=='linux'||process.arch!=='x64')throw Error('current interval adapters require Linux x86-64 ELF/perf');
  return value;
}
function validate(build:any){
  if(build.state!=='PASS'||build.independentArms!==true||!Array.isArray(build.pairs)||!build.pairs.length)throw Error('unverified interval build');
  if(hash(readFileSync(build.heapLibrary))!==build.heapSha256)throw Error('heap helper changed');
  for(const pair of build.pairs){
    if(pair.layouts.length<40||pair.layouts.length%2)throw Error('twenty paired layouts required');
    for(const row of pair.layouts)if(hash(readFileSync(row.binary))!==row.binarySha256)throw Error('layout executable changed');
  }
}
if(mode==='record'){
  const provenance=process.argv[5]?JSON.parse(readFileSync(process.argv[5],'utf8')):null;
  console.log(JSON.stringify(recordIntervals(resolve(input),out,provenance)));
}else if(mode==='check'||mode==='build'){
  const plan=sourcePlan(JSON.parse(readFileSync(input,'utf8')));
  if(mode==='check')console.log(`${plan.pairs.length} cases, ${plan.seeds.length} independent layouts per arm; no workload`);
  else {
    mkdirSync(out);writeFileSync(join(out,'plan.json'),JSON.stringify(plan,null,2));
    const pairs:any[]=[],state={state:'RUNNING',independentArms:true,heapLibrary:plan.heapLibrary,heapSha256:hash(readFileSync(plan.heapLibrary)),options:options(plan),pairs};
    for(const pair of plan.pairs){
      const layouts=await linkLayouts({arms:pair.arms,seeds:plan.seeds,independentArms:true},join(out,pair.name+'-'+pair.backend));
      pairs.push({name:pair.name,backend:pair.backend,n:pair.n,checksum:pair.checksum,layouts});
      writeFileSync(join(out,'artifacts.json'),JSON.stringify(state,null,2));
    }
    state.state='PASS';writeFileSync(join(out,'artifacts.json'),JSON.stringify(state,null,2));
  }
}else{
  const directory=resolve(input),build=JSON.parse(readFileSync(join(directory,'artifacts.json'),'utf8'));validate(build);
  if(mode==='measure'){
    const r=await withLayoutLock([process.execPath,import.meta.filename,'sample',directory,out],out+'-admission-'+Date.now());
    if(r.status!==0||r.signal||r.error)throw Error('interval sitting failed; raw state and admission sample retained');
  }else{
    if(process.env.NTS_BENCH_CPUS!=='4'||!/^Cpus_allowed_list:\s*0-3,6-31$/m.test(readFileSync('/proc/self/status','utf8')))throw Error('with-lock and off-core orchestration required');
    mkdirSync(out);const summaries:any[]=[];
    writeFileSync(join(out,'checkpoint.json'),JSON.stringify({state:'RUNNING',current:null,pairs:0}));
    try {
      for(const pair of build.pairs){
        const seeds=[...new Set<number>(pair.layouts.map((l:any)=>l.seed))],binaries=new Map();
        const trials:Trial[]=seeds.map(seed=>{
          const a=pair.layouts.filter((l:any)=>l.seed===seed&&l.arm==='base'),b=pair.layouts.filter((l:any)=>l.seed===seed&&l.arm==='contents');
          if(a.length!==1||b.length!==1||a[0].orderSeed===b[0].orderSeed)throw Error('independent paired orders missing');
          const id='draw-'+seed,draw=random(seed);draw();draw();
          binaries.set(id,{base:a[0].binary,changed:b[0].binary});
          return {id,geometry:{base:hash(JSON.stringify(a[0].functions)),changed:hash(JSON.stringify(b[0].functions))},heapSeed:{base:draw(),changed:draw()}};
        });
        writeFileSync(join(out,'checkpoint.json'),JSON.stringify({state:'RUNNING',current:pair.name+':'+pair.backend,pairs:summaries.length}));
        const metrics=await sampleLayouts(trials,join(out,pair.name+'-'+pair.backend),nativeAdapter(binaries,build.heapLibrary,pair.n,pair.checksum,directory),build.options);
        summaries.push({name:pair.name,backend:pair.backend,metrics});console.log(pair.name,pair.backend,metrics[build.options.primary].verdict);
      }
      validate(build);
      writeFileSync(join(out,'summary.json'),JSON.stringify(summaries,null,2)+'\n');writeFileSync(join(out,'report.md'),intervalTable(summaries));
      writeFileSync(join(out,'checkpoint.json'),JSON.stringify({state:'PASS',current:null,pairs:summaries.length}));
    }catch(error){writeFileSync(join(out,'checkpoint.json'),JSON.stringify({state:'FAIL',pairs:summaries.length,error:String(error)}));throw error;}
  }
}
