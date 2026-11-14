import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {chmodSync,existsSync,lstatSync,mkdirSync,readFileSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {scratchRepo} from '../landing/scratch-repo.ts';
import {hostObservations} from './host-observations.ts';
import {ownMemory} from './test-memory.ts';
import {completeBuild} from './build-completion.ts';
import {DiskCapacity} from './disk-capacity.ts';
import {reclaimDisk,assertNoUnitUsers,assertUnitTreeUnused,parseUnitTreeOwnership,type UnitTreeOwnership,type ReclaimOwnership,type ReclaimTarget} from './disk-reclamation.ts';
import {GateResource} from './gate-resource.ts';
import {processIdentity} from '../landing/lock.ts';
import {assertNoProcessUsers,observeTreeProcesses,processCgroup} from '../landing/tree-users.ts';
import {spawnTest,waitFor} from './test-wait.ts';
import {generatedJavaScript} from './generated-javascript.ts';
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
  assert.equal(report.triggerBytes,47*GiB,JSON.stringify(report?.kept));assert.equal(report.goalBytes,54*GiB,JSON.stringify(report?.kept));
  assert.deepEqual(report.removed.map(row=>row.kind),['obsolete-profile'],JSON.stringify(report?.kept));
  assert.equal(report.after,54*GiB,JSON.stringify(report?.kept));assert.ok(existsSync(unbuilt),JSON.stringify(report?.kept));
  const log=JSON.parse(readFileSync(join(f.dir,'.disk-reclaim.log'),'utf8')) as {root:string;allocatedBytes:number;freeBytesChange:number;facts:string[]};
  assert.equal(log.root,join(a,'target/debug'),JSON.stringify(report?.kept));assert.equal(log.allocatedBytes,10*GiB,JSON.stringify(report?.kept));assert.equal(log.freeBytesChange,10*GiB,JSON.stringify(report?.kept));
  assert.ok(log.facts.includes('resource lock held'),JSON.stringify(report?.kept));
  const repeated=reclaimDisk(f.options);
  assert.deepEqual(repeated.removed,[],'headroom prevents repeated eviction; kept='+JSON.stringify(repeated.kept));
});

test('free build output keeps the checkout and two warm targets; unbuilt removal uses Git',t=>{
  const f=fixture(t),trees=['1','2','3'].map(f.tree),unbuilt=f.tree('4');
  for(const tree of trees)f.output(tree);
  const report=reclaimDisk(f.options);
  assert.equal(report.removed.filter(row=>row.kind==='unbuilt-checkout').length,1,JSON.stringify(report?.kept));
  assert.equal(existsSync(unbuilt),false,JSON.stringify(report?.kept));
  assert.ok(!f.s.git(['worktree','list','--porcelain']).includes(unbuilt),JSON.stringify(report?.kept));
  assert.equal(report.removed.filter(row=>row.kind==='free-build-output').length,1,JSON.stringify(report?.kept));
  assert.ok(trees.every(path=>existsSync(path)),( 'built checkouts remain registered')+'; kept='+JSON.stringify(report?.kept));
  assert.equal(trees.filter(path=>existsSync(join(path,'target'))).length,2,JSON.stringify(report?.kept));
});

test('service targets offer obsolete whole profiles, never their current output',t=>{
  const f=fixture(t),tree=join(f.s.dir,'service');mkdirSync(tree);
  writeFileSync(join(tree,'Cargo.toml'),'[workspace]\n[profile.nts-dev]\ndebug=0\n');
  const current=f.output(tree),debug=f.output(tree,'debug',4*GiB),old=f.output(tree,'clippy',4*GiB);
  const marker=join(old,'.nts-complete.json');
  writeFileSync(marker,JSON.stringify({version:1,generation:'0'.repeat(64)}));
  f.options.services=[{tree,target:join(tree,'target'),service:true}];
  const report=reclaimDisk(f.options);
  assert.deepEqual(new Set(report.removed.map(row=>row.root)),new Set([debug,old]),JSON.stringify(report?.kept));
  assert.ok(existsSync(current),JSON.stringify(report?.kept));assert.ok(existsSync(tree),JSON.stringify(report?.kept));
  assert.equal(report.removed.some(row=>row.kind!=='obsolete-profile'),false,JSON.stringify(report?.kept));
});

