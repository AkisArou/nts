// Archive and program first-build costs, using the same real CLI plan as users.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {closeSync,copyFileSync,existsSync,mkdirSync,openSync,readFileSync,readdirSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {getPriority,homedir} from 'node:os';
import {spawnCounted,counterProblem,COUNTER_SCOPE} from '../gate/cputime.mjs';
import {needed,forbidden} from '../gate/node-deps-elf.ts';

const tree=resolve(import.meta.dirname,'../..');
function affinityList(text) {
 const list=/^(?:Cpus_allowed_list:\s*|pid \d+'s current affinity list: )([\d,-]+)\s*$/m.exec(text)?.[1];
 if(!list)throw Error('cannot read the launch affinity');
 const cpus=list.split(',').flatMap(part=>{
  const bounds=part.split('-').map(Number);
  assert.ok(bounds.length<=2&&bounds.every(Number.isSafeInteger));
  const [first,last=first]=bounds;assert.ok(first>=0&&last>=first&&last<4096);
  return Array.from({length:last-first+1},(_,i)=>first+i);
 });
 assert.ok(cpus.length&&!cpus.includes(4)&&!cpus.includes(5),'cost launches must exclude CPUs 4–5');
 return list;
}
function launchConditions() {
 const nice=getPriority(),affinity=affinityList(readFileSync('/proc/self/status','utf8'));
 assert.equal(nice,19,'cost launches must run at nice 19');
 return {nice,affinity,provenance:'Priority and affinity observed in the recorder at startup, before any measured command.'};
}
function render(summary) {
 const linux=summary.mode==='linux';
 const median=values=>values.toSorted((a,b)=>a-b)[Math.floor(values.length/2)];
 const loads=summary.rows.flatMap(r=>[r.cold,...r.warm,r.llvm].flatMap(row=>[Number.parseFloat(row.load_before),Number.parseFloat(row.load_after)]));
 return '# Bundled dependency target build costs\n\n'+
 `Release compiler; ${summary.conditions.compiler}, Zig ${summary.conditions.zig}, Node ${summary.conditions.node}. Native worker limit ${summary.conditions.workers}, nice ${summary.conditions.nice}, CPU affinity ${summary.conditions.affinity}. ${summary.conditions.provenance} Retained one-minute load: ${Math.min(...loads).toFixed(2)}–${Math.max(...loads).toFixed(2)}; these are loaded-machine costs, with warm spread shown. Queue state was not sampled per launch.\n\n`+
 'Each target starts with a fresh private XDG cache. Cold C includes source extraction, dependency compilation, program compilation and linking; Windows totals also include the cold Zig linker/CRT cache. '+
 (linux?'The source calls OPENSSL_version_major, reaching OpenSSL, Brotli, zlib, zstd and libuv. Native build sums the executor’s compile/archive/input-observation phases over that complete closure. Musl binaries run on the host or under qemu-aarch64; GNU arm64 is build-and-inspect only. ':'UV build is the executor’s compile/archive/input-observation phase. Cross binaries are built and inspected, not executed on Linux. ')+
 'Five warm C launches and the subsequent LLVM build leave every dependency archive and command mtime unchanged. Raw records retain complete argv, user instructions across all threads/descendants, CPU, RSS, imports and load per launch.\n\n'+
 `| Target | Cold C wall s | Cold CPU s | ${linux?'Native':'UV'} build s | Warm C median [range] s | LLVM with warm deps s | Archive bytes | C program bytes | LLVM program bytes |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n`+
 summary.rows.map(r=>`| ${r.plan.triple} | ${r.cold.wall_s.toFixed(3)} | ${r.cold.cpu_s.toFixed(3)} | ${r.native_cold_wall_s.toFixed(3)} | ${median(r.warm.map(x=>x.wall_s)).toFixed(3)} [${Math.min(...r.warm.map(x=>x.wall_s)).toFixed(3)}, ${Math.max(...r.warm.map(x=>x.wall_s)).toFixed(3)}] | ${r.llvm.wall_s.toFixed(3)} | ${r.archive_bytes} | ${r.artifacts[0].file_bytes} | ${r.artifacts[1].file_bytes} |`).join('\n')+
 `\n\nCompiler bytes: ${summary.compiler.baseline_bytes} before, ${summary.compiler.candidate_bytes} after (+${summary.compiler.candidate_bytes-summary.compiler.baseline_bytes}). All plans share the same ${summary.shared_source_files} verified source files; `+
 (linux?summary.rows.map(r=>`${r.plan.triple}: ${r.native_objects} native translation units`).join('; ')+'.\n':'each added target compiles 37 libuv translation units.\n');
}
if(process.argv[2]==='--publish-saved') {
 const [input,destination,...extra]=process.argv.slice(3);
 if(!input||!destination||extra.length)throw Error('node-deps-target-cost.ts --publish-saved <raw run> <results directory>');
 const raw=resolve(input),summary=JSON.parse(readFileSync(join(raw,'summary.json'),'utf8'));
 if(!summary.conditions.provenance) {
  // The retained first sitting predates the startup observer. Its unit's
  // recorded Nice setting supplies priority; taskset recorded actual affinity.
  assert.equal(summary.conditions.nice,19);
  summary.conditions.affinity=affinityList(summary.conditions.affinity);
  summary.conditions.provenance='Saved sitting: nice 19 is verified by the recorded systemd unit configuration; affinity was sampled by taskset in the recorder. Priority was not independently sampled at startup.';
 }
 assert.equal(summary.rows.length,summary.mode==='linux'?3:5);
 for(const target of summary.rows) {
  assert.equal(target.warm.length,5);
  if(summary.mode==='linux')assert.equal(target.native_objects,target.expected_objects);
  else assert.equal(target.native_objects,37);
  for(const row of [target.cold,...target.warm,target.llvm])assert.ok(row.status===0&&!row.counter_error&&!counterProblem(row));
 }
 const project=summary.rows[0].cold.args[1];
 const measured=dirname(JSON.parse(readFileSync(join(project,'tsconfig.json'),'utf8')).extends);
 const home=/^(?:\/home|\/Users)\/[^/]+(?=\/|$)/.exec(measured)?.[0]??homedir();
 function portable(value) {
  if(typeof value==='string')return value.replaceAll(raw,'<raw-run>').replaceAll(measured,'<repo>').replaceAll(home,'<home>');
  if(Array.isArray(value))return value.map(portable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,portable(item)]));
  return value;
 }
 mkdirSync(resolve(destination),{recursive:true});
 writeFileSync(join(resolve(destination),'summary.json'),JSON.stringify({...portable(summary),path_scope:'<raw-run> is the retained measurement folder, <repo> its measured checkout and <home> its user home; raw artifacts remain outside git.'},null,2)+'\n');
 writeFileSync(join(resolve(destination),'report.md'),render(summary));
 console.log('Published saved target build costs.');process.exit(0);
}
const observed=launchConditions();
if(process.argv[2]==='--check-conditions') {
 console.log(JSON.stringify(observed));process.exit(0);
}
const [asked,baseline,output,mode,...extra]=process.argv.slice(2),out=resolve(output??''),linux=mode==='--linux';
if(!asked||!baseline||!output||existsSync(out)||extra.length||(mode&&!linux))throw Error('target-cost.ts <release nts> <baseline nts> <fresh directory> [--linux]');
mkdirSync(out,{recursive:true});const nts=join(out,'nts');copyFileSync(resolve(asked),nts);
const registry=JSON.parse(readFileSync(tree+'/build/node-deps/recipes.json','utf8'));
const plans=linux?[
 {name:'linux-gnu-arm64',method:'linux',options:{arch:'aarch64',libc:'gnu'},triple:'aarch64-unknown-linux-gnu',format:'ELF'},
 {name:'linux-musl-arm64',method:'linux',options:{arch:'aarch64',libc:'musl'},triple:'aarch64-unknown-linux-musl',format:'ELF',execute:'/usr/bin/qemu-aarch64-static'},
 {name:'linux-musl-x64',method:'linux',options:{arch:'x86_64',libc:'musl'},triple:'x86_64-unknown-linux-musl',format:'ELF',execute:'host'},
]:[
 {name:'windows-x64',method:'windows',options:{arch:'x86_64'},triple:'x86_64-pc-windows-gnu',format:'PE32+'},
 {name:'windows-arm64',method:'windows',options:{arch:'aarch64'},triple:'aarch64-pc-windows-gnu',format:'PE32+'},
 {name:'macos-x64',method:'macos',options:{arch:'x86_64',minimumVersion:'13.0'},triple:'x86_64-apple-darwin',format:'Mach-O'},
 {name:'macos-arm64',method:'macos',options:{arch:'aarch64',minimumVersion:'13.0'},triple:'aarch64-apple-darwin',format:'Mach-O'},
 {name:'ios-simulator-x64',method:'ios',options:{arch:'x86_64',minimumVersion:'17.0'},triple:'x86_64-apple-ios-simulator',format:'Mach-O'},
];
// Refuse absent inspection/emulation prerequisites before the first counted exec.
for(const program of ['file',...(linux?['readelf','/usr/bin/qemu-aarch64-static']:['llvm-objdump'])])run(program,['--version'],process.env);
const rows=[];
function inventory(directory) {
 const result={};
 if(!existsSync(directory))return result;
 function walk(at) {for(const name of readdirSync(at)){const path=join(at,name),st=statSync(path);
  if(st.isDirectory())walk(path);else if(name.endsWith('.a')||name.endsWith('.command.json'))result[path.slice(directory.length+1)]={bytes:st.size,mtime_ms:st.mtimeMs};
 }}walk(directory);return result;
}
function run(program,args,env) {const r=spawnSync(program,args,{env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;}
async function measure(name,args,env) {
 while(Number(/^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync('/proc/meminfo','utf8'))?.[1])<14*1024**2)
  await new Promise(resolve=>setTimeout(resolve,10000));
 const prefix=join(out,name),stdout=openSync(prefix+'.stdout','w'),stderr=openSync(prefix+'.stderr','w');
 const start=new Date().toISOString(),load=readFileSync('/proc/loadavg','utf8').trim(),clock=performance.now();
 const {measurement}=spawnCounted('/usr/bin/time',['-v','-o',prefix+'.rusage','--',nts,...args],{cwd:tree,env,stdio:['ignore',stdout,stderr],counterFile:prefix+'.perf',timeoutMs:900000});
 const row=await measurement;closeSync(stdout);closeSync(stderr);
 const complete={name,args,start,end:new Date().toISOString(),load_before:load,load_after:readFileSync('/proc/loadavg','utf8').trim(),wall_s:(performance.now()-clock)/1000,
  max_rss_kib:Number(/Maximum resident set size \(kbytes\):\s*(\d+)/.exec(readFileSync(prefix+'.rusage','utf8'))?.[1]),...row};
 writeFileSync(prefix+'.json',JSON.stringify(complete,null,2)+'\n');
 assert.equal(row.status,0,readFileSync(prefix+'.stderr','utf8'));assert.ok(!row.counter_error&&!counterProblem(row));
 return complete;
}
function artifact(project,product,plan,env) {
 const root=project+'/.nts/build/'+product,targets=readdirSync(root);assert.equal(targets.length,1);
 const at=join(root,targets[0]),binary=join(at,product+(plan.method==='windows'?'.exe':''));
 const metadata=JSON.parse(readFileSync(join(at,'node-deps.json'),'utf8'));assert.equal(metadata.target,plan.triple);
 const format=run('file',['-b',binary],env);assert.ok(format.includes(plan.format),format);
 const imports=plan.method==='linux'?run('readelf',['-dW',binary],env):run('llvm-objdump',plan.method==='windows'?['-p',binary]:['--macho','--dylibs-used',binary],env);
 if(plan.method==='linux')assert.deepEqual(needed(imports).filter(forbidden),[],imports);
 else assert.ok(!/lib(?:uv|crypto|ssl|brotli|zstd)[.\-]|libz\.|zlib1\.dll/i.test(imports),imports);
 writeFileSync(join(out,plan.name+'-'+product+'.imports'),imports);
 let execution;
 if(plan.execute) {
  if(plan.options.libc==='musl')assert.ok(format.includes('statically linked'),format);
  const program=plan.execute==='host'?binary:plan.execute,args=plan.execute==='host'?[]:[binary];
  const stdout=run(program,args,env);assert.equal(stdout,'3\n');
  execution={program,args,status:0,stdout};
 }
 return {binary,file_bytes:statSync(binary).size,format:format.trim(),metadata,...(execution?{execution}:{})};
}
for(const plan of plans) {
 const at=join(out,plan.name),project=join(at,'project');mkdirSync(project+'/src',{recursive:true});
 mkdirSync(project+'/node_modules/@nts',{recursive:true});symlinkSync(tree+'/tooling/config',project+'/node_modules/@nts/config');
 writeFileSync(project+'/tsconfig.json',JSON.stringify({extends:tree+'/tsconfig.fixtures.json',include:['src/**/*'],...(linux?{files:[tree+'/runtime/native/libc.d.ts']}:{})},null,2)+'\n');
 if(linux)writeFileSync(project+'/src/crypto.d.ts',`/** @ntsHeader openssl/crypto.h
 * @ntsPackage openssl
 */
declare module 'c:bundled-crypto' {
 import type {c_uint} from '@nts/scalars';
 export function OPENSSL_version_major(): c_uint;
}
`);
 writeFileSync(project+'/src/main.ts',linux?"import {OPENSSL_version_major} from 'c:bundled-crypto';\nconsole.log(Number(OPENSSL_version_major()));\n":'console.log(7);\n');
 const products=['c','llvm'].map(backend=>`${backend}:app({kind:'executable',entry:'./src/main.ts',targets:[target.${plan.method}(${JSON.stringify({...plan.options,backend})})]})`).join(',\n');
 writeFileSync(project+'/nts.config.ts',`import {app,defineConfig,target} from '@nts/config';export default defineConfig({products:{${products}}});\n`);
 const env={...process.env,XDG_CACHE_HOME:join(at,'cache'),NTS_CHECKERS:'1'};
 const args=['build',project,'--product','c'];
 const cold=await measure(plan.name+'-cold',args,env),c=artifact(project,'c',plan,env);
 const archives=join(env.XDG_CACHE_HOME,'nts/node-deps/archives'),first=inventory(archives);
 const warm=[];for(let round=0;round<5;round++)warm.push(await measure(plan.name+'-warm-'+round,args,env));
 assert.deepEqual(inventory(archives),first,'warm C builds recompiled native dependencies');
 const llvm=await measure(plan.name+'-llvm',['build',project,'--product','llvm'],env),l=artifact(project,'llvm',plan,env);
 assert.deepEqual(inventory(archives),first,'LLVM did not reuse the C dependency closure');
 const keys=readdirSync(archives);assert.equal(keys.length,1,'one effective native plan per target');
 const compiled=readdirSync(join(archives,keys[0])).filter(name=>existsSync(join(archives,keys[0],name,'complete.json'))).map(name=>{
  const at=join(archives,keys[0],name),entry=JSON.parse(readFileSync(join(at,'complete.json'),'utf8'));
  return {name,objects:entry.objects,wall_s:entry.wall_seconds,archive_bytes:statSync(join(at,'lib'+name+'.a')).size};
 });
 const recipe=registry.plans.find(p=>p.target===plan.triple);
 const expected=linux?recipe.targets:recipe.targets.filter(t=>t.name==='libuv');
 assert.deepEqual(compiled.map(t=>t.name).sort(),expected.map(t=>t.name).sort(),'full selected native closure');
 const native_objects=compiled.reduce((sum,t)=>sum+t.objects,0),expected_objects=expected.reduce((sum,t)=>sum+t.sources.length,0);
 assert.equal(native_objects,expected_objects);
 rows.push({plan,cold,warm,llvm,artifacts:[c,l],archive_bytes:compiled.reduce((sum,t)=>sum+t.archive_bytes,0),native_objects,native_cold_wall_s:compiled.reduce((sum,t)=>sum+t.wall_s,0),...(linux?{expected_objects,compiled}:{})});
 writeFileSync(join(out,'partial.json'),JSON.stringify(rows,null,2)+'\n');
}
const git=spawnSync('git',['rev-parse','HEAD'],{cwd:tree,encoding:'utf8'});assert.equal(git.status,0);
const summary={source:git.stdout.trim(),...(linux?{mode:'linux'}:{}),profile:'release',scope:COUNTER_SCOPE+'; GNU time plus every native compiler/archiver/linker descendant',conditions:{node:process.version,compiler:run('clang',['--version'],process.env).split('\n')[0],zig:run('zig',['version'],process.env).trim(),workers:4,...observed},
 compiler:{baseline_bytes:statSync(resolve(baseline)).size,candidate_bytes:statSync(nts).size},shared_source_files:Object.keys(registry.files).length,rows};
writeFileSync(join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
const report=render(summary);
writeFileSync(join(out,'report.md'),report);console.log(report);
