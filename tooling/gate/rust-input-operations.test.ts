import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runtimeInputRequirement} from './rust-input-operations.ts';
import type {InputSubject} from './rust-test-inputs.ts';
import type {FileObserverReceipt} from './file-input-observer.ts';
import {emptyPathDescriptorArgument} from './rust-input-abi.ts';

const basis:FileObserverReceipt={version:1,observedPath:'/observer',artifactPath:'/retained/observer',sha256:'0'.repeat(64),sourceSha256:'1'.repeat(64),abi:'linux-x86_64-v1'};
const path=(arg:number,dirfdArg=-1,name='input'):InputSubject=>({kind:'path',arg,dirfdArg,name,raw:Buffer.from(name).toString('hex'),
  anchor:dirfdArg<0?{kind:'cwd',path:'/source'}:{kind:'dirfd',fd:3,path:'/source',raw:Buffer.from('/source').toString('hex')}});
const descriptor:InputSubject={kind:'descriptor',arg:0,fd:3,target:'/source/input',raw:Buffer.from('/source/input').toString('hex')};
const nullPath:InputSubject={...descriptor,pathArgument:{arg:1,dirfdArg:0,value:{hex:'',error:0,truncated:false,null:true}}};
const emptyPath:InputSubject={...descriptor,pathArgument:{arg:1,dirfdArg:0,value:{hex:'',error:0,truncated:false,null:false}}};
function request(syscall:string,operation:string,subject:InputSubject,values:Record<number,string>={},observer:FileObserverReceipt|null=basis){
  const args=['0','0','0','0','0','0'];
  if(subject.kind==='descriptor')args[subject.arg]=BigInt.asUintN(64,BigInt(subject.fd)).toString(16);
  else if(subject.anchor.kind==='dirfd')args[subject.dirfdArg]=subject.anchor.fd.toString(16);
  for(const [arg,value]of Object.entries(values))args[Number(arg)]=value;
  return runtimeInputRequirement({syscall,operation,args},subject,observer);
}
test('open requirements keep content, path, directory and mutation requests distinct',()=>{
  assert.deepEqual(request('open','open',path(0)),{kind:'content',following:'follow'});
  assert.deepEqual(request('openat','open',path(1,0),{2:'20000'}),{kind:'content',following:'no-follow'});
  assert.deepEqual(request('openat','open',path(1,0),{2:'10000'}),{kind:'metadata',query:'directory',following:'follow'});
  assert.deepEqual(request('openat','open',path(1,0),{2:'220000'}),{kind:'metadata',query:'path',following:'no-follow'});
  assert.deepEqual(request('openat','open',path(1,0),{2:'2'}),{kind:'mutation',role:'open',following:'follow',readsContent:true});
  assert.deepEqual(request('openat','open',path(1,0),{2:'c1'}),{kind:'mutation',role:'open',following:'no-follow',readsContent:false});
  assert.deepEqual(request('openat','open',path(1,0),{2:'410002'}),{kind:'mutation',role:'temporary-file',following:'follow',readsContent:false});
  for(const flags of ['20','80000000','620000'])assert.equal(request('openat','open',path(1,0),{2:flags}).kind,'unknown');
  assert.equal(request('openat2','open',path(1,0),{2:'10000'}).kind,'unknown');
  assert.equal(request('openat','open',path(1,0,''),{2:'0'}).kind,'unknown');
  assert.equal(request('openat','open',path(0),{2:'0'}).kind,'unknown');
});
test('stat and access flags keep their own argument and empty-descriptor protocols',()=>{
  assert.deepEqual(request('stat','lookup',path(0)),{kind:'metadata',query:'stat',following:'follow'});
  assert.deepEqual(request('lstat','lookup',path(0)),{kind:'metadata',query:'stat',following:'no-follow'});
  assert.deepEqual(request('newfstatat','lookup',path(1,0),{3:'100'}),{kind:'metadata',query:'stat',following:'no-follow'});
  assert.deepEqual(request('statx','lookup',path(1,0),{2:'4100'}),{kind:'metadata',query:'stat',following:'no-follow'});
  assert.deepEqual(request('statx','lookup',nullPath,{2:'1000'}),{kind:'metadata',query:'stat',following:'descriptor'});
  assert.deepEqual(request('newfstatat','lookup',path(1,0,''),{3:'1000'}),{kind:'metadata',query:'stat',following:'descriptor'});
  for(const flags of ['10000','6000','8000'])assert.equal(request('statx','lookup',path(1,0),{2:flags}).kind,'unknown');
  assert.equal(request('statx','lookup',nullPath).kind,'unknown');
  assert.deepEqual(request('fstat','descriptor',descriptor),{kind:'metadata',query:'stat',following:'descriptor'});
  assert.deepEqual(request('access','lookup',path(0),{1:'4'}),{kind:'metadata',query:'permission',following:'follow'});
  assert.deepEqual(request('faccessat','lookup',path(1,0),{2:'4',3:'ffffffffffffffff'}),{kind:'metadata',query:'permission',following:'follow'},'the original kernel faccessat has no flags argument');
  assert.deepEqual(request('faccessat2','lookup',path(1,0),{2:'6',3:'100'}),{kind:'metadata',query:'permission',following:'no-follow'});
  assert.deepEqual(request('faccessat2','lookup',path(1,0,''),{3:'1000'}),{kind:'metadata',query:'permission',following:'descriptor'});
  assert.equal(request('faccessat2','lookup',nullPath,{3:'1000'}).kind,'unknown');
  assert.equal(request('faccessat2','lookup',path(1,0),{2:'8'}).kind,'unknown');
});
test('descriptor access and link text never become an implicit byte or enumeration claim',()=>{
  assert.deepEqual(request('getdents64','directory',descriptor),{kind:'enumeration',following:'descriptor'});
  assert.deepEqual(request('fchdir','context',descriptor),{kind:'metadata',query:'chdir',following:'descriptor'});
  assert.deepEqual(request('chdir','context',path(0)),{kind:'metadata',query:'chdir',following:'follow'});
  assert.deepEqual(request('readlinkat','lookup',path(1,0)),{kind:'readlink',following:'no-follow'});
  assert.deepEqual(request('readlinkat','lookup',path(1,0,'')),{kind:'readlink',following:'descriptor'});
  assert.equal(request('readlinkat','lookup',nullPath).kind,'unknown');
  assert.equal(request('fstat','descriptor',{...descriptor,fd:-100}).kind,'unknown');
  assert.deepEqual(request('symlinkat','symlink',path(0,-1,'../target')),{kind:'literal',text:'../target'});
  assert.deepEqual(request('symlinkat','symlink',path(2,1)),{kind:'mutation',role:'link-destination',following:'no-follow',readsContent:false});
  assert.deepEqual(request('linkat','link',path(1,0)),{kind:'hard-link-source',following:'no-follow'});
  assert.deepEqual(request('linkat','link',path(1,0),{4:'400'}),{kind:'hard-link-source',following:'follow'});
  assert.deepEqual(request('linkat','link',path(1,0,''),{4:'1000'}),{kind:'hard-link-source',following:'descriptor'});
  assert.deepEqual(request('linkat','link',path(3,2)),{kind:'mutation',role:'link-destination',following:'no-follow',readsContent:false});
  assert.equal(request('linkat','link',path(1,0),{4:'200'}).kind,'unknown');
});
test('execution and mutation roles use their own positions, flags and following rules',()=>{
  assert.deepEqual(request('execve','execute',path(0)),{kind:'execute',following:'follow'});
  assert.deepEqual(request('execveat','execute',path(1,0),{4:'100'}),{kind:'execute',following:'no-follow'});
  assert.deepEqual(request('execveat','execute',path(1,0,''),{4:'1000'}),{kind:'execute',following:'descriptor'});
  assert.equal(request('execveat','execute',nullPath,{4:'1000'}).kind,'unknown');
  assert.equal(request('execveat','execute',path(1,0),{4:'10000'}).kind,'unknown');
  assert.deepEqual(request('renameat2','mutation',path(1,0),{4:'1'}),{kind:'mutation',role:'rename-source',following:'no-follow',readsContent:false});
  assert.deepEqual(request('renameat2','mutation',path(3,2),{4:'2'}),{kind:'mutation',role:'rename-destination',following:'no-follow',readsContent:false});
  assert.equal(request('renameat2','mutation',path(1,0),{4:'8'}).kind,'unknown');
  assert.deepEqual(request('unlinkat','mutation',path(1,0),{2:'200'}),{kind:'mutation',role:'remove',following:'no-follow',readsContent:false});
  assert.equal(request('unlinkat','mutation',path(1,0),{2:'100'}).kind,'unknown');
  assert.deepEqual(request('mkdirat','mutation',path(1,0)),{kind:'mutation',role:'mkdir',following:'no-follow',readsContent:false});
  assert.deepEqual(request('truncate','mutation',path(0)),{kind:'mutation',role:'truncate',following:'follow',readsContent:false});
  for(const basisValue of [null,{...basis,abi:'linux-aarch64-v1' as const}])assert.equal(request('stat','lookup',path(0),{},basisValue).kind,'unknown');
  assert.equal(request('unobserved','lookup',path(0)).kind,'unknown');
});

