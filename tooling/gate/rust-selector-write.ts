// The full check refreshes stale projections after landing. The records step
// independently rebuilds an edited current-key candidate before accepting it.
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {isAbsolute,join,relative,sep} from 'node:path';
import {runAsCommand} from '../differential/command-entry/main.ts';
import {cargoRuntimeTargets,cargoInputPaths} from './cargo-inputs.ts';
import {RUST_RUNTIME_DECLARATIONS} from './rust-selector-selection.ts';
import {readRustRuntimeManifest} from './rust-runtime-declarations.ts';
import {buildRustSelectorMaterial,publishRustSelectorRecord} from './rust-selector-build.ts';
import {cargoInputNames} from './cargo-input-population.ts';
import {selectorInstalledSdk,selectorTrackedFiles} from './rust-selector-inputs.ts';
import {RUST_SELECTOR_RECORD,rustSelectorKeyInputs,type RustSelectorKeyInputs,type RustSelectorRecord,encodeRustSelectorRecord,loadRustSelectorCandidate,parseRustSelectorRecord,validateRustSelectorKey,MAX_RUST_SELECTOR_RECORD_BYTES} from './rust-selector-record.ts';
import {acceptedRustSelectorRecord,verifyRustSelectorDerivation} from './rust-selector.ts';
import {withCommittedSelectorSource,selectorQuestion,type CommittedSelectorSource} from './owed-range.ts';
import {gitArguments} from './git-arguments/main.ts';
import {projectDiscoveryOwner,type ProjectRequest} from './project-discovery.ts';
import {selectorHash} from './rust-selector-material.ts';
import {readHostObservation} from '../differential/oracle-filesystem.ts';
import type {DependencyCatalogTrust} from '../inputs/dependency-catalog.ts';

export const RUST_SELECTOR_CASE=RUST_RUNTIME_DECLARATIONS;
function inputs(root:string,dependencyCatalog:DependencyCatalogTrust|null){
  const installed=selectorInstalledSdk(),inventory=cargoRuntimeTargets(root),tracked=selectorTrackedFiles(root);
  const key={roots:{source:root,sdk:installed.root,native:installed.nativeRoot},inventory,tracked,sdk:selectorInstalledSdk};
  const build=()=>buildRustSelectorMaterial({sourceRoot:root,manifest:readRustRuntimeManifest(join(root,RUST_RUNTIME_DECLARATIONS)),inventory:()=>cargoRuntimeTargets(root),
    declarations:RUST_RUNTIME_DECLARATIONS,cargoInputs:cargoInputPaths(root),tracked:()=>selectorTrackedFiles(root),installed,dependencyCatalog});
  return {key,build};
}
/** What one records run wrote: each record path it changed from clean
 * committed bytes, with the SHA-256 of the bytes it left there. Its rows are
 * checked against their own sources when the delta is applied. */
export type RecordRunWrites=ReadonlyMap<string,string>;
const NO_WRITES:RecordRunWrites=new Map();
export type DirtyEntry={path:string;content:boolean};
/** Porcelain v2 entries, with a rename's original path. `content` marks an
 * edit that keeps the path's presence, type and mode. */
function dirtyEntries(text:string):DirtyEntry[]{
  const fields=text.split('\0'),entries:DirtyEntry[]=[];
  for(let at=0;at<fields.length;at++){
    const field=fields[at]!;if(!field)continue;
    const parts=field.split(' '),kind=parts[0],name=(index:number)=>{const path=parts.slice(index).join(' ');if(!path)throw Error('Rust selector source fence: malformed status entry');return path;};
    if(kind==='1'){const modes=parts.slice(3,6);entries.push({path:name(8),content:/^[.M]{2}$/.test(parts[1]??'')&&modes[0]===modes[1]&&modes[1]===modes[2]});}
    else if(kind==='2'){entries.push({path:name(9),content:false});const original=fields[++at];if(!original)throw Error('Rust selector source fence: rename without its original path');entries.push({path:original,content:false});}
    else if(kind==='u')entries.push({path:name(10),content:false});
    else throw Error('Rust selector source fence: unknown status entry: '+field);
  }
  return entries;
}
const ancestors=(path:string)=>{const result:string[]=[];for(let at=path;;){const slash=at.lastIndexOf('/');at=slash<0?'':at.slice(0,slash);result.push(at);if(!at)return result;}};
type Scope={tree:true}|{tree:false;keys:RustSelectorKeyInputs[]};
/** A change is relevant when the scope observes it. Content edits matter only
 * at an observed path; a membership change also under an observed directory or
 * as a Cargo input name. A content edit this run itself wrote is a delta row. */
