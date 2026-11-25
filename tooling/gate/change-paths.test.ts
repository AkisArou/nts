import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {closeSync,ftruncateSync,mkdirSync,openSync,writeFileSync,writeSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {committedChanges,contentChanges,parseNameStatus,type PathChange} from './change-paths.ts';
import {gitArguments} from './git-arguments/main.ts';
import {infrastructureProbe,type InfrastructureProbe} from './infrastructure-probe.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {testScratch} from './test-scratch.ts';
import {preciseChange} from './precise-changes.ts';
import {gateSteps,owed} from './owed.mjs';

test('blob sizes beyond the safe integer range remain conservatively oversized',()=>{
  const change={path:'large.json',added:false,deleted:false},commands:string[]=[];
  const probe:InfrastructureProbe=request=>{
    const command=request.args[1]!;commands.push(command);
    let stdout:string;
    if(command==='ls-tree')stdout='100644 blob deadbeef\tlarge.json\n';
    else if(command==='cat-file')stdout='9007199254740993\n';
    else return assert.fail('an oversized body must not be read');
    return {pid:1,status:0,signal:null,stdout,stderr:'',output:['',stdout,'']};
  };
  assert.deepEqual(contentChanges('/owned',[change],'before','after',probe),
    [{...change,sameMode:true,contentUninspected:'oversize'}]);
  assert.deepEqual(commands,['ls-tree','ls-tree','cat-file','cat-file']);
});

test('a staged 40 MiB tracked record selects conservatively and retains its records check',t=>{
  const repo=testScratch(t,'change-paths'),env=fixtureEnvironment(t);
  const git=(...args:string[])=>execFileSync('git',gitArguments(args),{cwd:repo,env,encoding:'utf8'}).trim();
  const path='results/benchmarks/runs/large.json',file=join(repo,path);
  mkdirSync(dirname(file),{recursive:true});
  // Sparse bytes exercise Git's real blob/output sizes without a large allocation.
  const fd=openSync(file,'w');
  try{ftruncateSync(fd,40<<20);writeSync(fd,'a',0,'utf8');}finally{closeSync(fd);}
  git('init','-qb','main');git('add','.');git('commit','-qm','large base');
  const base=git('rev-parse','HEAD');
  const changed=openSync(file,'r+');
  try{writeSync(changed,'b',0,'utf8');}finally{closeSync(changed);}
  git('add','.');
  const staged=git('write-tree'),change={path,added:false,deleted:false};
  const shows:string[][]=[];
  const probe:InfrastructureProbe=request=>{
    if(request.args.includes('show'))shows.push([...request.args]);
    return infrastructureProbe({...request,env});
  };
  const expected={...change,sameMode:true,contentUninspected:'oversize'};
  const rows=contentChanges(repo,parseNameStatus(git('diff','--cached','--name-status')),base,staged,probe);
  assert.deepEqual(rows,[expected]);
  assert.deepEqual(contentChanges(repo,[change],base,null,probe),[expected]);
  assert.equal(preciseChange(rows[0]!),null);
  assert.ok(gateSteps(owed(rows)).includes('records'),'the records step owns record immutability');
  git('commit','-qm','large candidate');
  assert.deepEqual(committedChanges(repo,base,'HEAD',probe),[expected]);
  const large=git('rev-parse','HEAD');
  writeFileSync(file,'small body');git('add','.');
  const small=git('write-tree');
  assert.deepEqual(contentChanges(repo,[change],large,small,probe),[expected]);
  assert.deepEqual(contentChanges(repo,[change],small,large,probe),[expected]);
  assert.deepEqual(contentChanges(repo,[change],large,null,probe),[expected]);
  const grow=openSync(file,'r+');
  try{ftruncateSync(grow,40<<20);}finally{closeSync(grow);}
  assert.deepEqual(contentChanges(repo,[change],small,null,probe),[expected]);
  assert.deepEqual(shows,[],'no body is read when either endpoint is oversized');
});

test('content at the inspection bound is read, while one byte over skips both bodies',t=>{
  const limit=8<<20;
  const repo=testScratch(t,'change-paths-bound'),env=fixtureEnvironment(t);
  const git=(...args:string[])=>execFileSync('git',gitArguments(args),{cwd:repo,env,encoding:'utf8'}).trim();
  const path='body.txt',file=join(repo,path),change:PathChange={path,added:false,deleted:false};
  writeFileSync(file,'before');git('init','-qb','main');git('add','.');git('commit','-qm','base');
  const fd=openSync(file,'w');
  try{ftruncateSync(fd,limit);}finally{closeSync(fd);}
  git('add','.');const boundary=git('write-tree');
  const probe:InfrastructureProbe=request=>infrastructureProbe({...request,env});
  for(const endpoint of [boundary,null]){
    const [row]=contentChanges(repo,[change],'HEAD',endpoint,probe);
    assert.equal(row!.before,'before');assert.equal(row!.after!.length,limit);
    assert.equal(row!.contentUninspected,undefined);
  }
  const grow=openSync(file,'r+');
  try{ftruncateSync(grow,limit+1);}finally{closeSync(grow);}
  git('add','.');
  for(const endpoint of [git('write-tree'),null])assert.deepEqual(contentChanges(repo,[change],'HEAD',endpoint,probe),
    [{...change,sameMode:true,contentUninspected:'oversize'}]);
  writeFileSync(file,'after');
  assert.deepEqual(contentChanges(repo,[change],'HEAD',null,probe),[{...change,sameMode:true,before:'before',after:'after'}]);
});
