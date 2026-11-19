import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {gitArguments} from '../gate/git-arguments/main.ts';
import {fixtureEnvironment} from '../gate/test-environment.ts';
import {fileURLToPath} from 'node:url';
import {fileInput} from '../gate/reader-inputs/main.ts';
import {refreshLine,listedIn} from './pending.ts';
import {testScratch} from '../gate/test-scratch.ts';
import {censusCompiler,censusInventory,censusInputScope,acceptedCensusRecords,memoryPrograms,censusIdentities,censusRecord,checkMemoryCensuses,parseCensusRecord,validateCensus,censusSourceKey,CENSUS_RECORD_VERSION,CENSUS_STORE,CENSUS_WIRE_KINDS} from './memory-census.ts';
import {memoryCensusFamily} from './memory-census-record-family.ts';
import {createRecorder} from './recorder-core.ts';
import {projectInputOwner} from '../gate/project-inputs.ts';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const observation=()=>({preparation:'preparation: backend=c provider=ReferenceCounting',sources:[],uncompiled_functions:0,census:{schema:1,failure:null,sites:[],by_home:[],by_reason:[]}});
function fixture(t:Parameters<typeof testScratch>[0]){
 const root=testScratch(t,'memory-census');
 const put=(name:string,text:string)=>{const file=join(root,name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);};
 put('docs/foundations/memory.md','## Rows\n### memory\n- `tree-teardown`\n- `cyclic-churn`\n');
 put('tsconfig.fixtures.json',JSON.stringify({compilerOptions:{target:'ESNext',module:'ESNext',moduleResolution:'bundler',noLib:true,types:[]}}));
 for(const name of ['tree-teardown','cyclic-churn'])put(`benchmarks/cases/${name}/case.ts`,'import {value} from "../../common/shared.ts"; import {external} from "../../../outside/value.ts"; export function run(){return value+external}');
 put('benchmarks/common/shared.ts','export const value=1');put('compiler/core/src/hir/memory/census.rs','producer');put('outside/value.ts','export const external=1');put('tooling/records/memory-census.ts','recipe');
 const row=(name:string)=>{const measured=observation();return {version:CENSUS_RECORD_VERSION,program:name,identity:censusIdentities(root,[name]).get(name)!,compiler_commit:'c'.repeat(40),compiler_sha256:'a'.repeat(64),observation_sha256:hash(measured),observation:measured};};
 return {root,put,row};
}
test('missing observations are pending; source and producer changes re-request them; malformed and foreign stay red',t=>{
 const {root,put,row}=fixture(t),lines:string[]=[];
 assert.deepEqual(memoryPrograms(root),['cyclic-churn','tree-teardown']);
 assert.deepEqual(checkMemoryCensuses(root,line=>lines.push(line)),memoryPrograms(root));assert.equal(lines.length,2);
 const measured=row('tree-teardown');const reordered={...measured,identity:{version:measured.identity.version,producer:measured.identity.producer,recipe:measured.identity.recipe,source:measured.identity.source}};assert.deepEqual(parseCensusRecord(reordered,'tree-teardown'),measured);put(censusRecord('tree-teardown'),JSON.stringify(measured));
 assert.deepEqual(checkMemoryCensuses(root,()=>{}),['cyclic-churn']);
 const accepted=new Map([['tree-teardown',hash(parseCensusRecord(measured,'tree-teardown'))]]);
 put('benchmarks/common/shared.ts','export const value=2');assert.deepEqual(checkMemoryCensuses(root,()=>{},{accepted}),memoryPrograms(root));put('compiler/core/src/hir/memory/census.rs','new producer');assert.deepEqual(checkMemoryCensuses(root,()=>{},{accepted}),memoryPrograms(root));
 put(censusRecord('tree-teardown'),JSON.stringify({...measured,program:'cyclic-churn'}));assert.throws(()=>checkMemoryCensuses(root,()=>{}),/foreign/);
 const outside=join(root,CENSUS_STORE,'outside-group.json');writeFileSync(outside,JSON.stringify({...measured,program:'outside-group'}));
 assert.throws(()=>checkMemoryCensuses(root,()=>{},{accepted}),/foreign memory census record: outside-group\.json/,'a record for a program outside the memory group stays red');rmSync(outside);
 put(censusRecord('tree-teardown'),JSON.stringify({...measured,observation:observation(),observation_sha256:'b'.repeat(64)}));assert.throws(()=>checkMemoryCensuses(root,()=>{}),/forged/);
 const forged=observation();forged.census.by_home.push({kind:'heap',sites:1,contexts:1} as never);assert.throws(()=>validateCensus(forged),/forged/);
});
test('one record per requested case, deterministic whole-file delta and apply rejects changed inputs',async t=>{
 const {root,put,row}=fixture(t),recorder=createRecorder({memory:{family:memoryCensusFamily,steps:['records'],part:'core'}});
 const name='tree-teardown',file=censusRecord(name),body=JSON.stringify(row(name));
 const pending=recorder.findPending(root,'memory');assert.equal(recorder.recorderRuns('memory',pending).length,2);
 assert.equal(recorder.auditRecord('memory',file,null,body,new Set([name]),root).length,1);
 assert.throws(()=>recorder.auditRecord('memory',file,null,body,new Set(),root),/not requested/);
 const delta={version:1 as const,commit:null,headers:{},rows:[{kind:'memory',record:file,case:name,key:name,before:null,after:body,sources:censusSourceKey(root,name)}]};
 const result=await recorder.applyDelta(root,delta);assert.equal(result.applied,1);assert.equal(readFileSync(join(root,file),'utf8'),body);
 assert.deepEqual(parseCensusRecord(JSON.parse(body),name),row(name));
 put('outside/value.ts','export const external=2');
 const stale=await recorder.applyDelta(root,{...delta,rows:delta.rows.map(row=>({...row,before:body,after:body+'\n'}))});assert.equal(stale.applied,0);
});

