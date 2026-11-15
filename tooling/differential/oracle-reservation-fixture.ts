// The tooling producer proof executes from its own staged, committed source.
// Rust tests consume a parent seal and never stage or install dependencies.
import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {fixtureInput,fileInput} from '../gate/reader-inputs/main.ts';
import {testEnvironment} from '../gate/test-environment.ts';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gateEnvironment} from '../gate/canonical-environment.ts';
import {hostEnvironment} from '../gate/host-environment.ts';
import {removable,finishRunTemporary} from '../gate/run-temporary.ts';
import {newTestScratch} from '../gate/test-scratch.ts';
import {ownMemory} from '../gate/test-memory.ts';
import {spawnTest} from '../gate/test-wait.ts';
import {oracleWorkspaceFixture} from './oracle-workspace-fixture.ts';
import {captureDependencies,type DependencyCapability} from './oracle-dependencies.ts';
import {installationCatalogTrust} from '../inputs/dependency-inputs.ts';
import {gitArguments} from '../gate/git-arguments/main.ts';
import {assertSealedOracleRun,dependencySealReady} from './oracle-seal/main.ts';

const GATE_LIST=fileInput(new URL('../gate/all.sh',import.meta.url));
const GATE_RUN=new URL('../gate/run.mjs',import.meta.url);
const source=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const mode=process.argv[2];
if(mode==='--consume'){
  assertSealedOracleRun(process.env);
  const cap=JSON.parse(process.env.NTS_ORACLE_DEPENDENCIES!);
  const ready=dependencySealReady(cap);assert.ok(ready);
  console.log(JSON.stringify({consumed:true,ready}));
}else if(mode==='--owned-producer'){
  const own=process.argv[3];assert.ok(own);
  assert.equal(source,resolve(own,'tree'),'producer fixture source must be its acquired staged tree');
  const run=join(own,'run'),home=join(own,'home');mkdirSync(home);
  const memory=ownMemory(join(own,'memory')),low=ownMemory(join(own,'pressure'),{availableKiB:0,totalKiB:2**20}).NTS_HOST_OBSERVATIONS;
  const base={...hostEnvironment(process.env),HOME:home};
  const accounting=gateEnvironment(base,{run:join(own,'accounting'),standalone:true,oracleRoot:source,owned:{...memory}});
  const cap:DependencyCapability=JSON.parse(accounting.env.NTS_ORACLE_DEPENDENCIES!);
  assert.equal(cap.source,source);assert.equal(process.cwd(),source);
  const ledger=join(cap.directory,'oracle-dependency-calls.jsonl'),counts:number[]=[];
  const count=()=>{counts.push(readFileSync(ledger,'utf8').trim().split('\n').length);};
  let accountingPassed=false;
  try{
    const first=await captureDependencies(cap,undefined,accounting.env);count();
    assert.equal(await captureDependencies(cap,undefined,accounting.env),first);count();
    await assert.rejects(captureDependencies({...cap,helperSha256:'0'.repeat(64)},undefined,accounting.env),/provisioner source mismatch/);count();
    assert.deepEqual(counts,[1,2,2]);
    const acquisitions=readFileSync(ledger,'utf8').trim().split('\n').map(line=>JSON.parse(line) as {mode:string;wallMs:number;sealed?:boolean;helperProcess?:boolean});
    assert.deepEqual(acquisitions.map(row=>row.mode),['cold','hit']);
    const cold=acquisitions[0],image=JSON.parse(readFileSync(first,'utf8'));assert.ok(cold);assert.ok(cold.wallMs>0);assert.ok(image.cost.peakBytes>0);
    console.log(JSON.stringify({producerSource:source,counts,modes:acquisitions.map(row=>row.mode)}));
    accountingPassed=true;
  }finally{finishRunTemporary(accounting.temporary,accounting.env.HOME!,accountingPassed);}
  const fake=join(own,'nts');writeFileSync(fake,'#!/bin/sh\nexit 0\n',{mode:0o755});
  const names=execFileSync('sh',[fileURLToPath(GATE_LIST),'--list'],{env:testEnvironment(),encoding:'utf8'}).trim();
  const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
  writeFileSync(join(source,'tooling/gate/all.sh'),`#!/bin/sh
set -eu
if [ "$1" = --list ]; then
cat <<'NTS_STEPS'
${names}
NTS_STEPS
elif [ "$2" = tests ]; then
  export NTS_HOST_OBSERVATIONS=${quote(low)}
  unset NTS_GATE_TOKEN_HELD
  exec node ${quote(fileURLToPath(import.meta.url))} --consume
else exit 1
fi
`);
  const unit='nts-oracle-reservation-'+randomUUID()+'.scope';
  try{
    // run.mjs owns the cold preparation in its reservation, before this step
    // sees the intentionally empty host. The step consumes that exact seal.
    const planned=gateEnvironment(base,{run,standalone:true,oracleRoot:source,owned:{NTS_GATE_RUN_DIR:run,NTS_GATE_STEPS:'tests',...memory,NTS_BIN:fake,NTS_SUITE_BIN:fake,NTS_CHECKERS:'1'}});
    const result=spawnTest('systemd-run',['--user','--scope','--unit='+unit,'--collect','--quiet','prlimit','--core=0',process.execPath,fileURLToPath(GATE_RUN)],{cwd:source,env:planned.env,encoding:'utf8',maxBuffer:16*2**20},'owned producer preparation before a zero-memory consuming test');
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.equal(result.signal,null,result.stdout+result.stderr);
    const summary=JSON.parse(readFileSync(join(run,'summary.json'),'utf8'));
    const step=summary.steps.find((row:{name:string})=>row.name==='tests');assert.ok(step,result.stdout+result.stderr);
    const log=readFileSync(join(run,'tests.log'),'utf8');
    assert.equal(step.verdict,'PASS',log);assert.equal(step.exit,0,log);
    assert.match(log,/"consumed":true/);assert.doesNotMatch(log,/memory: .*(waits for|can never fit)/);
    const acquisitions=readFileSync(join(run,'oracle-dependency-calls.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line) as {mode:string;wallMs:number;peakBytes:number;sealed?:boolean;helperProcess?:boolean});
    assert.equal(acquisitions.filter(row=>row.mode==='cold').length,1);
    assert.ok(acquisitions.some(row=>row.mode==='hit'&&row.sealed===true&&row.helperProcess===false));
    console.log(JSON.stringify({step:step.verdict,zeroMemoryConsumed:true,producerSource:source,counts}));
  }finally{spawnSync('systemctl',['--user','stop',unit],{env:testEnvironment(),stdio:'ignore'});}
}else{
  assert.equal(mode,undefined,'only the owned producer fixture command is supported');
  const own=newTestScratch('oracle-reservation'),tree=join(own,'tree'),cleanup:(()=>void)[]=[];
  try{
    mkdirSync(tree);
    const common=execFileSync('git',gitArguments(['rev-parse','--path-format=absolute','--git-common-dir']),{cwd:source,env:testEnvironment(),encoding:'utf8'}).trim();
    const trust=installationCatalogTrust(dirname(common),source);assert.ok(trust);
    copyModuleClosure([fixtureInput(new URL('./oracle-reservation-fixture.ts',import.meta.url),{dataNamespaces:{}})],tree,{sourceRoot:source,dependencyCatalog:trust});
    oracleWorkspaceFixture({after:fn=>cleanup.push(fn)},tree,source);
    writeFileSync(join(tree,'.tool-versions'),`nodejs ${process.versions.node}\n`);
    const result=spawnTest(process.execPath,[join(tree,'tooling/differential/oracle-reservation-fixture.ts'),'--owned-producer',own],{cwd:tree,env:testEnvironment(),encoding:'utf8',maxBuffer:16*2**20},'producer fixture executes its installer from staged Git source');
    process.stdout.write(result.stdout);process.stderr.write(result.stderr);assert.equal(result.status,0,result.stdout+result.stderr);
  }finally{for(const close of cleanup.reverse())close();removable(own);rmSync(own,{recursive:true,force:true});}
}
