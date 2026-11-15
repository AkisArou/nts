import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {durableRecord} from './durable-record.ts';
import {testScratch,TestScratch} from './test-scratch.ts';
import {testEnvironment} from './test-environment.ts';
import {loaderSearch,prepareRustTestExecution,readRustTestExecution,rustTestExecutionClassifier} from './rust-test-execution.ts';
import {runtimeSubjectValidator} from './rust-input-validation.ts';
import type {InputIndexExecution,InputSubject,RuntimeObservation} from './rust-test-inputs.ts';
import type {FileObserverReceipt} from './file-input-observer.ts';
import type {InputSnapshot} from './module-closure.ts';
import {rustLoaderCapture} from './rust-loader.ts';

const observer:FileObserverReceipt={version:1,observedPath:'/observer',artifactPath:'/observer',sha256:'a'.repeat(64),sourceSha256:'b'.repeat(64),abi:'linux-x86_64-v1'};
function fixture(t:Parameters<typeof testScratch>[0]){
  const root=testScratch(t,'rust-test-execution'),env=testEnvironment();
  mkdirSync(join(root,'src'));mkdirSync(join(root,'target'));mkdirSync(join(root,'loader'));
  const path=join(root,'target','emitted'),source=join(root,'src','lib.rs'),artifacts=join(root,'artifacts.json');
  writeFileSync(source,'');writeFileSync(join(root,'main.c'),'int main(void) { return 0; }\n');
  execFileSync('clang',[join(root,'main.c'),'-o',path],{env,stdio:['ignore','pipe','pipe']});
  durableRecord(artifacts,{version:1,status:0,buildFinished:true,artifacts:[{reason:'compiler-artifact',filenames:[path],package_id:'owned-control',executable:path,profile:{test:true},
    target:{name:'control',kind:['test'],src_path:source}}]});
  const cwd=root,argv=[path,'--supplied-call'],environment={...env,LD_LIBRARY_PATH:testScratch(t,'rust-loader-search')};
  const prepared=prepareRustTestExecution({artifacts,root,cwd,argv,env:environment});
  const receipt=prepared.finish({path:join(root,'raw.gz'),sha256:'c'.repeat(64),bytes:123},42),file=join(root,'execution.json');
  durableRecord(file,receipt);
  const bytes=readFileSync(file),reference={path:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  return {root,path,artifacts,cwd,argv,env:environment,prepared,receipt,file,reference};
}
const image=(path:string):InputIndexExecution=>({kind:'execution',id:2,parent:1,pid:42,birth:'42',path,cwd:'/',phase:{phase:'test-runtime',source:'src/lib.rs'},reason:'actual-image',argvRaw:''});
const request=(path:string,operation='open'):RuntimeObservation=>({phase:'test-runtime',source:'src/lib.rs',attempt:{id:'1',tid:42,tgid:42,ppid:0,birth:'42',parentBirth:'0'},
  cwd:'/',args:operation==='execute'?['0','0','0','0','0','0']:['ffffffffffffff9c','0','0','0','0','0'],operation,syscall:operation==='lookup'?'newfstatat':operation==='execute'?'execve':'openat',
  outcome:'unknown',image:2,canceled:false,subjects:[{kind:'path',arg:operation==='execute'?0:1,dirfdArg:operation==='execute'?-1:0,name:path,raw:Buffer.from(path).toString('hex'),anchor:{kind:'absolute'}}],probes:[]});
function assess(root:string,row:RuntimeObservation){
  const empty:InputSnapshot={files:[],runtimeFiles:[],ownedFiles:[],moduleFiles:[],hostFiles:[],placingFiles:[],optionalFiles:[],memberships:[],observations:[],directories:[]};
  return runtimeSubjectValidator(root,empty).assess(row,row.subjects[0] as InputSubject,observer);
}

test('capture fences changed artifact bytes while historical receipts survive rebuild and deletion',t=>{
  const f=fixture(t),receipt=readRustTestExecution(f.reference);
  assert.equal(receipt.executable.path,f.path);assert.equal(receipt.loader.libraryPath,f.env.LD_LIBRARY_PATH);
  assert.deepEqual(receipt.argv,f.argv);assert.equal(receipt.cwd,f.cwd);assert.ok(receipt.loader.elf.includes('(NEEDED)'));
  const bytes=readFileSync(f.path);writeFileSync(f.path,Buffer.concat([bytes,Buffer.from('changed')]));
  assert.throws(()=>f.prepared.finish(f.receipt.raw,42),/changed during replay/);
  assert.deepEqual(readRustTestExecution(f.reference),receipt,'a later rebuild cannot invalidate capture-time evidence');
  rmSync(f.path);
  assert.deepEqual(readRustTestExecution(f.reference),receipt,'profile cleanup cannot invalidate capture-time evidence');
  const classifier=rustTestExecutionClassifier(readRustTestExecution(f.reference)),search=loaderSearch(receipt.loader,receipt.cwd);
  const probe=request(join(search.directories[0]!.path,search.libraries[0]!));
  assert.equal(classifier.classify(probe,image(f.path),assess(f.root,probe))?.kind,'loader-probe');
  durableRecord(f.file,{...receipt,loader:{...receipt.loader,libraryPath:'/tampered'}});
  assert.throws(()=>readRustTestExecution(f.reference),/manifest SHA\/length/);
  assert.throws(()=>prepareRustTestExecution({artifacts:f.artifacts,root:f.root,cwd:f.cwd,argv:[join(f.root,'unemitted')],env:f.env}),/not emitted by Cargo/);
});

test('exact emitted artifacts and same-binary derived loader paths are classified without a target prefix grant',t=>{
  const f=fixture(t),classifier=rustTestExecutionClassifier(f.receipt),context=image(f.path);
  const classify=(path:string,operation='open',actual=context)=>{const row=request(path,operation);return classifier.classify(row,actual,assess(f.root,row));};
  assert.equal(classify(f.path,'execute',{...context,path:'/observer'})?.kind,'emitted-executable');
  assert.equal(classify(join(f.root,'target','unrelated')) ,undefined);
  const search=loaderSearch(f.receipt.loader,f.cwd),library=search.libraries[0]!;
  const directory=search.directories.find(row=>row.origin.includes('Cargo')&&row.path.endsWith('glibc-hwcaps/x86-64-v3'))??search.directories.find(row=>row.origin==='Cargo LD_LIBRARY_PATH')!;
  assert.equal(classify(join(directory.path,library))?.kind,'loader-probe');
  const stat=classify(directory.path,'lookup');assert.equal(stat?.kind,'loader-probe');
  assert.ok(stat&&stat.kind==='loader-probe'&&stat.origin.includes('Cargo LD_LIBRARY_PATH'));
  assert.equal(classify(directory.path+'/','lookup')?.kind,'loader-probe','the loader retains exactly one trailing directory slash');
  for(const path of [directory.path+'//',directory.path+'/./',directory.path+'/../'+directory.path.split('/').at(-1)+'/',join(f.root,'not-derived')+'/'])
    assert.equal(classify(path,'lookup'),undefined,'only the exact derived directory spelling qualifies: '+path);
  assert.equal(classify(join(directory.path,library)+'/','lookup'),undefined,'a library basename cannot borrow directory-slash authority');
  assert.equal(classify(join(directory.path,'unrelated.so')),undefined,'only a DT_NEEDED name qualifies');
  assert.equal(classify(join(f.root,'other',library)),undefined,'only a derived search directory qualifies');
  assert.equal(classify(join(directory.path,library),'open',{...context,pid:43}),undefined,'another task gets no loader context');
  assert.equal(classify(join(directory.path,library),'open',{...context,path:'/different/binary'}),undefined,'another binary gets no loader context');
  const positive=join(f.env.LD_LIBRARY_PATH,library);writeFileSync(positive,'ordinary unexpected file');
  assert.equal(classify(positive),undefined,'a present file is not a loader absence');
  symlinkSync(f.env.LD_LIBRARY_PATH,join(f.root,'alias'));
  assert.equal(classify(join(f.root,'alias',library)),undefined,'an alias is not a derived directory');
  const later=rustTestExecutionClassifier(f.receipt),exec=request(f.path,'execute');
  later.classify(exec,context,assess(f.root,exec));
  const probe=request(join(directory.path,library));
  assert.equal(later.classify(probe,context,assess(f.root,probe)),undefined,'a later exec cannot inherit the original loader environment');
  const discharged=rustTestExecutionClassifier(f.receipt);
  assert.equal(discharged.classify(probe,context,assess(f.root,probe))?.kind,'loader-probe');
  discharged.observe(exec,context); // Provenance may discharge this subject before claim assessment.
  assert.equal(discharged.classify(probe,context,assess(f.root,probe)),undefined,'discharged attempts still advance execution lifetime');
});

test('loader directory derivation excludes supported but unsearched capabilities and refuses unmodeled paths',t=>{
  const f=fixture(t),loader={...f.receipt.loader,help:'Subdirectories of glibc-hwcaps directories, in priority order:\n  owned-disabled\n  owned-active (supported, searched)'};
  const search=loaderSearch(loader,f.cwd);
  assert.ok(search.directories.some(row=>row.path.endsWith('/glibc-hwcaps/owned-active')));
  assert.ok(search.directories.every(row=>!row.path.includes('owned-disabled')));
  assert.throws(()=>loaderSearch({...loader,libraryPath:'$ORIGIN/unknown'},f.cwd),/token expansion/);
  assert.throws(()=>loaderSearch({...loader,elf:loader.elf+'\n (RUNPATH) [unmodeled]\n'},f.cwd),/RPATH\/RUNPATH/);
});

test('ELF and loader report caches key exact bytes, environment and hwcaps without sharing mutable answers',t=>{
  const f=fixture(t),cache=rustLoaderCapture(f.env),first=cache.capture(f.path,f.cwd,f.env,'platform-a');
  const expected=first.loader.help;first.loader.help='caller mutation';
  assert.equal(cache.capture(f.path,f.cwd,f.env,'platform-a').loader.help,expected);
  cache.capture(f.path,f.cwd,{...f.env,LD_LIBRARY_PATH:join(f.root,'other')},'platform-a');
  cache.capture(f.path,f.cwd,f.env,'platform-b');
  assert.deepEqual(cache.statistics(),{elfHits:3,elfMisses:1,loaderHits:1,loaderMisses:3});
  writeFileSync(f.path,Buffer.concat([readFileSync(f.path),Buffer.from('different bytes')]));
  cache.capture(f.path,f.cwd,f.env,'platform-a');
  assert.equal(cache.statistics().elfMisses,2);assert.equal(cache.statistics().loaderHits,2);
});

test('capture binds creator-owned scratch identities and leaves historical receipt reuse independent of cleanup',t=>{
  const f=fixture(t),scratch=new TestScratch(join(f.root,'..'),'execution-owned');
  const prepared=prepareRustTestExecution({artifacts:f.artifacts,root:f.root,cwd:f.cwd,argv:f.argv,env:f.env,roots:[scratch.receipt],runStart:scratch.startedAt});
  const receipt=prepared.finish(f.receipt.raw,42);assert.equal(receipt.version,2);assert.ok(receipt.provenance);
  assert.deepEqual(receipt.provenance.roots,[scratch.receipt]);assert.ok(receipt.provenance.window.start<=scratch.receipt.createdAt&&receipt.provenance.window.end>=scratch.receipt.createdAt);
  const file=join(f.root,'owned-execution.json');durableRecord(file,receipt);const bytes=readFileSync(file),reference={path:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  assert.deepEqual(scratch.finish(),[]);assert.deepEqual(readRustTestExecution(reference),receipt);
  assert.throws(()=>prepared.finish(f.receipt.raw,42),/ENOENT|replaced/,'a capture-time replacement or disappearance cannot publish');
});
