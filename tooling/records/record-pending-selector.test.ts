// One records run in one real selector repository: a record an earlier family
// writes in the same run is a delta row, never an uncommitted source edit.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {test} from 'node:test';
import {gitArguments} from '../gate/git-arguments/main.ts';
import {fixtureEnvironment} from '../gate/test-environment.ts';
import {testScratch} from '../gate/test-scratch.ts';
import {smallSelectorRepository} from '../gate/selector-repository-fixture.ts';
import {rustSelectorFamily} from '../gate/rust-selector-record-family.ts';
import {RUST_SELECTOR_RECORD} from '../gate/rust-selector-record.ts';
import {checkRustSelectorRecord,recordRustSelector,rustSelectorPending} from '../gate/rust-selector-write.ts';
import {parseDelta} from './delta.ts';
import {createRecorder,type RecordFamily,type Runner} from './recorder-core.ts';

const INPUT='docs/runtime-input.txt',TYPES='results/tooling-types/diagnostics.json',EARLIER='earlier-case';
type Fixture=Parameters<typeof fixtureEnvironment>[0];

/** A committed, current selector record whose declared input then changes in a
 * later commit, so the Rust selector family is pending at HEAD. */
function repository(t:Fixture){
  const repo=join(testScratch(t,'record-pending-selector'),'repo');
  const env={...fixtureEnvironment(t),GIT_AUTHOR_NAME:'t',GIT_AUTHOR_EMAIL:'t@t',GIT_COMMITTER_NAME:'t',GIT_COMMITTER_EMAIL:'t@t'};
  smallSelectorRepository(t,repo,env);
  const git=(...args:string[])=>execFileSync('git',gitArguments(['-c','core.hooksPath=/dev/null',...args]),{cwd:repo,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const put=(path:string,text:string)=>{mkdirSync(dirname(join(repo,path)),{recursive:true});writeFileSync(join(repo,path),text);};
  put(TYPES,'{"version":2,"projects":{}}\n');put(INPUT,'the committed next runtime input\n');
  git('add','--',TYPES,INPUT);git('commit','-qm','a tracked earlier record and a changed declared input');
  return {repo,env,git,put,read:(path:string)=>readFileSync(join(repo,path),'utf8')};
}
/** A family that writes one improvement into a tracked record, as type-checks does. */
function earlier(record:string):RecordFamily{
  return {pending:()=>[{name:EARLIER,record}],files:()=>[record],records:()=>[record],runs:()=>[['earlier']],
    audit:()=>[EARLIER+' (improved)'],rows:()=>null,changes:(kind,file,before,after)=>[{kind,record:file,case:EARLIER,key:EARLIER,before,after}],
    validate:()=>{},merge:(_file,_text,rows)=>rows[0]!.after,sourceDigests:(_root,names)=>new Map(names.map(name=>[name,'earlier sources']))};
}
const failing:RecordFamily={...earlier('unused'),pending:()=>{throw Error('supplied pending failure');}};
function recorder(record:string,first:RecordFamily=earlier(record)){
  return createRecorder({first:{family:first,steps:[],part:'core'},'rust-selector':{family:rustSelectorFamily,steps:['records'],part:'core'}});
}
/** The earlier family writes its improvement; the selector's own command runs
 * as a real process, with the run's ledger on its command line. */
function runner(env:NodeJS.ProcessEnv,record:string,text:string,seen:string[][]):Runner{
  return (args,root)=>{
    seen.push(args);
    if(args[0]==='earlier'){writeFileSync(join(root,record),text);return 0;}
    const result=spawnSync(process.execPath,args,{cwd:root,env,encoding:'utf8'});
    if(result.status!==0)console.error(result.stderr);
    return result.status??1;
  };
}
const delta=(t:Fixture)=>join(testScratch(t,'record-pending-selector-delta'),'delta.json');

test('a records run writes the Rust selector rows after an earlier family records an improvement',t=>{
  const f=repository(t),path=delta(t),lines:string[]=[],seen:string[][]=[];
  assert.equal(rustSelectorPending(f.repo),true,'the committed input change makes the selector pending');
  const before=f.read(RUST_SELECTOR_RECORD);
  assert.equal(recorder(TYPES).recordPending(f.repo,['first','rust-selector'],runner(f.env,TYPES,'{"version":2,"projects":{"improved":{}}}\n',seen),line=>lines.push(line),new Map(),path),0,lines.join('\n'));
  assert.notEqual(f.read(RUST_SELECTOR_RECORD),before,'the selector record was rewritten');
  assert.equal(rustSelectorPending(f.repo),false,'the rewritten record is current; the dirty earlier record is not one of its inputs');
  const selector=seen.find(args=>args[0]!=='earlier')!;
  assert.ok(selector.includes('--run-written')&&selector.some(arg=>arg.endsWith(':'+TYPES)),'the writer receives the run ledger: '+selector.join(' '));
  assert.deepEqual(parseDelta(readFileSync(path,'utf8')).rows.map(row=>row.record),[TYPES,RUST_SELECTOR_RECORD]);
});

test('a declared selector input written earlier in the same run is a delta row, and the selector row stays keyed to HEAD',t=>{
  const f=repository(t),path=delta(t),lines:string[]=[];
  assert.equal(recorder(INPUT).recordPending(f.repo,['first','rust-selector'],runner(f.env,INPUT,'bytes the earlier family recorded\n',[]),line=>lines.push(line),new Map(),path),0,lines.join('\n'));
  assert.deepEqual(parseDelta(readFileSync(path,'utf8')).rows.map(row=>row.record),[INPUT,RUST_SELECTOR_RECORD]);
  // Outside the run's ledger the same bytes are a hand edit of a declared input.
  assert.throws(()=>rustSelectorPending(f.repo),/requires committed source inputs/);
  f.git('checkout','--',INPUT);
  assert.equal(rustSelectorPending(f.repo),false,'the recorded selector row is current for the committed source');
});

test('hand dirt on a declared input refuses, even where the run then also writes that input',t=>{
  const f=repository(t),lines:string[]=[],messages:string[]=[];
  f.put(INPUT,'a hand edit before the run\n');
  assert.throws(()=>rustSelectorPending(f.repo),/requires committed source inputs/);
  assert.throws(()=>checkRustSelectorRecord(f.repo,line=>messages.push(line)),/requires committed source inputs/);
  assert.throws(()=>recordRustSelector(f.repo),/requires committed source inputs/);
  const before=f.read(RUST_SELECTOR_RECORD);
  assert.equal(recorder(INPUT).recordPending(f.repo,['first','rust-selector'],runner(f.env,INPUT,'bytes the earlier family recorded\n',[]),line=>lines.push(line)),1);
  assert.ok(lines.some(line=>line.includes('rust-selector: REFUSED')&&line.includes('requires committed source inputs')),lines.join('\n'));
  assert.equal(f.read(RUST_SELECTOR_RECORD),before,'no selector record was written');
  f.git('checkout','--',INPUT);
  // An unrelated hand edit is outside the key; a staged rename of an input is not.
  f.put(TYPES,'{"version":2,"projects":{"hand":{}}}\n');assert.equal(rustSelectorPending(f.repo),true);
  f.git('mv',INPUT,'docs/moved-input.txt');assert.throws(()=>rustSelectorPending(f.repo),/requires committed source inputs/);
  assert.equal(messages.length,0);
});

test('a family whose pending question fails is its own problem; the others still record',t=>{
  const root=testScratch(t,'record-pending-contained'),path=delta(t),lines:string[]=[];
  execFileSync('git',gitArguments(['init','-q',root]),{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const {recordPending}=createRecorder({first:{family:failing,steps:[],part:'core'},second:{family:earlier(TYPES),steps:[],part:'core'}});
  mkdirSync(dirname(join(root,TYPES)),{recursive:true});
  assert.equal(recordPending(root,['first','second'],runner({},TYPES,'{"version":2,"projects":{"later":{}}}\n',[]),line=>lines.push(line),new Map(),path),1);
  assert.ok(lines.some(line=>line.includes('first: REFUSED finding its pending cases: supplied pending failure')),lines.join('\n'));
  assert.deepEqual(parseDelta(readFileSync(path,'utf8')).rows.map(row=>row.record),[TYPES]);
});