test('the shared empty-path ABI covers the supported at family without borrowing independent path authority',()=>{
  for(const [syscall,operation,flagsAt,kind]of [
    ['newfstatat','lookup',3,'metadata'],['fstatat','lookup',3,'metadata'],['statx','lookup',2,'metadata'],
    ['faccessat2','lookup',3,'metadata'],['linkat','link',4,'hard-link-source'],['execveat','execute',4,'execute'],
    ['readlinkat','lookup',-1,'readlink'],
  ] as const){
    const args=['3','0','0','0','0','0'];if(flagsAt>=0)args[flagsAt]='1000';
    assert.deepEqual(emptyPathDescriptorArgument({syscall,operation,args},basis),{pathArg:1,descriptorArg:0},syscall);
    const interpreted=request(syscall,operation,emptyPath,flagsAt>=0?{[flagsAt]:'1000'}:{});
    assert.equal(interpreted.kind,kind,syscall);assert.ok('following' in interpreted&&interpreted.following==='descriptor',syscall);
    if(flagsAt>=0){
      args[flagsAt]='0';assert.equal(emptyPathDescriptorArgument({syscall,operation,args},basis),undefined,syscall+' without empty flag');
      assert.equal(request(syscall,operation,path(1,0,''),{}).kind,'unknown',syscall+' unflagged empty pathname');
      args[flagsAt]='10001000';assert.equal(emptyPathDescriptorArgument({syscall,operation,args},basis),undefined,syscall+' unknown flags');
    }
    assert.equal(emptyPathDescriptorArgument({syscall,operation,args},null),undefined,'missing ABI grants no descriptor interpretation');
  }
});
