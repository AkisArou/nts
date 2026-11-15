import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn,spawnSync,type StdioOptions} from 'node:child_process';
import {mkdirSync,readFileSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {gzipSync,gunzipSync,constants} from 'node:zlib';
import {byteFactText,fileObserverArguments,prepareFileObserver,readFileObservation,readObservationRow,type InputAttempt,type ObservationRow} from './file-input-observer.ts';
import {publishInputTrace,readInputTraceIndex,classifyInputOpen,type InputIndexObservation,type InputIndexProbe,type InputIndexExecRequest,type InputIndexExecution} from './rust-test-inputs.ts';
import {authenticateRustInputTrace} from './rust-input-authentication.ts';
import {runtimeSubjectValidator,validateRustInputCapture} from './rust-input-validation.ts';
import {runtimeInputRequirement} from './rust-input-operations.ts';
import {runtimeProvenanceClassifier} from './rust-input-provenance.ts';
import {prepareObserverImageReader,observerImageSession} from './file-input-observer-session.ts';
import {rustTestExecutionClassifier} from './rust-test-execution.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {newTestScratch} from './test-scratch.ts';
import {spawnTest,waitFor} from './test-wait.ts';
import {IMAGE_READER_COMPILER_DEFINITION} from './image-reader-protocol.ts';

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
/* A main-local pointer can remain a conservative shutdown root. Retire this
 * frame and clear its volatile slot before LeakSanitizer scans the caller. */
__attribute__((noinline)) static int sanitizer_allocation(int release){
  void *volatile p=malloc(91);if(!p)return 109;memset(p,1,91);
  if(release)free(p);p=NULL;return 0;
}
int main(int argc,char **argv){
  if(argc<2)return 90;
  if(!strcmp(argv[1],"exec-args")){
    if(chdir(argv[2]))return 124;
    char *missing[]={"missing request","not entered",NULL};
    execve("/missing-observer-exec-control",missing,NULL);
    if(errno!=ENOENT)return 121;
    syscall(SYS_execve,"/missing-observer-exec-control",(char **)1,NULL);
    syscall(SYS_execveat,AT_FDCWD,"missing-execveat-control",missing,NULL,0);
    char *next[]={argv[3],"%s","space and empty","",NULL};
    execv(argv[3],next);return 122;
  }
  if(!strcmp(argv[1],"anchors")){
    if(chdir(argv[2]))return 124;
    int fd=open("logical/jump/../target",O_RDONLY);if(fd<0)return 125;
    char b[8];ssize_t n=read(fd,b,sizeof(b));close(fd);
    if(n!=8||memcmp(b,"physical",8)||write(1,b,8)!=8)return 126;
    if(chdir("physical"))return 127;
    fd=open("target",O_RDONLY);if(fd<0)return 128;
    n=read(fd,b,sizeof(b));close(fd);
    if(n!=8||memcmp(b,"physical",8)||write(1,b,8)!=8)return 129;
    return 0;
  }
  if(!strcmp(argv[1],"facts")){
    if(chdir(argv[2]))return 91;
    int dir=open(".",O_RDONLY|O_DIRECTORY);if(dir<0)return 92;
    int value=openat(dir,"value",O_RDONLY);if(value<0)return 93;
    int path_only=openat(dir,"value",O_PATH|O_NOFOLLOW);if(path_only<0)return 123;
    close(path_only);
    int temporary=openat(dir,".",O_TMPFILE|O_RDWR,0600);if(temporary>=0)close(temporary);
    char b[32];ssize_t n=read(value,b,sizeof(b));if(n<0)return 94;
    if(write(1,b,(size_t)n)!=n)return 95;
    if(openat(dir,"missing",O_RDONLY)!=-1||errno!=ENOENT)return 96;
    if(openat(-2,"invalid-fd",O_RDONLY)!=-1||errno!=EBADF)return 97;
    struct statx st;
    if(syscall(SYS_statx,value,NULL,AT_EMPTY_PATH,STATX_BASIC_STATS,&st))return 113;
    if(syscall(SYS_statx,value,"",AT_EMPTY_PATH,STATX_BASIC_STATS,&st))return 134;
    struct stat descriptor_stat;
    if(syscall(SYS_newfstatat,value,"",&descriptor_stat,AT_EMPTY_PATH))return 135;
    if(syscall(SYS_newfstatat,value,"",&descriptor_stat,0)!=-1||errno!=ENOENT)return 136;
    if(syscall(SYS_statx,dir,"value",AT_EMPTY_PATH,STATX_BASIC_STATS,&st))return 137;
    if(syscall(SYS_faccessat2,value,"",R_OK,AT_EMPTY_PATH))return 138;
    int socket_fd=socket(AF_UNIX,SOCK_STREAM,0);if(socket_fd<0)return 114;
    if(openat(socket_fd,"socket-relative",O_RDONLY)!=-1||errno!=ENOTDIR)return 115;
    close(socket_fd);
    if(mkdirat(dir,"other",0700))return 119;
    int other=openat(dir,"other",O_RDONLY|O_DIRECTORY);if(other<0)return 120;
    if(syscall(SYS_renameat2,dir,"value",other,"renamed",0))return 121;
    if(syscall(SYS_renameat2,other,"renamed",dir,"value",0))return 122;
    close(other);
    if(symlinkat("missing",dir,"symbolic"))return 130;
    char link_text[16];ssize_t link_size=readlinkat(dir,"symbolic",link_text,sizeof(link_text));
    if(link_size!=7||memcmp(link_text,"missing",7))return 131;
    int symbolic_fd=openat(dir,"symbolic",O_PATH|O_NOFOLLOW);if(symbolic_fd<0)return 139;
    link_size=readlinkat(symbolic_fd,"",link_text,sizeof(link_text));close(symbolic_fd);
    if(link_size!=7||memcmp(link_text,"missing",7))return 140;
    if(linkat(dir,"value",dir,"hard",0))return 132;
    if(unlinkat(dir,"hard",0)||unlinkat(dir,"symbolic",0))return 133;
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
    return sanitizer_allocation(argc>2);
  }
  if(!strcmp(argv[1],"cancel-exit")){
    pthread_t worker;if(pthread_create(&worker,NULL,thread_exit,NULL))return 116;
    char release;if(read(5,&release,1)!=1)return 117;
    kill(getpid(),SIGKILL);return 118;
  }
  return 110;
}
`;

test('pathname components are captured at the stopped attempt and survive later alias replacement',async t=>{
  const root=newTestScratch('file-input-resolution');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const env=fixtureEnvironment(t),prepared=prepareFileObserver(root,env),program=join(root,'subject'),input=join(root,'subject.c');
  const repository=join(root,'source'),outside=join(root,'host');mkdirSync(repository);mkdirSync(outside);
  const first=join(outside,'first'),second=join(outside,'second'),alias=join(repository,'alias');
  writeFileSync(first,'first');writeFileSync(second,'second');symlinkSync(first,alias);
  writeFileSync(input,`#define _GNU_SOURCE
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
int main(int argc,char **argv) {
  (void)argc; int fd=open(argv[1],O_RDONLY);if(fd<0)return 1;close(fd);
  if(unlink(argv[1])||symlink(argv[2],argv[1]))return 2;
  fd=open(argv[1],O_RDONLY);if(fd<0)return 3;close(fd);
  struct stat info; (void)stat(argv[3],&info);(void)stat(argv[4],&info);
  (void)fstatat(AT_FDCWD,argv[1],&info,AT_SYMLINK_NOFOLLOW);return 0;
}\n`);
  const built=spawnTest('cc',['-O1',input,'-o',program],{env,encoding:'utf8'});assert.equal(built.status,0,built.stderr);
  const raw=join(root,'raw.gz'),index=join(root,'index.gz'),missing=join(root,'missing/child'),blocked=first+'/child';
  const ran=spawnTest(prepared.executable,fileObserverArguments(raw,program,[alias,second,missing,blocked]),{env,encoding:'utf8'});
  assert.equal(ran.status,0,ran.stderr);
  const captured=await readFileObservation(raw,()=>{});assert.ok(captured.terminal.resolutionWalks!>0);assert.ok(captured.terminal.resolutionStats!>captured.terminal.resolutionWalks!);
  await publishInputTrace({raw,output:index,cwd:root,root:repository,observer:prepared.receipt,target:{package:'fixture',name:'resolution',kind:['test'],source:'fixture.rs'}});
  const rows:InputIndexObservation[]=[];await readInputTraceIndex(index,row=>{if(row.kind==='observation')rows.push(row);});
  const opens=rows.filter(row=>row.operation==='open').flatMap(row=>row.subjects).filter(value=>value.kind==='path'&&value.name===alias);
  assert.equal(opens.length,2);
  assert.equal(opens[0]!.kind==='path'&&opens[0]!.resolution?.state==='resolved'&&opens[0]!.resolution.path,first);
  assert.equal(opens[1]!.kind==='path'&&opens[1]!.resolution?.state==='resolved'&&opens[1]!.resolution.path,second);
  for(const value of opens){
    assert.ok(value.kind==='path'&&value.resolution&&value.resolution.state!=='unavailable'&&value.resolution.components.some(part=>part.path===alias&&part.kind==='symlink'));}
  const find=(name:string)=>rows.flatMap(row=>row.subjects).find(value=>value.kind==='path'&&value.name===name);
  const absent=find(missing),file=find(blocked);assert.equal(absent?.kind==='path'&&absent.resolution?.state,'missing');assert.equal(file?.kind==='path'&&file.resolution?.state,'not-directory');
  assert.equal(absent?.kind==='path'&&absent.resolution?.state!=='unavailable'&&absent.resolution?.finalComponent,false,'missing intermediate is not an exact endpoint');
  const magicRaw=join(root,'magic.raw.gz'),magicRan=spawnTest(prepared.executable,fileObserverArguments(magicRaw,prepared.executable,['--self-image-probe']),{env,encoding:'utf8'});
  assert.equal(magicRan.status,0,magicRan.stderr);const magic:InputAttempt[]=[];
  await readFileObservation(magicRaw,row=>{if(row.kind==='attempt'&&row.syscall==='readlink')magic.push(row);});
  assert.equal(magic.length,1);assert.equal(magic[0]!.paths[0]!.resolution?.state,'unavailable','procfs magic links cannot certify the observer identity');
  rmSync(outside,{recursive:true});
  assert.equal(opens[0]!.kind==='path'&&opens[0]!.resolution?.state==='resolved'&&opens[0]!.resolution.path,first,'no analysis-time filesystem lookup');
});

test('procfs task anchors retain their namespace and root fence while magic links stay unavailable',async t=>{
  const root=newTestScratch('file-input-procfs');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const env=fixtureEnvironment(t),prepared=prepareFileObserver(root,env);
  const raw=join(root,'raw.gz'),index=join(root,'index.gz'),ran=spawnTest(prepared.executable,fileObserverArguments(raw,prepared.executable,['--task-anchor-probe']),{env,encoding:'utf8'});
  assert.equal(ran.status,0,ran.stderr);
  await publishInputTrace({raw,output:index,cwd:root,root,observer:prepared.receipt,target:{package:'fixture',name:'procfs',kind:['test'],source:'fixture.rs'}});
  const rows:InputIndexObservation[]=[];await readInputTraceIndex(index,row=>{if(row.kind==='observation')rows.push(row);});
  const provenance=runtimeProvenanceClassifier({sourceRoot:root,buildNamespace:join(root,'target'),artifacts:[],outputDirectories:[],roots:[]});
  for(const name of ['limits','comm']){
    const row=rows.find(row=>row.subjects.some(part=>part.kind==='path'&&part.name.endsWith('/'+name)));assert.ok(row);
    const part=row.subjects.find(part=>part.kind==='path'&&part.name.endsWith('/'+name));assert.ok(part?.kind==='path'&&part.resolution?.state==='resolved');
    const proof=part.resolution,anchor=proof.components.find(part=>part.taskAnchor);assert.ok(anchor?.taskAnchor);
    assert.equal(anchor.filesystem,'procfs');assert.equal(anchor.link,undefined);assert.equal(anchor.taskAnchor.tid,row.attempt.tid);assert.equal(anchor.taskAnchor.tgid,row.attempt.tgid);
    assert.deepEqual(anchor.taskAnchor.taskPidNamespace,anchor.taskAnchor.observerPidNamespace);
    assert.equal(proof.components.at(-1)?.kind,'file');assert.equal(proof.components.at(-1)?.filesystem,'procfs');assert.equal(proof.finalComponent,true);
    assert.equal(provenance.classify(part,{kind:'content',following:'follow'})?.kind,'host-environment');
    if(name==='comm')assert.notEqual(row.attempt.tid,row.attempt.tgid);
  }
  const magic=rows.flatMap(row=>row.subjects).find(part=>part.kind==='path'&&part.name.endsWith('/exe'));
  assert.equal(magic?.kind==='path'&&magic.resolution?.state,'unavailable');
  assert.ok(magic);assert.equal(provenance.classify(magic,{kind:'readlink',following:'no-follow'}),undefined);
});

test('native procfs anchor identity rejects a different PID namespace or proc root',t=>{
  const root=newTestScratch('procfs-anchor-predicate');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const input=join(root,'predicate.c'),binary=join(root,'predicate'),env=fixtureEnvironment(t);
  writeFileSync(input,'#define main observer_main\n#include '+JSON.stringify(source)+'\n#undef main\n#include <assert.h>\n'+
    'int main(void){struct stat pid={.st_dev=1,.st_ino=2},root={.st_dev=3,.st_ino=4},changed=pid;'+
    'assert(proc_anchor_identity(&pid,&pid,&root,&root));changed.st_ino++;assert(!proc_anchor_identity(&changed,&pid,&root,&root));'+
    'changed=pid;changed.st_dev++;assert(!proc_anchor_identity(&changed,&pid,&root,&root));changed=root;changed.st_ino++;'+
    'assert(!proc_anchor_identity(&pid,&pid,&changed,&root));changed=root;changed.st_dev++;assert(!proc_anchor_identity(&pid,&pid,&changed,&root));return 0;}\n');
  const built=spawnTest('cc',[IMAGE_READER_COMPILER_DEFINITION,'-O1','-std=c11','-Wall','-Wextra','-Werror',input,'-lz','-o',binary],{env,encoding:'utf8'});
  assert.equal(built.status,0,built.stderr);assert.equal(spawnTest(binary,[],{env,encoding:'utf8'}).status,0);
});

test('child loader receipts frame concurrent large exec vectors and reuse content-keyed ELF and loader facts',async t=>{
  const root=newTestScratch('child-loader-capture');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const env=fixtureEnvironment(t),observer=prepareFileObserver(root,env),prepared=prepareObserverImageReader(),program=join(root,'subject'),input=join(root,'subject.c');
  const first=join(root,'lib-a'),second=join(root,'lib-b');mkdirSync(first);mkdirSync(second);
  const repository=join(root,'source');mkdirSync(repository);
  writeFileSync(input,`#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>
int main(int argc,char **argv){(void)argc;char large[49153];memset(large,'x',sizeof(large)-1);large[sizeof(large)-1]=0;if(setenv("NTS_LONG_CAPTURE_CONTROL",large,1))return 5;pid_t children[3];
for(int i=0;i<3;i++){pid_t p=fork();if(p<0)return 1;if(!p){if(setenv("LD_LIBRARY_PATH",argv[i==1?2:1],1))_exit(2);execl(argv[3],argv[3],"child%.0s",large,(char *)0);_exit(3);}children[i]=p;}
for(int i=0;i<3;i++){int status;if(waitpid(children[i],&status,0)!=children[i]||!WIFEXITED(status)||WEXITSTATUS(status))return 4;}return 0;}\n`);
  const built=spawnTest('cc',['-O1',input,'-o',program],{env,encoding:'utf8'});assert.equal(built.status,0,built.stderr);
  const raw=join(root,'raw.gz'),index=join(root,'index.gz'),target=realpathSync('/usr/bin/printf');
  const session=observerImageSession(prepared,observer.receipt,join(root,'reader.log'),env);
  let ran;
  try{ran=spawnTest(observer.executable,session.arguments(raw,program,[first,second,target]),{env,encoding:'utf8',stdio:['ignore','pipe','pipe',session.input,session.output]});}
  finally{await session.finish();}
  assert.equal(ran.status,0,ran.stderr);assert.equal(ran.stdout,'childchildchild');
  await publishInputTrace({raw,output:index,cwd:root,root:repository,observer:session.receipt,target:{package:'fixture',name:'loaders',kind:['test'],source:'fixture.rs'}});
  const images=new Map<number,InputIndexExecution>(),rows:InputIndexObservation[]=[],requests:InputIndexExecRequest[]=[];let statistics:unknown;
  await readInputTraceIndex(index,row=>{if(row.kind==='execution')images.set(row.id,row);if(row.kind==='observation')rows.push(row);if(row.kind==='exec-request')requests.push(row);if(row.kind==='image-reader-end')statistics=row.value.statistics;});
  const captured=[...images.values()].filter(image=>image.path===target&&image.imageLoader?.capture.state==='captured');
  assert.equal(captured.length,3,JSON.stringify([...images.values()].filter(image=>image.path===target).map(image=>image.imageLoader)));
  assert.deepEqual(captured.map(image=>image.imageLoader?.capture.state==='captured'?image.imageLoader.capture.loader.libraryPath:null).sort(),[first,first,second].sort());
  for(const image of captured){
    const bound=image.argvSource;assert.equal(bound?.kind,'request');if(bound?.kind!=='request')throw Error('missing request binding');
    const request=requests.find(row=>row.attempt===bound.attempt);assert.ok(request?.entry.environment);
    assert.ok(byteFactText(request.entry.argv,'large captured argv').length>48*1024);
    assert.ok(byteFactText(request.entry.environment,'large captured environment').length>48*1024);
  }
  const counts=statistics as {elfHits:number;loaderHits:number;loaderMisses:number};assert.ok(counts.elfHits>=2);assert.ok(counts.loaderHits>=1);assert.ok(counts.loaderMisses>=2);
  const classifier=rustTestExecutionClassifier(undefined,repository),sourceClassifier=rustTestExecutionClassifier(undefined,root),validator=runtimeSubjectValidator(repository,{files:[],ownedFiles:[],moduleFiles:[],hostFiles:[],placingFiles:[],stagingFiles:[],directories:[],optionalFiles:[],memberships:[],observations:[]},{capturedIdentities:true});
  let probes=0,sourceProbes=0;
  for(const row of rows){const image=images.get(row.image)!;classifier.observe(row,image);sourceClassifier.observe(row,image);for(const part of row.subjects){
    if(image.path!==target||part.kind!=='path'||!part.name.startsWith(first+'/'))continue;
    const assessment=validator.assess(row,part,session.receipt);
    if(classifier.classify(row,image,assessment)?.kind==='loader-probe'){probes++;assert.equal(sourceClassifier.classify(row,image,assessment),undefined);sourceProbes++;}
  }}
  assert.ok(probes>0,'child library probes use their own finite loader receipt');
  assert.equal(sourceProbes,probes,'a source directory on the loader path remains an absence obligation');
  const records=gunzipSync(readFileSync(index)).toString().trim().split('\n').map(line=>JSON.parse(line) as {kind:string;imageLoader?:{capture:{state:string;request?:string}}});
  const forged=records.find(row=>row.kind==='execution'&&row.imageLoader?.capture.state==='captured');assert.ok(forged?.imageLoader);forged.imageLoader.capture.request='0';
  const bad=join(root,'forged.gz');writeFileSync(bad,gzipSync(records.map(row=>JSON.stringify(row)).join('\n')+'\n'));
  await assert.rejects(readInputTraceIndex(bad,()=>{}),/no bound exec request/);
});

test('exec requests retain syscall argv and cwd without inventing successful or readable invocations',async t=>{
  const root=newTestScratch('file-input-exec-argv');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const env=fixtureEnvironment(t),prepared=prepareFileObserver(root,env),program=join(root,'subject'),input=join(root,'subject.c');
  writeFileSync(input,subject);
  const built=spawnTest('cc',['-O1','-std=c11','-Wall','-Wextra','-Werror','-Wno-misleading-indentation',input,'-pthread','-o',program],{env,encoding:'utf8'});
  assert.equal(built.status,0,built.stderr);
  const target=realpathSync('/usr/bin/printf'),raw=join(root,'exec.raw.gz');
  const ran=spawnTest(prepared.executable,fileObserverArguments(raw,program,['exec-args',root,target]),{env,encoding:'utf8'});
  assert.equal(ran.status,0,ran.stderr);assert.equal(ran.stdout,'space and empty');
  const attempts:InputAttempt[]=[];await readFileObservation(raw,row=>{if(row.kind==='attempt')attempts.push(row);});
  assert.ok(attempts.filter(row=>row.syscall==='execve'||row.syscall==='execveat').every(row=>row.exec?.source==='syscall-entry'));
  const path=join(root,'exec.index.gz');await publishInputTrace({raw,output:path,cwd:root,root,observer:prepared.receipt,target:{package:'fixture',name:'exec',kind:['test'],source:'fixture.rs'}});
  const requests:InputIndexExecRequest[]=[],images:InputIndexExecution[]=[];
  await readInputTraceIndex(path,row=>{if(row.kind==='exec-request')requests.push(row);if(row.kind==='execution')images.push(row);});
  const success=requests.find(row=>!row.entry.target.error&&byteFactText(row.entry.target,'requested target')===target);assert.ok(success);
  assert.equal(success.cwd,root);
  assert.deepEqual(byteFactText(success.entry.argv,'requested argv').split('\0'),[target,'%s','space and empty','','']);
  const entered=images.find(row=>row.path===target&&row.argvSource?.kind==='request');assert.ok(entered);
  assert.deepEqual(entered.argvSource,{kind:'request',attempt:success.attempt,state:'observed'});
  const missing=requests.find(row=>row.entry.target.error===2&&!row.entry.argv.error);assert.ok(missing);
  assert.ok(requests.some(row=>row.syscall==='execveat'&&row.entry.target.error===2));
  const unreadable=requests.find(row=>row.entry.argv.error!==0);assert.ok(unreadable);
  for(const request of [missing,unreadable])assert.ok(!images.some(row=>row.argvSource?.kind==='request'&&row.argvSource.attempt===request.attempt),'failed requests stay unbound');
  assert.ok(images.some(row=>row.argvSource?.kind==='missing'),'initial images have explicit missing argv');
  const rows=gunzipSync(readFileSync(path)).toString('utf8').trim().split('\n').map(line=>JSON.parse(line));
  const forged=rows.find(row=>row.kind==='execution'&&row.id===entered.id);forged.argvSource.attempt=missing.attempt;
  const changed=join(root,'forged.index.gz');writeFileSync(changed,gzipSync(rows.map(row=>JSON.stringify(row)).join('\n')+'\n'));
  await assert.rejects(readInputTraceIndex(changed,()=>{}),/no matching request and actual image transition/);
});

test('the native observer retains actual images, attempted inputs and original product streams',async t=>{
  const root=newTestScratch('file-input-observer');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const env=fixtureEnvironment(t),prepared=prepareFileObserver(root,env),binary=prepared.executable,program=join(root,'subject'),input=join(root,'subject.c');
  writeFileSync(input,subject);
  const build=spawnTest('cc',['-O1','-std=c11','-Wall','-Wextra','-Werror','-Wno-misleading-indentation',input,'-pthread','-o',program],{env,encoding:'utf8'});
  assert.equal(build.status,0,build.stderr);
  writeFileSync(join(root,'value'),'product');
  const record=join(root,'facts.jsonl'),result=spawnTest(binary,fileObserverArguments(record,program,['facts',root]),{env,encoding:'utf8'});
  assert.equal(result.status,7,result.stderr);assert.equal(result.stdout,'product');
  const rows:ObservationRow[]=[],{terminal:end,artifact}=await readFileObservation(record,row=>{rows.push(row);});
  assert.equal(artifact.bytes,readFileSync(record).length);assert.equal(artifact.sha256,createHash('sha256').update(readFileSync(record)).digest('hex'));
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
  await publishInputTrace({raw:record,output:published,cwd:root,root,observer:prepared.receipt,target:{package:'fixture',name:'syscalls',kind:['test'],source:'fixture.rs'}});
  const decoded:{observations:InputIndexObservation[];descriptorProbes:InputIndexProbe[]}={observations:[],descriptorProbes:[]};
  const indexed=await readInputTraceIndex(published,row=>{if(row.kind==='observation')decoded.observations.push(row);if(row.kind==='observation')decoded.descriptorProbes.push(...row.probes);});
  assert.deepEqual(indexed.header.observer,prepared.receipt);
  const descriptorCalls=decoded.observations.filter(row=>['statx','newfstatat','faccessat2','readlinkat'].includes(row.syscall));
  for(const syscall of ['statx','newfstatat','faccessat2','readlinkat']){
    const row=descriptorCalls.find(row=>row.syscall===syscall&&row.subjects.some(subject=>subject.kind==='descriptor'&&subject.pathArgument?.value.null===false));
    assert.ok(row,syscall+' retains its actual empty-string descriptor provenance');
    const subject=row.subjects.find(subject=>subject.kind==='descriptor'&&subject.pathArgument?.value.null===false)!;
    assert.equal(runtimeInputRequirement(row,subject,prepared.receipt).kind,syscall==='readlinkat'?'readlink':'metadata');
  }
  const unflagged=descriptorCalls.find(row=>row.syscall==='newfstatat'&&row.args[3]==='0'&&row.subjects.some(subject=>subject.kind==='path'&&subject.name===''));
  assert.ok(unflagged,'unflagged empty path remains a pathname rather than inventing descriptor authority');
  assert.equal(runtimeInputRequirement(unflagged,unflagged.subjects[0]!,prepared.receipt).kind,'unknown');
  assert.ok(descriptorCalls.some(row=>row.syscall==='statx'&&row.args[2]==='1000'&&row.subjects.some(subject=>subject.kind==='path'&&subject.name==='value')),
    'a nonempty pathname remains an independent path even when AT_EMPTY_PATH is set');
  assert.deepEqual(indexed.complete.raw,{path:record,...artifact});
  const authenticated=await authenticateRustInputTrace({raw:record,index:published,cwd:root,root,observer:prepared.receipt,
    target:{package:'fixture',name:'syscalls',kind:['test'],source:'fixture.rs'}});
  assert.deepEqual(authenticated.header,indexed.header);
  const validation=await validateRustInputCapture({capture:{raw:record,index:published,cwd:root,root,observer:prepared.receipt,
    target:{package:'fixture',name:'syscalls',kind:['test'],source:'fixture.rs'}},output:join(root,'validation.gz'),targets:new Map([['fixture.rs',{
      target:{source:'fixture.rs',name:'syscalls',kind:['test'],unitTests:true,doctests:false},
      snapshot:{files:['subject','subject.c'],ownedFiles:['subject','subject.c'],moduleFiles:[],hostFiles:[],placingFiles:[],stagingFiles:[],directories:[],optionalFiles:[],memberships:[],observations:[]},
    }]])});
  assert.ok(validation.counts.claimed>0,'the actual executed file retains its exact input authority');
  const actualEmpty=descriptorCalls.find(row=>row.syscall==='statx'&&row.subjects.some(subject=>subject.kind==='descriptor'&&subject.pathArgument?.value.null===false))!;
  const actualSubject=actualEmpty.subjects.find(subject=>subject.kind==='descriptor'&&subject.pathArgument?.value.null===false)!;
  const assessed=runtimeSubjectValidator(root,{files:['value'],ownedFiles:['value'],moduleFiles:[],hostFiles:[],placingFiles:[],stagingFiles:[],directories:[],optionalFiles:[],memberships:[],observations:[]})
    .assess(actualEmpty,actualSubject,prepared.receipt);
  assert.equal(assessed.identity?.path,join(root,'value'),'empty-path stat names the regular file, without appending a directory separator');
  assert.equal(assessed.state,'claimed','the descriptor metadata keeps its actual canonical input claim');
  assert.equal(validation.coverage,'incomplete','external and deliberately unsupported fixture operations remain named gaps');
  await assert.rejects(authenticateRustInputTrace({raw:record,index:published,cwd:root,root,observer:{...prepared.receipt,sha256:'0'.repeat(64)},
    target:{package:'fixture',name:'syscalls',kind:['test'],source:'fixture.rs'}}),/observer digest changed/);
  const opens=decoded.observations.filter(row=>row.operation==='open').map(row=>classifyInputOpen(row,indexed.header.observer));
  if(prepared.receipt.abi==='linux-x86_64-v1'){
    assert.ok(opens.some(row=>row.kind==='path'));assert.ok(opens.some(row=>row.kind==='directory'));assert.ok(opens.some(row=>row.kind==='write'&&row.reason==='temporary inode requested'));
    const requirements=decoded.observations.flatMap(row=>row.subjects.map(subject=>({syscall:row.syscall,arg:subject.arg,requirement:runtimeInputRequirement(row,subject,indexed.header.observer)})));
    assert.ok(requirements.some(row=>row.syscall==='statx'&&row.requirement.kind==='metadata'&&row.requirement.following==='descriptor'));
    assert.ok(requirements.some(row=>row.syscall==='getdents64'&&row.requirement.kind==='enumeration'));
    assert.ok(requirements.some(row=>row.syscall==='symlinkat'&&row.arg===0&&row.requirement.kind==='literal'&&row.requirement.text==='missing'));
    assert.ok(requirements.some(row=>row.syscall==='symlinkat'&&row.arg===2&&row.requirement.kind==='mutation'&&row.requirement.role==='link-destination'));
    assert.ok(requirements.some(row=>row.syscall==='readlinkat'&&row.requirement.kind==='readlink'));
    assert.ok(requirements.some(row=>row.syscall==='linkat'&&row.arg===1&&row.requirement.kind==='hard-link-source'));
    assert.ok(requirements.some(row=>row.syscall==='linkat'&&row.arg===3&&row.requirement.kind==='mutation'&&row.requirement.role==='link-destination'));
  }else assert.ok(opens.every(row=>row.kind==='unknown'));
  await assert.rejects(publishInputTrace({raw:record,output:join(root,'wrong-observer.gz'),cwd:root,root,observer:{...prepared.receipt,sha256:'0'.repeat(64)}}),/observer digest changed/);
  await assert.rejects(publishInputTrace({raw:record,output:join(root,'wrong-image.gz'),cwd:root,root,observer:{...prepared.receipt,observedPath:'/wrong/observer'},target:{package:'fixture',name:'test',kind:['test'],source:'fixture.rs'}}),/root image does not match/);
  assert.ok(decoded.observations.some(row=>row.syscall==='statx'&&row.subjects.some(subject=>subject.kind==='descriptor'&&subject.target===join(root,'value'))&&row.outcome==='unknown'));
  assert.ok(decoded.descriptorProbes.some(row=>row.probeKind==='non-file-dirfd'));
  assert.ok(decoded.observations.every(row=>row.subjects.every(subject=>subject.kind==='descriptor'?!subject.target.includes('socket:['):subject.name!=='socket-relative')));

  mkdirSync(join(root,'logical'));mkdirSync(join(root,'physical/inner'),{recursive:true});
  symlinkSync('../physical/inner',join(root,'logical/jump'));
  writeFileSync(join(root,'physical/target'),'physical');writeFileSync(join(root,'logical/target'),'lexical!');
  const anchoredRaw=join(root,'anchors.raw.gz'),anchoredIndex=join(root,'anchors.index.gz');
  const anchored=spawnTest(binary,fileObserverArguments(anchoredRaw,program,['anchors',root]),{env,encoding:'utf8'});
  assert.equal(anchored.status,0,anchored.stderr);assert.equal(anchored.stdout,'physicalphysical');
  await publishInputTrace({raw:anchoredRaw,output:anchoredIndex,cwd:root,root,observer:prepared.receipt,target:{package:'fixture',name:'anchors',kind:['test'],source:'fixture.rs'}});
  const anchoredRows:InputIndexObservation[]=[];
  await readInputTraceIndex(anchoredIndex,row=>{if(row.kind==='observation')anchoredRows.push(row);});
  assert.ok(anchoredRows.some(row=>row.cwd===root&&row.subjects.some(subject=>subject.kind==='path'&&subject.name==='logical/jump/../target'&&subject.anchor.kind==='cwd'&&subject.anchor.path===root)));
  assert.ok(anchoredRows.some(row=>row.cwd===join(root,'physical')&&row.subjects.some(subject=>subject.kind==='path'&&subject.name==='target'&&subject.anchor.kind==='cwd'&&subject.anchor.path===row.cwd)));

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
  const {terminal:noEntry}=await readFileObservation(join(root,'absent.jsonl'),()=>{});assert.equal(noEntry.entered,false);assert.equal(noEntry.execErrno,2);
  const exited=spawnTest(binary,fileObserverArguments(join(root,'exit127.jsonl'),'sh',['-c','exit 127']),{env,encoding:'utf8'});
  assert.equal(exited.status,127,exited.stderr);assert.equal((await readFileObservation(join(root,'exit127.jsonl'),()=>{})).terminal.entered,true);

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
      const {terminal}=await readFileObservation(record,()=>{});assert.equal(terminal.drainComplete,true);assert.equal(terminal.exit,0);
      assert.equal(terminal.observerSignal,signal?{SIGINT:2,SIGTERM:15,SIGHUP:1}[signal]:0);
    }finally{releasePipe.end();if(!closed)await done;}
  }

  // The private staged child pauses before it can publish its listener. A
  // signal in that interval must preserve its authority through failed setup.
  const startupSource=join(root,'startup.c'),startupBinary=join(root,'startup');
  const original=readFileSync(source,'utf8'),paused=original.replace('int listener = install_filter();',
    'if(write(3,"ready",5)!=5){_exit(111);}\n    char release;\n    if(read(4,&release,1)!=1){_exit(112);}\n    int listener = install_filter();');
  assert.notEqual(paused,original);writeFileSync(startupSource,paused);
  const startupBuild=spawnTest('cc',[IMAGE_READER_COMPILER_DEFINITION,'-O1','-std=c11','-Wall','-Wextra','-Werror',startupSource,'-lz','-o',startupBinary],{env,encoding:'utf8'});
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
  const closeBuild=spawnTest('cc',[IMAGE_READER_COMPILER_DEFINITION,'-O1','-std=c11','-Wall','-Wextra','-Werror',failedCloseSource,'-lz','-o',failedCloseBinary],{env,encoding:'utf8'});
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
    const built=spawnTest('cc',[IMAGE_READER_COMPILER_DEFINITION,'-O1','-std=c11','-Wall','-Wextra','-Werror',...(before?['-Wno-unused-variable']:[]),queuedSource,'-lz','-o',queuedBinary],{env,encoding:'utf8'});
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
        const {terminal:complete}=await readFileObservation(record,row=>{if(row.kind==='attempt'&&row.canceled)canceled.push(row);});
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
  const built=spawnTest('cc',[IMAGE_READER_COMPILER_DEFINITION,'-O2','-std=c11','-Wall','-Wextra','-Werror',input,'-lz','-o',program],{env,encoding:'utf8'});
  assert.equal(built.status,0,built.stderr);
  const result=spawnTest(program,[root],{env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const fact=(value:string|Buffer,error=0,truncated=false,nullValue=false)=>({hex:Buffer.from(value).toString('hex'),error,truncated,null:nullValue});
  assert.deepEqual(JSON.parse(result.stdout),[fact('abc'),fact('1234'),fact('1234',0,true),fact('',2),
    fact(Buffer.alloc(65536,0x7f)),fact('path'),fact('',0,false,true)]);
});

test('the native image response reader refuses short headers and bodies with EPROTO',t=>{
  const root=newTestScratch('file-observer-frame-eof');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const input=join(root,'frame.c'),binary=join(root,'frame'),env=fixtureEnvironment(t);
  writeFileSync(input,'#define main observer_main\n#include '+JSON.stringify(source)+'\n#undef main\n#include <assert.h>\n'+
    'static void frame(const unsigned char *bytes,size_t size,bool valid){int channel[2];assert(pipe(channel)==0);assert(write(channel[1],bytes,size)==(ssize_t)size);assert(close(channel[1])==0);if(channel[0]!=4){assert(dup2(channel[0],4)==4);assert(close(channel[0])==0);}errno=0;const char *reply=image_reader_reply();if(valid){assert(reply&&strcmp(reply,"null")==0);}else{assert(!reply&&errno==EPROTO);}assert(close(4)==0);}\n'+
    'int main(void){const unsigned char header[]={0,0,0},body[]={0,0,0,3,123,125},complete[]={0,0,0,4,110,117,108,108};frame(header,sizeof(header),false);frame(body,sizeof(body),false);frame(complete,sizeof(complete),true);return 0;}\n');
  const built=spawnTest('cc',[IMAGE_READER_COMPILER_DEFINITION,'-O1','-std=c11','-Wall','-Wextra','-Werror',input,'-lz','-o',binary],{env,encoding:'utf8'});
  assert.equal(built.status,0,built.stderr);const ran=spawnTest(binary,[],{env,encoding:'utf8'});assert.equal(ran.status,0,ran.stderr);
});

test('the native wedged-phase decision uses supplied elapsed observations',t=>{
  const root=newTestScratch('file-observer-bound');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const input=join(root,'bound.c'),binary=join(root,'bound');
  writeFileSync(input,'#define main observer_main\n#include '+JSON.stringify(source)+'\n#undef main\n#include <assert.h>\nint main(void){assert(phase_timeout_ms(false,UINT64_MAX)==-1);assert(phase_timeout_ms(true,0)==300000);assert(phase_timeout_ms(true,WEDGED_NS-1)==1);assert(phase_timeout_ms(true,WEDGED_NS)==0);assert(phase_timeout_ms(true,UINT64_MAX)==0);return 0;}\n');
  const env=fixtureEnvironment(t),compiled=spawnTest('cc',[IMAGE_READER_COMPILER_DEFINITION,'-O1','-std=c11','-Wall','-Wextra','-Werror',input,'-lz','-o',binary],{env,encoding:'utf8'});
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
  assert.equal((await readFileObservation(large,()=>{})).terminal.complete,true,'the limit is per decoded row, not total stream size');
});
