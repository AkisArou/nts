// A real library test panics on preparation pressure; the owning gate must hold.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {cpSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hostEnvironment,gateEnvironment,sealOracleRun} from '../gate/canonical-environment.ts';
import {removable} from '../gate/run-temporary.ts';
import {newTestScratch} from '../gate/test-scratch.ts';
import {ownMemory} from '../gate/test-memory.ts';
import {spawnTest} from '../gate/test-wait.ts';
import {oracleWorkspaceFixture} from './oracle-workspace-fixture.ts';

const SOURCE=fileURLToPath(new URL('../..',import.meta.url));
const admitted=process.argv.includes('--admitted');
const [library,previousHelper]=process.argv.slice(2).filter(arg=>arg!=='--admitted');
assert.ok(library,'the library test executable is required');
const own=newTestScratch('oracle-pressure'),tree=join(own,'tree'),run=join(own,'run'),home=join(own,'home');
const cleanup:(()=>void)[]=[];
const unit='nts-oracle-pressure-'+randomUUID()+'.scope';
try{
  mkdirSync(tree);cpSync(join(SOURCE,'tooling'),join(tree,'tooling'),{recursive:true});
  // An archived helper is used only by the retained before control. The real
  // library binary authenticates its own implementation bytes in either arm.
  if(previousHelper)writeFileSync(join(tree,'tooling/differential/oracle-execution.ts'),readFileSync(previousHelper));
  oracleWorkspaceFixture({after:fn=>cleanup.push(fn)},tree);
  mkdirSync(home);writeFileSync(join(tree,'.tool-versions'),`nodejs ${process.versions.node}\n`);
  // The run reserves against an ample reading and a ledger of its own; its
  // tests step reads a machine with nothing available.
  const memory=ownMemory(join(own,'memory')),low=ownMemory(join(own,'pressure'),{availableKiB:0}).NTS_MEMINFO;
  const fake=join(own,'nts');writeFileSync(fake,'#!/bin/sh\nexit 0\n',{mode:0o755});
  const names=execFileSync('sh',[join(SOURCE,'tooling/gate/all.sh'),'--list'],{encoding:'utf8'}).trim();
  const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
  writeFileSync(join(tree,'tooling/gate/all.sh'),`#!/bin/sh
set -eu
if [ "$1" = --list ]; then
cat <<'NTS_STEPS'
${names}
NTS_STEPS
elif [ "$2" = tests ]; then
  export NTS_MEMINFO=${quote(low)}
  # Deliberately withhold the step's admission, so this child must still
  # obtain host admission. A genuinely admitted child now uses its grant.
  ${admitted?'# retain the gate step admission':'unset NTS_GATE_TOKEN_HELD'}
  exec ${quote(resolve(library))} --exact source_contracts::tests::${admitted?'unavailable_bindings_do_not_compare_unexecuted_module_output':'a_source_export_alias_uses_the_recorded_abi_binding'} --nocapture
else exit 1
fi
`);
  const base={...hostEnvironment(process.env),HOME:home};
  const planned=await sealOracleRun(gateEnvironment(base,{run,standalone:true,oracleRoot:tree,owned:{NTS_GATE_RUN_DIR:run,NTS_GATE_STEPS:'tests',...memory,NTS_BIN:fake,NTS_SUITE_BIN:fake,NTS_CHECKERS:'1'}}));
  const result=spawnTest('systemd-run',['--user','--scope','--unit='+unit,'--collect','--quiet','prlimit','--core=0',process.execPath,join(tree,'tooling/gate/run.mjs')],{cwd:tree,env:planned.env,encoding:'utf8',maxBuffer:16*2**20},'tests step after oracle preparation pressure');
  assert.ok(existsSync(join(run,'summary.json')),result.stdout+result.stderr);
  const summary=JSON.parse(readFileSync(join(run,'summary.json'),'utf8'));
  const step=summary.steps.find((step:{name:string})=>step.name==='tests');
  assert.ok(step,result.stdout+result.stderr);
  const log=readFileSync(join(run,'tests.log'),'utf8');
  if(admitted){
    assert.equal(step.verdict,'PASS',log);assert.equal(step.exit,0,log);
    assert.match(log,/unavailable_bindings_do_not_compare_unexecuted_module_output .*ok/);
    assert.match(log,/test result: ok\. 1 passed/);
    console.log(JSON.stringify({status:result.status,step:step.verdict,admitted:true}));
  }else{
  assert.match(log,/check stage OraclePressure/,result.stdout+result.stderr);assert.match(log,/oracle preparation awaits host memory admission/);
  assert.match(log,/panicked/);
  console.log(JSON.stringify({status:result.status,step:step.verdict,kind:step.instrument?.kind,reason:step.reason,panicked:/panicked/.test(log)}));
  assert.equal(step.verdict,'INSTRUMENT',log);assert.equal(step.instrument?.kind,'memory-pressure');
  assert.equal(step.exit,101,'the library assertion still fails; only its owning step is held');
  assert.equal(summary.steps.filter((step:{verdict:string})=>step.verdict==='FAIL').length,0);
  }
}finally{
  spawnSync('systemctl',['--user','stop',unit],{stdio:'ignore'});
  for(const fn of cleanup.reverse())fn();
  removable(own);rmSync(own,{recursive:true,force:true});
}
