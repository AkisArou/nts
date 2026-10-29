// Measure the first real crypto program, its warm rebuilds and the dependency
// validator separately. Raw outputs and exec-inherited counters are retained.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {closeSync,copyFileSync,existsSync,mkdirSync,openSync,readFileSync,readdirSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {spawnCounted,instructionsWork,counterProblem,COUNTER_SCOPE} from '../gate/cputime.mjs';
import {check} from '../gate/node-deps-elf.ts';

const root=resolve(import.meta.dirname,'../..');
// Publishing saved measurements never launches a compiler or a counter. Paths
// describe the retained run, rather than the checkout that publishes its table.
if(process.argv[2]==='--publish-saved') {
 const [input,output,...extra]=process.argv.slice(3);
 if(!input||!output||extra.length)throw Error('node-deps-cost.ts --publish-saved <raw run> <results directory>');
 const raw=resolve(input),destination=resolve(output);
 const summary=JSON.parse(readFileSync(join(raw,'summary.json'),'utf8'));
 for(const row of [summary.cold,...summary.warm,summary.llvm,...summary.validation])
  if(row.status!==0||row.counter_error||counterProblem(row))throw Error('cannot publish an invalid accepted measurement');
 assert.equal(summary.warm.length,5);assert.equal(summary.validation.length,5);
 const configuration=JSON.parse(readFileSync(join(raw,'project/tsconfig.json'),'utf8'));
 const measuredRoot=dirname(configuration.extends);
 const measuredHome=/^\/home\/[^/]+(?=\/|$)/.exec(measuredRoot)?.[0]??homedir();
 function portable(value:unknown):unknown {
  if(typeof value==='string')return value.replaceAll(raw,'<raw-run>').replaceAll(measuredRoot,'<repo>').replaceAll(measuredHome,'<home>');
  if(Array.isArray(value))return value.map(portable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,portable(item)]));
  return value;
 }
 mkdirSync(destination,{recursive:true});
 writeFileSync(join(destination,'summary.json'),JSON.stringify({...portable(summary) as object,
  path_scope:'<raw-run> is the retained raw measurement directory; <repo> is its measured source checkout; <home> is the measured user home. Raw files remain outside git.'},null,2)+'\n');
 copyFileSync(join(raw,'report.md'),join(destination,'report.md'));
 console.log('Published saved Node dependency build costs.');
 process.exit(0);
}
const [candidate,baseline,asked,mode]=process.argv.slice(2);
const resume=mode==='--resume-validation';
if(mode&&!resume)throw Error('unknown cost mode');
if(!candidate||!baseline||!asked)throw Error('usage: node-deps-cost.ts <release nts> <baseline release nts> <fresh output directory>');
const out=resolve(asked);
if(existsSync(out)&&!resume)throw Error('cost output must be fresh; keep prior evidence');
if(resume&&!existsSync(out))throw Error('resume needs retained completed program rows');
const problem=instructionsWork();if(problem)throw Error(problem);
mkdirSync(out,{recursive:true});
const nts=join(out,'nts'),base=join(out,'baseline-nts');
if(resume){assert.ok(readFileSync(nts).equals(readFileSync(resolve(candidate))));assert.ok(readFileSync(base).equals(readFileSync(resolve(baseline))));}
else {copyFileSync(resolve(candidate),nts);copyFileSync(resolve(baseline),base);}
const env={...process.env,XDG_CACHE_HOME:join(out,'cache'),NTS_CHECKERS:'1'};
const project=join(out,'project');
if(!resume){
mkdirSync(join(project,'src'),{recursive:true});
mkdirSync(join(project,'node_modules/@nts'),{recursive:true});
symlinkSync(join(root,'tooling/config'),join(project,'node_modules/@nts/config'));
writeFileSync(join(project,'tsconfig.json'),JSON.stringify({extends:join(root,'tsconfig.fixtures.json'),
  include:['src/**/*',join(root,'runtime/native/libc.d.ts')]},null,2)+'\n');
writeFileSync(join(project,'src/crypto.d.ts'),`/** @ntsHeader openssl/crypto.h
 * @ntsPackage openssl
 */
declare module "c:bundled-crypto" {
 import type {c_uint} from "@nts/scalars";
 export function OPENSSL_version_major(): c_uint;
}
`);
writeFileSync(join(project,'src/main.ts'),`import {OPENSSL_version_major} from 'c:bundled-crypto';
console.log(Number(OPENSSL_version_major()));
`);
writeFileSync(join(project,'nts.config.ts'),`import {app,defineConfig,target} from '@nts/config';
export default defineConfig({products:{
 viaC:app({kind:'executable',entry:'./src/main.ts',targets:[target.linux({backend:'c'})]}),
 viaLlvm:app({kind:'executable',entry:'./src/main.ts',targets:[target.linux({backend:'llvm'})]})
}});
`);

}

