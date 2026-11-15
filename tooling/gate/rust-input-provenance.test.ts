import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {testScratch} from './test-scratch.ts';
import {readRustBuildProvenance,runtimeProvenanceClassifier,type RuntimeProvenanceFacts,type CapturedPathResolution} from './rust-input-provenance.ts';
import type {InputSubject} from './rust-test-inputs.ts';

const descriptor=(target:string):InputSubject=>({kind:'descriptor',arg:0,fd:3,target,raw:Buffer.from(target).toString('hex')});
const pathname=(name:string,resolution?:CapturedPathResolution):InputSubject=>({kind:'path',arg:1,dirfdArg:0,name,raw:Buffer.from(name).toString('hex'),anchor:{kind:'absolute'},...(resolution?{resolution}:{})});
const resolution=(path:string):CapturedPathResolution=>({state:'resolved',path,components:[{path,kind:'file',dev:'1',ino:'2'}]});
const content={kind:'content',following:'follow'} as const;
const facts=():RuntimeProvenanceFacts=>({sourceRoot:'/source',buildNamespace:'/build',artifacts:['/build/emitted'],outputDirectories:[{package:'crate',path:'/build/owned-out'}],roots:[]});

test('capture-time physical identities classify host inputs without resolving historical paths again',()=>{
  const classify=runtimeProvenanceClassifier(facts()).classify;
  assert.equal(classify(descriptor('/host/library'),content)?.kind,'host-environment');
  assert.equal(classify(pathname('/host/alias',resolution('/host/library')),content)?.kind,'host-environment');
  assert.equal(classify(pathname('/host/unresolved'),content),undefined,'a spelling is not an identity');
  assert.equal(classify(pathname('/host/alias',resolution('/source/input')),content),undefined,'an outside spelling may resolve to source');
  const alias=resolution('/host/library');alias.components.unshift({path:'/source/alias',kind:'symlink',dev:'1',ino:'3'});
  assert.equal(classify(pathname('/source/alias',alias),content),undefined,'a commit can change the source alias');
  assert.equal(classify(descriptor('/build/unemitted'),content),undefined,'the build namespace itself grants nothing');
  assert.equal(classify(descriptor('/source/input'),content),undefined);
  assert.equal(classify(descriptor('/host/library'),{kind:'unknown',reason:'unknown ABI'}),undefined);
  assert.equal(runtimeProvenanceClassifier({...facts(),buildNamespace:undefined}).classify(descriptor('/host/library'),content),undefined,'historical missing namespace stays unknown');
});

test('fresh empty root receipts survive deletion, while write attempts and unbound roots grant nothing',t=>{
  const root=testScratch(t,'input-provenance-roots'),source=join(root,'source'),owned=join(root,'owned');mkdirSync(source);mkdirSync(owned);
  const receipt={path:owned,dev:'1',ino:'2',uid:'1000',createdAt:20,empty:true as const};
  const classify=runtimeProvenanceClassifier({...facts(),sourceRoot:source,roots:[receipt],window:{start:10,end:30}}).classify;
  writeFileSync(join(owned,'produced'),'output');rmSync(owned,{recursive:true});
  assert.equal(classify(descriptor(join(owned,'produced')),content)?.kind,'owned-output');
  assert.equal(classify(pathname(join(owned,'produced')),content),undefined,'even an owned spelling needs physical resolution');
  assert.equal(runtimeProvenanceClassifier({...facts(),sourceRoot:source,roots:[]}).classify(descriptor(join(source,'written')),content),undefined);
  assert.throws(()=>runtimeProvenanceClassifier({...facts(),sourceRoot:source,roots:[receipt],window:{start:21,end:30}}),/run window/);
  assert.throws(()=>runtimeProvenanceClassifier({...facts(),sourceRoot:root,roots:[receipt],window:{start:10,end:30}}),/outside source/);
});

test('only Cargo-emitted artifacts and actual build-script messages discharge build products',t=>{
  const root=testScratch(t,'input-provenance-build'),path=join(root,'cargo.json');
  const value={version:2,status:0,buildFinished:true,buildNamespace:'/build',artifacts:[{reason:'compiler-artifact',filenames:['/build/emitted'],executable:null}],
    buildScripts:[{reason:'build-script-executed',package_id:'crate',out_dir:'/build/owned-out'}]};
  const read=()=>{const bytes=readFileSync(path);return readRustBuildProvenance({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});};
  writeFileSync(path,JSON.stringify(value));const build=read(),classify=runtimeProvenanceClassifier({...facts(),...build}).classify;
  assert.equal(classify(descriptor('/build/emitted'),content)?.kind,'cargo-artifact');
  assert.equal(classify(descriptor('/build/owned-out/generated'),content)?.kind,'build-script-output');
  assert.equal(classify(descriptor('/build/unreported/generated'),content),undefined);
  writeFileSync(path,JSON.stringify({...value,version:1}));const historical=read();assert.equal(historical.buildNamespace,undefined);assert.deepEqual(historical.outputDirectories,[]);
  assert.equal(runtimeProvenanceClassifier({...facts(),...historical}).classify(descriptor('/build/owned-out/generated'),content),undefined);
  writeFileSync(path,JSON.stringify({...value,buildScripts:[{reason:'build-script-executed',package_id:'crate',out_dir:'/unowned'}]}));
  assert.throws(read,/OUT_DIR/);
});