test('context rows retain all homes, overlapping reasons and exact byte bounds; inconsistent sites are rejected',()=>{
 const location={file:0,start:1,end:2},origin={location,scope:null,inline_chain:[],async_parent:null,generated:null};
 const context=(id:number,home:string)=>({id,context:'root-'+id,home,owner:home==='region'?'caller':null,reason:home==='heap'?{kind:'repeated_instances',detail:null}:null,obligations:home==='heap'?[{kind:'repeated_instances',detail:null},{kind:'storage_bound_unproved',detail:null}]:[],multiplicity:{kind:'one',limit:1,witness:'proof'},retention_frontier:'frame root',bytes_held_to_frontier:{kind:'unknown',bytes:null,witness:'unsealed'}});
 const value={...observation(),sources:[{id:0,uri:'nts-workspace:///fixture.ts',digest:Array(16).fill(0)}],census:{schema:1,failure:null,sites:[{id:{function:'fixture',value:0,storage:'object'},origin,contexts:[context(0,'frame'),context(1,'heap')]},{id:{function:'fixture',value:1,storage:'object'},origin,contexts:[{...context(0,'region'),multiplicity:{kind:'bounded',limit:3,witness:'proof'},bytes_held_to_frontier:{kind:'bound',bytes:'18446744073709551615',witness:'sealed'}}]},{id:{function:'fixture',value:2,storage:'string'},origin,contexts:[context(0,'immortal')]}],by_home:[{kind:'frame',sites:1,contexts:1},{kind:'heap',sites:1,contexts:1},{kind:'immortal',sites:1,contexts:1},{kind:'region',sites:1,contexts:1}],by_reason:[{kind:'repeated_instances',sites:1,contexts:1},{kind:'storage_bound_unproved',sites:1,contexts:1}]}};
 validateCensus(value);
 const duplicate=structuredClone(value);duplicate.census.sites.push(duplicate.census.sites[0]!);assert.throws(()=>validateCensus(duplicate),/duplicate census site/);
 const forged=structuredClone(value);forged.census.sites[0]!.contexts[1]!.home='frame';assert.throws(()=>validateCensus(forged));
 const foreign=structuredClone(value);Object.assign(foreign.census,{future_field:1});assert.throws(()=>validateCensus(foreign),/foreign/);
});


test('matching payload SHA cannot launder a foreign source or recipe identity into pending',t=>{
 const {root,put,row}=fixture(t),name='tree-teardown',measured=row(name);
 for(const key of ['source','recipe'] as const){
  const foreign={...measured,identity:{...measured.identity,[key]:'f'.repeat(64)}};
  assert.equal(foreign.observation_sha256,hash(foreign.observation));
  put(censusRecord(name),JSON.stringify(foreign));
  assert.throws(()=>checkMemoryCensuses(root,()=>{},{accepted:new Map()}),/foreign memory census source or recipe identity/);
  assert.throws(()=>memoryCensusFamily.audit(censusRecord(name),null,JSON.stringify(foreign),new Set([name]),root),/foreign memory census identity/);
 }
});

test('the native records run requests current observations too',t=>{
 const {root,put,row}=fixture(t);for(const name of memoryPrograms(root))put(censusRecord(name),JSON.stringify(row(name)));
 assert.deepEqual(checkMemoryCensuses(root,()=>{}),[]);
 assert.deepEqual(memoryCensusFamily.pending(root,{written:new Map()}),[]);
 assert.deepEqual(memoryCensusFamily.refresh!(root).map(row=>row.name),memoryPrograms(root));
});