test('both current service profiles survive legacy debug removal',t=>{
  const f=fixture(t),tree=join(f.s.dir,'service');mkdirSync(tree);
  writeFileSync(join(tree,'Cargo.toml'),'[workspace]\n[profile.nts-dev]\ndebug=0\n');
  const tests=f.output(tree),clippy=f.output(tree,'clippy'),debug=f.output(tree,'debug',16*GiB);
  const report=reclaimDisk({...f.options,services:[{tree,target:join(tree,'target'),service:true}]});
  assert.deepEqual(report.removed.map(row=>row.root),[debug],JSON.stringify(report?.kept));
  for(const path of [tests,clippy])assert.ok(existsSync(path),JSON.stringify(report?.kept));
});

test('corrupt and unknown profile markers keep the entire candidate inventory',t=>{
  for(const body of ['{broken',JSON.stringify({version:2,generation:'future'}),JSON.stringify({version:1,generation:42})]){
    const f=fixture(t),tree=f.tree('1'),current=f.output(tree),debug=f.output(tree,'debug');
    writeFileSync(join(current,'.nts-complete.json'),body);
    const report=reclaimDisk(f.options);
    assert.deepEqual(report.removed,[],JSON.stringify(report?.kept));assert.ok(report.kept.some(row=>row.root===tree),JSON.stringify(report?.kept));
    assert.ok(existsSync(debug),JSON.stringify(report?.kept));assert.ok(existsSync(current),JSON.stringify(report?.kept));
  }
});

test('a real cwd owner keeps a free scratch tree by name until it drains',async t=>{
  const f=fixture(t),tree=f.tree('1');
  const child=spawn('cat',[],{cwd:tree,env:f.s.env,stdio:['pipe','ignore','pipe']});
  const exited=once(child,'exit');let outsidePids:number[]=[];
  try{
    await once(child,'spawn');outsidePids=observeTreeProcesses([tree]).ignored.map(row=>row.pid);
    const report=reclaimDisk({...f.options,ownership:(root,target)=>assertNoProcessUsers([root,target])});
    assert.deepEqual(report.removed,[],JSON.stringify(report?.kept));
    assert.ok(report.kept.some(row=>row.root===tree&&row.reason.includes('process '+child.pid)&&row.reason.includes('cwd')),JSON.stringify(report));
  }finally{child.stdin.end();await exited;}
  const report=reclaimDisk({...f.options,ownership:(root,target)=>assertNoProcessUsers([root,target],{pids:[child.pid!,...outsidePids]})});
  assert.deepEqual(report.removed.map(row=>row.root),[tree],JSON.stringify(report));
  const facts=report.removed[0]!.facts;
  // The real user manager is present even when non-dumpable. Any ignored
  // observation names its exact PID/birth/cgroup in the removal receipt.
  assert.ok(facts.some(fact=>/ignored non-dumpable outside nts:.*systemd/.test(fact)),(JSON.stringify(facts))+'; kept='+JSON.stringify(report?.kept));
  const logged=JSON.parse(readFileSync(join(f.dir,'.disk-reclaim.log'),'utf8')) as {facts:string[]};
  assert.deepEqual(logged.facts,facts,JSON.stringify(report?.kept));
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
    const cgroup=processCgroup(child.pid!);assert.match(cgroup,/(?:^|\/)nts[.-]/);
    const report=reclaimDisk({...f.options,ownership:(root,target)=>assertNoProcessUsers([root,target])});
    assert.deepEqual(report.removed,[],JSON.stringify(report?.kept));
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
  const report=capacity.reclaim(f.dir);assert.deepEqual(report?.removed.map(row=>row.root),[debug],JSON.stringify(report?.kept));
  assert.equal(existsSync(join(f.dir,'.lock')),false,JSON.stringify(report?.kept));
});

