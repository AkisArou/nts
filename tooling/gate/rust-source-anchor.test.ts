import assert from 'node:assert/strict';
import {test} from 'node:test';
import {lstatSync,mkdirSync,renameSync,symlinkSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {runtimeSourceAnchor} from './rust-source-anchor.ts';
import {runtimeSubjectValidator} from './rust-input-validation.ts';
import type {InputSnapshot} from './module-closure.ts';
import type {FileObserverReceipt} from './file-input-observer.ts';
import type {InputSubject,RuntimeObservation} from './rust-test-inputs.ts';
import {testScratch} from './test-scratch.ts';

const basis:FileObserverReceipt={version:1,observedPath:'/observer',artifactPath:'/retained/observer',sha256:'0'.repeat(64),sourceSha256:'1'.repeat(64),abi:'linux-x86_64-v1'};
const empty:InputSnapshot={files:[],ownedFiles:[],moduleFiles:[],hostFiles:[],placingFiles:[],stagingFiles:[],directories:[],optionalFiles:[],memberships:[],projectMatches:[],observations:[]};
test('source anchor components retain exact identity without endpoint authority',t=>{
  const root=testScratch(t,'runtime-source-anchor'),anchor=runtimeSourceAnchor(root),parent=dirname(root);
  const first=anchor.component({kind:'runtimeKind',path:parent,value:'directory'});assert.equal(first.kind,'claimed');
  if(first.kind!=='claimed')throw Error('expected component');first.claims[0]!.anchor!.ino='caller mutation';
  assert.notDeepEqual(anchor.component({kind:'runtimeKind',path:parent,value:'directory'}),first);
  for(const observation of [{kind:'runtimeKind' as const,path:parent,value:'symlink' as const},{kind:'file' as const,path:parent,value:null},{kind:'runtimeEntries' as const,path:parent,value:[]},
    {kind:'stat' as const,path:parent,value:{mode:0o40755,size:0,mtimeMs:0}}])assert.equal(anchor.component(observation).kind,'uncovered');
  const validator=runtimeSubjectValidator(root,empty);
  for(const path of [root,parent])for(const operation of ['open','stat','enumerate'] as const){
    const row:RuntimeObservation={phase:'test-runtime',source:'crate/lib.rs',attempt:{id:'1',tid:1,tgid:1,ppid:0,birth:'1',parentBirth:'0'},cwd:root,image:1,canceled:false,subjects:[],probes:[],outcome:'unknown',
      operation:operation==='open'?'open':operation==='stat'?'lookup':'directory',syscall:operation==='open'?'openat':operation==='stat'?'stat':'getdents64',args:['ffffffffffffff9c','0','0','0','0','0']};
    const subject:InputSubject=operation==='enumerate'?{kind:'descriptor',arg:0,fd:3,target:path,raw:Buffer.from(path).toString('hex')}:
      {kind:'path',arg:operation==='stat'?0:1,dirfdArg:operation==='stat'?-1:0,name:path,raw:Buffer.from(path).toString('hex'),anchor:{kind:'absolute'}};
    const result=validator.assess(row,subject,basis);
    assert.equal(result.requirement.kind,operation==='open'?'content':operation==='stat'?'metadata':'enumeration');
    assert.equal(result.state,'uncovered',operation+' endpoint '+path);
  }
});
test('root replacement before or during the fence refuses the complete assessment',t=>{
  const base=testScratch(t,'runtime-source-replacement'),root=join(base,'source');mkdirSync(root);
  const anchor=runtimeSourceAnchor(root);renameSync(root,join(base,'prior'));mkdirSync(root);
  assert.throws(()=>anchor.fence(()=>true),/source anchor changed/);
  let replaced=false;
  const supplied=runtimeSourceAnchor(root,path=>{const info=lstatSync(path,{bigint:true});return {...info,dev:info.dev,ino:info.ino+(replaced&&path===root?1n:0n),isDirectory:()=>info.isDirectory(),isSymbolicLink:()=>info.isSymbolicLink()};});
  assert.throws(()=>supplied.fence(()=>{replaced=true;return 'must not publish';}),/source anchor changed/);
  const link=join(base,'alias');symlinkSync('source',link);assert.throws(()=>runtimeSourceAnchor(link),/symbolic ancestor/);
});
test('a failed assessment and changed post-read root retain both diagnostics',t=>{
  const root=testScratch(t,'runtime-source-fence-failures');let changed=false;
  const anchor=runtimeSourceAnchor(root,path=>{const info=lstatSync(path,{bigint:true});return {...info,ino:info.ino+(changed&&path===root?1n:0n),isDirectory:()=>info.isDirectory(),isSymbolicLink:()=>info.isSymbolicLink()};});
  const original=Error('actual assessment diagnostic');
  assert.throws(()=>anchor.fence(()=>{throw original;}),error=>error===original);
  assert.throws(()=>anchor.fence(()=>{changed=true;throw original;}),error=>error instanceof AggregateError&&error.cause===original&&error.errors[0]===original&&/source anchor changed/.test(String(error.errors[1])));
});
