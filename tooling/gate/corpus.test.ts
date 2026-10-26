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
    assert.deepEqual(args,['--root',root]);
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