test('a live lease, dirty/unpublished/branched tree and unreadable owner remain named',t=>{
  const f=fixture(t),leased=f.tree('1'),dirty=f.tree('2'),unpublished=f.tree('3'),branched=f.tree('4'),unreadable=f.tree('5');
  f.output(leased,'debug');f.output(unreadable,'debug');
  writeFileSync(join(dirty,'README.md'),'not committed');
  f.s.commit({'private.txt':'not published'},'private commit',unpublished);
  f.s.git(['switch','-q','-c','not-published'],branched);
  const report=reclaimDisk({...f.options,protectedRoots:()=>[{root:leased,target:join(leased,'target')}],
    ownership:(tree)=>{if(tree===unreadable)throw Error('unreadable owned unit');}});
  for(const tree of [leased,dirty,unpublished,branched,unreadable])assert.ok(existsSync(tree),JSON.stringify(report?.kept));
  const text=report.kept.map(row=>row.reason).join('\n');
  for(const expected of [/live lease/,/uncommitted/,/unpublished detached/,/branch remains owned/,/unreadable owned unit/])assert.match(text,expected,JSON.stringify(report?.kept));
});

test('ignored local data, aliased roots and held resource locks prevent deletion',t=>{
  const f=fixture(t),local=f.tree('1'),aliased=f.tree('2'),locked=f.tree('3');
  mkdirSync(join(local,'local'));writeFileSync(join(local,'local/value'),'keep');
  const debug=f.output(locked,'debug');
  const saved=aliased+'.saved';renameSync(aliased,saved);symlinkSync(saved,aliased);
  const lock=GateResource.tryAcquire(locked+'.lock');assert.ok(lock);
  try{
    const report=reclaimDisk(f.options),text=report.kept.map(row=>row.reason).join('\n');
    assert.match(text,/ignored local data/,JSON.stringify(report?.kept));assert.match(text,/aliased root/,JSON.stringify(report?.kept));assert.match(text,/resource lock is held/,JSON.stringify(report?.kept));
    assert.ok(existsSync(join(local,'local/value')),JSON.stringify(report?.kept));assert.ok(existsSync(debug),JSON.stringify(report?.kept));assert.ok(lstatSync(aliased).isSymbolicLink(),JSON.stringify(report?.kept));
  }finally{lock.close();}
});

