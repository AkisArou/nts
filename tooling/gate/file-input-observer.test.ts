import assert from 'node:assert/strict';
import {spawn,spawnSync,type StdioOptions} from 'node:child_process';
import {readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {gzipSync,gunzipSync,constants} from 'node:zlib';
import {byteFactText,fileObserverArguments,prepareFileObserver,readFileObservation,readObservationRow,type InputAttempt,type ObservationRow} from './file-input-observer.ts';
import {publishInputTrace,readInputTraceIndex,type InputIndexObservation,type InputIndexProbe} from './rust-test-inputs.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {newTestScratch} from './test-scratch.ts';
import {spawnTest,waitFor} from './test-wait.ts';

const source=fileURLToPath(new URL('./file-input-observer.c',import.meta.url));
const subject=String.raw`
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/stat.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>
static void *thread_exit(void *unused){(void)unused;syscall(SYS_exit,0);return NULL;}
int main(int argc,char **argv){
  if(argc<2)return 90;
  if(!strcmp(argv[1],"facts")){
    if(chdir(argv[2]))return 91;
    int dir=open(".",O_RDONLY|O_DIRECTORY);if(dir<0)return 92;
    int value=openat(dir,"value",O_RDONLY);if(value<0)return 93;
    char b[32];ssize_t n=read(value,b,sizeof(b));if(n<0)return 94;
    if(write(1,b,(size_t)n)!=n)return 95;
    if(openat(dir,"missing",O_RDONLY)!=-1||errno!=ENOENT)return 96;
    if(openat(-2,"invalid-fd",O_RDONLY)!=-1||errno!=EBADF)return 97;
    struct statx st;
    if(syscall(SYS_statx,value,NULL,AT_EMPTY_PATH,STATX_BASIC_STATS,&st))return 113;
    int socket_fd=socket(AF_UNIX,SOCK_STREAM,0);if(socket_fd<0)return 114;
    if(openat(socket_fd,"socket-relative",O_RDONLY)!=-1||errno!=ENOTDIR)return 115;
    close(socket_fd);
    if(mkdirat(dir,"other",0700))return 119;
    int other=openat(dir,"other",O_RDONLY|O_DIRECTORY);if(other<0)return 120;
    if(syscall(SYS_renameat2,dir,"value",other,"renamed",0))return 121;
    if(syscall(SYS_renameat2,other,"renamed",dir,"value",0))return 122;
    close(other);
    char entries[4096];if(syscall(SYS_getdents64,dir,entries,sizeof(entries))<0)return 98;
    close(value);close(dir);if(write(2,"err",3)!=3)return 104;return 7;
  }
  if(!strcmp(argv[1],"streams")){
    char b[8];if(read(0,b,3)!=3||memcmp(b,"abc",3))return 99;
    if(read(3,b,3)!=3||memcmp(b,"def",3))return 100;
    sigset_t mask;if(sigprocmask(SIG_SETMASK,NULL,&mask))return 101;
    if(sigismember(&mask,SIGTERM)||sigismember(&mask,SIGCHLD))return 102;
    if(write(1,"1234567890",10)!=10)return 103;
    return 0;
  }
  if(!strcmp(argv[1],"descendant")){
    pid_t child=fork();if(child<0)return 105;if(child)return 0;
    if(write(3,"ready",5)!=5)_exit(106);
    char b;if(read(4,&b,1)!=1)_exit(107);
    int fd=open(argv[2],O_RDONLY);if(fd<0)_exit(108);close(fd);_exit(0);
  }
  if(!strcmp(argv[1],"leak")){
    volatile void *p=malloc(91);if(!p)return 109;memset((void *)p,1,91);
    if(argc>2)free((void *)p);return 0;
  }
  if(!strcmp(argv[1],"cancel-exit")){
    pthread_t worker;if(pthread_create(&worker,NULL,thread_exit,NULL))return 116;
    char release;if(read(5,&release,1)!=1)return 117;
    kill(getpid(),SIGKILL);return 118;
  }
  return 110;
}
`;

test('the native observer retains actual images, attempted inputs and original product streams',async t=>{
  const root=newTestScratch('file-input-observer');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const env=fixtureEnvironment(t),binary=prepareFileObserver(root,env),program=join(root,'subject'),input=join(root,'subject.c');
  writeFileSync(input,subject);
  const build=spawnTest('cc',['-O1','-std=c11','-Wall','-Wextra','-Werror','-Wno-misleading-indentation',input,'-pthread','-o',program],{env,encoding:'utf8'});
  assert.equal(build.status,0,build.stderr);
  writeFileSync(join(root,'value'),'product');
  const record=join(root,'facts.jsonl'),result=spawnTest(binary,fileObserverArguments(record,program,['facts',root]),{env,encoding:'utf8'});
  assert.equal(result.status,7,result.stderr);assert.equal(result.stdout,'product');
  const rows:ObservationRow[]=[],end=await readFileObservation(record,row=>{rows.push(row);});
  assert.equal(end.exit,7);assert.equal(end.entered,true);assert.equal(end.execErrno,0);
  const attempts=rows.filter((row):row is InputAttempt=>row.kind==='attempt');
  const missing=attempts.find(row=>row.paths.some(path=>byteFactText(path.value,'path')==='missing'));
  assert.ok(missing);assert.equal(missing.outcome,'unknown');assert.equal(byteFactText(missing.image,'actual image'),program);
  assert.equal(byteFactText(missing.cwd,'cwd'),root);assert.ok(missing.birth!=='0');
  assert.equal(byteFactText(missing.dirfds[0]!.target,'directory'),root);
  assert.ok(attempts.some(row=>row.operation==='directory'&&byteFactText(row.dirfds[0]!.target,'directory')===root));
  assert.ok(attempts.some(row=>row.dirfds.some(fd=>fd.fd===-2&&fd.target.error!==0)&&row.factsComplete));
  assert.ok(attempts.some(row=>row.syscall==='statx'&&row.paths.some(path=>path.value.null)&&row.dirfds.some(fd=>byteFactText(fd.target,'AT_EMPTY_PATH target')===join(root,'value'))));
  assert.ok(attempts.some(row=>row.paths.some(path=>!path.value.null&&byteFactText(path.value,'relative socket path')==='socket-relative')&&row.dirfds.some(fd=>byteFactText(fd.target,'socket dirfd').startsWith('socket:['))));
  const renamed=attempts.find(row=>row.syscall==='renameat2'&&row.paths.length===2&&byteFactText(row.paths[0]!.value,'first path')==='value');
  assert.ok(renamed);assert.equal(byteFactText(renamed.paths[1]!.value,'second path'),'renamed');
  assert.deepEqual(renamed.dirfds.map(fd=>byteFactText(fd.target,'independent directory')),[root,join(root,'other')]);
  const exec=attempts.find(row=>row.operation==='execute');assert.ok(exec);
  assert.notEqual(byteFactText(exec.image,'pre-exec image'),program,'an exec attempt does not claim the requested program entered');
  const published=join(root,'facts.index.jsonl.gz');
  await publishInputTrace({raw:record,output:published,cwd:root,root,target:{package:'fixture',name:'syscalls',kind:['test'],source:'fixture.rs'}});
  const decoded:{observations:InputIndexObservation[];descriptorProbes:InputIndexProbe[]}={observations:[],descriptorProbes:[]};
  await readInputTraceIndex(published,row=>{if(row.kind==='observation')decoded.observations.push(row);if(row.kind==='probe')decoded.descriptorProbes.push(row);});
  assert.ok(decoded.observations.some(row=>row.syscall==='statx'&&row.operation==='descriptor'&&row.path===join(root,'value')&&row.outcome==='unknown'));
  assert.ok(decoded.descriptorProbes.some(row=>row.probeKind==='non-file-dirfd'));
  assert.ok(decoded.observations.every(row=>!row.path.includes('socket:[')&&!row.path.endsWith('/socket-relative')));

  const descriptor=join(root,'descriptor');writeFileSync(descriptor,'def');
  const {openSync,closeSync}=await import('node:fs');
  const products=[];
  for(const observed of [false,true]){
    const fd=openSync(descriptor,'r');
    try{
      const record=join(root,'exact-buffer.jsonl');
      const result=spawnSync(observed?binary:program,observed?fileObserverArguments(record,program,['streams']):['streams'],
        {env,encoding:'utf8',input:'abc',stdio:['pipe','pipe','pipe',fd],maxBuffer:10});
      assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
      assert.equal(result.stdout,'1234567890');assert.equal(result.stderr,'');
      products.push({stdout:result.stdout,stderr:result.stderr,status:result.status,signal:result.signal});
      if(observed)await readFileObservation(record,()=>{});
    }finally{closeSync(fd);}
  }
  assert.deepEqual(products[1],products[0]);

  const absent=spawnTest(binary,fileObserverArguments(join(root,'absent.jsonl'),join(root,'absent'),[]),{env,encoding:'utf8'});
  assert.equal(absent.status,2);assert.match(absent.stderr,/exec errno 2/);
  const noEntry=await readFileObservation(join(root,'absent.jsonl'),()=>{});assert.equal(noEntry.entered,false);assert.equal(noEntry.execErrno,2);
  const exited=spawnTest(binary,fileObserverArguments(join(root,'exit127.jsonl'),'sh',['-c','exit 127']),{env,encoding:'utf8'});
  assert.equal(exited.status,127,exited.stderr);assert.equal((await readFileObservation(join(root,'exit127.jsonl'),()=>{})).entered,true);

  for(const signal of [undefined,'SIGINT','SIGTERM','SIGHUP'] as const){
    const record=join(root,'drain-'+String(signal)+'.jsonl');
    const child=spawn(binary,fileObserverArguments(record,program,['descendant',join(root,'value')]),{env,stdio:['ignore','pipe','pipe','pipe','pipe']});
    let ready='',stderr='',closed=false;child.stdout!.resume();child.stderr!.on('data',part=>stderr+=part);
    const readyPipe=child.stdio[3],releasePipe=child.stdio[4];assert.ok(readyPipe&&'on' in readyPipe&&releasePipe&&'write' in releasePipe);
    readyPipe.on('data',part=>ready+=part);
    const done=new Promise<{status:number|null;signal:NodeJS.Signals|null}>(resolve=>child.on('close',(status,signal)=>{closed=true;resolve({status,signal});}));
    try{
      await waitFor('descendant readiness after root work',()=>ready==='ready',{stopped:()=>closed?stderr||'observer exited':undefined});
      await waitFor('root exit before descendant release',()=>gunzipSync(readFileSync(record+'.pending.'+child.pid),{finishFlush:constants.Z_SYNC_FLUSH}).toString('utf8').includes('"kind":"root-exit"'),{stopped:()=>closed?'observer exited before drain':undefined});
      assert.equal(closed,false,'root exit is not terminal completion while a filter descendant lives');
      assert.equal((await import('node:fs')).existsSync(record),false,'the final artifact waits for compression close');
      if(signal){child.kill(signal);await waitFor('observer signal during drain',()=>gunzipSync(readFileSync(record+'.pending.'+child.pid),{finishFlush:constants.Z_SYNC_FLUSH}).toString('utf8').includes('\"kind\":\"signal\"'));}
      releasePipe.end('x');
      const result=await done;assert.deepEqual(result,signal?{status:null,signal}:{status:0,signal:null},stderr);
      const terminal=await readFileObservation(record,()=>{});assert.equal(terminal.drainComplete,true);assert.equal(terminal.exit,0);
      assert.equal(terminal.observerSignal,signal?{SIGINT:2,SIGTERM:15,SIGHUP:1}[signal]:0);
    }finally{releasePipe.end();if(!closed)await done;}
  }

  // The private staged child pauses before it can publish its listener. A
  // signal in that interval must preserve its authority through failed setup.
  const startupSource=join(root,'startup.c'),startupBinary=join(root,'startup');
  const original=readFileSync(source,'utf8'),paused=original.replace('int listener = install_filter();',
    'if(write(3,"ready",5)!=5){_exit(111);}\n    char release;\n    if(read(4,&release,1)!=1){_exit(112);}\n    int listener = install_filter();');
  assert.notEqual(paused,original);writeFileSync(startupSource,paused);
  const startupBuild=spawnTest('cc',['-O1','-std=c11','-Wall','-Wextra','-Werror',startupSource,'-lz','-o',startupBinary],{env,encoding:'utf8'});
  assert.equal(startupBuild.status,0,startupBuild.stderr);
  const startupRecord=join(root,'startup.jsonl'),starting=spawn(startupBinary,fileObserverArguments(startupRecord,program,['streams']),{env,stdio:['ignore','pipe','pipe','pipe','pipe']});
  let startupReady='',startupClosed=false;starting.stdout!.resume();starting.stderr!.resume();
  const startReady=starting.stdio[3],startRelease=starting.stdio[4];assert.ok(startReady&&'on' in startReady&&startRelease&&'end' in startRelease);
  startReady.on('data',part=>startupReady+=part);
  const startupDone=new Promise<NodeJS.Signals|null>(resolve=>starting.on('close',(_status,signal)=>{startupClosed=true;resolve(signal);}));
  try{
    await waitFor('listener startup barrier',()=>startupReady==='ready',{stopped:()=>startupClosed?'observer closed before its barrier':undefined});
    starting.kill('SIGTERM');assert.equal(await startupDone,'SIGTERM');
    const final=gunzipSync(readFileSync(startupRecord)).toString('utf8').trim().split('\n').map(line=>JSON.parse(line)).at(-1);
    assert.equal(final.observerSignal,15);assert.equal(final.drainComplete,true);assert.equal(final.complete,false);
  }finally{startRelease.end();if(!startupClosed)await startupDone;}

  const failedCloseSource=join(root,'failed-close.c'),failedCloseBinary=join(root,'failed-close');
  const failedClose=original.replace('if (gzclose((gzFile)cookie) == Z_OK)',
    'if (gzclose((gzFile)cookie) == Z_OK && 0)');
  assert.notEqual(failedClose,original);writeFileSync(failedCloseSource,failedClose);
  const closeBuild=spawnTest('cc',['-O1','-std=c11','-Wall','-Wextra','-Werror',failedCloseSource,'-lz','-o',failedCloseBinary],{env,encoding:'utf8'});
  assert.equal(closeBuild.status,0,closeBuild.stderr);
  const failedRecord=join(root,'failed-close.gz');
  const closeResult=spawnTest(failedCloseBinary,fileObserverArguments(failedRecord,'sh',['-c','exit 0']),{env,encoding:'utf8'});
  assert.equal(closeResult.status,2,closeResult.stderr);assert.match(closeResult.stderr,/compressed artifact close failed/);
  await assert.rejects(readFileObservation(failedRecord,()=>{}),/ENOENT/,'a failed compression close cannot publish completion');

  for(const before of [true,false]){
    const queuedSource=join(root,'queued-'+before+'.c'),queuedBinary=join(root,'queued-'+before);
    const barrier=String.raw`if(request->data.nr==SYS_exit){
      flush_output();if(write(3,"exit-notified",13)!=13)fatal("exit barrier ready");
      char release;if(read(4,&release,1)!=1)fatal("exit barrier release");
      int exited=(int)syscall(SYS_pidfd_open,root,0);if(exited<0)fatal("controlled root pidfd");
      struct pollfd ready={.fd=exited,.events=POLLIN};
      int result;do{result=poll(&ready,1,-1);}while(result<0&&errno==EINTR);
      if(result!=1||!(ready.revents&POLLIN)){fatal("controlled root exit readiness");}
      close(exited);
    }
    attempt_json(listener, request);`;
    let staged=original.replace('attempt_json(listener, request);',barrier);assert.notEqual(staged,original);
    if(before){const current=staged;staged=staged.replace('if (!complete && !canceled_lifetime)','if (!complete)');assert.notEqual(staged,current);}
    writeFileSync(queuedSource,staged);
    const built=spawnTest('cc',['-O1','-std=c11','-Wall','-Wextra','-Werror',...(before?['-Wno-unused-variable']:[]),queuedSource,'-lz','-o',queuedBinary],{env,encoding:'utf8'});
    assert.equal(built.status,0,built.stderr);
    const record=join(root,'queued-'+before+'.gz');
    const channels:StdioOptions=['ignore','pipe','pipe','pipe','pipe','pipe'];
    const child=spawn(queuedBinary,fileObserverArguments(record,program,['cancel-exit']),{env,stdio:channels});
    let ready='',closed=false,error='';child.stdout!.resume();child.stderr!.on('data',part=>error+=part);
    const notify=child.stdio[3],resume=child.stdio[4],stop=child.stdio.at(5);
    assert.ok(notify&&'on' in notify&&resume&&'end' in resume&&stop&&'end' in stop);
    notify.on('data',part=>ready+=part);
    const done=new Promise<{status:number|null;signal:NodeJS.Signals|null}>(resolve=>child.on('close',(status,signal)=>{closed=true;resolve({status,signal});}));
    try{
      await waitFor('queued thread exit notification',()=>ready==='exit-notified',{stopped:()=>closed?error||'observer exited':undefined});
      stop.end('x');resume.end('x');
      assert.deepEqual(await done,before?{status:2,signal:null}:{status:null,signal:'SIGKILL'},error);
      if(before)await assert.rejects(readFileObservation(record,()=>{}),/incomplete census/);
      else{
        const canceled:InputAttempt[]=[];
        const complete=await readFileObservation(record,row=>{if(row.kind==='attempt'&&row.canceled)canceled.push(row);});
        assert.equal(complete.errors,0);assert.equal(canceled.length,1);
        assert.equal(canceled[0]!.factsComplete,false);assert.equal(canceled[0]!.syscall,'exit');
        assert.deepEqual(canceled[0]!.paths,[]);assert.deepEqual(canceled[0]!.dirfds,[]);
      }
    }finally{stop.end();resume.end();if(!closed)await done;}
  }

  const sanitized=join(root,'sanitized');
  const sanitizer=spawnTest('clang',['-O0','-fsanitize=address',input,'-pthread','-o',sanitized],{env,encoding:'utf8'});assert.equal(sanitizer.status,0,sanitizer.stderr);
  for(const clean of [true,false]){
    const args=clean?['leak','free']:['leak'];
    const off=spawnTest(sanitized,args,{env,encoding:'utf8'});
    const on=spawnTest(binary,fileObserverArguments(join(root,'sanitizer-'+clean+'.jsonl'),sanitized,args),{env,encoding:'utf8'});
    assert.equal(on.status,off.status,on.stderr);assert.equal(off.status,clean?0:1,off.stderr);
    if(!clean){assert.match(off.stderr,/91 byte\(s\) leaked/);assert.match(on.stderr,/91 byte\(s\) leaked/);}
    await readFileObservation(join(root,'sanitizer-'+clean+'.jsonl'),()=>{});
  }
});

test('native fact views retain independent bytes and initialize only metadata, including exact bounds and errors',t=>{
  const root=newTestScratch('file-input-view-storage');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const env=fixtureEnvironment(t),input=join(root,'view.c'),program=join(root,'view');
  writeFileSync(join(root,'small'),'abc');writeFileSync(join(root,'exact'),'1234');writeFileSync(join(root,'over'),'12345');
  writeFileSync(join(root,'argv'),Buffer.alloc(65536,0x7f));
  writeFileSync(input,`#define main observer_main\n#include ${JSON.stringify(source)}\n#undef main\n#include <assert.h>
int main(int argc,char **argv){
  assert(argc==2);assert(chdir(argv[1])==0);
  unsigned char first[4],exact[4],over[4],missing[4],large[ARGV_BYTES],remote[PATH_BYTES],null_data[PATH_BYTES];
  memset(first,0xa5,sizeof(first));memset(exact,0xa5,sizeof(exact));memset(over,0xa5,sizeof(over));
  memset(missing,0xa5,sizeof(missing));memset(large,0xa5,sizeof(large));
  memset(remote,0xa5,sizeof(remote));memset(null_data,0xa5,sizeof(null_data));
  Bytes a=read_file("small",first,sizeof(first)),b=read_file("exact",exact,sizeof(exact)),
    c=read_file("over",over,sizeof(over)),d=read_file("missing",missing,sizeof(missing)),
    e=read_file("argv",large,sizeof(large)),f=remote_path(getpid(),(uintptr_t)"path",remote),
    g=remote_path(getpid(),0,null_data);
  // remote_path reads one 256-byte chunk before finding its terminator.
  assert(first[3]==0xa5&&missing[0]==0xa5&&remote[256]==0xa5&&null_data[0]==0xa5);
  memset(remote+f.size,0xa5,sizeof(remote)-f.size);
  output=stdout;Bytes *facts[]={&a,&b,&c,&d,&e,&f,&g};fputc('[',output);
  for(unsigned i=0;i<sizeof(facts)/sizeof(facts[0]);i++){if(i)fputc(',',output);bytes_json(facts[i]);}
  puts("]");return 0;
}\n`);
  const built=spawnTest('cc',['-O2','-std=c11','-Wall','-Wextra','-Werror',input,'-lz','-o',program],{env,encoding:'utf8'});
  assert.equal(built.status,0,built.stderr);
  const result=spawnTest(program,[root],{env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const fact=(value:string|Buffer,error=0,truncated=false,nullValue=false)=>({hex:Buffer.from(value).toString('hex'),error,truncated,null:nullValue});
  assert.deepEqual(JSON.parse(result.stdout),[fact('abc'),fact('1234'),fact('1234',0,true),fact('',2),
    fact(Buffer.alloc(65536,0x7f)),fact('path'),fact('',0,false,true)]);
});

test('the native wedged-phase decision uses supplied elapsed observations',t=>{
  const root=newTestScratch('file-observer-bound');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const input=join(root,'bound.c'),binary=join(root,'bound');
  writeFileSync(input,'#define main observer_main\n#include '+JSON.stringify(source)+'\n#undef main\n#include <assert.h>\nint main(void){assert(phase_timeout_ms(false,UINT64_MAX)==-1);assert(phase_timeout_ms(true,0)==300000);assert(phase_timeout_ms(true,WEDGED_NS-1)==1);assert(phase_timeout_ms(true,WEDGED_NS)==0);assert(phase_timeout_ms(true,UINT64_MAX)==0);return 0;}\n');
  const env=fixtureEnvironment(t),compiled=spawnTest('cc',['-O1','-std=c11','-Wall','-Wextra','-Werror',input,'-lz','-o',binary],{env,encoding:'utf8'});
  assert.equal(compiled.status,0,compiled.stderr);assert.equal(spawnTest(binary,[],{env,encoding:'utf8'}).status,0);
});

test('malformed and incomplete raw observations cannot publish a complete census',async t=>{
  const root=newTestScratch('file-observer-records');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const start={kind:'start',version:2,mechanism:'seccomp-user-notification',noNewPrivileges:true};
  const end={kind:'complete',complete:true,root:1,entered:true,execErrno:0,exit:0,signal:0,attempts:0,errors:0,drainComplete:true,observerSignal:0};
  for(const [index,rows] of [[start],[start,{...end,complete:false}],[start,{...end,errors:1}],[start,{...end,drainComplete:false}],[start,{...end,attempts:1}],[start,end,end],[{},end]].entries()){
    const file=join(root,index+'.jsonl');writeFileSync(file,gzipSync(rows.map(row=>JSON.stringify(row)).join('\n')+'\n'));
    await assert.rejects(readFileObservation(file,()=>{}),/file input observer/);
  }
  assert.throws(()=>readObservationRow({...end,attempts:'0'}),/malformed/);
  assert.throws(()=>byteFactText({hex:'ff',error:0,truncated:false,null:false},'raw path'),/not UTF-8/);
  for(const fact of [{hex:'',error:14,truncated:false,null:false},{hex:'61',error:0,truncated:true,null:false},{hex:'',error:0,truncated:false,null:true}])assert.throws(()=>byteFactText(fact,'raw path'),/unreadable, null or truncated/);
  const valid=Buffer.from([start,{kind:'root-start',root:1},{kind:'root-exit',root:1,exit:0,signal:0},end].map(row=>JSON.stringify(row)).join('\n')+'\n');
  const compressed=gzipSync(valid);
  const truncated=join(root,'truncated.gz');writeFileSync(truncated,compressed.subarray(0,compressed.length-1));
  await assert.rejects(readFileObservation(truncated,()=>{}),/unexpected end|buffer error/i);
  const corrupt=join(root,'corrupt.gz'),corrupted=Buffer.from(compressed);corrupted[corrupted.length-8]=corrupted[corrupted.length-8]!^1;writeFileSync(corrupt,corrupted);
  await assert.rejects(readFileObservation(corrupt,()=>{}),/incorrect data check/i);
  const oversized=join(root,'oversized.gz');writeFileSync(oversized,gzipSync('x'.repeat(256*1024+1)+'\n'));
  await assert.rejects(readFileObservation(oversized,()=>{}),/exceeds bounded row size/);
  const large=join(root,'many-rows.gz'),descriptor={kind:'inherited',fd:1,flags:1,target:{hex:'706970653a5b315d',error:0,truncated:false,null:false}};
  const many=[start,...Array.from({length:5000},()=>descriptor),{kind:'root-start',root:1},{kind:'root-exit',root:1,exit:0,signal:0},end].map(row=>JSON.stringify(row)).join('\n')+'\n';
  assert.ok(Buffer.byteLength(many)>256*1024);writeFileSync(large,gzipSync(many));
  assert.equal((await readFileObservation(large,()=>{})).complete,true,'the limit is per decoded row, not total stream size');
});
