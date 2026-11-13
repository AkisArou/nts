import {fixtureEnvironment} from "../gate/test-environment.ts";
import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,symlinkSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {OracleFilesystem} from './oracle-filesystem.ts';
import {oracleRecipeIdentity,removeOracleSnapshot} from './oracle-emit.ts';
import {nodeExecutableIdentity,nodeProcessBirth,type NodeResolutionSession} from './oracle-runtime.ts';
import * as resultAPI from './oracle-results.ts';
import {createProgramOracleResults} from './oracle-result-publisher.ts';
import {openProgramOracleResults,programOracleHandoff,resultHash,type ProgramAnswer} from './oracle-results.ts';

function fixture(t:{after(callback:()=>void):void}){
  const root=mkdtempSync(join(tmpdir(),'program-reference-'));t.after(()=>removeOracleSnapshot(root));
  const inputs=join(root,'inputs');mkdirSync(inputs);
  const entry=join(inputs,'main.ts'),project=join(inputs,'tsconfig.json');writeFileSync(entry,'source');writeFileSync(project,'{}');
  const fs=new OracleFilesystem();fs.readBytes(entry);fs.readBytes(project);
  const owner={pid:process.pid,birth:nodeProcessBirth(process.pid)};
  const session:NodeResolutionSession={version:1,directory:root,token:'private-test',nodeVersion:process.versions.node,nodeSha256:'b'.repeat(64),executable:nodeExecutableIdentity(process.pid),holder:owner,owner,options:{flags:[],nodeOptions:''},conditions:{esm:[],cjs:[]},helperSha256:'c'.repeat(64)};
  const value:ProgramAnswer={version:1,kind:'calls',subject:'tests/programs/private',entry,project,driverSha256:'d'.repeat(64),count:2,rows:['19','23'],stdout:[0,255,10],stderr:[]};
  const identity=oracleRecipeIdentity(),directory=join(root,'results');
  const publish=()=>{const writer=createProgramOracleResults(directory,identity);writer.add(value,{observations:fs.captured(),session});writer.publish();return openProgramOracleResults(programOracleHandoff(directory),identity);};
  return {root,inputs,entry,project,fs,session,value,identity,directory,publish};
}

test('five example arms read one authenticated answer with exact printed bytes',t=>{
  const f=fixture(t),reader=f.publish();
  for(const arm of ['examples','rc','llvm','llvm-rc','jvm']){
    assert.deepEqual(reader.calls(f.project,f.entry,'d'.repeat(64)),f.value,arm);
    assert.equal(reader.project(f.value.subject),f.project);
  }
  assert.throws(()=>reader.calls(f.project,f.entry,'e'.repeat(64)),/call population changed/);
  assert.throws(()=>reader.calls(f.project+'.other',f.entry,'d'.repeat(64)),/no measured source project/);
  assert.throws(()=>openProgramOracleResults(programOracleHandoff(f.directory),{...f.identity,options:'changed'}),/identity changed/);
});

test('the standalone result reader needs no SDK or preparation module imports',t=>{
  const f=fixture(t);f.publish();
  const request={handoff:programOracleHandoff(f.directory),project:f.project,entry:f.entry,driverSha256:'d'.repeat(64)};
  const wrapper=join(f.root,'read.mjs');
  writeFileSync(wrapper,`import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
const target=process.argv[2],request=process.argv[3];
registerHooks({resolve(specifier,context,next){const result=next(specifier,context);if(/\\/(?:oracle-emit|oracle-assets|oracle-resolution)\\.ts$/.test(result.url)||result.url.includes('/typescript/'))throw Error('preparation module imported by result reader: '+result.url);return result;}});
process.argv=[process.execPath,target,'--read-program-reference',request];
await import(pathToFileURL(target).href);
`);
  const read=(entry:string)=>spawnSync(process.execPath,[wrapper,fileURLToPath(new URL(entry,import.meta.url)),JSON.stringify(request)],
    {encoding:'utf8',env:{...fixtureEnvironment(t),NTS_ORACLE_TYPESCRIPT:join(f.root,'missing-sdk')}});
  const control=read('./oracle-emit.ts');
  assert.notEqual(control.status,0);assert.match(control.stderr,/preparation module imported by result reader/,'the import guard discriminates the old entry');
  const result=read('./oracle-results.ts');
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),f.value);
});