function relevant(root:string,scope:Scope,entry:DirtyEntry,writes:RecordRunWrites):boolean{
  if(scope.tree)return entry.path!==RUST_SELECTOR_RECORD;
  if(!observesChange(scope.keys,entry))return false;
  const written=entry.content?writes.get(entry.path):undefined;
  return written===undefined||createHash('sha256').update(readFileSync(join(root,entry.path))).digest('hex')!==written;
}
/** Whether a change at a path alters what these keys observe. Membership is
 * matched through byte, alias and membership ancestors. Exact directory type
 * and identity queries are replayed by the fence; they grant no subtree reach. */
export function observesChange(keys:readonly RustSelectorKeyInputs[],entry:DirtyEntry):boolean{
  const observed=(path:string)=>path===RUST_RUNTIME_DECLARATIONS||keys.some(key=>key.paths.has(path));
  if(entry.content)return observed(entry.path);
  return observed(entry.path)||cargoInputNames([entry]).length>0||
    ancestors(entry.path).some(path=>keys.some(key=>key.subtrees.has(path)||key.members.has(path)||key.populations.has(path)));
}
/** At apply, a selector row keyed to committed sources is stale when another
 * row of the same delta changes a path its key observes. */
export function rustSelectorDeltaConflict(root:string,body:string,others:readonly {record:string}[]):string|undefined{
  const keys=[rustSelectorKeyInputs(parseRustSelectorRecord(JSON.parse(body) as unknown))];
  const other=others.find(row=>row.record!==RUST_SELECTOR_RECORD&&observesChange(keys,{path:row.record,content:existsSync(join(root,row.record))}));
  return other&&`its key observes ${other.record}, which another row of this delta changes`;
}
function fenced<T>(root:string,tree:boolean,writes:RecordRunWrites,operation:(source:CommittedSelectorSource,observe:(record:RustSelectorRecord)=>void)=>T):T{
  const question=(args:string[])=>selectorQuestion('git',gitArguments(args),{purpose:'Rust selector committed source fence',cwd:root,maxBuffer:64<<20});
  const state=()=>({head:question(['rev-parse','--verify','HEAD']).trim(),dirty:dirtyEntries(question(['status','--porcelain=v2','-z','--untracked-files=no']))});
  const before=state(),keys:RustSelectorKeyInputs[]=[],scope=():Scope=>tree?{tree:true}:{tree:false,keys};
  const projects=new Map<string,{request:ProjectRequest;files:string}>();
  const facts=new Map<string,{query:RustSelectorKeyInputs['facts'][number];answer:string}>();
  const factAnswer=(source:string,query:RustSelectorKeyInputs['facts'][number])=>{
    let value=readHostObservation(query.kind,join(source,query.path));
    if(query.kind==='realpath'&&typeof value==='string'){
      const name=relative(source,value);
      if(name!=='..'&&!name.startsWith('..'+sep)&&!isAbsolute(name))value='<source>/'+name;
    }
    return selectorHash(value);
  };
  const queryChanges=()=>{
    for(const {query,answer} of facts.values())if(factAnswer(root,query)!==answer)return true;
    if(!projects.size)return false;
    const owner=projectDiscoveryOwner(root);
    try{for(const {request,files} of projects.values())if(selectorHash(owner.read(request).files)!==files)return true;}
    finally{owner.close();}
    return false;
  };
  const dirty=(entries:readonly DirtyEntry[])=>entries.some(entry=>relevant(root,scope(),entry,writes))
    ||entries.some(entry=>!entry.content)&&queryChanges();
  let assessed=false;
  const result=withCommittedSelectorSource(root,source=>{
    if(source.revision!==before.head)throw Error('Rust selector committed source moved before preparation');
    if(!existsSync(join(source.tree,RUST_RUNTIME_DECLARATIONS)))return operation(source,()=>{});
    // The declarations are read before any key exists; key paths after.
    if(dirty(before.dirty))throw Error('Rust selector derivation requires committed source inputs: '+root);
    assessed=true;
    const discovery=projectDiscoveryOwner(source.tree);
    let value:T;
    try{value=operation(source,record=>{
      const inputs=rustSelectorKeyInputs(record);keys.push(inputs);
      for(const query of inputs.facts){
        const key=JSON.stringify(query);
        if(!facts.has(key))facts.set(key,{query,answer:factAnswer(source.tree,query)});
      }
      // A stale candidate can name an old match. The fence compares the same
      // query at committed and working sources, never against stale answers.
      for(const {request} of inputs.projects){
        // A removed committed config makes the candidate stale; it no longer
        // supplies a discovery operation to fence. Its exact path stays keyed.
        if(!existsSync(join(source.tree,request.path)))continue;
        const key=JSON.stringify(request);
        if(!projects.has(key))projects.set(key,{request,files:selectorHash(discovery.read(request).files)});
      }
    });}finally{discovery.close();}
    if(dirty(before.dirty))throw Error('Rust selector derivation requires committed source inputs: '+root);
    return value;
  });
  const after=state();if(after.head!==before.head||assessed&&dirty(after.dirty))throw Error('Rust selector committed source changed during assessment');
  return result;
}
/** Derivation observes committed sources; the candidate remains the caller's
 * independently bounded working body. Ignored outputs never enter this key.
 * With no key to bound it, the fence covers every tracked path but the record. */