function command(program:string,args:string[],cwd=root):string {
 const result=spawnSync(program,args,{cwd,env,encoding:'utf8',maxBuffer:32<<20});
 if(result.error||result.status!==0)throw Error(`${program}: ${result.error?.message??result.stderr}`);
 return result.stdout;
}
function sizes(path:string) {
 const sections=Object.fromEntries(command('size',['-A','-d',path]).split('\n').flatMap(line=>{
  const match=/^(\S+)\s+(\d+)\s+\d+\s*$/.exec(line.trim());return match?[[match[1],Number(match[2])]]:[];
 }));
 return {file_bytes:statSync(path).size,text_bytes:sections['.text'],rodata_bytes:sections['.rodata']};
}
function inventory(directory:string):Record<string,{size:number;mtime_ms:number}> {
 const files:Record<string,{size:number;mtime_ms:number}>={};
 function walk(at:string) {for(const name of readdirSync(at)){const path=join(at,name),st=statSync(path);
  if(st.isDirectory())walk(path);
  else if(name.endsWith('.command.json')||name.endsWith('.a'))files[path.slice(directory.length+1)]={size:st.size,mtime_ms:st.mtimeMs};
 }}
 if(existsSync(directory))walk(directory);return files;
}
async function measure(name:string,args:string[]) {
 const prefix=join(out,name),stdout=openSync(prefix+'.stdout','w'),stderr=openSync(prefix+'.stderr','w');
 const start=new Date().toISOString(),load=readFileSync('/proc/loadavg','utf8').trim();
 const clock=performance.now();
 const {measurement}=spawnCounted('/usr/bin/time',['-v','-o',prefix+'.rusage','--',nts,...args],{
  cwd:project,env,stdio:['ignore',stdout,stderr],counterFile:prefix+'.perf',timeoutMs:900000,
 });
 const row=await measurement;closeSync(stdout);closeSync(stderr);
 const complete={name,args,start,end:new Date().toISOString(),load_before:load,
  load_after:readFileSync('/proc/loadavg','utf8').trim(),wall_s:(performance.now()-clock)/1000,
  max_rss_kib:Number(/Maximum resident set size \(kbytes\):\s*(\d+)/.exec(readFileSync(prefix+'.rusage','utf8'))?.[1]),...row};
 writeFileSync(prefix+'.json',JSON.stringify(complete,null,2)+'\n');
 if(row.counter_error||counterProblem(row)||row.status!==0)throw Error('cost run invalid: '+JSON.stringify(row));
 return complete;
}
function verify(product:string) {
 const binary=join(project,`.nts/build/${product}/linux-gnu-x86_64/${product}`);
 assert.equal(command(binary,[],project),'3\n');
 return {product,needed:check(binary),...sizes(binary)};
}
function retained(name:string,args:string[]) {
 const row=JSON.parse(readFileSync(join(out,name+'.json'),'utf8'));
 assert.deepEqual(row.args,args);assert.equal(row.status,0);assert.ok(!row.counter_error&&!counterProblem(row));return row;
}
const buildC=['build',project,'--product','viaC'];
const cold=resume?retained('cold-program',buildC):await measure('cold-program',buildC);
const programs=[verify('viaC')];
const archives=join(env.XDG_CACHE_HOME,'nts/node-deps/archives');
const keys=readdirSync(archives);
// A fresh run has exactly one program key. For the retained first run only,
// recover that key from its directory creation bracket, before the rejected
// validator request created a second key. Ambiguity refuses the continuation.
const original=resume?keys.filter(key=>{const st=statSync(join(archives,key));return st.birthtimeMs>=Date.parse(cold.start)&&st.birthtimeMs<=Date.parse(cold.end);}):keys;
assert.equal(original.length,1,'one archive key must belong to the cold program');
const programKey=original[0];
const first=inventory(archives);writeFileSync(join(out,resume?'continued-inventory.json':'cold-inventory.json'),JSON.stringify(first,null,2)+'\n');
const warm=[];
for(let i=0;i<5;i++)warm.push(resume?retained('warm-program-'+i,buildC):await measure('warm-program-'+i,buildC));
assert.deepEqual(inventory(archives),first,'warm program rebuilds must compile no dependency objects or archives');
const buildLlvm=['build',project,'--product','viaLlvm'];
const llvm=resume?retained('warm-llvm-program',buildLlvm):await measure('warm-llvm-program',buildLlvm);programs.push(verify('viaLlvm'));
assert.deepEqual(inventory(archives),first,'LLVM must reuse the same dependency closure');
// Read the executor's recorded effective argv. Never reconstruct its ordering
// from a second copy of the shipping flag list.
const inputs=JSON.parse(readFileSync(join(archives,programKey,'openssl/invocation.json'),'utf8'));
assert.equal(inputs.length,14,'update the recorder if the internal invocation schema changes');
for(const at of [3,4,5])assert.ok(Array.isArray(inputs[at])&&inputs[at].every((word:unknown)=>typeof word==='string'));
const request=join(out,resume?'corrected-request.json':'warm-request.json');
writeFileSync(request,JSON.stringify({target:inputs[2],compiler:inputs[3],archiver:inputs[4],flags:inputs[5],
 libraries:['openssl','uv'],cache:join(env.XDG_CACHE_HOME,'nts/node-deps'),jobs:4},null,2)+'\n');
