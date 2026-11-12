import {testEnvironment} from "../gate/test-environment.ts";
// Shared by the oracle emit test files: their oracle test environment, the
// toolchain, and the helpers their tests call. Each file closes the
// executions its tests open (afterEach below). The tests were one file whose
// 143 tests ran one after another for 480 s; split by subject, they run
// beside each other.
import * as oracleOwner from './oracle-emit.ts';
import {oracleToolchainLocation,gateEnvironment,hostEnvironment,sealOracleRun} from "../gate/canonical-environment.ts";
import {ownMemory} from "../gate/test-memory.ts";
import {finishRunTemporary} from '../gate/run-temporary.ts';
import assert from "node:assert/strict";
import {activeCommand} from "../gate/active-command.ts";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join,relative,resolve} from "node:path";
import {before,afterEach,type TestContext} from "node:test";
import {OracleWorker,REPOSITORY,removeOracleSnapshot,prepareOracle as prepareOracleTemplate,oracleExecution as newOracleExecution,oracleLoaderReady,type OracleOptions,type OraclePrepared} from "./oracle-emit.ts";
import {readOracleSnapshotIndex,writeOracleSnapshotIndex,type HostObservation,type DirectoryEntries} from './oracle-filesystem.ts';
import {type SnapshotSlotIndex} from './oracle-runtime.ts';
import {setupOracleTestEnvironment} from './oracle-test-fixture.ts';

export type EmittedFile={path:string;text:string;sourceFileName?:string};

before(setupOracleTestEnvironment);

export const toolchain=oracleToolchainLocation();
export const executions=new Set<OraclePrepared>();
export function closeOracleExecution(prepared:OraclePrepared){const close=Reflect.get(oracleOwner,'closeOracleExecution');if(typeof close==='function')close(prepared);}
export function oracleExecution(...args:Parameters<typeof newOracleExecution>){const execution=newOracleExecution(...args);executions.add(execution);return execution;}
export async function prepareOracle(...args:Parameters<typeof prepareOracleTemplate>){return oracleExecution((await prepareOracleTemplate(...args)));}
afterEach(()=>{for(const execution of executions)closeOracleExecution(execution);executions.clear();});


export function workspace(t:TestContext,files:Record<string,string>,options:Record<string,unknown>={}) {
  const root=mkdtempSync(join(tmpdir(),"nts-oracle-emit-"));
  t.after(()=>removeOracleSnapshot(root));
  writeFileSync(join(root,"package.json"),'{"type":"module"}');
  writeFileSync(join(root,"tsconfig.json"),JSON.stringify({
    extends:join(REPOSITORY,"tsconfig.fixtures.json"),compilerOptions:{types:['node'],typeRoots:[join(REPOSITORY,'node_modules/@types')],...options},include:["src"],
  }));
  for(const [name,text] of Object.entries(files)) {
    const path=join(root,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);
  }
  return root;
}
export function execute(root:string,prepared:Pick<OraclePrepared,"args"|"env">,entry="src/main.ts") {
  return spawnSync(process.execPath,[...prepared.args,"--no-warnings",join(root,entry)],{
    encoding:"utf8",cwd:root,env:{...testEnvironment(),...prepared.env},
  });
}
export function bare(root:string,prepared:OraclePrepared,entry="src/main.ts"){
  const stored=JSON.parse(readFileSync(prepared.manifest,'utf8'));
  const output=join(dirname(prepared.manifest),stored.sources[join(root,entry)]);
  return spawnSync(process.execPath,['--enable-source-maps','--no-warnings',output],{encoding:'utf8',cwd:root,env:testEnvironment()});
}
export async function prepare(root:string,entry="src/main.ts",extra:Partial<OracleOptions>={}) {
  return (await prepareOracle({toolchain,entry:join(root,entry),directory:join(root,"scratch"),...extra}));
}

export function snapshotRecords(prepared:OraclePrepared):Map<string,unknown>{
  const directory=dirname(prepared.manifest),reference=prepared.snapshot!.index;
  const descriptorBytes=readFileSync(join(directory,reference.path));
  assert.equal(createHash('sha256').update(descriptorBytes).digest('hex'),reference.sha256);
  const descriptor=JSON.parse(descriptorBytes.toString('utf8')) as SnapshotSlotIndex;
  const table=readFileSync(join(directory,descriptor.table.path)),data=readFileSync(join(directory,descriptor.data.path));
  assert.equal(createHash('sha256').update(table).digest('hex'),descriptor.table.sha256);
  assert.equal(createHash('sha256').update(data).digest('hex'),descriptor.data.sha256);
  const checked=readOracleSnapshotIndex(directory,reference),records=new Map<string,unknown>();
  for(let slot=0;slot<descriptor.slots;slot++){
    const offset=table.readUInt32LE(slot*descriptor.slotBytes),length=table.readUInt32LE(slot*descriptor.slotBytes+4);
    if(!length)continue;
    const bucket=JSON.parse(data.subarray(offset,offset+length).toString('utf8')) as {entries:[string,unknown][]};
    for(const [key,value] of bucket.entries){assert.equal(records.has(key),false);assert.deepEqual(checked.get(key),value);records.set(key,value);}
  }
  return records;
}
/** Rebind a deliberately changed producer record, so a semantic guard reaches
 * its predicate rather than merely tripping the authenticated-byte check. */
