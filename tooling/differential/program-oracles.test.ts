import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,symlinkSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {test} from 'node:test';
import {REPOSITORY,verifyToolchain,oracleRecipeIdentity,removeOracleSnapshot} from './oracle-emit.ts';
import * as producer from './program-oracles.ts';
import {PROGRAM_EMIT_PROJECTS,produceProgramOracles,type ProgramOracleTask} from './program-oracles.ts';
import {openProgramOracleResults,programOracleHandoff} from './oracle-results.ts';
import {setupOracleTestEnvironment} from './oracle-test-fixture.ts';
import {readRecords,fixtureOf} from './oracle-records.ts';
import {oracleToolchainLocation} from '../gate/canonical-environment.ts';
import {newTestScratch} from '../gate/test-scratch.ts';

test('the measured example corpus names every type-directed emit project',()=>{
  const location=oracleToolchainLocation(),{compiler}=verifyToolchain(location),require=createRequire(join(location,'package.json'));
  const {API}:typeof import('typescript/sync')=require('typescript/sync'),ast:typeof import('typescript/ast')=require('typescript/ast');
  const api=new API({cwd:REPOSITORY,tsserverPath:compiler}),needed=new Set<string>();
  try{
    const projects=new Set(readRecords(REPOSITORY).rows.filter(row=>row.kind==='measured'&&!!row.count&&row.source.startsWith('tests/programs/')).map(row=>fixtureOf(row.source)));
    for(const project of projects){
      const parsed=api.parseConfigFile(join(REPOSITORY,project,'tsconfig.json'));
      assert.equal(parsed.errors.length,0,project);
      if(parsed.options.emitDecoratorMetadata)needed.add(project.split('/').at(-1)!);
      for(const file of parsed.fileNames){
        if(/\.d\.[cm]?ts$/.test(file))continue;
        const lease=api.createSourceFile(file,readFileSync(file,'utf8'));
        try{
          const visit=(node:import('typescript/ast').Node):void=>{
            if(ast.isEnumDeclaration(node)&&node.modifiers?.some(modifier=>modifier.kind===ast.SyntaxKind.ConstKeyword))needed.add(project.split('/').at(-1)!);
            node.forEachChild(visit);
          };
          visit(lease.sourceFile);
        }finally{lease.dispose();}
      }
    }
    assert.deepEqual([...needed].sort(),[...PROGRAM_EMIT_PROJECTS].sort(),'a new type-directed project must be named before the standalone path can run it');
  }finally{api.close();}
});