test('accepted main rows keep complete JSON boundaries and source authority',t=>{
 const {row}=fixture(t),a=row('tree-teardown'),b=row('cyclic-churn');
 const accepted=acceptedCensusRecords(JSON.stringify(a,null,2)+'\n'+JSON.stringify(b)+'\n');
 assert.equal(accepted.get('tree-teardown'),hash(a));assert.equal(accepted.get('cyclic-churn'),hash(b));
 assert.throws(()=>acceptedCensusRecords(JSON.stringify(a).slice(0,-1)),/incomplete/);
});


test('static producer identity is separate from compiler provenance and unrelated runtime bytes',t=>{
 const {root,put}=fixture(t),identity=()=>censusIdentities(root,['tree-teardown']).get('tree-teardown')!;
 const original=identity();
 put('compiler/core/src/hir/escape.rs','another compiler implementation');
 put('runtime/chromium/host/host.c','another runtime');
 put('compiler/core/src/hir/memory/build.rs','changed compiler implementation');
 put('benchmarks/common/unrelated.ts','unimported module');
 assert.deepEqual(identity(),original);
 put('outside/value.ts','export const external=3');
 const source=identity();assert.notEqual(source.source,original.source);assert.equal(source.producer,original.producer);assert.equal(source.recipe,original.recipe);
 put('compiler/core/src/hir/memory/census.rs','changed static projection');
 const producer=identity();assert.notEqual(producer.producer,source.producer);assert.equal(producer.source,source.source);assert.equal(producer.recipe,source.recipe);
 put('tooling/records/memory-census.ts','changed writer recipe');
 const recipe=identity();assert.notEqual(recipe.recipe,producer.recipe);assert.equal(recipe.source,producer.source);assert.equal(recipe.producer,producer.producer);
});


test('Program identity follows inherited configs, root membership and imported JSON outside namespaces',t=>{
 const {root,put}=fixture(t),identity=()=>censusIdentities(root,['tree-teardown']).get('tree-teardown')!;
 put('config/base.json',JSON.stringify({compilerOptions:{target:'ESNext',module:'ESNext',moduleResolution:'bundler',resolveJsonModule:true,noLib:true,types:[]}}));
 put('benchmarks/cases/tree-teardown/tsconfig.json',JSON.stringify({extends:'../../../config/base.json',files:['case.ts']}));
 put('benchmarks/cases/tree-teardown/case.ts','import data from "../../../data/input.json"; export const run=()=>data.value;');put('data/input.json','{"value":1}');
 const first=identity();put('data/input.json','{"value":2}');const json=identity();assert.notEqual(json.source,first.source);
 put('benchmarks/cases/tree-teardown/not-selected.ts','export const unused=1');assert.deepEqual(identity(),json,'explicit roots exclude neighboring sources');
 put('config/base.json',JSON.stringify({compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'bundler',resolveJsonModule:true,noLib:true,types:[]}}));assert.notEqual(identity().source,json.source);
 put('benchmarks/cases/tree-teardown/tsconfig.json',JSON.stringify({extends:'../../../config/base.json',include:['*.ts']}));const roots=identity();put('benchmarks/cases/tree-teardown/new-root.ts','export const selected=1');assert.notEqual(identity().source,roots.source);
});

test('compiler commit and binary provenance select no landing observation',t=>{
 const {root,put,row}=fixture(t),name='tree-teardown',record=row(name);
 put(censusRecord(name),JSON.stringify({...record,compiler_commit:'d'.repeat(40),compiler_sha256:'b'.repeat(64)}));
 assert.deepEqual(checkMemoryCensuses(root,()=>{}),['cyclic-churn']);
 assert.deepEqual(memoryCensusFamily.pending(root,{written:new Map()}).map(row=>row.name),['cyclic-churn']);
 assert.deepEqual(memoryCensusFamily.refresh!(root).map(row=>row.name),[name],'only the current row refreshes; the missing row remains pending');
});