export function withRustSelectorSource<T>(root:string,operation:(source:CommittedSelectorSource)=>T):T{
  return fenced(root,true,NO_WRITES,source=>operation(source));
}
/** The fence covers the declarations and exactly what each observed key
 * reads, minus the content this records run wrote from clean bytes. */
export function withKeyedRustSelectorSource<T>(root:string,writes:RecordRunWrites,operation:(source:CommittedSelectorSource,observe:(record:RustSelectorRecord)=>void)=>T):T{
  return fenced(root,false,writes,operation);
}
export function rustSelectorPending(root:string,writes:RecordRunWrites=NO_WRITES):boolean{
  return withKeyedRustSelectorSource(root,writes,(source,observe)=>{
    if(!existsSync(join(source.tree,RUST_RUNTIME_DECLARATIONS)))return false;
    if(!existsSync(join(root,RUST_SELECTOR_RECORD)))return true;
    const candidate=loadRustSelectorCandidate(join(root,RUST_SELECTOR_RECORD),inputs(source.tree,source.dependencyCatalog).key);
    if(candidate.record)observe(candidate.record);
    return candidate.state==='pending';
  });
}
export function checkRustSelectorRecord(root:string,report:(message:string)=>void):void{
  // Reports wait for both fences: a refused assessment reports nothing.
  const reports:string[]=[],held=(message:string)=>{reports.push(message);};
  const result=withKeyedRustSelectorSource(root,NO_WRITES,(source,observe)=>{
    const report=held;
    if(!existsSync(join(source.tree,RUST_RUNTIME_DECLARATIONS)))return;
    if(!existsSync(join(root,RUST_SELECTOR_RECORD))){report(`pending: ${RUST_SELECTOR_CASE} is not recorded in ${RUST_SELECTOR_RECORD} yet`);return;}
    const {key,build}=inputs(source.tree,source.dependencyCatalog);
    return verifyRustSelectorDerivation({root:source.tree,candidatePath:join(root,RUST_SELECTOR_RECORD),key,observe,
      accepted:()=>acceptedRustSelectorRecord(root),build:()=>encodeRustSelectorRecord(build()),report});
  });
  for(const message of reports)report(message);
  if(result!==undefined)report('Rust selector record '+result);
}
export function recordRustSelector(root:string,writes:RecordRunWrites=NO_WRITES):void{
  // Publication follows successful source/installation drain and both fences.
  const record=withKeyedRustSelectorSource(root,writes,(source,observe)=>{const record=encodeRustSelectorRecord(inputs(source.tree,source.dependencyCatalog).build());observe(record);return record;});
  publishRustSelectorRecord(join(root,RUST_SELECTOR_RECORD),record);
}
/** Delta application observes the same committed source as the writer and
 * mandatory derivation. A candidate body supplies no source authority. */
export function rustSelectorSourceKey(root:string,body:string,writes:RecordRunWrites=NO_WRITES):string|undefined{
  if(Buffer.byteLength(body)>MAX_RUST_SELECTOR_RECORD_BYTES)throw Error('Rust selector record exceeds committed size budget');
  const record=parseRustSelectorRecord(JSON.parse(body) as unknown);
  return withKeyedRustSelectorSource(root,writes,(source,observe)=>{observe(record);
    return existsSync(join(source.tree,RUST_RUNTIME_DECLARATIONS))&&validateRustSelectorKey(record,inputs(source.tree,source.dependencyCatalog).key).state==='key-current'?record.keySha256:undefined;});
}
/** A records run names what it wrote as `--run-written <sha256>:<path>`. */
export function runWritesArguments(writes:RecordRunWrites):string[]{
  return [...writes].sort(([a],[b])=>a.localeCompare(b,'en')).flatMap(([path,sha256])=>['--run-written',sha256+':'+path]);
}
function parseWriteArguments(args:readonly string[]):RecordRunWrites{
  if(args[0]!=='--write')throw Error('usage: rust-selector-write.ts --write [--run-written <sha256>:<path>]...');
  const writes=new Map<string,string>();
  for(let at=1;at<args.length;at+=2){
    const value=args[at+1],match=args[at]==='--run-written'&&value?/^([a-f0-9]{64}):(.+)$/.exec(value):null;
    if(!match||writes.has(match[2]!))throw Error('usage: rust-selector-write.ts --write [--run-written <sha256>:<path>]...');
    writes.set(match[2]!,match[1]!);
  }
  return writes;
}
runAsCommand(import.meta.url,()=>{
  recordRustSelector(process.cwd(),parseWriteArguments(process.argv.slice(2)));
});
