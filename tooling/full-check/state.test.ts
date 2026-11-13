import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {fixtureEnvironment} from '../gate/test-environment.ts';
import {testScratch} from '../gate/test-scratch.ts';
import {spawnTest} from '../gate/test-wait.ts';
import {answerTask,emptyState,layout,newTask,readState,retainTaskHistory,writeState} from './state.ts';

const AT='2026-11-13T01:00:00.000Z';

test('legacy task rows migrate once with stable distinct identities and no answers',t=>{
  const root=testScratch(t,'task-migration'),legacy=join(root,'state.json'),file=join(root,'state-v2.json');
  const rows=[{at:AT,line:'- one unhandled report'},{at:AT,line:'- one unhandled report'}];
  const original=JSON.stringify({version:1,core:{},wide:{},culprits:[],probes:[],tasks:rows});
  writeFileSync(legacy,original);
  const migrated=readState(file);
  assert.equal(migrated.version,2);
  assert.deepEqual(migrated.tasks.map(({at,line,answer})=>({at,line,answer})),rows.map(row=>({...row,answer:undefined})));
  assert.notEqual(migrated.tasks[0]!.id,migrated.tasks[1]!.id);
  assert.deepEqual(readState(file).tasks,migrated.tasks);
  assert.equal(existsSync(file),false,'reading a legacy view does not publish a premature migration');
  assert.throws(()=>answerTask(file,migrated.tasks[0]!.id,{issue:592},new Date(AT)),/controller to adopt/);
  writeState(file,migrated);
  assert.equal(readFileSync(legacy,'utf8'),original);
  writeFileSync(legacy,JSON.stringify({version:1,core:{},wide:{},culprits:[],probes:[],tasks:[]}));
  assert.deepEqual(readState(file).tasks,migrated.tasks,'an old-format writer cannot replace v2');
});

test('answers survive a controller publication from before the answer',t=>{
  const file=join(testScratch(t,'task-stale-writer'),'state-v2.json'),state=emptyState();
  state.tasks.push(newTask(AT,'- a report'));
  writeState(file,state);
  const stale=readState(file),id=state.tasks[0]!.id;
  const answered=answerTask(file,id,{issue:746},new Date(AT));
  stale.core.last_green={commit:'c'.repeat(40),run:'/run',verdict:'green',at:AT,failed:[]};
  writeState(file,stale);
  assert.deepEqual(readState(file).tasks[0],answered);
  assert.equal(readState(file).core.last_green?.commit,'c'.repeat(40));
  assert.deepEqual(answerTask(file,id,{issue:746},new Date('2026-11-14T01:00:00.000Z')),answered,'the same acknowledgement is idempotent');
  assert.throws(()=>answerTask(file,id,{reason:'a different answer'},new Date(AT)),/already answered/);
  const forged=readState(file);forged.tasks[0]!.line='- another report';
  assert.throws(()=>writeState(file,forged),/immutable identity/);
});

test('only answered history expires by supplied time, without stale resurrection',t=>{
  const file=join(testScratch(t,'task-retention'),'state-v2.json'),state=emptyState();
  const open=newTask('2020-01-01T00:00:00.000Z','- still owed');
  const old=newTask('2026-01-01T00:00:00.000Z','- handled long ago');old.answer={reason:'accounted for',at:'2026-01-02T00:00:00.000Z'};
  const recent=newTask(AT,'- handled recently');recent.answer={issue:592,at:AT};
  state.tasks=[open,old,recent];writeState(file,state);
  const stale=readState(file);
  retainTaskHistory(state,new Date('2026-11-14T00:00:00.000Z'));writeState(file,state);
  assert.deepEqual(readState(file).tasks.map(task=>task.id),[open.id,recent.id]);
  writeState(file,stale);
  assert.deepEqual(readState(file).tasks.map(task=>task.id),[open.id,recent.id]);
});

test('the answer CLI owns only answers and works beside the controller lifetime lock',t=>{
  const env=fixtureEnvironment(t),where=layout(join(env.HOME!,'.cache')),state=emptyState();
  state.tasks=[newTask(AT,'- first report'),newTask(AT,'- second report')];
  writeState(where.state,state);
  mkdirSync(where.lock);writeFileSync(join(where.lock,'pid'),String(process.pid));
  const call=(args:string[])=>spawnTest(process.execPath,['tooling/full-check/service.ts',...args],{env,encoding:'utf8'});
  let result=call(['--answer',state.tasks[0]!.id,'--issue','592']);
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/issue #592/);
  result=call(['--answer',state.tasks[1]!.id,'--reason','fixed forward by #746']);
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.deepEqual(readState(where.state).tasks.map(task=>task.answer?.issue??task.answer?.reason),[592,'fixed forward by #746']);
  assert.equal(readFileSync(join(where.lock,'pid'),'utf8'),String(process.pid));
  result=call(['--answer','f'.repeat(16),'--issue','592']);
  assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/unknown task/);
});