test('every Rust wire kind and detail contract is covered by the TypeScript validator',()=>{
 const fixture=JSON.parse(readFileSync(fileURLToPath(fileInput(new URL('../../compiler/core/tests/memory_census_contract.json',import.meta.url))),'utf8')) as {census:{by_reason:{kind:string}[];sites:{id:{storage:string};contexts:{home:string;obligations:{kind:string;detail:string|null}[]}[]}[]}};
 validateCensus(fixture);
 const sorted=(values:Iterable<string>)=>[...new Set(values)].sort();
 assert.deepEqual(sorted(CENSUS_WIRE_KINDS.reason),sorted(fixture.census.by_reason.map(row=>row.kind)));
 assert.deepEqual(sorted(CENSUS_WIRE_KINDS.storage),sorted(fixture.census.sites.map(row=>row.id.storage)));
 const contexts=fixture.census.sites.flatMap(row=>row.contexts);
 assert.deepEqual(sorted(CENSUS_WIRE_KINDS.home),sorted(contexts.map(row=>row.home)));
 assert.deepEqual(sorted(CENSUS_WIRE_KINDS.detailedReason),sorted(contexts.flatMap(row=>row.obligations).filter(row=>row.detail!==null).map(row=>row.kind)));
});

test('current rows request refresh, not pending, and a compiler-only change rederives observations',t=>{
 const {root,put,row}=fixture(t),names=memoryPrograms(root),lines:string[]=[];
 for(const name of names)put(censusRecord(name),JSON.stringify(row(name)));
 put('compiler/core/src/hir/memory/build.rs','changed homes without changing the static recipe');
 assert.deepEqual(checkMemoryCensuses(root,line=>lines.push(line)),[]);
 assert.deepEqual(lines,names.map(name=>refreshLine('memory-census',name,censusRecord(name))));
 put('run/records.log',lines.join('\n'));
 const listed=listedIn(join(root,'run'));assert.deepEqual(listed.pending,[]);assert.deepEqual(listed.accepted,[]);assert.equal(listed.refresh.length,names.length);
 const recorder=createRecorder({memory:{family:memoryCensusFamily,steps:['records'],part:'core'}}),output:string[]=[];let runs=0;
 assert.equal(recorder.recordPending(root,['memory'],()=>{runs++;return 0;},line=>output.push(line)),0);
 assert.equal(runs,names.length);assert.ok(output.includes('memory: 0 pending, 2 recorded refresh(es)'));
 assert.ok(!output.some(line=>line.trimStart().startsWith('pending:')));
});


test('one transaction reads each real Program once and replays negative lookups and bytes',t=>{
 const {root,put}=fixture(t),owner=projectInputOwner(root),reads:string[][]=[];
 const inputs=censusInputScope(root,requests=>{reads.push(requests.map(row=>row.path));return owner.read(requests);});
 try{
  const names=memoryPrograms(root),identities=inputs.read(names);
  assert.deepEqual(inputs.read([names[0]!]).get(names[0]!),identities.get(names[0]!));
  assert.deepEqual(inputs.read(names),identities);assert.equal(reads.length,names.length);
  put('outside/value.ts','export const external=20');
  assert.throws(()=>inputs.read(names),/changed|mismatch/);
 }finally{owner.close();}
 const negative=projectInputOwner(root),snapshot=censusInputScope(root,requests=>negative.read(requests));
 try{
  put('benchmarks/cases/tree-teardown/case.ts','import {newlyPresent} from "../../../later/source.ts"; export const run=()=>newlyPresent;');
  snapshot.read(['tree-teardown']);put('later/source.ts','export const newlyPresent=1');
  assert.throws(()=>snapshot.read(['tree-teardown']),/changed|mismatch/);
 }finally{negative.close();}
});

test('a transaction refuses captured native matches that disagree with the pinned parser',t=>{
 const {root}=fixture(t),owner=projectInputOwner(root);
 const inputs=censusInputScope(root,requests=>{
  const input=owner.read(requests);assert.ok(input.matches[0]?.files.length);
  return {...input,matches:input.matches.map((match,index)=>index?match:{...match,files:[]})};
 });
 try{assert.throws(()=>inputs.read(['tree-teardown']),/project discovery matched files changed/);}
 finally{owner.close();}
});

test('the recorder scopes hooks once and applies a native refresh when no row is pending',async t=>{
 const {root,put,row}=fixture(t),name='tree-teardown',before=JSON.stringify(row(name));
 for(const program of memoryPrograms(root))put(censusRecord(program),program===name?before:JSON.stringify(row(program)));
 let scopes=0;const recorder=createRecorder({memory:{family:{...memoryCensusFamily,scope:root=>{scopes++;return memoryCensusFamily.scope!(root);}},steps:['records'],part:'core'}});
 const result=recorder.recordPending(root,['memory'],()=>0,()=>{});assert.equal(result,0);assert.equal(scopes,1);
 const changed={...JSON.parse(before),compiler_commit:'d'.repeat(40)},after=JSON.stringify(changed);
 const applied=await recorder.applyDelta(root,{version:1,commit:null,headers:{},rows:[{kind:'memory',record:censusRecord(name),case:name,key:name,before,after,sources:censusSourceKey(root,name)}]},{say:()=>{}});
 assert.equal(applied.applied,1);assert.equal(scopes,2);assert.equal(readFileSync(join(root,censusRecord(name)),'utf8'),after);
});


