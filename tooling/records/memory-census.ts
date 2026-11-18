// Static memory observations. Source/producer changes request a new observation;
// malformed, foreign or internally inconsistent records never become pending.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {gitArguments} from '../gate/git-arguments/main.ts';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readBenchmarkGroups,groupRows} from '../bench/groups.ts';
import {projectFor,compileEnvironment} from '../bench/compile-producer.ts';
import {digestSources} from './recorder-core.ts';
import {conservativeDirectory,dataDirectory,fileInput} from '../gate/reader-inputs/main.ts';
import {durableRecord} from '../gate/durable-record.ts';
import {activeCommand} from '../gate/active-command.ts';
import {pendingLine,refreshLine} from './pending.ts';
import {runAsCommand} from '../differential/command-entry/main.ts';
import {acceptedRevision,acceptedRevisionData} from '../gate/accepted-revision-data.ts';
import {reserveJob} from '../gate/memory-ledger.ts';
import {projectInputOwner,type ProjectInputs,type ProjectRequest} from '../gate/project-inputs.ts';
import {OracleFilesystem} from '../differential/oracle-filesystem.ts';
import {captureReaderObservations,validateReaderBatchObservations} from '../gate/reader-observations.ts';
import type {InputSnapshot,ReaderObservation} from '../gate/module-closure.ts';
import {provenanceOf} from '../conformance/pin-provenance.ts';
const ROOT=fileURLToPath(new URL('../..',import.meta.url));
const pathOf=(url:URL)=>relative(ROOT,fileURLToPath(url));
const STORE=pathOf(conservativeDirectory(new URL('../../results/memory-census/',import.meta.url)));
const ACCEPTED=acceptedRevisionData(new URL('../../results/memory-census/',import.meta.url));
const CASES=pathOf(dataDirectory(new URL('../../benchmarks/cases/',import.meta.url)));
// Selection owns this instrument's exact static recipe. Compiler implementation
// and installation belong to the pin provenance and never select census rows.
export const CENSUS_PRODUCER_INPUTS=[fileInput(new URL('../../compiler/core/src/hir/memory.rs',import.meta.url)),fileInput(new URL('../../compiler/core/src/hir/memory/report.rs',import.meta.url)),fileInput(new URL('../../compiler/core/src/hir/memory/census.rs',import.meta.url)),fileInput(new URL('../cli/src/main.rs',import.meta.url)),fileInput(new URL('../cli/src/arguments.rs',import.meta.url))];
export const CENSUS_RECIPE_INPUTS=[fileInput(new URL('./memory-census.ts',import.meta.url)),fileInput(new URL('./memory-census-record-family.ts',import.meta.url)),fileInput(new URL('../bench/compile-producer.ts',import.meta.url))];
const GENERATED_CONFIG=pathOf(fileInput(new URL('../../tsconfig.fixtures.json',import.meta.url)));
export const CENSUS_RECORD_VERSION=2;
export const CENSUS_VERSION=1;
export const censusRecord=(name:string)=>{assert.match(name,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);return `${STORE}/${name}.json`;};
const sha=(text:string|Uint8Array)=>createHash('sha256').update(text).digest('hex');
const hash=(value:unknown)=>sha(JSON.stringify(value));
const hex=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function memoryPrograms(root:string):string[]{
 const names=groupRows(readBenchmarkGroups(root),'memory')??[];
 for(const name of names)assert.ok(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)&&existsSync(join(root,CASES,name,'case.ts')),`memory group has no benchmark: ${name}`);
 return [...names].sort();
}
export type CensusIdentity={source:string;recipe:string;producer:string;version:number};
/** The shared Program owner selects configs, roots, resolved imports, ambient
 * types, JSON and package goals. No namespace list approximates those inputs. */