export function changedSnapshot(prepared:OraclePrepared,change:(records:Map<string,unknown>)=>void):OraclePrepared{
  const directory=dirname(prepared.manifest),records=snapshotRecords(prepared);change(records);
  chmodSync(join(directory,'runtime-index'),0o700);
  const index=writeOracleSnapshotIndex(directory,records);chmodSync(join(directory,'runtime-index'),0o500);
  const manifest=JSON.parse(readFileSync(prepared.manifest,'utf8'));manifest.runtimeIndex=index;
  const bytes=JSON.stringify(manifest)+'\n';writeFileSync(prepared.manifest,bytes);
  const snapshot={...prepared.snapshot!,index,manifestSha256:createHash('sha256').update(bytes).digest('hex')};
  return {...prepared,snapshot,env:{...prepared.env,NTS_ORACLE_SNAPSHOT:JSON.stringify(snapshot)}};
}
export function witnessOwner(root:string,entry:string){
  const project=join(root,'witness.tsconfig.json');
  writeFileSync(project,JSON.stringify({extends:join(REPOSITORY,'tsconfig.fixtures.json'),compilerOptions:{allowJs:true,checkJs:false,types:[]},files:[relative(root,entry)],include:[]})+'\n');
  return {entry,project};
}
export function ordinaryProject(root:string,files:string[],name='tsconfig.json') {
  const file=join(root,name),config=name==='tsconfig.json'?JSON.parse(readFileSync(file,'utf8')):{extends:join(root,'tsconfig.json')};
  writeFileSync(file,JSON.stringify({...config,files,include:[]}));return file;
}

export function diagnostics(text:string,cwd:string){
    try{const record=JSON.parse(text);if(record?.version===1&&'emitSkipped' in record)text=record.diagnostics||record.instrument||text;}catch{}
    const result:unknown[]=[];
    for(const line of text.split(/\r?\n/)){
      const at=/^(.*?)\((\d+),(\d+)\): (error TS\d+:.*)$/.exec(line);
      if(at)result.push({file:resolve(cwd,at[1]!),line:Number(at[2]),column:Number(at[3]),message:at[4]});
      else if(/^error TS\d+:/.test(line)||/^\s+\S/.test(line))result.push(line);
    }
    return result;
}

export async function boundedCompiler(compiler:string,args:string[],cwd:string){
  const run=await activeCommand(compiler,args,{cwd,env:testEnvironment(),idleMs:120_000,cpuBudgetSeconds:120,maxBuffer:32*2**20});
  if(run.error||run.signal||run.hung||run.runaway)throw Error('oracle batch not measured: '+(run.signal??run.hung??run.runaway??run.error));
  return run;
}


export function authoredExecution(prepared:OraclePrepared,entry:string){
  const execution=oracleExecution(prepared),manifest=readFileSync(prepared.manifest);
  writeFileSync(join(dirname(execution.loaderState),'plain-node-inputs.json'),JSON.stringify({version:1,manifestSha256:createHash('sha256').update(manifest).digest('hex'),inputs:[{path:entry,sha256:createHash('sha256').update(readFileSync(entry)).digest('hex')}]})+'\n',{flag:'wx'});
  return execution;
}

export type OwnerObservationRecord={observations:HostObservation[];proof:{beforeFiles:string[];beforeEdges:{file:string;imports:{resolved:{resolvedFileName:string}|null}[]}[]}};
export type OwnerObservationCall={project:string;directory:string;mode:'emit'|'hit'|'held';inputsSha256:string};

