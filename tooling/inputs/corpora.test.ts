import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,readlinkSync,writeFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {CORPORA} from './corpora.ts';
import {corpus} from './corpus.ts';
import {LINKER_INPUTS} from './linker.ts';
import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {testScratch} from '../gate/test-scratch.ts';
import {fixtureEnvironment} from '../gate/test-environment.ts';
import {gitArguments} from '../gate/git-arguments/main.ts';
import {corporaFixture,fixturePins} from '../bootstrap/corpora-test-fixture.ts';
const SOURCE=fileURLToPath(new URL('../../',import.meta.url));
const localPin=(tree:string,source:URL)=>pathToFileURL(join(tree,relative(SOURCE,fileURLToPath(source))));
function stage(tree:string){
  mkdirSync(tree);copyModuleClosure(LINKER_INPUTS.map(url=>relative(SOURCE,fileURLToPath(url))),tree);
  // These controls exercise the real corpus registry; the other linker owners
  // retain their independent controls and receive only private stand-ins here.
  for(const path of ['tooling/inputs/node-inputs.ts','tooling/inputs/dependency-inputs.ts'])writeFileSync(join(tree,path),'process.exitCode=0;\n');
}
test('the production linker runs two corpus pins side by side without moving legacy checkouts',t=>{
  const own=testScratch(t,'corpus-pins'),oldTree=join(own,'old'),nextTree=join(own,'next'),shared=join(own,'shared');
  const env={...fixtureEnvironment(t),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'};
  stage(oldTree);stage(nextTree);
  const f=corporaFixture(join(own,'upstream-owner'),shared,[oldTree],env);
  for(const definition of CORPORA){const legacy=join(shared,'third_party',definition.slot);mkdirSync(legacy);writeFileSync(join(legacy,'kept'),'legacy\n');}
  const link=(tree:string)=>{const actual=spawnSync('sh',[join(tree,'tooling/inputs/link.sh'),'work',shared,tree],{cwd:tree,env,encoding:'utf8'});assert.equal(actual.status,0,actual.stderr);};
  link(oldTree);
  const git=(...args:string[])=>execFileSync('git',gitArguments(args),{cwd:f.upstream,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  for(const name of ['tsc/testdata/tests/cases/control.ts','test/language/control.js'])writeFileSync(join(f.upstream,name),"process.stdout.write('second\\n');\n");
  git('add','.');git('-c','user.name=fixture','-c','user.email=fixture@invalid','commit','-qm','Second corpus pin');
  const nextPin=git('rev-parse','--verify','HEAD^{commit}');assert.notEqual(nextPin,f.pin);fixturePins(nextTree,nextPin);
  for(const definition of CORPORA)corpus({...definition,pinSource:localPin(nextTree,definition.pinSource),upstream:f.upstream}).acquire(shared,env);
  link(nextTree);
  for(const [tree,pin,answer]of [[oldTree,f.pin,'first\n'],[nextTree,nextPin,'second\n']] as const){
    for(const [slot,file]of [['typescript','tsc/testdata/tests/cases/control.ts'],['test262','test/language/control.js']] as const){
      const directory=join(tree,'third_party',slot);assert.equal(readlinkSync(directory),join(shared,'third_party',slot+'.d',pin));
      const actual=spawnSync(process.execPath,[join(directory,file)],{env,encoding:'utf8'});assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,answer);
    }
  }
  for(const definition of CORPORA){
    assert.equal(readFileSync(join(shared,'third_party',definition.slot,'kept'),'utf8'),'legacy\n');
    const before=corpus({...definition,pinSource:localPin(oldTree,definition.pinSource)});
    assert.equal(before.checkout(shared),f.selected[definition.slot]);before.verify(before.checkout(shared),env);
  }
});

for(const slot of ['typescript','test262'] as const)test(slot+' acquisition keeps its population, verifies hits and refuses mismatch/dirty inputs',t=>{
  const own=testScratch(t,slot+'-acquisition'),tree=join(own,'tree'),shared=join(own,'shared'),env=fixtureEnvironment(t);stage(tree);
  const f=corporaFixture(join(own,'fixture'),shared,[tree],env),definition=CORPORA.find(row=>row.slot===slot);assert.ok(definition);
  const selected={...definition,pinSource:localPin(tree,definition.pinSource)},owner=corpus(selected),destination=owner.checkout(shared);
  assert.equal(owner.acquire(shared,env),destination);assert.equal(corpus({...selected,upstream:join(own,'unreachable')}).acquire(shared,env),destination);
  if(slot==='typescript'){
    assert.ok(existsSync(join(destination,'tsc/testdata/tests/cases/control.ts')));
    assert.equal(existsSync(join(destination,'INTERPRETING.md')),false,'the tests-only sparse population is retained');
  }else for(const name of ['test/language/control.js','harness/assert.js','INTERPRETING.md'])assert.ok(existsSync(join(destination,name)),name);
  // A foreign pin is independently authenticated by its own native metadata
  // before its checkout identity is asked; changing the private tree does both.
  fixturePins(tree,'f'.repeat(40));assert.throws(()=>corpus(selected).verify(destination,env),/requires/);fixturePins(tree,f.pin);
  const file=join(destination,slot==='typescript'?'tsc/testdata/tests/cases/control.ts':'test/language/control.js');writeFileSync(file,'changed\n');
  assert.throws(()=>owner.acquire(shared,env),/local changes/);assert.equal(readFileSync(file,'utf8'),'changed\n');
});

test('each pin command reads its data and test262 remains independent of native TypeScript verification',t=>{
  const own=testScratch(t,'corpus-pin-commands'),tree=join(own,'tree'),shared=join(own,'shared'),env=fixtureEnvironment(t);stage(tree);
  const f=corporaFixture(join(own,'fixture'),shared,[tree],env),definition=CORPORA.find(row=>row.slot==='typescript');assert.ok(definition);
  writeFileSync(localPin(tree,definition.pinSource),'f'.repeat(40)+'\n');
  const test262=spawnSync(process.execPath,[join(tree,'tooling/bootstrap/test262.ts'),'--pin'],{env,encoding:'utf8'});
  assert.equal(test262.status,0,test262.stderr);assert.equal(test262.stdout,f.pin+'\n');
  const packet=join(own,'native-pin-refusal.json'),typescript=spawnSync(process.execPath,[join(tree,'tooling/bootstrap/typescript.ts'),'--pin'],{
    env:{...env,NTS_GATE_STEP:'corpus-pin',NTS_GATE_STEP_ATTEMPT:'native-mismatch',NTS_GATE_STEP_RESULT:packet},encoding:'utf8'});
  assert.notEqual(typescript.status,0);assert.ok(typescript.stderr.includes(f.pin),typescript.stderr);assert.match(typescript.stderr,/differs from the native checker/);
  assert.equal(JSON.parse(readFileSync(packet,'utf8')).kind,'tooling-setup');
});

test('bootstrap preparation fills a fresh slot and retains a nonempty legacy directory',t=>{
  const own=testScratch(t,'corpus-prepare'),tree=join(own,'tree'),shared=join(own,'shared'),env=fixtureEnvironment(t);stage(tree);
  const f=corporaFixture(join(own,'fixture'),shared,[tree],env);
  for(const definition of CORPORA){
    const owner=corpus({...definition,pinSource:localPin(tree,definition.pinSource)}),selected=owner.prepare(shared,tree,env);
    assert.equal(selected.path,f.selected[definition.slot]);assert.equal(selected.legacy,undefined);
    const legacyTree=join(own,'legacy-'+definition.slot),legacy=join(legacyTree,'third_party',definition.slot);mkdirSync(legacy,{recursive:true});writeFileSync(join(legacy,'owned'),'retained\n');
    assert.equal(owner.prepare(shared,legacyTree,env).legacy,legacy);assert.equal(readFileSync(join(legacy,'owned'),'utf8'),'retained\n');
  }
});

test('the bootstrap registry command prepares all declared corpora and reports a retained legacy slot',t=>{
  const own=testScratch(t,'corpus-bootstrap-command'),tree=join(own,'tree'),env=fixtureEnvironment(t);stage(tree);
  execFileSync('git',gitArguments(['init','-q']),{cwd:tree,env,stdio:['ignore','pipe','pipe']});
  const f=corporaFixture(join(own,'fixture'),tree,[tree],env),legacy=join(tree,'third_party/are-we-fast-yet');mkdirSync(legacy);writeFileSync(join(legacy,'kept'),'legacy\n');
  const actual=spawnSync(process.execPath,[join(tree,'tooling/inputs/corpora.ts'),'--prepare'],{cwd:tree,env,encoding:'utf8'});
  assert.equal(actual.status,0,actual.stderr);
  const rows=actual.stdout.trim().split('\n').map(line=>JSON.parse(line));assert.deepEqual(rows.map(row=>row.slot),CORPORA.map(row=>row.slot));
  assert.equal(rows.find(row=>row.slot==='are-we-fast-yet').legacy,legacy);assert.equal(readFileSync(join(legacy,'kept'),'utf8'),'legacy\n');
  for(const slot of ['typescript','test262'])assert.equal(readlinkSync(join(tree,'third_party',slot)),f.selected[slot]);
});