function programIdentity(root:string,input:ProjectInputs,request:ProjectRequest):string{
 const label=(path:string,capability?:ProjectInputs['installedObservations'][number]['capability']):string=>{
  for(const [prefix,base]of capability?[['$typescript',capability.root],['$typescript-native',capability.nativeRoot]]:[]){
   const local=relative(base!,path);if(local!=='..'&&!local.startsWith('..'+sep)&&!isAbsolute(local))return prefix+'/'+local.split(sep).join('/');
  }
  const local=relative(root,path);assert.ok(local!=='..'&&!local.startsWith('..'+sep)&&!isAbsolute(local),'memory census has an undeclared external source: '+path);return local.split(sep).join('/');
 };
 const files=new Map<string,string>();
 for(const {observation,capability}of [...input.observations.map(observation=>({observation,capability:undefined})),...input.pinObservations.map(observation=>({observation,capability:undefined})),...input.installedObservations,...input.dependencyObservations.map(({observation})=>({observation,capability:undefined}))])
  if(observation.kind==='file'&&typeof observation.value==='string')files.set(label(observation.path,capability),observation.value);
 return hash({version:1,request,roots:[...input.roots].sort(),modules:input.modules.map(row=>({path:row.path,imports:[...row.imports].sort()})).sort((a,b)=>a.path.localeCompare(b.path,'en')),files:[...files].sort(([a],[b])=>a.localeCompare(b,'en'))});
}
/** A transaction owns detached Program facts, never a persistent Program cache.
 * Reuse replays every typed observation, including failed lookups and SDK facts. */
