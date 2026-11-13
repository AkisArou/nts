import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {byteFactText,fileObserverArguments,prepareFileObserver,readFileObservation,readObservationRow,type InputAttempt,type ObservationRow} from './file-input-observer.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {newTestScratch} from './test-scratch.ts';
import {spawnTest,waitFor} from './test-wait.ts';

const source=fileURLToPath(new URL('./file-input-observer.c',import.meta.url));
const subject=String.raw`
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>
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
  return 110;
}
`;

test('the native observer retains actual images, attempted inputs and original product streams',async t=>{
  const root=newTestScratch('file-input-observer');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const env=fixtureEnvironment(t),binary=prepareFileObserver(root,env),program=join(root,'subject'),input=join(root,'subject.c');
  writeFileSync(input,subject);
  const build=spawnTest('cc',['-O1','-std=c11','-Wall','-Wextra','-Werror','-Wno-misleading-indentation',input,'-o',program],{env,encoding:'utf8'});
  assert.equal(build.status,0,build.stderr);
  writeFileSync(join(root,'value'),'product');
  const record=join(root,'facts.jsonl'),result=spawnTest(binary,fileObserverArguments(record,program,['facts',root]),{env,encoding:'utf8'});
  assert.equal(result.status,7,result.stderr);assert.equal(result.stdout,'product');
  const rows:ObservationRow[]=[],end=await readFileObservation(record,row=>rows.push(row));
  assert.equal(end.exit,7);assert.equal(end.entered,true);assert.equal(end.execErrno,0);
  const attempts=rows.filter((row):row is InputAttempt=>row.kind==='attempt');
  const missing=attempts.find(row=>row.paths.some(path=>byteFactText(path.value,'path')==='missing'));
  assert.ok(missing);assert.equal(missing.outcome,'unknown');assert.equal(byteFactText(missing.image,'actual image'),program);
  assert.equal(byteFactText(missing.cwd,'cwd'),root);assert.ok(missing.birth!=='0');
  assert.equal(byteFactText(missing.dirfds[0]!.target,'directory'),root);
  assert.ok(attempts.some(row=>row.operation==='directory'&&byteFactText(row.dirfds[0]!.target,'directory')===root));
  assert.ok(attempts.some(row=>row.dirfds.some(fd=>fd.fd===-2&&fd.target.error!==0)&&row.factsComplete));
  const exec=attempts.find(row=>row.operation==='execute');assert.ok(exec);
  assert.notEqual(byteFactText(exec.image,'pre-exec image'),program,'an exec attempt does not claim the requested program entered');

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
      await waitFor('root exit before descendant release',()=>readFileSync(record,'utf8').includes('"kind":"root-exit"'),{stopped:()=>closed?'observer exited before drain':undefined});
      assert.equal(closed,false,'root exit is not terminal completion while a filter descendant lives');
      if(signal){child.kill(signal);await waitFor('observer signal during drain',()=>readFileSync(record,'utf8').includes('\"kind\":\"signal\"'));}
      releasePipe.end('x');
      const result=await done;assert.deepEqual(result,signal?{status:null,signal}:{status:0,signal:null},stderr);
      const terminal=await readFileObservation(record,()=>{});assert.equal(terminal.drainComplete,true);assert.equal(terminal.exit,0);
      assert.equal(terminal.observerSignal,signal?{SIGINT:2,SIGTERM:15,SIGHUP:1}[signal]:0);
    }finally{releasePipe.end();if(!closed)await done;}
  }

  const sanitized=join(root,'sanitized');
  const sanitizer=spawnTest('clang',['-O0','-fsanitize=address',input,'-o',sanitized],{env,encoding:'utf8'});assert.equal(sanitizer.status,0,sanitizer.stderr);
  for(const clean of [true,false]){
    const args=clean?['leak','free']:['leak'];
    const off=spawnTest(sanitized,args,{env,encoding:'utf8'});
    const on=spawnTest(binary,fileObserverArguments(join(root,'sanitizer-'+clean+'.jsonl'),sanitized,args),{env,encoding:'utf8'});
    assert.equal(on.status,off.status,on.stderr);assert.equal(off.status,clean?0:1,off.stderr);
    if(!clean){assert.match(off.stderr,/91 byte\(s\) leaked/);assert.match(on.stderr,/91 byte\(s\) leaked/);}
    await readFileObservation(join(root,'sanitizer-'+clean+'.jsonl'),()=>{});
  }
});

test('the native wedged-phase decision uses supplied elapsed observations',t=>{
  const root=newTestScratch('file-observer-bound');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const input=join(root,'bound.c'),binary=join(root,'bound');
  writeFileSync(input,'#define main observer_main\n#include '+JSON.stringify(source)+'\n#undef main\n#include <assert.h>\nint main(void){assert(phase_timeout_ms(false,UINT64_MAX)==-1);assert(phase_timeout_ms(true,0)==300000);assert(phase_timeout_ms(true,WEDGED_NS-1)==1);assert(phase_timeout_ms(true,WEDGED_NS)==0);assert(phase_timeout_ms(true,UINT64_MAX)==0);return 0;}\n');
  const env=fixtureEnvironment(t),compiled=spawnTest('cc',['-O1','-std=c11','-Wall','-Wextra','-Werror',input,'-o',binary],{env,encoding:'utf8'});
  assert.equal(compiled.status,0,compiled.stderr);assert.equal(spawnTest(binary,[],{env}).status,0);
});

test('malformed and incomplete raw observations cannot publish a complete census',async t=>{
  const root=newTestScratch('file-observer-records');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const start={kind:'start',version:2,mechanism:'seccomp-user-notification',noNewPrivileges:true};
  const end={kind:'complete',complete:true,root:1,entered:true,execErrno:0,exit:0,signal:0,attempts:0,errors:0,drainComplete:true,observerSignal:0};
  for(const [index,rows] of [[start],[start,{...end,complete:false}],[start,{...end,errors:1}],[start,{...end,drainComplete:false}],[start,{...end,attempts:1}],[start,end,end],[{},end]].entries()){
    const file=join(root,index+'.jsonl');writeFileSync(file,rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
    await assert.rejects(readFileObservation(file,()=>{}),/file input observer/);
  }
  assert.throws(()=>readObservationRow({...end,attempts:'0'}),/malformed/);
  assert.throws(()=>byteFactText({hex:'ff',error:0,truncated:false,null:false},'raw path'),/not UTF-8/);
  for(const fact of [{hex:'',error:14,truncated:false,null:false},{hex:'61',error:0,truncated:true,null:false},{hex:'',error:0,truncated:false,null:true}])assert.throws(()=>byteFactText(fact,'raw path'),/unreadable, null or truncated/);
});
