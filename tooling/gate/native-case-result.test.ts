import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync,copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {parseCases,publishCases} from '../conformance/native-case-result.ts';
import {readStepInstrument} from './step-result.ts';

function scratch(t) {
 const parent=process.env.TMPDIR??join(homedir(),'.cache/nts-tests');
 mkdirSync(parent,{recursive:true});
 const dir=mkdtempSync(join(parent,'native-result-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 return dir;
}

test('forced 124 publishes unavailable, while completed nonzero is an actual failure',t=>{
 const dir=scratch(t);
 for(const code of [0,7,124]) {
  const child=spawnSync(process.execPath,['-e',`process.exit(${code})`]);
  assert.equal(child.status,code);assert.equal(child.signal,null);
  const file=join(dir,`result-${code}.json`),env={NTS_GATE_STEP_RESULT:file,NTS_GATE_STEP:'tests',NTS_GATE_STEP_ATTEMPT:'native-result-control'};
  const result=publishCases(parseCases(`run\tfixture\t${child.status}\n`),env);
  assert.equal(result.verdict,code===0?'PASS':code===124?'UNAVAILABLE':'FAIL');
  assert.equal(result.failures.length,code===7?1:0);
  if(code===124) {
   const typed=readStepInstrument(file,'tests','native-result-control');
   assert.equal(typed?.verdict,'NOT RUN');assert.equal(typed?.kind,'hung');
   assert.match(readFileSync(file,'utf8'),/fixture/);
  } else assert.equal(existsSync(file),false,'a real failure must remain an ordinary FAIL');
 }
 const file=join(dir,'mixed.json');
 const result=publishCases(parseCases('run\thung\t124\nrun\twrong\t9\n'),{NTS_GATE_STEP_RESULT:file,NTS_GATE_STEP:'tests',NTS_GATE_STEP_ATTEMPT:'mixed'});
 assert.equal(result.verdict,'FAIL');assert.equal(result.failures.length,1);assert.equal(result.unavailable.length,1);
 assert.equal(existsSync(file),false,'an unavailable peer must not mask an observed failure');
});

test('empty and malformed records cannot invent a pass',()=>{
 for(const row of ['', 'run\tcase\t\n','run\tcase\t-1\n','run\tcase\t256\n','compile\tcase\t0\n','other\tcase\t0\n'])
  assert.throws(()=>parseCases(row));
 assert.equal(publishCases(parseCases('compile\tbroken\t1\n')).verdict,'FAIL');
});

test('the real native shell captures terminal statuses and publishes only the aggregate',t=>{
 const dir=scratch(t),repo=join(import.meta.dirname,'../..');
 for(const codes of [[124],[7],[124,9]]) {
  const tree=join(dir,codes.join('-')),bin=join(tree,'bin'),tmp=join(tree,'tmp');
  for(const path of ['tooling/conformance','tooling/gate','runtime/node/internal','runtime/node/control/test','runtime/c','bin','tmp'])
   mkdirSync(join(tree,path),{recursive:true});
  for(const path of ['tooling/conformance/c-tests.sh','tooling/conformance/native-case-result.ts','tooling/gate/step-result.ts'])
   copyFileSync(join(repo,path),join(tree,path));
  // Only external build/discovery and timeout commands are controlled. The
  // shell's status capture, terminal rows, helper and shared publisher are real.
  writeFileSync(join(tree,'tooling/conformance/node-deps.ts'),
   "import {writeFileSync} from 'node:fs'; for(const suffix of ['.include_flags','.link_flags'])writeFileSync(process.argv[3]+suffix,'');\n");
  writeFileSync(join(tree,'tooling/gate/node-deps-elf.ts'),'process.exitCode=0;\n');
  writeFileSync(join(tree,'runtime/node/internal/stub.c'),'/* scratch compiler input */\n');
  writeFileSync(join(bin,'clang'),'#!/bin/sh\nwhile [ "$#" -gt 0 ]; do\n if [ "$1" = -o ]; then shift; : > "$1"; fi\n shift\ndone\n');
  writeFileSync(join(bin,'ar'),'#!/bin/sh\nexit 0\n');
  writeFileSync(join(bin,'timeout'),'#!/bin/sh\n[ "$1" = 60 ] || exit 99\ncase "$2" in\n *-status124) exit 124;;\n *-status7) echo "FAIL forced seven"; exit 7;;\n *-status9) echo "FAIL forced nine"; exit 9;;\n *) exit 99;;\nesac\n');
  for(const name of ['clang','ar','timeout'])chmodSync(join(bin,name),0o755);
  for(const code of codes)writeFileSync(join(tree,`runtime/node/control/test/status${code}.c`),'/* forced terminal status */\n');
  const frame=join(tree,'step-result.json'),attempt='shell-'+codes.join('-');
  const child=spawnSync('bash',['tooling/conformance/c-tests.sh'],{
   cwd:tree,encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,TMPDIR:tmp,
    NTS_GATE_STEP_RESULT:frame,NTS_GATE_STEP:'tests',NTS_GATE_STEP_ATTEMPT:attempt}
  });
  const detail=child.stdout+'\n'+child.stderr;
  assert.equal(child.error,undefined,detail);assert.equal(child.signal,null,detail);
  assert.equal(child.status,codes.includes(7)||codes.includes(9)?1:3,detail);
  const artifacts=readdirSync(tmp).filter(name=>name.startsWith('nts-c-tests.'));
  assert.equal(artifacts.length,1,detail);
  const work=join(tmp,artifacts[0]);
  const terminal=parseCases(readFileSync(join(work,'native-cases.tsv'),'utf8'));
  assert.deepEqual(terminal,codes.map(code=>({stage:'run',name:`control/status${code}`,status:code})));
  assert.equal(new Set(terminal.map(row=>row.name)).size,codes.length,'one terminal row per case');
  const result=JSON.parse(readFileSync(join(work,'native-result.json'),'utf8'));
  assert.deepEqual(result.cases,terminal);
  assert.equal(result.verdict,codes.length===1&&codes[0]===124?'UNAVAILABLE':'FAIL');
  assert.equal(result.unavailable.length,codes.includes(124)?1:0);
  assert.equal(result.failures.length,codes.includes(7)||codes.includes(9)?1:0);
  if(result.verdict==='UNAVAILABLE') {
   const shared=readStepInstrument(frame,'tests',attempt);
   assert.equal(shared?.verdict,'NOT RUN');assert.equal(shared?.kind,'hung');
   assert.match(shared?.reason??'',/control\/status124/);
  } else assert.equal(existsSync(frame),false,'a timeout must not mask a completed failure');
  t.diagnostic(`real shell ${codes.join('+')}: exit ${child.status}, ${terminal.length} terminal row(s), ${result.verdict}`);
 }
});