const validation=[];let artifacts;
const validationPrefix=resume?'corrected-validation-':'warm-validation-';
for(let i=0;i<5;i++){
 const row=await measure(validationPrefix+i,['node-deps',request]);
 artifacts=JSON.parse(readFileSync(join(out,validationPrefix+i+'.stdout'),'utf8'));
 validation.push({...row,phases:artifacts.timings});
}
assert.deepEqual(inventory(archives),first,'validator request must use the same warm dependency cache');
const entries=[];
for(const key of [programKey])for(const target of readdirSync(join(archives,key))){
 const directory=join(archives,key,target),entry=JSON.parse(readFileSync(join(directory,'complete.json'),'utf8'));
 entries.push({target,objects:entry.objects,cold_wall_s:entry.wall_seconds,
  archive_bytes:statSync(join(directory,`lib${target}.a`)).size});
}
const protocolCorrection=resume?{reason:'The original validator request reordered flags and created a second key. All original validator rows are rejected; original cold/warm C and LLVM program guards had already passed. Only five corrected validator launches are used here.',rejected_validation:Array.from({length:5},(_,i)=>JSON.parse(readFileSync(join(out,'warm-validation-'+i+'.json'),'utf8')))}:null;
const summary={protocolCorrection,program_cache_key:programKey,source:command('git',['rev-parse','HEAD']).trim(),profile:'release',
 scope:COUNTER_SCOPE+'; includes GNU time and all compiler, assembler, archiver and linker descendants',
 conditions:{affinity:command('taskset',['-pc',String(process.pid)]).trim(),nice:19,workers:4,
  node:process.version,compiler:command('clang',['--version']).split('\n')[0],archiver:command('llvm-ar',['--version']).split('\n')[0],
  queue:command('node',['tooling/lanes/lane.ts','status']).split('\n').slice(0,10)},
 payload:{raw_bytes:artifacts.source_raw_bytes,compressed_bytes:artifacts.source_compressed_bytes},
 executable:{baseline:sizes(base),candidate:sizes(nts)},cold,warm,llvm,validation,programs,entries};
writeFileSync(join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
const range=(values:number[])=>{const sorted=values.toSorted((a,b)=>a-b);return `${sorted[Math.floor(sorted.length/2)].toFixed(3)} [${sorted[0].toFixed(3)}, ${sorted.at(-1)!.toFixed(3)}]`;};
const report=`# Bundled Node dependency build cost\n\nRelease compiler; four native workers, nice 19, excluding reserved CPUs 4–5. Wall readings retain load and queue conditions in the raw record. CPU and instructions include every thread and descendant from exec, plus GNU time.\n\n| Build | Wall seconds | CPU seconds | User instructions | Peak RSS KiB |\n|---|---:|---:|---:|---:|\n| First C crypto program | ${cold.wall_s.toFixed(3)} | ${cold.cpu_s.toFixed(3)} | ${cold.instructions} | ${cold.max_rss_kib} |\n| Warm C, median [min, max], 5 launches | ${range(warm.map(r=>r.wall_s))} | ${range(warm.map(r=>r.cpu_s))} | ${range(warm.map(r=>r.instructions))} | ${range(warm.map(r=>r.max_rss_kib))} |\n| LLVM program with warm native dependencies | ${llvm.wall_s.toFixed(3)} | ${llvm.cpu_s.toFixed(3)} | ${llvm.instructions} | ${llvm.max_rss_kib} |\n\nWarm dependency source validation: ${range(validation.map(r=>r.phases.source_validation_s))} seconds; toolchain validation: ${range(validation.map(r=>r.phases.toolchain_validation_s))}; archive validation: ${range(validation.map(r=>r.phases.archives_s))}. Five fresh validator processes. No dependency object/archiver command or archive mtime changed during warm builds or validation.\n\nCompiler bytes: ${summary.executable.baseline.file_bytes} before, ${summary.executable.candidate.file_bytes} after (${summary.executable.candidate.file_bytes-summary.executable.baseline.file_bytes >=0?'+':''}${summary.executable.candidate.file_bytes-summary.executable.baseline.file_bytes}). Embedded source: ${summary.payload.raw_bytes} raw bytes, ${summary.payload.compressed_bytes} compressed bytes.\n\n${protocolCorrection?'Protocol correction: '+protocolCorrection.reason+' Corrected validation was a later continuation; no wall ratio is drawn across the groups.\n\n':''}Both programs execute the linked OpenSSL API and print 3. Their ELF dependency lists contain none of the owned system libraries. Download and Rust compiler construction are excluded from the program-build figures.\n`;
writeFileSync(join(out,'report.md'),report);
console.log(report);
