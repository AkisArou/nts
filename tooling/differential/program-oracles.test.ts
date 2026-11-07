import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {test} from 'node:test';
import {REPOSITORY,verifyToolchain,oracleRecipeIdentity,removeOracleSnapshot} from './oracle-emit.ts';
import * as producer from './program-oracles.ts';
import {PROGRAM_EMIT_PROJECTS,produceProgramOracles,programOracleDirectory,type ProgramOracleTask} from './program-oracles.ts';
import {openProgramOracleResults,programOracleHandoff} from './oracle-results.ts';
import {setupOracleTestEnvironment} from './oracle-test-fixture.ts';
import {readRecords,fixtureOf} from './oracle-records.ts';
import {oracleToolchainLocation} from '../gate/canonical-environment.ts';

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

test('program consumers read completed answers after the SDK workers drain',async t=>{
  await setupOracleTestEnvironment();
  const root=mkdtempSync(join(tmpdir(),'program-producer-'));t.after(()=>removeOracleSnapshot(root));
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
  await produceProgramOracles({jobs:1,tasks});
  const handoff=programOracleHandoff(join(programOracleDirectory(),'results'));
  const reader=openProgramOracleResults(handoff,oracleRecipeIdentity()),answer=reader.get(tasks[0]!.subject);
  assert.equal(answer.kind,'calls');if(answer.kind!=='calls')throw Error('missing calls');
  assert.ok(answer.count>1);assert.equal(answer.rows.length,answer.count);assert.ok(answer.replay);
  const observation=reader.get(tasks[1]!.subject);assert.equal(observation.kind,'observation');
  if(observation.kind!=='observation')throw Error('missing observation');
  assert.equal(observation.observation.result,'exit 0');assert.equal(observation.observation.printed.stdout,'23\n');
  const binary=process.env.NTS_BIN??join(REPOSITORY,'target/release/nts');
  const ran=spawnSync(binary,['check',tasks[0]!.project],{encoding:'utf8',maxBuffer:8*1024**2,
    env:{...process.env,NTS_PROGRAM_ORACLE:JSON.stringify(handoff),NTS_ORACLE_TYPESCRIPT:join(root,'there-is-no-sdk-here'),NODE_OPTIONS:'--no-experimental-strip-types',NTS_BACKEND:'c'}});
  assert.equal(ran.status,0,ran.stdout+ran.stderr);
  assert.match(ran.stdout,/agreed on/);
  writeFileSync(join(source,'main.ts'),'export function answer(x:number):number{return x+23;}\n');
  assert.throws(()=>reader.get(tasks[0]!.subject),/filesystem .* changed/);
});


test('the generated JVM sweep is a producer-owned program with unchanged source',t=>{
  const root=mkdtempSync(join(tmpdir(),'program-sweep-'));t.after(()=>removeOracleSnapshot(root));
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
