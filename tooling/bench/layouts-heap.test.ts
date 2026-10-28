import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {heapReport} from './layouts-heap.ts';

test('heap helper compiles strictly and moves observed main/thread placement',{skip:process.platform!=='linux'||process.arch!=='x64'},()=>{
 const parent=process.env.TMPDIR??join(homedir(),'.cache/nts-tests');mkdirSync(parent,{recursive:true});
 const dir=mkdtempSync(join(parent,'layout-heap-'));
 try {
  const source=resolve(import.meta.dirname,'../../tooling/bench/layouts-heap.c'),library=join(dir,'heap.so');
  let r=spawnSync('clang',['-std=c11','-O2','-Wall','-Wextra','-Werror','-fPIC','-shared',source,'-ldl','-pthread','-o',library],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  const probe=join(dir,'probe.c'),binary=join(dir,'probe');
  writeFileSync(probe,'#include <pthread.h>\n#include <stdint.h>\n#include <stdio.h>\n#include <stdlib.h>\nstatic void *run(void *p){(void)p;void *a=malloc(64);if(!a)return (void*)1;printf("%llu\\n",(unsigned long long)(uintptr_t)a);free(a);return NULL;}\nint main(void){pthread_t t;if(run(NULL)||pthread_create(&t,NULL,run,NULL))return 1;void *p;if(pthread_join(t,&p)||p)return 1;return 0;}\n');
  r=spawnSync('clang',['-std=c11','-O2','-Wall','-Wextra','-Werror',probe,'-pthread','-o',binary],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  const positions:[number[],number[]]=[[],[]];
  for(const seed of [101,307,509,701,907,1103,1301,1511,1709,1907]){
   const report=join(dir,seed+'.jsonl');
   r=spawnSync(binary,[],{encoding:'utf8',env:{...process.env,LD_PRELOAD:library,NTS_LAYOUT_HEAP_SEED:String(seed),NTS_LAYOUT_HEAP_REPORT:report}});
   assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');
   const events=heapReport(report,seed);assert.equal(events.length,2);assert.deepEqual(events.map(e=>e.thread).sort(),[0,1]);
   const actual=r.stdout.trim().split('\n').map(Number);assert.equal(actual.length,2);assert.ok(actual.every(Number.isSafeInteger));
   positions[0].push(actual[0]%262144);positions[1].push(actual[1]%262144);
  }
  assert.ok(new Set(positions[0]).size>=5);assert.ok(new Set(positions[1]).size>=5);
  r=spawnSync(binary,[],{encoding:'utf8',env:{...process.env,LD_PRELOAD:library,NTS_LAYOUT_HEAP_SEED:'0',NTS_LAYOUT_HEAP_REPORT:join(dir,'bad.jsonl')}});
  assert.equal(r.status,125);assert.throws(()=>readFileSync(join(dir,'bad.jsonl')));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