test('program consumers read completed answers from an nts-dev planner after the SDK workers drain',async t=>{
  await setupOracleTestEnvironment();
  const root=newTestScratch('program-producer');t.after(()=>removeOracleSnapshot(root));
  const project=join(root,'input'),source=join(project,'src');mkdirSync(source,{recursive:true});
  writeFileSync(join(project,'package.json'),'{"type":"module"}');
  writeFileSync(join(project,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ESNext',module:'ESNext',moduleResolution:'Bundler',rootDir:'src',strict:true},include:['src']}));
  writeFileSync(join(source,'main.ts'),'export function answer(x:number):number{return x+19;}\n');
  const observed=join(root,'observation'),observedSources=join(observed,'src');mkdirSync(observedSources,{recursive:true});
  writeFileSync(join(observed,'package.json'),'{"type":"module"}');
  writeFileSync(join(observed,'tsconfig.json'),readFileSync(join(project,'tsconfig.json')));
  writeFileSync(join(observedSources,'value.mjs'),'export const value=23;\n');
  writeFileSync(join(observedSources,'main.ts'),"import {value} from './value.mjs';console.log(value);\n");
  const tasks:ProgramOracleTask[]=[{subject:'tests/programs/private-producer',project:join(project,'tsconfig.json'),entry:join(source,'main.ts'),mode:'calls',program:false,observations:[]},
    {subject:'tests/outcomes/private-producer',project:join(observed,'tsconfig.json'),entry:join(observedSources,'main.ts'),mode:'observation',program:false,observations:[]}];
  const binary=resolve(process.env.NTS_BIN??join(REPOSITORY,'target/release/nts'));
  const profile=join(root,'target/nts-dev'),calls=join(root,'planner-calls');mkdirSync(profile,{recursive:true});
  symlinkSync(binary,join(profile,'nts'));
  const planner=join(profile,'oracle-plan');
  writeFileSync(planner,`#!/usr/bin/env node
import {appendFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
appendFileSync(${JSON.stringify(calls)},process.argv[1]+'\\n');
const result=spawnSync(${JSON.stringify(join(dirname(binary),'oracle-plan'))},process.argv.slice(2),{stdio:'inherit'});
process.exitCode=result.status??1;
`,{mode:0o755});
  await assert.rejects(Reflect.apply(produceProgramOracles,undefined,[{jobs:1,tasks}]),/publication requires an explicit absolute root/);
  const stepPublication=join(root,'step-publication'),fixturePublication=join(root,'fixture-publication');
  const launch=`import {produceProgramOracles} from ${JSON.stringify(new URL('./program-oracles.ts',import.meta.url).href)};
await produceProgramOracles({directory:process.argv[1],jobs:1,tasks:JSON.parse(process.argv[2])});`;
  // Both producers inherit the exact same TMPDIR and run capability. The
  // completed step publication remains present when the fixture publishes.
  for(const directory of [stepPublication,fixturePublication]){
    const produced=spawnSync(process.execPath,['--input-type=module','-e',launch,directory,JSON.stringify(tasks)],
      {encoding:'utf8',maxBuffer:8*1024**2,env:{...process.env,NTS_BIN:join(profile,'nts')}});
    assert.equal(produced.status,0,produced.stdout+produced.stderr);
    assert.equal(openProgramOracleResults(programOracleHandoff(join(directory,'results')),oracleRecipeIdentity()).get(tasks[0]!.subject).kind,'calls');
  }
  assert.deepEqual(readFileSync(calls,'utf8').trim().split('\n'),[planner,planner,planner,planner]);
  const handoff=programOracleHandoff(join(fixturePublication,'results'));
  const reader=openProgramOracleResults(handoff,oracleRecipeIdentity()),answer=reader.get(tasks[0]!.subject);
  assert.equal(answer.kind,'calls');if(answer.kind!=='calls')throw Error('missing calls');
  assert.ok(answer.count>1);assert.equal(answer.rows.length,answer.count);assert.ok(answer.replay);
  const observation=reader.get(tasks[1]!.subject);assert.equal(observation.kind,'observation');
  if(observation.kind!=='observation')throw Error('missing observation');
  assert.equal(observation.observation.result,'exit 0');assert.equal(observation.observation.printed.stdout,'23\n');
  const ran=spawnSync(binary,['check',tasks[0]!.project],{encoding:'utf8',maxBuffer:8*1024**2,
    env:{...process.env,NTS_PROGRAM_ORACLE:JSON.stringify(handoff),NTS_ORACLE_TYPESCRIPT:join(root,'there-is-no-sdk-here'),NODE_OPTIONS:'--no-experimental-strip-types',NTS_BACKEND:'c'}});
  assert.equal(ran.status,0,ran.stdout+ran.stderr);
  assert.match(ran.stdout,/agreed on/);
  writeFileSync(join(source,'main.ts'),'export function answer(x:number):number{return x+23;}\n');
  assert.throws(()=>reader.get(tasks[0]!.subject),/filesystem .* changed/);
});


test('the generated JVM sweep is a producer-owned program with unchanged source',t=>{
  const root=newTestScratch('program-sweep');t.after(()=>removeOracleSnapshot(root));
  const api=producer as typeof producer & {sweepOracleTask?:(directory:string)=>ProgramOracleTask};
  assert.equal(typeof api.sweepOracleTask,'function','the generated JVM control must join the producer population');
  const task=api.sweepOracleTask!(root);
  const plain=spawnSync(process.execPath,[join(REPOSITORY,'tooling/sweep/sweep.mjs')],{encoding:'utf8'});
  assert.equal(plain.status,0,plain.stderr);
  assert.equal(task.subject,'gate/jvm-sweep');assert.equal(task.mode,'calls');assert.equal(task.program,false);
  assert.equal(readFileSync(task.entry,'utf8'),plain.stdout);
  assert.equal(JSON.parse(readFileSync(task.project,'utf8')).extends,join(REPOSITORY,'tsconfig.fixtures.json'));
  assert.equal(readFileSync(join(task.project,'../package.json'),'utf8'),readFileSync(join(REPOSITORY,'package.json'),'utf8'));
  assert.ok(task.observations.some(row=>row.kind==='file'&&row.path===join(REPOSITORY,'tooling/sweep/sweep.mjs')));
});
