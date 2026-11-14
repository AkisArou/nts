import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {chmodSync,existsSync,lstatSync,mkdirSync,readFileSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {scratchRepo} from '../landing/scratch-repo.ts';
import {hostObservations} from './host-observations.ts';
import {ownMemory} from './test-memory.ts';
import {completeBuild} from './build-completion.ts';
import {DiskCapacity} from './disk-capacity.ts';
import {reclaimDisk,assertNoProcessUsers,type ReclaimOwnership,type ReclaimTarget} from './disk-reclamation.ts';
import {GateResource} from './gate-resource.ts';
import {processIdentity} from '../landing/lock.ts';
import {spawnTest,waitFor} from './test-wait.ts';
const GiB=2**30;
const cargoTag='Signature: 8a477f597d28d172789f06886806bc55\n';

function fixture(t:TestContext){
  const s=scratchRepo(t,'disk-reclamation');
  s.commit({'.gitignore':'target/\nlocal/\n','Cargo.toml':'[workspace]\n[profile.nts-dev]\ndebug=0\n'},'build policy');
  const dir=join(s.dir,'pool');mkdirSync(dir);
  const env=ownMemory(join(s.dir,'observations'),{disk:{freeBytes:44*GiB,freeInodes:1000}});
  const original=hostObservations(env),outputs=new Map<string,number>();
  let initialFree=44*GiB;
  const free=()=>initialFree+[...outputs].filter(([path])=>!existsSync(path)).reduce((sum,[,bytes])=>sum+bytes,0);
  const host={...original,disk:(path:string)=>({...original.disk(path),freeBytes:free()}),allocatedBytes:(path:string)=>outputs.get(path)??0};
  const tree=(name:string)=>{const path=join(dir,name);s.git(['worktree','add','-q','--detach',path,'main']);return path;};
  const output=(tree:string,name='nts-dev',bytes=4*GiB)=>{
    const target=join(tree,'target'),path=join(target,name);mkdirSync(path,{recursive:true});
    writeFileSync(join(target,'CACHEDIR.TAG'),cargoTag);writeFileSync(join(path,'built'),'immutable artifact');outputs.set(path,bytes);
    if(name==='nts-dev'||name==='clippy')completeBuild(tree,name,path);
    return path;
  };
  const options={pool:{dir,git:{root:s.root,env:s.env}},host,coldBytes:7*GiB,
    snapshot:()=>({freeBytes:free(),floorBytes:40*GiB,reservedBytes:0}),protectedRoots:()=>[],services:[] as ReclaimTarget[],ownership:((_tree,_target)=>{}) as ReclaimOwnership};
  return {s,dir,host,tree,output,options,outputs,setFree:(bytes:number)=>{initialFree=bytes;}};
}

test('pressure reclaims in cost order to a measured hysteresis goal, then stops',t=>{
  const f=fixture(t),a=f.tree('1'),b=f.tree('2'),c=f.tree('3'),unbuilt=f.tree('4');
  f.output(a);f.output(b);f.output(c);f.output(a,'debug',10*GiB);
  // Keep this target less recently used without a wall-clock decision.
  const report=reclaimDisk(f.options);
  assert.equal(report.triggerBytes,47*GiB);assert.equal(report.goalBytes,54*GiB);
  assert.deepEqual(report.removed.map(row=>row.kind),['obsolete-profile']);
  assert.equal(report.after,54*GiB);assert.ok(existsSync(unbuilt));
  const log=JSON.parse(readFileSync(join(f.dir,'.disk-reclaim.log'),'utf8')) as {root:string;allocatedBytes:number;freeBytesChange:number;facts:string[]};
  assert.equal(log.root,join(a,'target/debug'));assert.equal(log.allocatedBytes,10*GiB);assert.equal(log.freeBytesChange,10*GiB);
  assert.ok(log.facts.includes('resource lock held'));
  assert.deepEqual(reclaimDisk(f.options).removed,[],'headroom prevents repeated eviction');
});

test('free build output keeps the checkout and two warm targets; unbuilt removal uses Git',t=>{
  const f=fixture(t),trees=['1','2','3'].map(f.tree),unbuilt=f.tree('4');
  for(const tree of trees)f.output(tree);
  const report=reclaimDisk(f.options);
  assert.equal(report.removed.filter(row=>row.kind==='unbuilt-checkout').length,1);
  assert.equal(existsSync(unbuilt),false);
  assert.ok(!f.s.git(['worktree','list','--porcelain']).includes(unbuilt));
  assert.equal(report.removed.filter(row=>row.kind==='free-build-output').length,1);
  assert.ok(trees.every(path=>existsSync(path)), 'built checkouts remain registered');
  assert.equal(trees.filter(path=>existsSync(join(path,'target'))).length,2);
});

test('service targets offer obsolete whole profiles, never their current output',t=>{
  const f=fixture(t),tree=join(f.s.dir,'service');mkdirSync(tree);
  writeFileSync(join(tree,'Cargo.toml'),'[workspace]\n[profile.nts-dev]\ndebug=0\n');
  const current=f.output(tree),debug=f.output(tree,'debug',4*GiB),old=f.output(tree,'clippy',4*GiB);
  const marker=join(old,'.nts-complete.json');
  writeFileSync(marker,JSON.stringify({version:1,generation:'0'.repeat(64)}));
  f.options.services=[{tree,target:join(tree,'target'),service:true}];
  const report=reclaimDisk(f.options);
  assert.deepEqual(new Set(report.removed.map(row=>row.root)),new Set([debug,old]));
  assert.ok(existsSync(current));assert.ok(existsSync(tree));
  assert.equal(report.removed.some(row=>row.kind!=='obsolete-profile'),false);
});

test('both current service profiles survive legacy debug removal',t=>{
  const f=fixture(t),tree=join(f.s.dir,'service');mkdirSync(tree);
  writeFileSync(join(tree,'Cargo.toml'),'[workspace]\n[profile.nts-dev]\ndebug=0\n');
  const tests=f.output(tree),clippy=f.output(tree,'clippy'),debug=f.output(tree,'debug',16*GiB);
  const report=reclaimDisk({...f.options,services:[{tree,target:join(tree,'target'),service:true}]});
  assert.deepEqual(report.removed.map(row=>row.root),[debug]);
  for(const path of [tests,clippy])assert.ok(existsSync(path));
});

test('corrupt and unknown profile markers keep the entire candidate inventory',t=>{
  for(const body of ['{broken',JSON.stringify({version:2,generation:'future'}),JSON.stringify({version:1,generation:42})]){
    const f=fixture(t),tree=f.tree('1'),current=f.output(tree),debug=f.output(tree,'debug');
    writeFileSync(join(current,'.nts-complete.json'),body);
    const report=reclaimDisk(f.options);
    assert.deepEqual(report.removed,[]);assert.ok(report.kept.some(row=>row.root===tree));
    assert.ok(existsSync(debug));assert.ok(existsSync(current));
  }
});

test('a real cwd owner keeps a free scratch tree by name until it drains',async t=>{
  const f=fixture(t),tree=f.tree('1');
  const child=spawn('cat',[],{cwd:tree,env:f.s.env,stdio:['pipe','ignore','pipe']});
  const exited=once(child,'exit');
  try{
    await once(child,'spawn');
    const report=reclaimDisk({...f.options,ownership:(root,target)=>assertNoProcessUsers([root,target])});
    assert.deepEqual(report.removed,[]);
    assert.ok(report.kept.some(row=>row.root===tree&&row.reason.includes('process '+child.pid)&&row.reason.includes('cwd')),JSON.stringify(report));
  }finally{child.stdin.end();await exited;}
  const report=reclaimDisk({...f.options,ownership:(root,target)=>assertNoProcessUsers([root,target])});
  assert.deepEqual(report.removed.map(row=>row.root),[tree]);
  const facts=report.removed[0]!.facts;
  // The real user manager is present even when non-dumpable. Any ignored
  // observation names its exact PID/birth/cgroup in the removal receipt.
  assert.ok(facts.some(fact=>/ignored non-dumpable outside nts:.*systemd/.test(fact)),JSON.stringify(facts));
  const logged=JSON.parse(readFileSync(join(f.dir,'.disk-reclaim.log'),'utf8')) as {facts:string[]};
  assert.deepEqual(logged.facts,facts);
});

test('a real non-dumpable C child in the nts unit keeps its root by name',async t=>{
  const f=fixture(t),tree=f.tree('1'),executable=join(f.s.dir,'non-dumpable');
  const code='#include <sys/prctl.h>\n#include <unistd.h>\n#include <stdio.h>\nint main(int argc,char **argv){if(argc!=2||chdir(argv[1])||prctl(PR_SET_DUMPABLE,0))return 2;puts("ready");fflush(stdout);char byte;while(read(0,&byte,1)>0){}return 0;}\n';
  const build=spawnTest('clang',['-x','c','-','-o',executable],{input:code,env:f.s.env,encoding:'utf8'});
  assert.equal(build.status,0,build.stderr);
  const child=spawn(executable,[tree],{env:f.s.env,stdio:['pipe','pipe','pipe']});
  const exited=once(child,'exit');let out='',error='';
  child.stdout.on('data',bytes=>{out+=String(bytes);});child.stderr.on('data',bytes=>{error+=String(bytes);});
  try{
    await waitFor('non-dumpable child readiness',()=>out.includes('ready\n'),{stopped:()=>child.exitCode===null?undefined:error||'child exited '+child.exitCode});
    const cgroup=readFileSync('/proc/'+child.pid+'/cgroup','utf8');assert.match(cgroup,/(?:^|\/)nts[.-]/);
    const report=reclaimDisk({...f.options,ownership:(root,target)=>assertNoProcessUsers([root,target])});
    assert.deepEqual(report.removed,[]);
    assert.ok(report.kept.some(row=>row.root===tree&&row.reason.includes('unreadable tool process '+child.pid)),JSON.stringify(report));
  }finally{child.stdin.end();await exited;}
});

test('a stale previous-boot lock and build claim confer no ownership after reboot',t=>{
  const f=fixture(t),tree=f.tree('1'),debug=f.output(tree,'debug',16*GiB);
  const capacity=new DiskCapacity({env:f.s.env,host:f.host,pool:f.options.pool,reclamation:{services:[],ownership:f.options.ownership}});
  const identity=processIdentity(process.pid);assert.ok(identity);
  const previousBoot=identity.replace(/^[^ ]+/,'00000000-0000-0000-0000-000000000000');assert.notEqual(previousBoot,identity);
  writeFileSync(join(f.dir,'.lock'),previousBoot+'\n');
  writeFileSync(capacity.stateFile,JSON.stringify({version:1,claims:[{id:'previous-boot',pid:process.pid,identity:previousBoot,root:tree,target:join(tree,'target')}]}));
  const report=capacity.reclaim(f.dir);assert.deepEqual(report?.removed.map(row=>row.root),[debug]);
  assert.equal(existsSync(join(f.dir,'.lock')),false);
});

test('a live lease, dirty/unpublished/branched tree and unreadable owner remain named',t=>{
  const f=fixture(t),leased=f.tree('1'),dirty=f.tree('2'),unpublished=f.tree('3'),branched=f.tree('4'),unreadable=f.tree('5');
  f.output(leased,'debug');f.output(unreadable,'debug');
  writeFileSync(join(dirty,'README.md'),'not committed');
  f.s.commit({'private.txt':'not published'},'private commit',unpublished);
  f.s.git(['switch','-q','-c','not-published'],branched);
  const report=reclaimDisk({...f.options,protectedRoots:()=>[{root:leased,target:join(leased,'target')}],
    ownership:(tree)=>{if(tree===unreadable)throw Error('unreadable owned unit');}});
  for(const tree of [leased,dirty,unpublished,branched,unreadable])assert.ok(existsSync(tree));
  const text=report.kept.map(row=>row.reason).join('\n');
  for(const expected of [/live lease/,/uncommitted/,/unpublished detached/,/branch remains owned/,/unreadable owned unit/])assert.match(text,expected);
});

test('ignored local data, aliased roots and held resource locks prevent deletion',t=>{
  const f=fixture(t),local=f.tree('1'),aliased=f.tree('2'),locked=f.tree('3');
  mkdirSync(join(local,'local'));writeFileSync(join(local,'local/value'),'keep');
  const debug=f.output(locked,'debug');
  const saved=aliased+'.saved';renameSync(aliased,saved);symlinkSync(saved,aliased);
  const lock=GateResource.tryAcquire(locked+'.lock');assert.ok(lock);
  try{
    const report=reclaimDisk(f.options),text=report.kept.map(row=>row.reason).join('\n');
    assert.match(text,/ignored local data/);assert.match(text,/aliased root/);assert.match(text,/resource lock is held/);
    assert.ok(existsSync(join(local,'local/value')));assert.ok(existsSync(debug));assert.ok(lstatSync(aliased).isSymbolicLink());
  }finally{lock.close();}
});

test('replacement between inventory and removal cannot borrow the acquired root identity',t=>{
  const f=fixture(t),tree=f.tree('1'),debug=f.output(tree,'debug');
  let changed=false;
  const report=reclaimDisk({...f.options,ownership:()=>{
    if(changed)return;changed=true;renameSync(debug,debug+'.old');mkdirSync(debug);writeFileSync(join(debug,'new'),'foreign generation');
  }});
  assert.match(report.kept.map(row=>row.reason).join('\n'),/identity changed/);
  assert.equal(readFileSync(join(debug,'new'),'utf8'),'foreign generation');
});

test('snapshot never collects; explicit admission reclamation uses the same promises and owner',t=>{
  const f=fixture(t),tree=f.tree('1');f.output(tree,'debug',16*GiB);
  const capacity=new DiskCapacity({env:f.s.env,host:f.host,pool:f.options.pool,reclamation:{services:[],ownership:f.options.ownership}});
  assert.equal(capacity.snapshot(f.dir).freeBytes,44*GiB);assert.ok(existsSync(join(tree,'target/debug')));
  const service=join(f.s.dir,'builder');mkdirSync(service);
  writeFileSync(join(service,'Cargo.toml'),'[workspace]\n[profile.nts-dev]\ndebug=0\n');
  const release=capacity.beginBuild({root:service,target:join(service,'target')});
  try{assert.equal(existsSync(join(tree,'target/debug')),false);assert.equal(capacity.snapshot(f.dir).reservedBytes,7*GiB);}
  finally{release();}
});

test('process ownership includes cwd, executable and open files and refuses unreadability',t=>{
  const f=fixture(t),root=join(f.s.dir,'owned'),proc=join(f.s.dir,'proc');mkdirSync(root);mkdirSync(proc);
  const pid=join(proc,'42');mkdirSync(join(pid,'fd'),{recursive:true});
  writeFileSync(join(pid,'status'),'Uid:\t'+Array<number>(4).fill(process.getuid!()).join('\t')+'\n');
  writeFileSync(join(pid,'stat'),'42 (worker) '+['S',...Array<string>(18).fill('0'),'99'].join(' '));
  symlinkSync(root,join(pid,'cwd'));symlinkSync('/outside/node',join(pid,'exe'));
  assert.throws(()=>assertNoProcessUsers([root],proc),/42 owns cwd/);
  rmSync(join(pid,'cwd'));symlinkSync('/outside',join(pid,'cwd'));rmSync(join(pid,'exe'));symlinkSync(join(root,'program'),join(pid,'exe'));
  assert.throws(()=>assertNoProcessUsers([root],proc),/42 owns exe/);
  rmSync(join(pid,'exe'));symlinkSync('/outside/node',join(pid,'exe'));symlinkSync(join(root,'data')+' (deleted)',join(pid,'fd/7'));
  assert.throws(()=>assertNoProcessUsers([root],proc),/42 owns fd\/7/);
  rmSync(join(pid,'fd/7'));assert.doesNotThrow(()=>assertNoProcessUsers([root],proc));
  rmSync(join(pid,'exe'));assert.throws(()=>assertNoProcessUsers([root],proc),/keeps unreadable process/);
  symlinkSync('/outside/node',join(pid,'exe'));writeFileSync(join(pid,'comm'),'non-dumpable\n');
  writeFileSync(join(pid,'cgroup'),'0::/user.slice/session-2.scope\n');chmodSync(join(pid,'fd'),0);
  try{
    assert.match(assertNoProcessUsers([root],proc).join('\n'),/ignored non-dumpable outside nts: pid 42 non-dumpable/);
    writeFileSync(join(pid,'cgroup'),'0::/user.slice/nts-agent-private.service\n');
    assert.throws(()=>assertNoProcessUsers([root],proc),/unreadable tool process 42/);
    rmSync(join(pid,'cgroup'));assert.throws(()=>assertNoProcessUsers([root],proc),/keeps unreadable process/);
  }finally{chmodSync(join(pid,'fd'),0o700);}
});