export function censusInputScope(root:string,readProject?:(requests:readonly ProjectRequest[])=>ProjectInputs){
 const identities=new Map<string,CensusIdentity>(),snapshots=new Map<string,InputSnapshot>();
 const recipe=()=>digestSources(root,[{name:'producer',paths:CENSUS_PRODUCER_INPUTS.map(pathOf),except:null},{name:'recipe',paths:CENSUS_RECIPE_INPUTS.map(pathOf),except:null}]);
 let original:ReturnType<typeof recipe>|undefined;
 return {read(names:readonly string[]):Map<string,CensusIdentity>{
  const current=recipe();if(original)assert.deepEqual(current,original,'census recipe changed during transaction');else original=current;
  const missing=[...new Set(names)].filter(name=>!identities.has(name));
  const owner=missing.length&&!readProject?projectInputOwner(root):undefined;
  try{for(const name of missing){
   const directory=`${CASES}/${name}`,config=`${directory}/tsconfig.json`,selection=new OracleFilesystem();
   const request:ProjectRequest=selection.fileExists(join(root,config))?{kind:'config',path:config}:{kind:'generated',path:GENERATED_CONFIG,directory,include:'directory'};
   const input=(readProject??owner!.read)([request]);assert.ok(input.modules.some(row=>row.path===`${directory}/case.ts`),'memory census Program has no entry: '+name);
   const rows:ReaderObservation[]=captureReaderObservations(root,[...selection.captured(),...input.observations,...input.pinObservations]).map(row=>({...row,reader:'memory census',context:{entry:'<entry>',dataNamespaces:{}},protocol:'project'}));
   for(const row of [...input.installedObservations,...input.hostObservations,...input.dependencyObservations,...input.generatedObservations])rows.push({...row,reader:'memory census',context:{entry:'<entry>',dataNamespaces:{}},protocol:'project',causes:[{kind:row.observation.kind,path:row.observation.path}]});
   const files=rows.filter(row=>!row.capability&&!row.environment&&!row.dependency&&row.observation.kind==='file'&&row.observation.value!==null).map(row=>relative(root,row.observation.path));
   snapshots.set(name,{files,ownedFiles:files,moduleFiles:[],hostFiles:[],placingFiles:[],stagingFiles:[],directories:[],optionalFiles:[],memberships:[],observations:rows});
   const required=(key:string)=>{const value=current.get(key);assert.ok(value,`memory census identity has no inputs: ${key}`);return value;};
   identities.set(name,{source:programIdentity(root,input,request),recipe:required('recipe'),producer:required('producer'),version:CENSUS_VERSION});
  }}finally{owner?.close();}
  validateReaderBatchObservations(names.map(name=>snapshots.get(name)!));
  return new Map(names.map(name=>[name,identities.get(name)!]));
 }};
}
export type CensusInputScope=ReturnType<typeof censusInputScope>;
export function censusIdentities(root:string,names:readonly string[]):Map<string,CensusIdentity>{return censusInputScope(root).read(names);}
type ObjectValue=Record<string,unknown>;
function object(value:unknown):ObjectValue{assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value),'memory census: expected object');return value as ObjectValue;}
function fields(row:ObjectValue,names:string):void{assert.deepEqual(Object.keys(row).sort(),names.split(' ').sort(),'foreign memory census fields');}
function list(value:unknown):unknown[]{assert.ok(Array.isArray(value),'memory census: expected array');return value;}
function text(value:unknown):string{assert.equal(typeof value,'string','memory census: expected string');return value as string;}
function count(value:unknown):number{assert.ok(Number.isSafeInteger(value)&&Number(value)>=0,'memory census: expected nonnegative count');return Number(value);}
export const CENSUS_WIRE_KINDS={
 reason:['work_budget','edge_budget','context_budget','outside','returned','outlives_frame','repeated_instances','storage_bound_unproved','runtime_root_contract','manual_storage','producer_unproved','weak_union_budget','store_order_budget','unsealed_writer','binding_identity_unproved','retained_environment','missing_outcome','invalid_control_flow','unsupported_phase'],
 detailedReason:['outside','returned','outlives_frame','unsealed_writer','binding_identity_unproved','retained_environment','missing_outcome','invalid_control_flow','unsupported_phase'],
 storage:['object','array','string','native','call_result','call_storage'],
 home:['frame','region','heap','immortal'],
};
function reason(value:unknown):string{const row=object(value),kind=text(row.kind);fields(row,'kind detail');assert.ok(CENSUS_WIRE_KINDS.reason.includes(kind),'unknown memory census reason');assert.ok(CENSUS_WIRE_KINDS.detailedReason.includes(kind)?typeof row.detail==='string':row.detail===null);return kind;}
/** Validate the wire contract and independently reproduce every summary. */
export function validateCensus(value:unknown):void{
 const envelope=object(value),census=object(envelope.census);fields(envelope,'preparation sources uncompiled_functions census');fields(census,'schema failure sites by_home by_reason');
 assert.equal(envelope.preparation,'preparation: backend=c provider=ReferenceCounting','foreign memory census preparation');count(envelope.uncompiled_functions);
 assert.equal(census.schema,CENSUS_VERSION,'foreign memory census version');if(census.failure!==null)reason(census.failure);
 const sources=new Set<number>();for(const value of list(envelope.sources)){const source=object(value),id=count(source.id);fields(source,'id uri digest');assert.ok(!sources.has(id));sources.add(id);text(source.uri);assert.equal(list(source.digest).length,16);for(const byte of list(source.digest))assert.ok(count(byte)<=255);}
 const location=(value:unknown)=>{const row=object(value);fields(row,'file start end');assert.ok(sources.has(count(row.file)),'unknown census source');assert.ok(count(row.start)<=count(row.end));};
 const homes=new Map<string,{sites:Set<string>;contexts:number}>(),reasons=new Map<string,{sites:Set<string>;contexts:number}>();
 const add=(groups:typeof homes,kind:string,key:string)=>{const row=groups.get(kind)??{sites:new Set<string>(),contexts:0};row.sites.add(key);row.contexts++;groups.set(kind,row);};
 const keys=new Set<string>();
 for(const value of list(census.sites)){
  const site=object(value),id=object(site.id),origin=object(site.origin);fields(site,'id origin contexts');fields(id,'function value storage');fields(origin,'location scope inline_chain async_parent generated');text(id.function);count(id.value);assert.ok(CENSUS_WIRE_KINDS.storage.includes(text(id.storage)));
  const key=hash([id,origin]);assert.ok(!keys.has(key),'duplicate census site');keys.add(key);location(origin.location);for(const loc of list(origin.inline_chain))location(loc);if(origin.async_parent!==null)location(origin.async_parent);if(origin.scope!==null)count(origin.scope);assert.ok(origin.generated===null||typeof origin.generated==='string');
  const contexts=new Set<number>();assert.ok(list(site.contexts).length>0);
  for(const value of list(site.contexts)){
   const row=object(value),context=count(row.id);fields(row,'id context home owner reason obligations multiplicity retention_frontier bytes_held_to_frontier');assert.ok(!contexts.has(context),'duplicate census context');contexts.add(context);text(row.context);
   const home=text(row.home);assert.ok(CENSUS_WIRE_KINDS.home.includes(home));assert.ok(home==='region'?typeof row.owner==='string':row.owner===null);assert.ok(home==='heap'?row.reason!==null:row.reason===null);
   add(homes,home,key);const kinds=new Set(list(row.obligations).map(reason));if(row.reason!==null)kinds.add(reason(row.reason));for(const kind of kinds)add(reasons,kind,key);
   const multiplicity=object(row.multiplicity),kind=text(multiplicity.kind);fields(multiplicity,'kind limit witness');text(multiplicity.witness);assert.ok(['one','bounded','unbounded'].includes(kind));if(kind==='unbounded')assert.equal(multiplicity.limit,null);else {assert.ok(count(multiplicity.limit)>0);if(kind==='one')assert.equal(multiplicity.limit,1);}
   text(row.retention_frontier);const bytes=object(row.bytes_held_to_frontier);fields(bytes,'kind bytes witness');text(bytes.witness);assert.ok(['unknown','bound'].includes(text(bytes.kind)));if(bytes.kind==='unknown')assert.equal(bytes.bytes,null);else assert.match(text(bytes.bytes),/^(?:0|[1-9][0-9]*)$/);
  }
 }
 const summary=(groups:typeof homes)=>[...groups].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([kind,row])=>({kind,sites:row.sites.size,contexts:row.contexts}));
 assert.deepEqual(census.by_home,summary(homes),'forged memory census home summary');assert.deepEqual(census.by_reason,summary(reasons),'forged memory census reason summary');
}
export type CensusRecord={version:2;program:string;identity:CensusIdentity;compiler_commit:string;compiler_sha256:string;observation_sha256:string;observation:unknown};
export function parseCensusRecord(value:unknown,name:string):CensusRecord{
 const row=object(value);fields(row,'version program identity compiler_commit compiler_sha256 observation_sha256 observation');assert.equal(row.version,CENSUS_RECORD_VERSION);assert.equal(row.program,name,'foreign memory census program');const identity=object(row.identity);fields(identity,'source recipe producer version');
 for(const key of ['source','recipe','producer'])assert.ok(hex(identity[key]),`invalid census ${key} identity`);assert.equal(identity.version,CENSUS_VERSION);
 assert.match(text(row.compiler_commit),/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);assert.ok(hex(row.compiler_sha256));assert.ok(hex(row.observation_sha256));assert.equal(row.observation_sha256,hash(row.observation),'forged memory census observation');validateCensus(row.observation);return {version:CENSUS_RECORD_VERSION,program:name,identity:{source:text(identity.source),recipe:text(identity.recipe),producer:text(identity.producer),version:CENSUS_VERSION},compiler_commit:text(row.compiler_commit),compiler_sha256:text(row.compiler_sha256),observation_sha256:text(row.observation_sha256),observation:row.observation};
}
/** Accepted main supplies the authority to refresh an unchanged older row.
 * A candidate cannot turn an invented identity into a pending observation. */
