import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,readlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {testScratch} from '../gate/test-scratch.ts';
import {fixtureEnvironment} from '../gate/test-environment.ts';
import {gitArguments} from '../gate/git-arguments/main.ts';
import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {LINKER_INPUTS} from '../inputs/linker.ts';
import {corpus} from '../inputs/corpus.ts';
import {AWFY} from './awfy.ts';
import {corporaFixture} from './corpora-test-fixture.ts';
const SOURCE=fileURLToPath(new URL('../../',import.meta.url));
function repository(parent:string,env:NodeJS.ProcessEnv){
  const root=join(parent,'upstream');mkdirSync(root);
  const git=(...args:string[])=>execFileSync('git',gitArguments(args),{cwd:root,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');
  for(const path of ['benchmarks/C++/src/bounce.h','benchmarks/Java/src/Bounce.java','docs/README.md']){
    mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),'first\n');
  }
  const commit=()=>{git('add','.');git('-c','user.name=fixture','-c','user.email=fixture@example.test','commit','-qm','Corpus revision');return git('rev-parse','--verify','HEAD^{commit}');};
  const pin=commit(),pinFile=join(parent,'corpus.pin');writeFileSync(pinFile,pin+'\n');
  const owner=()=>corpus({...AWFY,pinSource:pathToFileURL(pinFile),upstream:root});
  return {root,pin,pinFile,git,commit,owner};
}
test('fresh acquisition selects the pin rather than the upstream default and never moves an existing checkout',t=>{
  const own=testScratch(t,'awfy-acquisition'),env=fixtureEnvironment(t),f=repository(own,env),first=f.owner();
  writeFileSync(join(f.root,'docs/README.md'),'second\n');const second=f.commit();
  const shared=join(own,'shared'),destination=first.acquire(shared,env);
  first.verify(destination,env);assert.equal(readFileSync(join(destination,'docs/README.md'),'utf8'),'first\n');
  assert.equal(first.acquire(shared,env),destination);
  assert.equal(corpus({...AWFY,pinSource:pathToFileURL(f.pinFile),upstream:join(own,'unreachable')}).acquire(shared,env),destination,'a verified pin never fetches again');
  writeFileSync(f.pinFile,second+'\n');const next=f.owner();
  assert.throws(()=>next.verify(destination,env),error=>error instanceof Error&&error.message.includes(destination)&&error.message.includes(f.pin)&&error.message.includes(second));
  const newer=next.acquire(shared,env);assert.notEqual(newer,destination);first.verify(destination,env);next.verify(newer,env);
  writeFileSync(join(destination,'docs/README.md'),'local edit\n');assert.throws(()=>first.verify(destination,env),/local changes/);
  assert.equal(readFileSync(join(destination,'docs/README.md'),'utf8'),'local edit\n');
});
test('the production linker keeps two candidate pins and the legacy checkout independent',t=>{
  const own=testScratch(t,'awfy-link'),env=fixtureEnvironment(t),f=repository(own,env),shared=join(own,'shared');
  const first=f.owner(),source=first.acquire(shared,env),legacy=join(shared,'third_party/are-we-fast-yet');mkdirSync(legacy);writeFileSync(join(legacy,'owned'),'legacy\n');
  const stage=(name:string,pin:string)=>{
    const tree=join(own,name);mkdirSync(tree);copyModuleClosure(LINKER_INPUTS.map(url=>relative(SOURCE,fileURLToPath(url))),tree);
    corporaFixture(join(own,name+'-corpora'),shared,[tree],env);
    // Private stand-ins for the linker's other acquisition owners.
    for(const path of ['tooling/inputs/node-inputs.ts','tooling/inputs/dependency-inputs.ts'])writeFileSync(join(tree,path),'process.exitCode=0;\n');
    writeFileSync(join(tree,'tooling/bootstrap/awfy.pin'),pin+'\n');return tree;
  };
  const link=(tree:string)=>spawnSync('sh',[join(tree,'tooling/inputs/link.sh'),'work',shared,tree],{cwd:tree,env,encoding:'utf8'});
  const oldTree=stage('old',f.pin),old=link(oldTree);assert.equal(old.status,0,old.stderr);assert.equal(readlinkSync(join(oldTree,'third_party/are-we-fast-yet')),source);
  writeFileSync(join(f.root,'docs/README.md'),'second\n');const second=f.commit();writeFileSync(f.pinFile,second+'\n');const next=f.owner(),newSource=next.acquire(shared,env);
  const newTree=stage('new',second),newer=link(newTree);assert.equal(newer.status,0,newer.stderr);assert.equal(readlinkSync(join(newTree,'third_party/are-we-fast-yet')),newSource);
  assert.equal(readlinkSync(join(oldTree,'third_party/are-we-fast-yet')),source);assert.equal(readFileSync(join(legacy,'owned'),'utf8'),'legacy\n');
  writeFileSync(join(source,'docs/README.md'),'dirty\n');const dirty=link(oldTree);assert.notEqual(dirty.status,0);assert.match(dirty.stderr,/local changes/);
  assert.equal(readlinkSync(join(oldTree,'third_party/are-we-fast-yet')),source);next.verify(newSource,env);assert.ok(existsSync(join(source,'.git')));
});
test('a repository without an acquired pin retains explicit corpus absence',t=>{
  const own=testScratch(t,'awfy-absence'),env=fixtureEnvironment(t),f=repository(own,env);
  assert.equal(f.owner().resolve(f.root,env),null);
});
test('a real link acquisition failure names its cause and retry without publishing a slot',t=>{
  const own=testScratch(t,'awfy-fetch-failure'),env=fixtureEnvironment(t),f=repository(own,env),tree=join(own,'tree'),shared=join(own,'shared'),upstream=join(own,'missing-upstream');
  mkdirSync(tree);copyModuleClosure(LINKER_INPUTS.map(url=>relative(SOURCE,fileURLToPath(url))),tree);
  const entry=join(tree,'tooling/bootstrap/awfy.ts'),source=readFileSync(entry,'utf8');assert.ok(source.includes(AWFY.upstream));
  writeFileSync(entry,source.replace(AWFY.upstream,upstream));writeFileSync(join(tree,'tooling/bootstrap/awfy.pin'),f.pin+'\n');
  const packet=join(own,'instrument.json'),result=spawnSync('sh',[join(tree,'tooling/inputs/link.sh'),'work',shared,tree],{cwd:tree,env:{...env,NTS_GATE_STEP:'awfy-acquisition',NTS_GATE_STEP_ATTEMPT:'failure',NTS_GATE_STEP_RESULT:packet},encoding:'utf8'});
  assert.notEqual(result.status,0);assert.ok(result.stderr.includes(upstream),result.stderr);assert.match(result.stderr,/retry tree setup/);
  assert.equal(JSON.parse(readFileSync(packet,'utf8')).kind,'tooling-setup');
  assert.equal(existsSync(join(tree,'third_party/are-we-fast-yet')),false);assert.equal(existsSync(f.owner().checkout(shared)),false);
});
test('the AWFY data pin is one full revision',()=>assert.match(corpus(AWFY).pin,/^[a-f0-9]{40}$/));
