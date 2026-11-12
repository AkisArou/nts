import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {testEnvironment} from "../gate/test-environment.ts";
// A real library test's oracle preparation inside the tests step runs in the
// run's reservation, whatever the host reads: it neither waits nor refuses for
// host memory, and needs no held token to say so.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {cpSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hostEnvironment,gateEnvironment,sealOracleRun} from '../gate/canonical-environment.ts';
import {removable} from '../gate/run-temporary.ts';
import {newTestScratch} from '../gate/test-scratch.ts';
import {ownMemory} from '../gate/test-memory.ts';
import {spawnTest} from '../gate/test-wait.ts';
import {oracleWorkspaceFixture} from './oracle-workspace-fixture.ts';

const SOURCE=fileURLToPath(new URL('../..',import.meta.url));
const [serialized,previousHelper]=process.argv.slice(2);
assert.ok(serialized,"the exact library test argv is required");
const library=JSON.parse(serialized) as string[];
assert.ok(Array.isArray(library)&&library.every(arg=>typeof arg==="string"));
const own=newTestScratch('oracle-reservation'),tree=join(own,'tree'),run=join(own,'run'),home=join(own,'home');
const cleanup:(()=>void)[]=[];
const unit='nts-oracle-reservation-'+randomUUID()+'.scope';
try{
  mkdirSync(tree);cpSync(join(SOURCE,'tooling'),join(tree,'tooling'),{recursive:true});
  copyModuleClosure(['tooling/gate/run.mjs'],tree);
  // An archived helper is used only by the retained before control. The real
  // library binary authenticates its own implementation bytes in either arm.
  if(previousHelper)writeFileSync(join(tree,'tooling/differential/oracle-execution.ts'),readFileSync(previousHelper));
  oracleWorkspaceFixture({after:fn=>cleanup.push(fn)},tree);
  mkdirSync(home);writeFileSync(join(tree,'.tool-versions'),`nodejs ${process.versions.node}\n`);
  // The run reserves against an ample reading and a ledger of its own. Its
  // tests step reads a machine with no memory at all: a preparation that asked
  // for any would be refused at once.
  const memory=ownMemory(join(own,'memory')),low=ownMemory(join(own,'pressure'),{availableKiB:0,totalKiB:2**20}).NTS_HOST_OBSERVATIONS;
  const fake=join(own,'nts');writeFileSync(fake,'#!/bin/sh\nexit 0\n',{mode:0o755});
  const names=execFileSync('sh',[join(SOURCE,'tooling/gate/all.sh'),'--list'],{env:testEnvironment(),encoding:'utf8'}).trim();
  const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
  writeFileSync(join(tree,'tooling/gate/all.sh'),`#!/bin/sh
set -eu
if [ "$1" = --list ]; then
cat <<'NTS_STEPS'
${names}
NTS_STEPS
elif [ "$2" = tests ]; then
  export NTS_HOST_OBSERVATIONS=${quote(low)}
  # No held token either: the reservation is the step's, not the token's.
  unset NTS_GATE_TOKEN_HELD
  exec ${library.map(quote).join(" ")}
else exit 1
fi
`);
  const base={...hostEnvironment(process.env),HOME:home};
  const planned=await sealOracleRun(gateEnvironment(base,{run,standalone:true,oracleRoot:tree,owned:{NTS_GATE_RUN_DIR:run,NTS_GATE_STEPS:'tests',...memory,NTS_BIN:fake,NTS_SUITE_BIN:fake,NTS_CHECKERS:'1'}}));
  const result=spawnTest('systemd-run',['--user','--scope','--unit='+unit,'--collect','--quiet','prlimit','--core=0',process.execPath,join(tree,'tooling/gate/run.mjs')],{cwd:tree,env:planned.env,encoding:'utf8',maxBuffer:16*2**20},'tests step whose oracle preparation runs in its reservation');
  assert.ok(existsSync(join(run,'summary.json')),result.stdout+result.stderr);
  const summary=JSON.parse(readFileSync(join(run,'summary.json'),'utf8'));
  const step=summary.steps.find((step:{name:string})=>step.name==='tests');
  assert.ok(step,result.stdout+result.stderr);
  const log=readFileSync(join(run,'tests.log'),'utf8');
  console.log(JSON.stringify({status:result.status,step:step.verdict}));
  process.stdout.write(log);
  assert.equal(step.verdict,'PASS',log);assert.equal(step.exit,0,log);
  assert.match(log,/unavailable_bindings_do_not_compare_unexecuted_module_output .*ok/);
  assert.match(log,/test result: ok\. 1 passed/);
  assert.doesNotMatch(log,/memory: .*(waits for|can never fit)/,'the preparation asked the ledger for nothing');
}finally{
  spawnSync('systemctl',['--user','stop',unit],{env:testEnvironment(),stdio:'ignore'});
  for(const fn of cleanup.reverse())fn();
  removable(own);rmSync(own,{recursive:true,force:true});
}