export async function ownerObservationInvalidation(t:TestContext,kind:'listing'|'failed-lookup'){
  const outside=mkdtempSync(join(tmpdir(),'nts-owner-observation-'));
  const root=workspace(t,{'src/main.ts':'console.log(19);\n'},{types:[],typeRoots:[]});
  const candidate=join(outside,'negative','candidate.d.ts');
  if(kind==='failed-lookup'){
    const fallback=join(outside,'negative','candidate','index.d.ts');
    mkdirSync(dirname(fallback),{recursive:true});writeFileSync(fallback,'export type Marker=number;\n');
    const specifier=relative(join(root,'src'),join(outside,'negative','candidate')).replaceAll('\\','/');
    writeFileSync(join(root,'src/main.ts'),`import type {Marker} from ${JSON.stringify(specifier)};const value:Marker=19;console.log(value);\n`);
    ordinaryProject(root,['src/main.ts']);
  }
  const planned=await sealOracleRun(gateEnvironment(hostEnvironment(process.env),{run:join(outside,'registered'),oracleAdmissionContext:'gate',owned:ownMemory(join(outside,'memory'))}));
  const keys=['NTS_ORACLE_DEPENDENCIES','NTS_GATE_ENV_CONTEXT'] as const,previous=keys.map(key=>process.env[key]);
  const cap=JSON.parse(planned.env.NTS_ORACLE_DEPENDENCIES!),records:OwnerObservationRecord[]=[];let green=false;
  try{
    for(const key of keys)process.env[key]=planned.env[key];
    for(let index=0;index<3;index++){
      if(index===2){
        if(kind==='listing')writeFileSync(join(root,'src','appeared.txt'),'a directory observation, not a TypeScript input\n');
        else writeFileSync(candidate,'export type Marker=number;\n');
      }
      const directory=join(outside,'worker-'+index),worker=new OracleWorker(directory,toolchain);
      try{
        const context=JSON.parse(readFileSync(join(directory,'owner-cache.json'),'utf8'));assert.equal(context.shared,true);
        const prepared=oracleExecution((await worker.prepare({entry:join(root,'src/main.ts'),directory:join(outside,'output-'+index)})));
        try{
          const run=execute(root,prepared);assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'19\n');
          assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
          const calls=readFileSync(join(cap.directory,'oracle-owner-calls.jsonl'),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line) as OwnerObservationCall).filter(row=>row.project===join(root,'tsconfig.json'));
          const last=calls.at(-1);assert.ok(last);records.push(JSON.parse(readFileSync(join(last.directory,last.inputsSha256+'.json'),'utf8')));
        }finally{closeOracleExecution(prepared);}
      }finally{worker.close();}
    }
    const calls=readFileSync(join(cap.directory,'oracle-owner-calls.jsonl'),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line) as OwnerObservationCall).filter(row=>row.project===join(root,'tsconfig.json'));
    assert.deepEqual(calls.map(row=>row.mode),['emit','hit','emit']);
    assert.equal(calls[0]!.inputsSha256,calls[1]!.inputsSha256);assert.notEqual(calls[1]!.inputsSha256,calls[2]!.inputsSha256);
    const fact=(record:OwnerObservationRecord,kind:HostObservation['kind'],path:string)=>record.observations.find(row=>row.kind===kind&&row.path===path);
    if(kind==='listing'){
      const before=fact(records[0]!,'entries',join(root,'src')),after=fact(records[2]!,'entries',join(root,'src'));
      assert.ok(before&&after);assert.equal((before.value as DirectoryEntries).files.includes('appeared.txt'),false);assert.equal((after.value as DirectoryEntries).files.includes('appeared.txt'),true);
      assert.deepEqual(records[0]!.proof.beforeFiles,records[2]!.proof.beforeFiles,'only the consulted listing changes, not the program inputs');
    }else{
      assert.equal(fact(records[0]!,'fileExists',candidate)?.value,false,'the original checker really tried this missing module');
      assert.equal(fact(records[2]!,'fileExists',candidate)?.value,true);
      const entries=(record:OwnerObservationRecord)=>record.observations.filter(row=>row.kind==='entries');
      assert.deepEqual(entries(records[0]!),entries(records[2]!),'failed lookup invalidation is independent of directory listings');
      const target=(record:OwnerObservationRecord)=>record.proof.beforeEdges.find(row=>row.file===join(root,'src/main.ts'))!.imports[0]!.resolved!.resolvedFileName;
      assert.equal(target(records[0]!),join(outside,'negative','candidate','index.d.ts'));assert.equal(target(records[2]!),candidate);
    }
    t.diagnostic(JSON.stringify({kind,owner:join(root,'tsconfig.json'),calls,observations:records.map(record=>record.observations)}));green=true;
  }finally{
    for(const [index,key] of keys.entries())if(previous[index]===undefined)delete process.env[key];else process.env[key]=previous[index];
    finishRunTemporary(planned.temporary,planned.env.HOME!,green);if(green)removeOracleSnapshot(outside);
  }
}