test('a per-case config appearing during a transaction invalidates the generated-project choice',t=>{
 const {root,put}=fixture(t),inputs=censusInputScope(root);inputs.read(['tree-teardown']);
 put('benchmarks/cases/tree-teardown/tsconfig.json',JSON.stringify({compilerOptions:{noLib:true,types:[]},files:['case.ts']}));
 assert.throws(()=>inputs.read(['tree-teardown']),/changed|mismatch/);
});


test('matching source, recipe and known compiler provenance requests no native refresh',t=>{
 const {root,put,row}=fixture(t),binary='compiler-pin/nts',bytes='native compiler fixture',digest=createHash('sha256').update(bytes).digest('hex');
 const git=(args:string[])=>execFileSync('git',gitArguments(args),{cwd:root,encoding:'utf8',env:fixtureEnvironment(t)}).trim();
 git(['init','-q']);git(['add','.']);git(['-c','user.name=NTS fixture','-c','user.email=fixture@example.invalid','commit','-qm','source']);const commit=git(['rev-parse','HEAD']);
 put(binary,bytes);put('compiler-pin/provenance.json',JSON.stringify({sha:commit,clean:true,applied:null,binary_sha256:digest}));
 const names=memoryPrograms(root),measured=new Map(names.map(name=>[name,{...row(name),compiler_commit:commit,compiler_sha256:digest}]));
 for(const [name,value]of measured)put(censusRecord(name),JSON.stringify(value));
 const compiler=censusCompiler(root,binary);assert.ok(compiler);const lines:string[]=[];
 assert.deepEqual(checkMemoryCensuses(root,line=>lines.push(line),{compiler}),[]);assert.deepEqual(lines,[]);
 let runs=0;const recorder=createRecorder({memory:{family:memoryCensusFamily,steps:['records'],part:'core'}},()=>{runs++;return 0;},{environment:{NTS_BIN:join(root,binary)}});
 assert.equal(recorder.recordPending(root,['memory'],undefined,()=>{}),0);assert.equal(runs,0);
 const name='tree-teardown',original=measured.get(name)!;
 for(const changed of [{compiler_commit:'d'.repeat(40)},{compiler_sha256:'b'.repeat(64)}]){
  put(censusRecord(name),JSON.stringify({...original,...changed}));assert.deepEqual(censusInventory(root,{compiler}),{pending:[],refresh:[name]});
 }
 put(censusRecord(name),JSON.stringify(original));
 const accepted=new Map([...measured].map(([name,value])=>[name,hash(value)]));
 put('outside/value.ts','export const external=2');assert.deepEqual(censusInventory(root,{compiler,accepted}),{pending:names,refresh:[]});
 put('outside/value.ts','export const external=1');put('tooling/records/memory-census.ts','changed recipe');assert.deepEqual(censusInventory(root,{compiler,accepted}),{pending:names,refresh:[]});
 put('tooling/records/memory-census.ts','recipe');
 put('compiler/core/src/hir/memory/build.rs','changed compiler');git(['add','compiler/core/src/hir/memory/build.rs']);git(['-c','user.name=NTS fixture','-c','user.email=fixture@example.invalid','commit','-qm','compiler-only change']);
 const unknown=censusCompiler(root,binary);assert.equal(unknown,null,'an older recorded pin is not the current source revision');assert.deepEqual(censusInventory(root,{compiler:unknown}),{pending:[],refresh:names});
});

test('missing, applied or corrupted pin provenance remains an unknown producer and requests refresh',t=>{
 const {root,put,row}=fixture(t),names=memoryPrograms(root);for(const name of names)put(censusRecord(name),JSON.stringify(row(name)));
 const binary='pin/nts',bytes='compiler',digest=createHash('sha256').update(bytes).digest('hex');put(binary,bytes);
 assert.equal(censusCompiler(root,binary),null);
 const good={sha:'c'.repeat(40),clean:true,applied:null,binary_sha256:digest};
 for(const change of [{clean:false},{applied:{source:'patch',sha256:digest,files:[]}},{binary_sha256:'f'.repeat(64)}]){
  put('pin/provenance.json',JSON.stringify({...good,...change}));const compiler=censusCompiler(root,binary);assert.equal(compiler,null);assert.deepEqual(censusInventory(root,{compiler}),{pending:[],refresh:names});
 }
});
