import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {fixtureInput} from './reader-inputs/main.ts';
import {testScratch} from './test-scratch.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {spawnTest} from './test-wait.ts';
import {gitArguments} from './git-arguments/main.ts';
import {dependencyCache} from '../inputs/dependency-inputs.ts';
import {withCommittedSelectorSource} from './owed-range.ts';
import {installationCatalog,dependencyHash} from '../inputs/dependency-catalog.ts';
import {durableRecord} from './durable-record.ts';

test('one selection keeps working JS readers distinct from committed Rust reader inputs',t=>{
  const root=testScratch(t,'rust-selector-distinct-views'),env=fixtureEnvironment(t);
  const put=(path:string,body:string)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),body);};
  put('Cargo.toml','[package]\nname="distinct-views"\nversion="0.0.0"\nedition="2021"\n');
  put('src/lib.rs','');put('package.json','{"type":"module"}');
  put('shared.mjs',"export const input=new URL('./committed.txt',import.meta.url);\n");
  put('committed.txt','original');put('working.txt','original');
  put('tooling/reader.test.ts',"import '../shared.mjs';\n");
  put('tooling/gate/all.sh','#!/bin/sh\nif [ "$1" = --list ]; then printf "%s\\n" tests doctests tooling; exit; fi\nstep "tests" true\nstep "doctests" true\nstep "tooling" node tooling/reader.test.ts\n');
  put('tooling/gate/run.mjs','');put('tooling/gate/tooling-test-exclusions.json','[]');
  put('tooling/gate/rust-runtime-inputs.json',JSON.stringify({version:1,targets:[{target:{source:'src/lib.rs',name:'distinct_views',kind:['lib']},declarations:{imports:['../shared.mjs'],assets:[]}}]}));
  for(const args of [['init','-q','-b','main'],['add','.'],['commit','-qm','committed readers']]){
    const result=spawnTest('git',gitArguments(args),{cwd:root,env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  }
  const identity={version:2 as const,pnpm:'supplied',manager:'supplied',node:process.versions.node,platform:process.platform,arch:process.arch,inputs:[],importers:[]};
  const catalog=join(testScratch(t,'distinct-view-catalog'),'catalog.json');
  durableRecord(catalog,installationCatalog(root,{...identity,key:dependencyHash(JSON.stringify(identity))},[]));
  const dependencyCatalog={catalogPath:catalog,catalogSha256:dependencyHash(readFileSync(catalog))};
  put('shared.mjs',"export const input=new URL('./working.txt',import.meta.url);\n");
  put('src/lib.rs','mod uncommitted_reader;\n');
  const url=new URL('./owed.mjs',import.meta.url).href;
  withCommittedSelectorSource(root,source=>{
    const code=`import {owed} from ${JSON.stringify(url)};
const trust=${JSON.stringify({acceptedRustRecordBlob:null,dependencyCatalog,committedSource:{...source,dependencyCatalog}})};
// Compare reader obligations independently of the policy's unconditional checks.
const choose=path=>[...new Set(owed([{path,before:'original',after:'changed',sameMode:true}],trust).filter(row=>row.name!=='every change').flatMap(row=>row.steps))];
console.log(JSON.stringify({committed:choose('committed.txt'),working:choose('working.txt'),rules:owed([{path:'working.txt',before:'original',after:'changed',sameMode:true}],trust)}));`;
    const selected=spawnTest(process.execPath,['--input-type=module','-e',code],{cwd:root,env,encoding:'utf8'});
    assert.equal(selected.status,0,selected.stdout+selected.stderr);
    const result=JSON.parse(selected.stdout) as {committed:string[];working:string[]};
    for(const step of ['tests','doctests']){
      assert.ok(result.committed.includes(step),'Rust retains the committed reader: '+step);
      assert.ok(!result.working.includes(step),'working reader bytes never enter the Rust view: '+step+' '+JSON.stringify(result)+' '+selected.stderr);
    }
    assert.ok(!result.committed.includes('tooling'),'JS no longer reads the committed-only input');
    assert.ok(result.working.includes('tooling'),'JS observes its uncommitted reader bytes');
  });
});