for(const kind of ['file','failed lookup','listing','link'] as const)test('each result use replays its original '+kind,t=>{
  const f=fixture(t),candidate=join(f.inputs,'candidate');
  if(kind==='failed lookup')f.fs.fileExists(candidate);
  if(kind==='listing')f.fs.getAccessibleEntries(f.inputs);
  if(kind==='link'){symlinkSync('main.ts',candidate);f.fs.readlink(candidate);}
  const reader=f.publish();reader.get(f.value.subject);
  if(kind==='file')writeFileSync(f.entry,'changed');
  else if(kind==='link'){unlinkSync(candidate);symlinkSync('tsconfig.json',candidate);}
  else writeFileSync(candidate,'appeared');
  assert.throws(()=>reader.get(f.value.subject),/filesystem .* changed/);
});

test('incomplete results and unfinished observations cannot enter the result store',t=>{
  const f=fixture(t),writer=createProgramOracleResults(f.directory,f.identity);
  assert.throws(()=>writer.add({...f.value,kind:'calls',rows:['19'],count:2,driverSha256:'d'.repeat(64),stdout:[],stderr:[]},{observations:f.fs.captured(),session:f.session}),/incomplete call result/);
  const observation:ProgramAnswer={version:1,kind:'observation',subject:'tests/outcomes/private',entry:f.entry,project:f.project,observation:{result:'exit 1; nts: uncaught expected',printed:{stdout:'',stderr:''},complete:true}};
  const unfinished=JSON.parse(JSON.stringify({...observation,observation:{...observation.observation,complete:false}})) as ProgramAnswer;
  assert.throws(()=>writer.add(unfinished,{observations:f.fs.captured(),session:f.session}),/unmeasured observation/);
  writer.add(observation,{observations:f.fs.captured(),session:f.session});writer.publish();
  assert.deepEqual(openProgramOracleResults(programOracleHandoff(f.directory),f.identity).get(observation.subject),observation);
});


test('a generated control selects its authenticated producer project by name',t=>{
  const f=fixture(t);f.publish();
  const command=(subject:string)=>spawnSync(process.execPath,[fileURLToPath(new URL('./oracle-results.ts',import.meta.url)),'--project-subject',subject],
    {encoding:'utf8',env:{...fixtureEnvironment(t),NTS_PROGRAM_ORACLE:JSON.stringify(programOracleHandoff(f.directory)),NTS_ORACLE_TYPESCRIPT:join(f.root,'missing-sdk')}});
  const positive=command(f.value.subject);
  assert.equal(positive.status,0,positive.stderr);assert.equal(positive.stdout,f.project+'\n');
  const absent=command('gate/unknown-control');assert.notEqual(absent.status,0);assert.match(absent.stderr,/no measured project: gate\/unknown-control/);
  writeFileSync(f.entry,'changed');const changed=command(f.value.subject);assert.notEqual(changed.status,0);assert.match(changed.stderr,/filesystem file changed/);
});