function acceptedCensuses(root:string):Map<string,string>{
 const revision=acceptedRevision(root);if('error' in revision)throw Error('memory census accepted identity: '+revision.error);
 const data=revision.grep(ACCEPTED,'^');if(typeof data!=='string')throw Error('memory census accepted identity: '+data.error);
 return acceptedCensusRecords(data);
}
/** Git grep joins accepted JSON files; parse complete objects independently,
 * including valid pretty-printed observations. Strings never delimit a row. */
export function acceptedCensusRecords(data:string):Map<string,string>{
 const records=new Map<string,string>();let depth=0,start=0,quoted=false,escaped=false;
 for(let at=0;at<data.length;at++){
  const char=data[at]!;
  if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
  if(char==='"'){quoted=true;continue;}
  if(char==='{'){if(depth===0)start=at;depth++;}
  else if(char==='}'){assert.ok(depth>0,'malformed accepted census');if(--depth===0){const value:unknown=JSON.parse(data.slice(start,at+1)),name=text(object(value).program);assert.ok(!records.has(name),'duplicate accepted census');records.set(name,hash(parseCensusRecord(value,name)));}}
  else if(depth===0)assert.match(char,/\s/,'malformed accepted census');
 }
 assert.ok(depth===0&&!quoted,'incomplete accepted census');return records;
}
/** A known pin can suppress redundant native work. No pin means unknown,
 * including a build target that the tree-only records step can reach before build. */