test('final owed composition retains supplied exact file and file-stat bytes through precision and handover',t=>{
  const root=testScratch(t,'rust-selector-owed'),env=fixtureEnvironment(t);
  const cache=dependencyCache(root);t.after(()=>rmSync(cache,{recursive:true,force:true}));
  const put=(path:string,text:string)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),text);};
  put('Cargo.toml','[package]\nname="selector-bytes"\nversion="0.0.0"\nedition="2021"\n');put('src/lib.rs','');
  put('pnpm-lock.yaml','supplied lock input\n');
  put('tooling/gate/all.sh',`#!/bin/sh
if [ "$1" = --list ]; then printf '%s\\n' tests doctests addons tooling; exit; fi
step "tests" true
step "doctests" true
step "addons" true
step "tooling" node tooling/empty.test.ts
`);
  put('tooling/gate/run.mjs','if (step.name === "addons" && plan.includes("tests")) e.NTS_ADDON_EMITTED = "output";');
  put('tooling/empty.test.ts','');put('tooling/gate/tooling-test-exclusions.json','[]');
  put('docs/bytes.ts','// old\nconstant\n');put('docs/stat.ts','// old\nconstant\n');put('docs/unread.md','old prose');
  put('docs/broad/input.md','conservative prose');put('tooling/unowned/input.ts','export const unused=1;');
  const target={source:'src/lib.rs',name:'selector_bytes',kind:['lib']};
  put('tooling/gate/rust-runtime-inputs.json',JSON.stringify({version:1,targets:[{target,declarations:{imports:[],assets:[{kind:'file',path:'../docs/bytes.ts'},{kind:'conservative',path:'../docs/broad/'},{kind:'conservative',path:'../tooling/unowned/'}]}}]}));
  for(const args of [['init','-q','-b','main'],['add','.']]){const result=spawnTest('git',gitArguments(args),{cwd:root,env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
  const url=(file:string)=>JSON.stringify(new URL(file,import.meta.url).href);
  const prepare=`import {readFileSync,mkdirSync} from 'node:fs';
import {durableRecord} from ${url('./durable-record.ts')};
import {buildRustSelectorMaterial,selectorTrackedFiles} from ${url('./rust-selector-build.ts')};
import {encodeRustSelectorRecord} from ${url('./rust-selector-record.ts')};
import {readerObservationProjection} from ${url('./reader-observations.ts')};
import {readHostObservation} from ${url('../differential/oracle-filesystem.ts')};
import {selectorFile} from ${url('./rust-selector-material.ts')};
import {selectorInstalledSdk} from ${url('./rust-selector-inputs.ts')};
import {installationCatalog,dependencyHash} from ${url('../inputs/dependency-catalog.ts')};
import {installationCatalogPath} from ${url('../inputs/dependency-inputs.ts')};
const root=process.cwd(),manifest=JSON.parse(readFileSync('tooling/gate/rust-runtime-inputs.json','utf8'));
const supplied={version:2,pnpm:'supplied',manager:'supplied',node:process.versions.node,platform:process.platform,arch:process.arch,inputs:[{path:'pnpm-lock.yaml',sha256:dependencyHash(readFileSync('pnpm-lock.yaml'))}],importers:[]};
durableRecord(installationCatalogPath(root,root),installationCatalog(root,{...supplied,key:dependencyHash(JSON.stringify(supplied))},[]));
const material=buildRustSelectorMaterial({sourceRoot:root,manifest,inventory:()=>[{...manifest.targets[0].target,unitTests:true,doctests:true}],linkage:{packages:[{directory:'',name:'supplied',targets:[manifest.targets[0].target],dependencies:[]}]},declarations:'tooling/gate/rust-runtime-inputs.json',engine:['src/lib.rs'],cargoInputs:['Cargo.toml'],tracked:()=>selectorTrackedFiles(root)});
// Supplied real callback rows exercise the composed selector, independently
// of which callbacks the pinned compiler happens to make for this fixture.
for(const [kind,path]of [['file','docs/bytes.ts'],['stat','docs/stat.ts']]){
const row={reader:'src/lib.rs',protocol:'project',context:{entry:'<entry>',dataNamespaces:{}},observation:{kind,path:root+'/'+path,value:readHostObservation(kind,root+'/'+path)},causes:[]};
material.targets[0].roles.typedDependencies.push({reader:row.reader,protocol:row.protocol,dependency:readerObservationProjection(root,row)});}
const installed=selectorInstalledSdk();material.key.files.push(selectorFile({source:root,sdk:installed.root,native:installed.nativeRoot},root+'/docs/stat.ts'));
mkdirSync('results/gate-inputs',{recursive:true});durableRecord('results/gate-inputs/rust-runtime.json',encodeRustSelectorRecord(material),{compact:true});`;
  const prepared=spawnTest(process.execPath,['--input-type=module','-e',prepare],{cwd:root,env,encoding:'utf8'});assert.equal(prepared.status,0,prepared.stderr);
  for(const args of [['add','.'],['-c','user.name=selector control','-c','user.email=control@example.invalid','commit','-qm','accepted supplied roles']]){const result=spawnTest('git',gitArguments(args),{cwd:root,env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
  const acceptedBlob=spawnTest('git',gitArguments(['rev-parse','HEAD:results/gate-inputs/rust-runtime.json']),{cwd:root,env,encoding:'utf8'});assert.equal(acceptedBlob.status,0,acceptedBlob.stderr);
  const select=`import {owed,gateSteps,inputMetadataDeclarations,inputDirectoryDeclarations,rustRecordDecision} from ${url('./owed.mjs')};
import {installationCatalogTrust} from ${url('../inputs/dependency-inputs.ts')};
const dependencyCatalog=installationCatalogTrust(process.cwd(),process.cwd());
const choose=(path,trust)=>gateSteps(owed([{path,before:'// old\\nconstant\\n',after:'// new\\nconstant\\n',sameMode:true}],trust?{...trust,dependencyCatalog}:undefined));
const blob=${JSON.stringify(acceptedBlob.stdout.trim())};
const trustedStat=choose('docs/stat.ts',{acceptedRustRecordBlob:blob}),absentStat=choose('docs/stat.ts',{acceptedRustRecordBlob:null}),trustedAgain=choose('docs/stat.ts',{acceptedRustRecordBlob:blob});
console.log(JSON.stringify({trustedStat,absentStat,trustedAgain,file:choose('docs/bytes.ts'),stat:choose('docs/stat.ts'),unread:choose('docs/unread.md'),
conservative:choose('docs/broad/input.md'),added:gateSteps(owed([{path:'docs/broad/new.md',added:true}])),deleted:gateSteps(owed([{path:'docs/broad/input.md',deleted:true}])),
unplaced:owed([{path:'tooling/unowned/input.ts',sameMode:true}]).some(row=>row.full&&row.fallback),directories:inputDirectoryDeclarations(),metadata:inputMetadataDeclarations()}));`;
  const selected=spawnTest(process.execPath,['--input-type=module','-e',select],{cwd:root,env,encoding:'utf8'});assert.equal(selected.status,0,selected.stdout+selected.stderr);
  const result=JSON.parse(selected.stdout) as {trustedStat:string[];absentStat:string[];trustedAgain:string[];file:string[];stat:string[];unread:string[];conservative:string[];added:string[];deleted:string[];unplaced:boolean;directories:{kind:string;directory:string;steps:string[];context?:{entry:string}}[];metadata:{dependencies:{dependency:{path:string;kind:string};steps:string[]}[]}};
  for(const step of ['tests','doctests','addons']){assert.ok(result.trustedStat.includes(step));assert.ok(!result.absentStat.includes(step),'explicit null takes live after a trusted decision: '+step);assert.ok(result.trustedAgain.includes(step));}
  for(const name of ['file','stat'] as const)for(const step of ['tests','doctests','addons'])assert.ok(result[name].includes(step),name+' retains '+step);
  for(const step of ['tests','doctests','addons'])assert.ok(!result.unread.includes(step),'unread prose keeps precision: '+step);
  for(const name of ['conservative','added','deleted'] as const)for(const step of ['tests','doctests','addons'])assert.ok(result[name].includes(step),name+' retains '+step);
  assert.equal(result.unplaced,true,'conservative bytes do not supply executable placement');
  assert.ok(result.directories.some(row=>row.kind==='conservative'&&row.directory==='docs/broad'&&row.context?.entry==='<entry>'&&row.steps.includes('addons')));
  const stat=result.metadata.dependencies.find(row=>row.dependency.kind==='stat'&&row.dependency.path==='docs/stat.ts');assert.ok(stat);
  assert.ok(['tests','doctests','addons'].every(step=>stat.steps.includes(step)));
  const staged=testScratch(t,'rust-selector-typed-byte-mutant');
  copyModuleClosure([fixtureInput(new URL('./owed.mjs',import.meta.url),{dataNamespaces:{}})],staged);
  const entry=join(staged,'tooling/gate/owed.mjs'),body=readFileSync(entry,'utf8'),needle='if(!row.dependency.observationOnly&&row.dependency.bytes){map.add(row.dependency.path,step);byteReaders.add(row.dependency.path,step);}';
  assert.equal(body.split(needle).length,2,'the staged mutation removes exactly the typed-byte merge');
  writeFileSync(entry,body.replace(needle,'/* typed byte composition deliberately removed */'));
  // A staged instrument keeps the same installed SDK capability as the
  // original owner; its bytes are not copied or granted repository roles.
  const loader=join(staged,'sdk-capability.ts');
  writeFileSync(loader,`import {createRequire,registerHooks} from 'node:module';import {pathToFileURL} from 'node:url';import {readFileSync} from 'node:fs';
const require=createRequire(${url('./module-closure.ts')});
const pkg=JSON.parse(readFileSync(require.resolve('typescript/package.json'),'utf8'));
const names=Object.keys(pkg.exports).filter(name=>!name.includes('*')).map(name=>name==='.'?'typescript':'typescript/'+name.slice(2));
const installed=new Map(names.map(name=>[name,pathToFileURL(require.resolve(name)).href]));
registerHooks({resolve(specifier,context,next){return installed.has(specifier)?{url:installed.get(specifier),shortCircuit:true}:next(specifier,context);}});`);
  const mutant=spawnTest(process.execPath,['--import',pathToFileURL(loader).href,'--input-type=module','-e',select.replace(url('./owed.mjs'),JSON.stringify(pathToFileURL(entry).href))],{cwd:root,env,encoding:'utf8'});
  assert.equal(mutant.status,0,mutant.stdout+mutant.stderr);const missing=JSON.parse(mutant.stdout) as typeof result;
  for(const step of ['tests','doctests','addons']){assert.ok(missing.file.includes(step),'independent exact bytes survive');assert.ok(!missing.stat.includes(step),'removing typed composition loses '+step);}
  const fallback=`import {owed,gateSteps,rustRecordDecision} from ${url('./owed.mjs')};
import {installationCatalogTrust} from ${url('../inputs/dependency-inputs.ts')};
const trust={acceptedRustRecordBlob:${JSON.stringify(acceptedBlob.stdout.trim())},dependencyCatalog:${'installationCatalogTrust(process.cwd(),process.cwd())'}};
const rules=owed([{path:'docs/unread.md',before:'old prose',after:'new prose',sameMode:true}],trust);
console.log(JSON.stringify({steps:gateSteps(rules),decision:rustRecordDecision(trust),all:rules.some(row=>row.name==='Rust installation catalog requires all targets')}));`;
  const checkFallback=(code:string,reason:RegExp)=>{
    const response=spawnTest(process.execPath,['--input-type=module','-e',code],{cwd:root,env,encoding:'utf8'});assert.equal(response.status,0,response.stdout+response.stderr);
    const result=JSON.parse(response.stdout);assert.equal(result.all,true);assert.match(result.decision.reason,reason);
    for(const step of ['tests','doctests','addons'])assert.ok(result.steps.includes(step),step);
  };
  checkFallback(fallback.replace('installationCatalogTrust(process.cwd(),process.cwd())','null'),/catalog-stale-live: .*missing/);
  writeFileSync(join(root,'pnpm-lock.yaml'),'changed lock input\n');
  checkFallback(fallback,/catalog-stale-live: .*pin changed: pnpm-lock.yaml/);
});
