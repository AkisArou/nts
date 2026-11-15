import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {moduleGraph} from './module-closure.ts';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {validateReaderSourceObservations} from './reader-observations.ts';
import {runtimeRepositoryClaims} from './rust-input-claims.ts';
import {testScratch} from './test-scratch.ts';

function fixture(t:Parameters<typeof testScratch>[0],path='./types/'){
  const base=testScratch(t,'conservative-reader'),source=join(base,'source');mkdirSync(source);writeFileSync(join(source,'reader.rs'),'');
  const declarations=new Map([['reader.rs',{imports:[],assets:[{kind:'conservative' as const,path}]}]]);
  const describe=()=>{const graph=moduleGraph({sourceRoot:source,declarations});try{return graph.describe(['reader.rs']);}finally{graph.close();}};
  return {base,source,declarations,describe};
}

test('conservative roots retain recursive bytes and exact presence without placing programs',t=>{
  const f=fixture(t);mkdirSync(join(f.source,'types/nested'),{recursive:true});writeFileSync(join(f.source,'types/a.d.ts'),'declare const a:number;');writeFileSync(join(f.source,'types/nested/program.ts'),'export {};');
  const snapshot=f.describe();assert.deepEqual(snapshot.files,['reader.rs','types/a.d.ts','types/nested/program.ts']);
  assert.deepEqual(snapshot.moduleFiles,['reader.rs']);assert.deepEqual(snapshot.placingFiles,['reader.rs']);
  assert.deepEqual(snapshot.directories,[{reader:'reader.rs',directory:'types',kind:'conservative',files:['types/a.d.ts','types/nested/program.ts'],context:{entry:'<entry>',dataNamespaces:{}}}]);
  assert.ok(snapshot.observations.some(row=>row.observation.kind==='runtimeEntries'&&row.observation.path===join(f.source,'types/nested')));
  validateReaderSourceObservations(snapshot,f.source);
  writeFileSync(join(f.source,'types/nested/new.ts'),'export const added=1;');
  assert.throws(()=>validateReaderSourceObservations(snapshot,f.source),/runtimeEntries changed/);
  const destination=join(f.base,'destination');
  const copied=copyModuleClosure(['reader.rs'],destination,{sourceRoot:f.source,declarations:f.declarations});assert.ok(copied.includes('types/nested/new.ts'));
  assert.throws(()=>copyModuleClosure(['reader.rs'],destination,{sourceRoot:f.source,declarations:f.declarations,dataNamespaces:{types:'private'}}),/not a declared data input/);
});

test('absent and empty conservative roots never fabricate destination metadata',t=>{
  const f=fixture(t,'./missing/types/'),absent=f.describe(),destination=join(f.base,'destination');
  assert.deepEqual(absent.directories[0]!.files,[]);assert.ok(absent.observations.some(row=>row.observation.path===join(f.source,'missing')&&row.observation.value===null));
  copyModuleClosure(['reader.rs'],destination,{sourceRoot:f.source,declarations:f.declarations});assert.equal(existsSync(join(destination,'missing')),false);
  mkdirSync(join(f.source,'missing/types'),{recursive:true});assert.throws(()=>validateReaderSourceObservations(absent,f.source),/runtimeKind changed/);
  assert.throws(()=>copyModuleClosure(['reader.rs'],destination,{sourceRoot:f.source,declarations:f.declarations}),/not portable/);
  assert.equal(existsSync(join(destination,'missing')),false);
  mkdirSync(join(destination,'missing/types'),{recursive:true});copyModuleClosure(['reader.rs'],destination,{sourceRoot:f.source,declarations:f.declarations});
  rmSync(join(f.source,'missing'),{recursive:true});assert.throws(()=>copyModuleClosure(['reader.rs'],destination,{sourceRoot:f.source,declarations:f.declarations}),/not portable/);
});

test('conservative authority stays explicit, operation-aware and inside its owned source root',t=>{
  const f=fixture(t);mkdirSync(join(f.source,'types'));writeFileSync(join(f.source,'types/a.d.ts'),'owned');
  const snapshot=f.describe(),claims=runtimeRepositoryClaims(f.source,snapshot),identity=(path:string)=>({state:'resolved' as const,path:join(f.source,path)});
  const content={kind:'content' as const,following:'follow' as const};
  const answer=claims.match(content,identity('types/a.d.ts'));assert.equal(answer.kind,'claimed');
  assert.ok(answer.kind==='claimed'&&answer.claims.some(row=>row.role==='conservative-directory'&&row.via==='types'));
  for(const requirement of [{kind:'metadata' as const,query:'stat' as const,following:'follow' as const},{kind:'enumeration' as const,following:'descriptor' as const}])
    assert.equal(claims.match(requirement,identity('types')).kind,'claimed');
  assert.equal(claims.match(content,{state:'missing',path:join(f.source,'types/absent'),component:join(f.source,'types/absent'),kind:null}).kind,'claimed');
  assert.equal(claims.match(content,identity('types/unowned-new-file')).kind,'uncovered');
  assert.equal(claims.match(content,identity('outside')).kind,'uncovered');
  assert.equal(claims.match({kind:'unknown',reason:'unknown flags'},identity('types/a.d.ts')).kind,'uncovered');
  assert.equal(claims.match({kind:'mutation',role:'open',following:'follow',readsContent:true},identity('types/a.d.ts')).kind,'uncovered');
  const foreign=join(f.base,'foreign');writeFileSync(foreign,'foreign');symlinkSync(foreign,join(f.source,'types/link'));
  assert.throws(()=>f.describe(),/refuses symbolic or unsupported/);
});