test('published result runtime needs no TypeScript stripping and hashes the exact loaded bytes',t=>{
  const f=fixture(t);f.publish();
  const argumentsFor=Reflect.get(resultAPI,'programOracleRuntimeArguments') as ((root:unknown)=>string[])|undefined;
  assert.equal(typeof argumentsFor,'function','the producer must publish executable reader assets');
  const root=JSON.parse(readFileSync(join(f.directory,'ready.json'),'utf8'));
  assert.ok(root.runtime.assets['oracle-seal/main.mjs'],'the result publisher emits nested dependencies');
  assert.ok(root.runtime.assets['runtime-paths/main.mjs']);
  const args=argumentsFor!(root),request={handoff:programOracleHandoff(f.directory),project:f.project,entry:f.entry,driverSha256:'d'.repeat(64)};
  const run=()=>spawnSync(process.execPath,['--no-experimental-strip-types',...args,'--read-program-reference',JSON.stringify(request)],{encoding:'utf8',env:{...fixtureEnvironment(t),NTS_ORACLE_TYPESCRIPT:join(f.root,'missing-sdk')}});
  const positive=run();assert.equal(positive.status,0,positive.stderr);assert.deepEqual(JSON.parse(positive.stdout),f.value);
  for(const name of Object.keys(root.runtime.assets)){
    const runtime=join(root.runtime.directory,name),original=readFileSync(runtime);chmodSync(runtime,0o644);
    writeFileSync(runtime,original.toString('utf8')+'\n// changed reader code\n');
    try{const changed=run();assert.notEqual(changed.status,0);assert.match(changed.stderr,/program oracle reader bytes changed/,name);}
    finally{writeFileSync(runtime,original);chmodSync(runtime,0o444);}
  }
  const leaf=join(root.runtime.directory,'oracle-seal/main.mjs'),original=readFileSync(leaf),outside=join(f.root,'outside.mjs');
  writeFileSync(outside,original);unlinkSync(leaf);symlinkSync(outside,leaf);
  try{const alias=run();assert.notEqual(alias.status,0);assert.match(alias.stderr,/program oracle reader (?:path changed|module was not published)/);}
  finally{unlinkSync(leaf);writeFileSync(leaf,original,{mode:0o444});}
  unlinkSync(leaf);
  try{const missing=run();assert.notEqual(missing.status,0);assert.match(missing.stderr,/(?:ENOENT|Cannot find module).*oracle-seal\/main\.mjs/);}
  finally{writeFileSync(leaf,original,{mode:0o444});}
  const entry=join(root.runtime.directory,'oracle-results.mjs'),entryBytes=readFileSync(entry,'utf8');
  const extended="import './unlisted.mjs';\n"+entryBytes;
  chmodSync(entry,0o644);writeFileSync(entry,extended);writeFileSync(join(root.runtime.directory,'unlisted.mjs'),"throw Error('unlisted-module-ran');\n");
  root.runtime.assets['oracle-results.mjs']=resultHash(extended);
  const unlisted=spawnSync(process.execPath,['--no-experimental-strip-types',...argumentsFor!(root),'--read-program-reference',JSON.stringify(request)],{encoding:'utf8',env:fixtureEnvironment(t)});
  assert.notEqual(unlisted.status,0);assert.match(unlisted.stderr,/program oracle reader module was not published: .*unlisted\.mjs/);assert.doesNotMatch(unlisted.stderr,/unlisted-module-ran/);
});

test('a finalized budget answer is authenticated without inventing call rows',t=>{
  const f=fixture(t),writer=createProgramOracleResults(f.directory,f.identity);
  const value:ProgramAnswer={version:1,subject:f.value.subject,project:f.project,entry:f.entry,kind:'budget',driverSha256:'d'.repeat(64),budget:{phase:'execute',outcome:'timeout',bound:60,signal:'SIGKILL',reason:'oracle timed out'}};
  writer.add(value,{observations:f.fs.captured(),session:f.session});writer.publish();
  const reader=openProgramOracleResults(programOracleHandoff(f.directory),f.identity);
  assert.deepEqual(reader.calls(f.project,f.entry,'d'.repeat(64)),value);
  writeFileSync(f.entry,'changed');assert.throws(()=>reader.calls(f.project,f.entry,'d'.repeat(64)),/changed/);
});

test('a planner past its bound planned no driver, so its budget answers each driver of its entry',t=>{
  const f=fixture(t),writer=createProgramOracleResults(f.directory,f.identity),capture={observations:f.fs.captured(),session:f.session};
  const budget={phase:'plan' as const,outcome:'timeout' as const,bound:600,signal:'SIGKILL',reason:'oracle planner timed out'};
  const value:ProgramAnswer={version:1,subject:f.value.subject,project:f.project,entry:f.entry,kind:'budget',budget};
  assert.throws(()=>writer.add({...value,driverSha256:'d'.repeat(64)} as unknown as ProgramAnswer,capture),/invalid case budget/,'an unplanned population names no driver');
  assert.throws(()=>writer.add({...value,budget:{...budget,phase:'execute'}} as unknown as ProgramAnswer,capture),/invalid case budget/,'a planned population names its driver');
  writer.add(value,capture);writer.publish();
  const reader=openProgramOracleResults(programOracleHandoff(f.directory),f.identity);
  for(const driver of ['d'.repeat(64),'e'.repeat(64)])assert.deepEqual(reader.calls(f.project,f.entry,driver),value);
  assert.throws(()=>reader.calls(f.project,f.entry+'.other','d'.repeat(64)),/call population changed/);
});
