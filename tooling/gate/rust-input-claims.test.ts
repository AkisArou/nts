import assert from 'node:assert/strict';
import {mkdirSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {OracleFilesystem} from '../differential/oracle-filesystem.ts';
import {moduleGraph,type InputSnapshot,type ModuleDeclarations,type ReaderObservation} from './module-closure.ts';
import {runtimeRepositoryClaims,compileRuntimeRepositoryClaims} from './rust-input-claims.ts';
import {membershipIndex} from './reader-metadata.ts';
import {testScratch} from './test-scratch.ts';

const empty=():InputSnapshot=>({files:[],ownedFiles:[],moduleFiles:[],hostFiles:[],placingFiles:[],stagingFiles:[],directories:[],optionalFiles:[],memberships:[],projectMatches:[],observations:[]});
const context={entry:'<entry>',dataNamespaces:{}};
const identity=(path:string)=>({state:'resolved' as const,path});
const content={kind:'content' as const,following:'follow' as const};
const enumerate={kind:'enumeration' as const,following:'descriptor' as const};
const metadata={kind:'metadata' as const,query:'path' as const,following:'follow' as const};
function observed(path:string,kind:ReaderObservation['observation']['kind'],value:ReaderObservation['observation']['value']):ReaderObservation{
  return {reader:'entry.ts',context,protocol:'project',observation:{path,kind,value},causes:[]};
}

test('the pure claim index keys complete requests and owns deeply frozen detached graph answers',()=>{
  const snapshot=empty(),namespaces:Record<string,string>={};snapshot.files=['data/bytes'];
  snapshot.observations=[{...observed('/source/link','readlink','first'),context:{...context,dataNamespaces:namespaces}}];
  const indexed=compileRuntimeRepositoryClaims('/source',snapshot),plain=compileRuntimeRepositoryClaims('/source',snapshot,{memoize:false});
  const file=identity('/source/data/bytes'),first=indexed.match(content,file);
  assert.equal(first.kind,'claimed');if(first.kind!=='claimed')throw Error('expected content claim');
  assert.equal(indexed.match({...content},{...file}),first,'identical complete keys reuse one internal answer');
  assert.ok(Object.isFrozen(first)&&Object.isFrozen(first.claims)&&Object.isFrozen(first.claims[0]));
  assert.throws(()=>first.claims.push(first.claims[0]!),TypeError);
  assert.throws(()=>{first.claims[0]!.path='mutated';},TypeError);
  const link={kind:'readlink' as const,path:'/source/link',value:'first'};
  const observedFirst=indexed.matchComponent(link);assert.equal(observedFirst.kind,'claimed');
  if(observedFirst.kind!=='claimed')throw Error('expected link claim');
  assert.ok(Object.isFrozen(observedFirst.claims[0]!.context!.dataNamespaces));
  assert.equal(indexed.matchComponent({...link}),observedFirst);
  assert.equal(indexed.matchComponent({...link,value:'second'}).kind,'uncovered','observation values are in the key');
  namespaces.changed='caller mutation';snapshot.files.push('not-in-generation');
  assert.equal(indexed.match(content,identity('/source/not-in-generation')).kind,'uncovered');
  assert.equal(observedFirst.claims[0]!.context!.dataNamespaces.changed,undefined);
  const requests=[
    [content,file],
    [{kind:'metadata' as const,query:'stat' as const,following:'no-follow' as const},file],
    [{kind:'readlink' as const,following:'no-follow' as const},file],
    [content,{state:'missing' as const,path:'/source/data/bytes/tail',component:'/source/data/bytes',kind:null}],
  ] as const;
  for(const [request,target]of requests)assert.deepEqual(indexed.match(request,target),plain.match(request,target));
  assert.ok(indexed.statistics().matchHits>0&&indexed.statistics().componentHits>0);
  assert.equal(plain.statistics().matchHits,0);assert.equal(plain.statistics().componentHits,0);
});

test('canonical file and optional byte roles retain exact content without granting placement or extra children',t=>{
  const root=testScratch(t,'runtime-claims');writeFileSync(join(root,'entry.ts'),'export {};');
  writeFileSync(join(root,'data.txt'),'owned');writeFileSync(join(root,'unowned.txt'),'not declared');
  const declarations=new Map<string,ModuleDeclarations>([['entry.ts',{imports:[],assets:[
    {kind:'file',path:'./data.txt'},{kind:'optional-file',path:'./absent.txt'},
  ]}]]);
  const graph=moduleGraph({sourceRoot:root,declarations});
  try{
    const snapshot=graph.describe(['entry.ts']),claims=runtimeRepositoryClaims(root,snapshot);
    assert.equal(claims.match(content,identity(join(root,'data.txt'))).kind,'claimed');
    assert.equal(claims.match(content,{state:'missing',path:join(root,'absent.txt'),component:join(root,'absent.txt'),kind:null}).kind,'claimed');
    assert.equal(claims.match(content,identity(join(root,'unowned.txt'))).kind,'uncovered');
    assert.equal(claims.match({kind:'mutation',role:'open',following:'follow',readsContent:false},identity(join(root,'data.txt'))).kind,'uncovered');
    assert.equal(claims.match(enumerate,identity(root)).kind,'uncovered');
  }finally{graph.close();}
});

test('metadata roles match their own operations and never authorize an unknown content open',()=>{
  const snapshot=empty();snapshot.memberships=[{reader:'entry.ts',directory:'data',entries:[],context}];
  snapshot.observations=[observed('/source/link','readlink','target'),observed('/source/file','fileExists',true),
    observed('/source/stat','stat',{mode:0o100644,size:3,mtimeMs:123}),observed('/source/entries','entries',{files:[],directories:[]})];
  const claims=runtimeRepositoryClaims('/source',snapshot);
  for(const path of ['data','link','file','stat','entries'])assert.equal(claims.match(content,identity('/source/'+path)).kind,'uncovered',path);
  assert.equal(claims.match(enumerate,identity('/source/data')).kind,'claimed');
  assert.equal(claims.match(enumerate,identity('/source/entries')).kind,'claimed');
  assert.equal(claims.match(enumerate,identity('/source/file')).kind,'uncovered');
  assert.equal(claims.match(metadata,identity('/source/file')).kind,'claimed');
  assert.equal(claims.match({...metadata,query:'stat'},identity('/source/file')).kind,'uncovered');
  assert.equal(claims.match({...metadata,query:'stat'},identity('/source/stat')).kind,'claimed');
  assert.equal(claims.match({...metadata,query:'stat',following:'no-follow'},identity('/source/stat')).kind,'uncovered');
  assert.equal(claims.match({kind:'readlink',following:'no-follow'},identity('/source/link')).kind,'claimed');
});

test('membership covers only a captured absent direct child and adding that child owes its reader',t=>{
  const root=testScratch(t,'runtime-membership-absence');mkdirSync(join(root,'includes'));
  writeFileSync(join(root,'entry.rs'),'// include directory reader');writeFileSync(join(root,'includes/present.h'),'present');
  const graph=moduleGraph({sourceRoot:root,declarations:new Map([['entry.rs',{imports:[],assets:[{kind:'membership',path:'./includes/'}]}]])});
  try{
    const snapshot=graph.describe(['entry.rs']),claims=runtimeRepositoryClaims(root,snapshot),missing=join(root,'includes/absent.h');
    assert.equal(claims.match(content,{state:'missing',path:missing,component:missing,kind:null}).kind,'claimed');
    assert.equal(claims.matchComponent({kind:'runtimeKind',path:missing,value:null}).kind,'claimed');
    assert.equal(claims.match(content,identity(missing)).kind,'uncovered','present bytes need a real byte declaration');
    assert.equal(claims.match(content,identity(join(root,'includes/present.h'))).kind,'uncovered');
    assert.equal(claims.matchComponent({kind:'runtimeKind',path:join(root,'includes/present.h'),value:null}).kind,'uncovered','a listed name cannot become a claimed absence');
    assert.equal(claims.match(content,{state:'missing',path:missing+'/nested',component:missing,kind:null}).kind,'uncovered','missing intermediate components stay separate');
    assert.equal(claims.matchComponent({kind:'runtimeKind',path:missing+'/nested',value:null}).kind,'uncovered');
    writeFileSync(missing,'new override');
    assert.ok(membershipIndex(snapshot.files).affected(snapshot.memberships[0]!,[{path:'includes/absent.h',added:true}]));
    const refreshed=runtimeRepositoryClaims(root,graph.describe(['entry.rs']));
    assert.equal(refreshed.match(content,{state:'missing',path:missing,component:missing,kind:null}).kind,'uncovered');
  }finally{graph.close();}
});

test('directory populations authorize enumeration while bytes remain the canonical exact file set',()=>{
  const snapshot=empty();snapshot.files=['data/tracked.txt'];
  snapshot.directories=[{reader:'entry.ts',directory:'data',files:['data/tracked.txt','data/nested/member.txt'],kind:'inspection'}];
  const claims=runtimeRepositoryClaims('/source',snapshot);
  assert.equal(claims.match(enumerate,identity('/source/data')).kind,'claimed');
  assert.equal(claims.match(enumerate,identity('/source/data/nested')).kind,'claimed');
  assert.equal(claims.match(content,identity('/source/data/tracked.txt')).kind,'claimed');
  assert.equal(claims.match(content,identity('/source/data/untracked.txt')).kind,'uncovered');
  assert.equal(claims.match(enumerate,identity('/source/data/unknown')).kind,'uncovered');
  snapshot.directories[0]!.member='entry.ts';
  assert.equal(runtimeRepositoryClaims('/source',snapshot).match(enumerate,identity('/source/data')).kind,'uncovered','filtered member discovery is not full enumeration');
});

test('private fixture metadata and data grants cannot claim production paths',()=>{
  const snapshot=empty(),privateContext={entry:'fixture.ts',dataNamespaces:{data:'private corpus'}};
  snapshot.directories=[{reader:'entry.ts',directory:'data',files:[],kind:'data',fixture:{entry:'fixture.ts',owner:'private corpus'}}];
  snapshot.optionalFiles=[{reader:'entry.ts',path:'data/file',present:false,context:privateContext}];
  snapshot.memberships=[{reader:'entry.ts',directory:'data',entries:[],context:privateContext}];
  snapshot.observations=[{...observed('/source/data/file','file',null),context:privateContext}];
  const claims=runtimeRepositoryClaims('/source',snapshot);
  assert.equal(claims.match(content,identity('/source/data/file')).kind,'uncovered');
  assert.equal(claims.match(enumerate,identity('/source/data')).kind,'uncovered');
});

test('positive byte callbacks require real owned bytes and answers detach their provenance',()=>{
  const snapshot=empty();snapshot.observations=[observed('/source/file','file','bytes')];
  assert.equal(runtimeRepositoryClaims('/source',snapshot).match(content,identity('/source/file')).kind,'uncovered');
  snapshot.ownedFiles=['file'];
  const claims=runtimeRepositoryClaims('/source',snapshot),first=claims.match(content,identity('/source/file'));
  assert.equal(first.kind,'claimed');if(first.kind!=='claimed')throw Error('expected claim');
  first.claims[0]!.reader='mutated';
  const next=claims.match(content,identity('/source/file'));assert.equal(next.kind,'claimed');
  if(next.kind!=='claimed')throw Error('expected claim');assert.equal(next.claims[0]!.reader,'entry.ts');
});

test('current component identity precedes repository matching, retaining missing-before-parent and outside gaps',t=>{
  const base=testScratch(t,'runtime-alias'),root=join(base,'source'),outside=join(base,'outside');mkdirSync(root);mkdirSync(outside);
  mkdirSync(join(root,'physical'));mkdirSync(join(root,'physical/child'));
  writeFileSync(join(root,'physical/target'),'physical');writeFileSync(join(root,'target'),'lexical trap');
  symlinkSync(join(root,'physical/child'),join(root,'jump'));symlinkSync(join(root,'physical/target'),join(outside,'source-alias'));
  const snapshot=empty();snapshot.files=['physical/target'];const claims=runtimeRepositoryClaims(root,snapshot),fs=new OracleFilesystem();
  assert.equal(claims.match(content,fs.inputIdentity(root+'/jump/../target',root)).kind,'claimed');
  assert.equal(claims.match(content,fs.inputIdentity(outside+'/source-alias',root)).kind,'claimed','external spelling does not bypass the repository claim');
  assert.equal(claims.match(content,fs.inputIdentity(root+'/missing/../target',root)).kind,'uncovered');
  assert.equal(claims.match(content,identity(outside+'/unowned')).kind,'uncovered');
  assert.equal(claims.match({kind:'unknown',reason:'legacy ABI'},identity(root+'/physical/target')).kind,'uncovered');
  assert.equal(claims.match(content,identity(root+'/physical/child/../target')).kind,'uncovered','a lexical normalized guess is not an identity');
});


test('an installed capability fact never becomes repository metadata authority by physical prefix',()=>{
  const snapshot=empty(),fact=observed('/source/node_modules/sdk/lib.d.ts','fileExists',true);
  fact.capability={kind:'typescript-sdk',root:'/source/node_modules/sdk',nativeRoot:'/source/node_modules/native',
    identity:{version:'pinned',rootPackageSha256:'root',packageSha256:'package',nativeSha256:'native',nativePackageSha256:'native-package'}};
  snapshot.observations=[fact];
  assert.equal(runtimeRepositoryClaims('/source',snapshot).match(metadata,identity(fact.observation.path)).kind,'uncovered');
  delete fact.capability;
  assert.equal(runtimeRepositoryClaims('/source',snapshot).match(metadata,identity(fact.observation.path)).kind,'claimed');
});


test('compiled source membership grants no runtime bytes until a real byte role also owns it',()=>{
  const snapshot=empty();snapshot.files=['crate/lib.rs','crate/reader.rs'];snapshot.ownedFiles=[...snapshot.files];
  snapshot.moduleFiles=[...snapshot.files];snapshot.runtimeFiles=[];
  assert.equal(runtimeRepositoryClaims('/source',snapshot).match(content,identity('/source/crate/reader.rs')).kind,'uncovered');
  snapshot.runtimeFiles.push('crate/reader.rs');
  assert.equal(runtimeRepositoryClaims('/source',snapshot).match(content,identity('/source/crate/reader.rs')).kind,'claimed');
});