test('replacement between inventory and removal cannot borrow the acquired root identity',t=>{
  const f=fixture(t),tree=f.tree('1'),debug=f.output(tree,'debug');
  let changed=false;
  const report=reclaimDisk({...f.options,ownership:()=>{
    if(changed)return;changed=true;renameSync(debug,debug+'.old');mkdirSync(debug);writeFileSync(join(debug,'new'),'foreign generation');
  }});
  assert.match(report.kept.map(row=>row.reason).join('\n'),/identity changed/,JSON.stringify(report?.kept));
  assert.equal(readFileSync(join(debug,'new'),'utf8'),'foreign generation',JSON.stringify(report?.kept));
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
  writeFileSync(join(pid,'comm'),'worker\n');
  writeFileSync(join(pid,'status'),'Uid:\t'+Array<number>(4).fill(process.getuid!()).join('\t')+'\n');
  writeFileSync(join(pid,'stat'),'42 (worker) '+['S',...Array<string>(18).fill('0'),'99'].join(' '));
  symlinkSync(root,join(pid,'cwd'));symlinkSync('/outside/node',join(pid,'exe'));
  assert.throws(()=>assertNoProcessUsers([root],{proc}),/42 owns cwd/);
  rmSync(join(pid,'cwd'));symlinkSync('/outside',join(pid,'cwd'));rmSync(join(pid,'exe'));symlinkSync(join(root,'program'),join(pid,'exe'));
  assert.throws(()=>assertNoProcessUsers([root],{proc}),/42 owns exe/);
  rmSync(join(pid,'exe'));symlinkSync('/outside/node',join(pid,'exe'));symlinkSync(join(root,'data')+' (deleted)',join(pid,'fd/7'));
  assert.throws(()=>assertNoProcessUsers([root],{proc}),/42 owns fd\/7/);
  rmSync(join(pid,'fd/7'));assert.doesNotThrow(()=>assertNoProcessUsers([root],{proc}));
  rmSync(join(pid,'exe'));assert.doesNotThrow(()=>assertNoProcessUsers([root],{proc}));
  symlinkSync('/outside/node',join(pid,'exe'));writeFileSync(join(pid,'comm'),'non-dumpable\n');
  writeFileSync(join(pid,'cgroup'),'0::/user.slice/session-2.scope\n');chmodSync(join(pid,'fd'),0);
  try{
    assert.match(assertNoProcessUsers([root],{proc}).join('\n'),/ignored non-dumpable outside nts: pid 42 non-dumpable/);
    writeFileSync(join(pid,'cgroup'),'0::/user.slice/nts-agent-private.service\n');
    assert.throws(()=>assertNoProcessUsers([root],{proc}),/unreadable tool process 42/);
    rmSync(join(pid,'cgroup'));assert.throws(()=>assertNoProcessUsers([root],{proc}),/keeps unreadable process/);
  }finally{chmodSync(join(pid,'fd'),0o700);}
});

test('typed unit execution properties preserve path and argument ownership',()=>{
  const root='/owned/tree',unit='owned.service';
  for(const property of ['ExecStartPre','ExecStart','ExecStartPost'] as const){
    for(const command of [{property,path:root+'/program',args:[]},{property,path:'/usr/bin/node',args:[root+'/argument with ; space']},
      {property,path:'/usr/bin/node',args:['--file='+root+'/config']},{property,path:'/usr/bin/node',args:['../tree/entry']}]){
      const reading:UnitTreeOwnership={unit,workingDirectory:'/owned/outside',rootDirectory:'',commands:[command]};
      assert.throws(()=>assertUnitTreeUnused([root],reading),/unit owned\.service owns ExecStart/);
    }
  }
  const command=['/usr/bin/node',['/outside/entry','quoted ; value'],false,0,0,0,0,0,0,0];
  const text=[{type:'s',data:'/outside'},{type:'s',data:''},...Array.from({length:3},()=>({type:'a(sasbttttuii)',data:[command]}))].map(row=>JSON.stringify(row)).join('\n');
  const reading=parseUnitTreeOwnership(unit,text);assert.deepEqual(reading.commands[0]!.args,command[1]);
  assert.doesNotThrow(()=>assertUnitTreeUnused([root],reading));
  assert.throws(()=>parseUnitTreeOwnership(unit,text.replace('a(sasbttttuii)','unknown')),/unreadable unit ExecStartPre/);
  assert.throws(()=>parseUnitTreeOwnership(unit,'{}'),/unreadable unit directories/);
  assert.throws(()=>assertUnitTreeUnused([root],{...reading,workingDirectory:root+'/cwd'}),/WorkingDirectory/);
  assert.throws(()=>assertUnitTreeUnused([root],{...reading,rootDirectory:root+'/root'}),/RootDirectory/);
  assert.doesNotThrow(()=>assertUnitTreeUnused([root],{...reading,workingDirectory:'~'}));
  assert.doesNotThrow(()=>assertUnitTreeUnused([root],{...reading,workingDirectory:'!/outside/absent'}));
  assert.throws(()=>assertUnitTreeUnused([root],{...reading,workingDirectory:'-/outside'}),/unresolved unit WorkingDirectory/);
  assert.throws(()=>assertUnitTreeUnused([root],{...reading,workingDirectory:'!!/outside'}),/unresolved unit WorkingDirectory/);
});

