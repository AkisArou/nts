// The TypeScript conformance suite's selection and oracle:
//
//   node --test tooling/census/typescript-suite.test.ts
//
// The oracle is what keeps a wrong case out of the suite, so it is held to
// both answers: a right case passes it, and a case whose expectation is wrong
// does not -- whatever nts would make of either.
import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync} from "node:fs";

import {extname, join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {API} from 'typescript/sync';
import {isEnumDeclaration, isImportEqualsDeclaration, SyntaxKind} from 'typescript/ast';

import {oracle, selectTypescript, materialiseTypeScriptOracleProject} from "./suites/typescript.ts";
import {newTestScratch} from "../gate/test-scratch.ts";
import {workspace} from "./project.ts";
import {OracleWorker, removeOracleSnapshot} from "../differential/oracle-emit.ts";
import {oracleToolchainLocation} from "../gate/canonical-environment.ts";
import {createTypeScriptOracleResults, openTypeScriptOracleResults, typeScriptOracleHandoff, oracleResultHash} from "./typescript-oracle-results.ts";
import type { TypeScriptOracleCapture } from './typescript-oracle-capture.ts';

import {setupOracleTestEnvironment} from "../differential/oracle-test-fixture.ts";
await setupOracleTestEnvironment();

const scratch = () => {
  return newTestScratch("typescript-suite");
};

function nodeTypes(dir:string) {
  const root=fileURLToPath(new URL('../../',import.meta.url));
  writeFileSync(join(dir,'tsconfig.json'),JSON.stringify({extends:join(root,'tsconfig.fixtures.json'),
    compilerOptions:{types:['node'],typeRoots:[join(root,'node_modules/@types')]},files:['oracle.ts'],include:[]}));
}

const RIGHT = `/*---
description: right
features: [ts-enum]
---*/
enum Color { Red, Green }
assert.sameValue(Color.Green, 1);
`;

const WRONG = `/*---
description: wrong
features: [ts-enum]
---*/
enum Color { Red, Green }
assert.sameValue(Color.Green, 2);
`;

test('a shared reference releases executable snapshots without creating Programs',async()=>{
  const root=scratch(),inputs=join(root,'inputs'),producer=join(root,'producer'),results=join(root,'results'),dir=workspace(join(root,'case'),'ts');
  mkdirSync(results);mkdirSync(inputs);
  const sources=[RIGHT,WRONG],projects=sources.map((source,index)=>{
    const project=join(inputs,String(index));materialiseTypeScriptOracleProject(source,project);return project;
  });
  const worker=new OracleWorker(producer,oracleToolchainLocation()),identity='a'.repeat(64),writer=createTypeScriptOracleResults(results,identity);
  try{
    for(const [index,source] of sources.entries()){
      let capture:TypeScriptOracleCapture|undefined,printed={stdout:'',stderr:''};
      const output=join(root,'snapshot');
      const verdict=await oracle(source,dir,(stdout,stderr)=>{printed={stdout,stderr};},worker,
        {projectDirectory:projects[index]!,outputDirectory:output,record:value=>{capture=value;}});
      assert.equal(verdict.ok,index===0,JSON.stringify(verdict));assert.ok(capture);
      assert.equal(existsSync(output),false,'the executable snapshot is gone before another case starts');
      const cache=JSON.parse(readFileSync(join(producer,'owner-cache.json'),'utf8')).directory;
      const owner=oracleResultHash(JSON.stringify([join(projects[index]!,'tsconfig.json'),worker.identity,process.versions.node]));
      assert.equal(existsSync(join(cache,'programs',owner)),false,'transpileModule creates no checked-Program cache entry for this case');
      writer.add({version:1,path:String(index),sourceSha256:oracleResultHash(source),verdict,printed,observations:capture.observations,
        ...(capture.dependencyObservations?{dependencyObservations:capture.dependencyObservations}:{})},capture.session);
    }
    writer.publish();
    const reader=openTypeScriptOracleResults(typeScriptOracleHandoff(results),identity);
    assert.equal(reader.get('0',oracleResultHash(RIGHT)).verdict.ok,true,'later cases and cleanup leave the first proof valid');
    assert.equal(reader.get('1',oracleResultHash(WRONG)).verdict.ok,false);
    writeFileSync(join(projects[0]!,'oracle.ts'),'changed');
    assert.throws(()=>reader.get('0',oracleResultHash(RIGHT)),/filesystem file changed/);
  }finally{worker.close();removeOracleSnapshot(root);}
});

test('an admitted worker releases each source snapshot before its next case',async()=>{
  const root=scratch(),dir=workspace(join(root,'case'),'ts');
  const worker=new OracleWorker(join(root,'producer'),oracleToolchainLocation());
  try{
    for(let index=0;index<8;index++){
      const source=index===3?WRONG:RIGHT;
      const result=await oracle(source,dir,undefined,worker);
      assert.equal(result.ok,index!==3,JSON.stringify(result));
      assert.equal(existsSync(join(dir,'oracle-project')),false,'the finalized case must release its snapshot before another is dispatched');
      assert.equal(readdirSync(dir).some(name=>name.startsWith('oracle-project-')),false,'a resident worker must not accumulate one project per case');
    }
    const cache=JSON.parse(readFileSync(join(root,'producer/owner-cache.json'),'utf8')).directory;
    const owner=oracleResultHash(JSON.stringify([join(dir,'oracle-project/tsconfig.json'),worker.identity,process.versions.node]));
    assert.equal(existsSync(join(cache,'programs',owner)),false,'the syntax-only case never creates a checked-Program proof');
  }finally{worker.close();removeOracleSnapshot(root);}
});

test("the oracle admits a case node passes", async () => {
  const dir = scratch();
  try {
    assert.deepEqual((await oracle(RIGHT, dir)), { ok: true });
  } finally {
    removeOracleSnapshot(dir);
  }
});

test("the current case owns its program roots in an empty or reused workspace",async ()=>{
  const dir=scratch();
  try{
    workspace(dir,'ts');
    assert.deepEqual((await oracle(RIGHT,dir)),{ok:true});
    writeFileSync(join(dir,'src/main.ts'),'declare const enum Stale { Value=7 }\n');
    const leaked=(await oracle('declare const Stale:{Value:number}; assert.sameValue(Stale.Value,7);',dir));
    assert.equal(leaked.ok,false);
    if(!leaked.ok)assert.match(leaked.rejection?.error??'',/Stale is not defined/);
    const ambient=await oracle('declare const enum Stale { Value=7 } assert.sameValue(Stale.Value,7);',dir);
    assert.equal(ambient.ok,false,'an erased ambient declaration supplies no runtime value');
    if(!ambient.ok)assert.match(ambient.rejection?.error??'',/ReferenceError.*Stale/);
  }finally{removeOracleSnapshot(dir);}
});

test('type checking does not decide whether Node executes a case',async()=>{
  const root=scratch();
  try{assert.deepEqual(await oracle('const value:number="runtime"; assert.sameValue(value,"runtime");',root),{ok:true});}
  finally{removeOracleSnapshot(root);}
});

test('syntax-only cases retain unknown-domain holds',async()=>{
  const root=scratch(),outside=join(root,'outside.mjs');writeFileSync(outside,'export const value=19;\n');
  try{
    const result=await oracle('const request:string='+JSON.stringify(pathToFileURL(outside).href)+'; await import(request);',root);
    assert.equal(result.ok,false);if(!result.ok){assert.equal(result.rejection,undefined);assert.match(result.why,/not captured|outside|unobserved/);}
  }finally{removeOracleSnapshot(root);}
});

test('the corpus const enums and namespace aliases use the same syntax-only producer',async()=>{
  const root=fileURLToPath(new URL('../../',import.meta.url)),directory=scratch();
  const parser=new API({cwd:root,runExternalCode:false}),worker=new OracleWorker(join(directory,'producer'),oracleToolchainLocation());
  let checked=0;
  try{
    for(const item of selectTypescript(root,'tests/typescript')){
      const source=readFileSync(join(root,item.path),'utf8'),lease=parser.createSourceFile(join(root,item.path),source);
      let sensitive=false;
      try{
        const visit=(node:import('typescript/ast').Node):void=>{
          if(isImportEqualsDeclaration(node)||isEnumDeclaration(node)&&(node.modifiers??[]).some(modifier=>modifier.kind===SyntaxKind.ConstKeyword))sensitive=true;
          node.forEachChild(visit);
        };visit(lease.sourceFile);
      }finally{lease.dispose();}
      if(!sensitive)continue;
      let printed={stdout:'',stderr:''};
      assert.deepEqual(await oracle(source,directory,(stdout,stderr)=>{printed={stdout,stderr};},worker),{ok:true},item.path);
      assert.deepEqual(printed,{stdout:'',stderr:''},item.path);checked++;
    }
    assert.ok(checked>0,'the syntax-only producer guard reaches real corpus constructs');
  }finally{parser.close();worker.close();removeOracleSnapshot(directory);}
});

test("the oracle refuses a case whose expectation is wrong, naming what node said", async () => {
  const dir = scratch();
  try {
    const verdict = (await oracle(WRONG, dir));
    assert.equal(verdict.ok, false);
    assert.match(verdict.ok ? "" : verdict.why, /Test262Error|Expected/);
    assert.ok(!verdict.ok&&verdict.rejection?.exit===1);
  } finally {
    removeOracleSnapshot(dir);
  }
});

test("a missing async completion and a signal remain unmeasured",async ()=>{
  const dir=scratch();
  try{
    nodeTypes(dir);
    const pending=(await oracle('/*---\nflags: [async]\n---*/\nvoid 0;',dir));
    assert.equal(pending.ok,false);if(!pending.ok){assert.match(pending.why,/never called/);assert.equal(pending.rejection,undefined);}
    const stopped=(await oracle('process.kill(process.pid,"SIGTERM");',dir));
    assert.equal(stopped.ok,false);if(!stopped.ok){assert.match(stopped.why,/SIGTERM/);assert.equal(stopped.rejection,undefined);}
  }finally{removeOracleSnapshot(dir);}
});

test("a completed async failure records rejection even when node exits zero",async ()=>{
  const dir=scratch();
  try{
    const verdict=(await oracle('/*---\nflags: [async]\n---*/\n$DONE(new Error("wrong"));',dir));
    assert.equal(verdict.ok,false);
    if(!verdict.ok){assert.equal(verdict.rejection?.exit,0);assert.match(verdict.rejection?.error??'',/Test262:AsyncTestFailure/);}
  }finally{removeOracleSnapshot(dir);}
});

test("invalid loader status cannot become a completed case rejection",async ()=>{
  const dir=scratch();
  try{
    nodeTypes(dir);
    const verdict=(await oracle('import {writeFileSync} from "node:fs"; writeFileSync(process.env.NTS_ORACLE_EMIT_STATUS!,"invalid"); throw new Error("wrong");',dir));
    assert.equal(verdict.ok,false);if(!verdict.ok){assert.equal(verdict.rejection,undefined);assert.match(verdict.why,/loader did not complete/);}
  }finally{removeOracleSnapshot(dir);}
});

test("the selection reads every case under a directory, with its features, sorted", () => {
  const root = scratch();
  try {
    mkdirSync(join(root, "tests/typescript/b"), { recursive: true });
    mkdirSync(join(root, "tests/typescript/a"), { recursive: true });
    writeFileSync(join(root, "tests/typescript/b/one.ts"), RIGHT);
    writeFileSync(join(root, "tests/typescript/a/two.ts"), WRONG.replace("[ts-enum]", "[ts-enum, ts-namespace]"));
    writeFileSync(join(root, "tests/typescript/a/notes.md"), "not a case");
    const selected = selectTypescript(root, "tests/typescript");
    assert.deepEqual(
      selected.map((record) => [record.path, record.features]),
      [
        ["tests/typescript/a/two.ts", ["ts-enum", "ts-namespace"]],
        ["tests/typescript/b/one.ts", ["ts-enum"]],
      ],
    );
    assert.equal(selected[0].variant_id, "tests/typescript/a/two.ts#strict");
  } finally {
    removeOracleSnapshot(root);
  }
});

test("the TypeScript oracle preserves its authored extension and ESM goal", async () => {
  const root = scratch();
  try {
    const cases = join(root, "tests/typescript");
    const execution = join(root, "execution");
    mkdirSync(cases, {recursive: true});
    mkdirSync(execution);
    const source = RIGHT + "\nassert.sameValue(this === undefined, true);\n";
    writeFileSync(join(cases, "control.ts"), source);
    const selected = selectTypescript(root, "tests/typescript");
    assert.equal(selected.length, 1);
    assert.deepEqual((await oracle(source, execution)), {ok: true});
    const projects = readdirSync(execution).filter(name => name.startsWith("oracle-project-"));
    assert.equal(projects.length, 1, "one invocation owns exactly one isolated source project");
    const project = join(execution, projects[0]!);
    const entries = readdirSync(project).filter(name => /^oracle\.(?:ts|mts|cts|tsx)$/.test(name));
    assert.equal(entries.length, 1);
    assert.equal(extname(entries[0]!), extname(selected[0]!.path), "the oracle must not change the authored grammar");
    assert.equal(JSON.parse(readFileSync(join(project, "package.json"), "utf8")).type, "module");
    assert.match(readFileSync(join(project, entries[0]!), "utf8"), /export \{\};\s*$/);
  } finally { removeOracleSnapshot(root); }
});
