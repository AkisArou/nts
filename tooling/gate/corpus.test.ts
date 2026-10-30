import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,chmodSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const helper=join(dirname(fileURLToPath(import.meta.url)),'corpus.ts');
function fixture(body:(root:string,suite:string)=>void){
  const cache=process.env.TMPDIR??join(homedir(),'.cache');mkdirSync(cache,{recursive:true});
  const root=mkdtempSync(join(cache,'nts-corpus-gate-'));
  const suite=join(root,'suite.cjs');
  writeFileSync(suite,[
    "#!/usr/bin/env node",
    "const fs=require('node:fs');",
    "fs.writeFileSync(process.env.MOCK_TRACE,JSON.stringify(process.argv.slice(2)));",
    "if(process.env.MOCK_STOP)fs.writeFileSync(process.argv[process.argv.indexOf('--rows')+1],JSON.stringify({examined:{outcome:process.env.MOCK_WRONG?{Failed:'known failure'}:'Lowered',uncompilable:false,unverifiable:false,incomplete:[{kind:process.env.MOCK_STOP,reason:'verifier incomplete',case_index:null}]}})+'\\n');",
    "if(process.env.MOCK_EXIT==='1'){console.log('suite failed deliberately');process.exit(1)}",
    "console.log((process.env.MOCK_CASES??'1')+' single-file cases');",
    "console.log('  frontend failed '+(process.env.MOCK_FRONTEND_FAILURES??'0'));",
    "console.log('  invalid HIR 0');",
    "console.log('  compiler crashed '+(process.env.MOCK_CRASHES??'0'));",
    "console.log('  uncompilable C 0');",
    "console.log('  unverifiable class 0');",
  ].join(String.fromCharCode(10)));chmodSync(suite,0o755);
  try{body(root,suite)}finally{rmSync(root,{recursive:true,force:true})}
}
function run(root:string,suite:string,mode:string,extra:Record<string,string>={}){
  return spawnSync(process.execPath,[helper,root,mode],{encoding:'utf8',env:{...process.env,NTS_SUITE_BIN:suite,MOCK_TRACE:join(root,'trace'),...extra}});
}

test('the gate selects the stable population and a private report',()=>fixture((root,suite)=>{
  for(const mode of ['core']){
    const result=run(root,suite,mode);assert.equal(result.status,0,result.stderr+result.stdout);
    const args=JSON.parse(readFileSync(join(root,'trace'),'utf8'));
    assert.deepEqual(args,['--root',root,'--rows',join(root,'target','suite-rows.jsonl')]);
    assert.match(readFileSync(join(root,'target','suite-report.txt'),'utf8'),/invalid HIR 0/);
  }
}));
test('frontend failures cannot pass because HIR remains zero',()=>fixture((root,suite)=>{
  for(const mode of ['core']){
    const result=run(root,suite,mode,{MOCK_FRONTEND_FAILURES:'1'});assert.equal(result.status,1);assert.match(result.stdout,/frontend failures must be zero/);
  }
}));
test('an aborted suite fails explicitly in either mode',()=>fixture((root,suite)=>{
  for(const mode of ['core']){
    const result=run(root,suite,mode,{MOCK_EXIT:'1'});assert.equal(result.status,1);assert.match(result.stdout,/suite failed deliberately/);assert.match(result.stdout,/TypeScript corpus did not finish/);
  }
}));

test('an empty population is unmeasured in either mode',()=>fixture((root,suite)=>{
  for(const mode of ['core']){
    const result=run(root,suite,mode,{MOCK_CASES:'0'});assert.equal(result.status,1);assert.match(result.stdout,/measured no cases/);
  }
}));

test('a completed population with a compiler crash fails',()=>fixture((root,suite)=>{
  const result=run(root,suite,'core',{MOCK_CRASHES:'1'});
  assert.equal(result.status,1);assert.match(result.stdout,/compiler crashes must be zero/);
}));

test('the full survey is not a landing or wide-step selector',()=>fixture((root,suite)=>{
  const result=run(root,suite,'full');assert.equal(result.status,2);
}));

test('a verifier stop holds unless a completed corpus failure already exists',()=>fixture((root,suite)=>{
  const resultPath=join(root,'step.json');
  for(const kind of ['hung','runaway']) {
    const env={MOCK_STOP:kind,NTS_GATE_STEP:'corpus',NTS_GATE_STEP_ATTEMPT:'verifier-control',NTS_GATE_STEP_RESULT:resultPath};
    const held=run(root,suite,'core',env);assert.equal(held.status,124,held.stdout+held.stderr);
    assert.equal(JSON.parse(readFileSync(resultPath,'utf8')).verdict,'NOT RUN');
    const failed=run(root,suite,'core',{...env,MOCK_WRONG:'1'});assert.equal(failed.status,1,failed.stdout+failed.stderr);
    const frame=JSON.parse(readFileSync(resultPath,'utf8'));assert.equal(frame.kind,kind);assert.equal(frame.verdict,'FAIL');assert.equal(frame.completedFailures,1);
  }
}));