test('an activating start-pre unit owns its future executable before PID zero starts',async t=>{
  const f=fixture(t),tree=f.tree('1'),outside=join(f.s.dir,'outside');mkdirSync(outside);
  const entry=join(tree,'entry'),prelude=join(outside,'prelude.mjs'),ready=join(outside,'ready');
  writeFileSync(entry,'#!/bin/sh\nexit 0\n',{mode:0o755});
  writeFileSync(prelude,generatedJavaScript(`import {writeFileSync,watch} from 'node:fs';watch(${JSON.stringify(outside)},()=>{});writeFileSync(${JSON.stringify(ready)},'ready');`));
  const alias=join(outside,'entry-alias');symlinkSync(entry,alias);
  for(const executable of [entry,alias]){
    const unit='nts-agent-709-unit-entry-'+randomUUID()+'.service';
    const started=spawnTest('systemd-run',['--user','--collect','--quiet','--no-block','--unit='+unit,'--working-directory='+outside,
      '-p','LimitCORE=0','-p','Nice=19','-p','ExecStartPre='+process.execPath+' '+prelude,'--',executable],{env:f.s.env,encoding:'utf8'});
    assert.equal(started.status,0,started.stderr);
    try{
      await waitFor('owned pre-exec barrier',()=>existsSync(ready));
      const state=spawnTest('systemctl',['--user','show',unit,'--property=ActiveState,SubState,ExecMainPID'],{env:f.s.env,encoding:'utf8'});
      assert.equal(state.status,0,state.stderr);assert.match(state.stdout,/^ActiveState=activating$/m);
      assert.match(state.stdout,/^SubState=start-pre$/m);assert.match(state.stdout,/^ExecMainPID=0$/m);
      assert.throws(()=>assertNoUnitUsers([tree],[unit]),error=>error instanceof Error&&error.message.includes('unit '+unit+' owns ExecStart path '+executable));
      assert.ok(existsSync(entry));
    }finally{
      const stop=spawnTest('systemctl',['--user','stop',unit],{env:f.s.env,encoding:'utf8'});assert.equal(stop.status,0,stop.stderr);
      rmSync(ready,{force:true});
    }
  }
});

test('unit paths follow outside aliases and symlink before parent components',t=>{
  const f=fixture(t),tree=f.tree('1'),outside=join(f.s.dir,'outside');mkdirSync(outside);
  mkdirSync(join(tree,'nested'));writeFileSync(join(tree,'entry'),'input');symlinkSync(join(tree,'nested'),join(outside,'jump'));
  const reading:UnitTreeOwnership={unit:'alias.service',workingDirectory:outside,rootDirectory:'',commands:[]};
  assert.throws(()=>assertUnitTreeUnused([tree],{...reading,workingDirectory:join(outside,'jump')}),/owns WorkingDirectory.* -> /);
  assert.throws(()=>assertUnitTreeUnused([tree],{...reading,rootDirectory:join(outside,'jump')}),/owns RootDirectory.* -> /);
  for(const argument of [outside+'/jump/../entry','jump/../entry']){
    assert.throws(()=>assertUnitTreeUnused([tree],{...reading,commands:[{property:'ExecStart',path:process.execPath,args:[argument]}]}),/owns ExecStart argument.* -> /);
  }
  assert.throws(()=>assertUnitTreeUnused([tree],{...reading,commands:[{property:'ExecStart',path:process.execPath,args:[outside+'/jump/not-yet-created']}]}),/owns ExecStart argument.* -> /);
  symlinkSync(f.dir,join(outside,'pool-alias'));
  assert.throws(()=>assertUnitTreeUnused([tree],{...reading,rootDirectory:join(outside,'pool-alias')}),/owns RootDirectory.* -> /);
});