export type CensusCompiler={compiler_commit:string;compiler_sha256:string};
export function censusCompiler(root:string,binary:string|undefined):CensusCompiler|null{
 if(!binary)return null;
 const path=resolve(root,binary),pin=provenanceOf(path);
 if(pin?.clean!==true||pin.applied!==null||typeof pin.sha!=='string'||!(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).test(pin.sha)||!hex(pin.binary_sha256)||!existsSync(path))return null;
 if(!existsSync(join(root,'.git')))return null;
 const revision=spawnSync('git',gitArguments(['rev-parse','--verify','HEAD']),{cwd:root,encoding:'utf8'});
 if(revision.status!==0||revision.stdout.trim()!==pin.sha)return null;
 const digest=sha(readFileSync(path));return digest===pin.binary_sha256?{compiler_commit:pin.sha,compiler_sha256:digest}:null;
}
export type CensusCheckOptions={accepted?:ReadonlyMap<string,string>;inputs?:CensusInputScope;compiler?:CensusCompiler|null};
export function censusInventory(root:string,options:CensusCheckOptions={}):{pending:string[];refresh:string[]}{
 const names=memoryPrograms(root),identities=(options.inputs??censusInputScope(root)).read(names),pending:string[]=[],refresh:string[]=[];let accepted=options.accepted;
 const store=join(root,STORE);if(existsSync(store))for(const file of readdirSync(store))assert.ok(names.some(name=>`${name}.json`===file),`foreign memory census record: ${file}`);
 for(const name of names){const file=censusRecord(name),path=join(root,file);let stale=!existsSync(path),measured:CensusRecord|undefined;
  if(!stale){const row=measured=parseCensusRecord(JSON.parse(readFileSync(path,'utf8')),name);stale=hash(row.identity)!==hash(identities.get(name));if(stale){accepted??=acceptedCensuses(root);assert.equal(accepted.get(name),hash(row),'foreign memory census source or recipe identity: '+name);}}
  if(stale)pending.push(name);else if(!options.compiler||measured!.compiler_commit!==options.compiler.compiler_commit||measured!.compiler_sha256!==options.compiler.compiler_sha256)refresh.push(name);
 }
 return {pending,refresh};
}
export function checkMemoryCensuses(root:string,say:(line:string)=>void,options:CensusCheckOptions={}):string[]{
 const inventory=censusInventory(root,options);
 for(const name of inventory.pending)say(pendingLine(name,censusRecord(name)));
 for(const name of inventory.refresh)say(refreshLine('memory-census',name,censusRecord(name)));
 return inventory.pending;
}
export function censusSourceKey(root:string,name:string,inputs=censusInputScope(root)):string{return hash(inputs.read([name]).get(name));}
export async function writeMemoryCensuses(root:string,names:readonly string[],binary:string,env:NodeJS.ProcessEnv):Promise<void>{
 const wanted=memoryPrograms(root);assert.ok(names.every(name=>wanted.includes(name)),'foreign census request');
 const compiler=sha(readFileSync(binary)),pin=provenanceOf(binary);
 assert.ok(pin?.clean&&!pin.applied&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(pin.sha),'memory census writer requires a clean compiler pin with recorded commit provenance');
 assert.equal(pin.binary_sha256,compiler,'memory census compiler differs from its pin provenance');
 const inputs=censusInputScope(root),identities=inputs.read(names);
 const base=env.TMPDIR??join(root,'target');mkdirSync(base,{recursive:true});const scratch=mkdtempSync(join(base,'record-'));
 const lease=await reserveJob({key:'memory-census',what:'static memory census observations'});
 try {for(const name of names){
  const project=projectFor(root,`${CASES}/${name}`,scratch);
  const result=await activeCommand(binary,['regions',project,'--census','--rc','--backend','c','--checkers','1'],{cwd:root,env:compileEnvironment(env,scratch,binary)});
  assert.equal(result.status,0,`memory census ${name}: ${result.stderr}`);
  const observation:unknown=JSON.parse(result.stdout);validateCensus(observation);
  assert.equal(censusSourceKey(root,name,inputs),hash(identities.get(name)),'census inputs changed during observation');
  const row:CensusRecord={version:CENSUS_RECORD_VERSION,program:name,identity:identities.get(name)!,compiler_commit:pin.sha,compiler_sha256:compiler,observation_sha256:hash(observation),observation};
  const file=join(root,censusRecord(name));if(existsSync(file)){const previous=parseCensusRecord(JSON.parse(readFileSync(file,'utf8')),name);if(hash(previous.identity)===hash(row.identity)&&previous.observation_sha256===row.observation_sha256){console.log(`native memory census unchanged: ${name}`);continue;}}
  durableRecord(file,row,{compact:true});console.log(`recorded memory census: ${name}`);
 }}finally{lease.release();await lease.closed;rmSync(scratch,{recursive:true,force:true});}
}
runAsCommand(import.meta.url,async()=>{
 const args=process.argv.slice(2),root=resolve(process.cwd());
 if(args[0]==='--check'){checkMemoryCensuses(root,console.log,{compiler:censusCompiler(root,process.env.NTS_BIN)});return;}
 assert.equal(args[0],'--record-pending','usage: memory-census.ts --check | --record-pending <program>...');
 await writeMemoryCensuses(root,args.slice(1),resolve(process.env.NTS_BIN??'target/release/nts'),process.env);
});
