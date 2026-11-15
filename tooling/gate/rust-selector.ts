// Selection and record verification share the accepted-blob boundary. A stale
// key uses the live graph; only an independently verified record can skip it.
import {createHash} from 'node:crypto';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {optionalFile} from './reader-inputs/main.ts';
import {gitArguments} from './git-arguments/main.ts';
import {infrastructureProbe,type InfrastructureProbe} from './infrastructure-probe.ts';
import {RUST_SELECTOR_RECORD,MAX_RUST_SELECTOR_RECORD_BYTES,loadRustSelectorCandidate,readRustSelectorRecord,
  type TrustedRustSelectorRecord,type RustSelectorTarget,type RustSelectorRecord} from './rust-selector-record.ts';
import type {validateRustSelectorKey} from './rust-selector-record.ts';
import type {SelectorPending} from './rust-selector-material.ts';
import type {RustRecordDecision} from './rust-selector-decision.ts';
import type {DependencyCatalogTrust} from '../inputs/dependency-catalog.ts';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const RECORD_INPUT=optionalFile(new URL('../../results/gate-inputs/rust-runtime.json',import.meta.url));
const recordPath=(root:string)=>join(root,relative(fileURLToPath(new URL('../..',import.meta.url)),fileURLToPath(RECORD_INPUT)));
type AcceptedRecordIdentity={revision:string;blob:string};
const validObjectId=(value:string)=>/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
function recordGit(root:string,probe:InfrastructureProbe){
  return (args:string[],maxBuffer=4096)=>probe({purpose:'accepted Rust selector record',command:'git',args:gitArguments(args),cwd:root,maxBuffer,exits:'classify'});
}
function recordIdentity(root:string,reference:string,probe:InfrastructureProbe):AcceptedRecordIdentity|undefined{
  const git=recordGit(root,probe),revision=git(['rev-parse','--verify','--quiet',reference]);
  if(revision.status===1)return undefined;
  if(revision.status!==0||!validObjectId(revision.stdout.trim()))throw Error('Rust selector accepted revision is unavailable: '+revision.stderr);
  const pinned=revision.stdout.trim(),entry=git(['ls-tree','-z',pinned,'--',RUST_SELECTOR_RECORD]);
  if(entry.status!==0)throw Error('Rust selector accepted tree is unavailable: '+entry.stderr);
  if(entry.stdout==='')return undefined;
  const row=/^100644 blob ([a-f0-9]{40}|[a-f0-9]{64})\t([^\0]+)\0$/.exec(entry.stdout);
  if(!row||row[2]!==RUST_SELECTOR_RECORD)throw Error('Rust selector accepted record is not one regular Git blob');
  return {revision:pinned,blob:row[1]!};
}
/** The source selection owner acquires this identity once, before creating
 * private endpoints. No candidate or environment supplies accepted authority. */
export function acceptedRustSelectorIdentity(root:string,probe:InfrastructureProbe=infrastructureProbe):AcceptedRecordIdentity|undefined{
  return recordIdentity(root,'refs/heads/main',probe);
}
function recordBody(root:string,identity:AcceptedRecordIdentity,probe:InfrastructureProbe):TrustedRustSelectorRecord{
  const git=recordGit(root,probe),size=git(['cat-file','-s',identity.blob]);
  if(size.status!==0||!/^\d+\n$/.test(size.stdout)||Number(size.stdout)>MAX_RUST_SELECTOR_RECORD_BYTES)throw Error('Rust selector accepted record exceeds its bounded blob contract');
  const body=git(['cat-file','blob',identity.blob],MAX_RUST_SELECTOR_RECORD_BYTES+1);
  if(body.status!==0||Buffer.byteLength(body.stdout)!==Number(size.stdout))throw Error('Rust selector accepted record blob is incomplete');
  return {...identity,sha256:hash(body.stdout)};
}
export function acceptedRustSelectorRecord(root:string,probe:InfrastructureProbe=infrastructureProbe):TrustedRustSelectorRecord|undefined{
  const identity=acceptedRustSelectorIdentity(root,probe);return identity?recordBody(root,identity,probe):undefined;
}
export type RustSelectorTrust={readonly acceptedRustRecordBlob:string|null;readonly dependencyCatalog?:DependencyCatalogTrust|null};
/** Explicit null never discovers a local main. A matching endpoint hashes
 * the immutable Git blob, independently of its bounded working-body read. */
export function rustSelectorRecordAtBlob(root:string,trust:RustSelectorTrust,probe:InfrastructureProbe=infrastructureProbe):TrustedRustSelectorRecord|undefined{
  const blob=trust.acceptedRustRecordBlob;
  if(blob===null)return undefined;
  if(!validObjectId(blob))throw Error('Rust selector accepted blob input is malformed');
  const identity=recordIdentity(root,'HEAD',probe);
  return identity?.blob===blob?recordBody(root,identity,probe):undefined;
}

type KeyOptions=Parameters<typeof validateRustSelectorKey>[1];
export type RustSelectorSelection=({state:'record';targets:RustSelectorTarget[];trusted:TrustedRustSelectorRecord}|{state:'live';targets:RustSelectorTarget[];pending:SelectorPending;allRust?:true})&{decision:RustRecordDecision};
/** The live callback uses the canonical graph directly, without requiring a
 * portable record representation for facts discovered by a future engine. */
export function selectRustInputs(options:{root:string;candidatePath?:string;key:KeyOptions;accepted:()=>TrustedRustSelectorRecord|undefined;live:()=>RustSelectorTarget[];report:(message:string)=>void;catalogPending?:string;catalogCurrent?:boolean}):RustSelectorSelection{
  const path=options.candidatePath??recordPath(options.root),accepted=options.accepted(),result=readRustSelectorRecord(path,{...options.key,trusted:accepted});
  // Still parse/authenticate a candidate first: missing installation metadata
  // cannot hide a malformed or tampered record. It grants no path placement.
  if(options.catalogPending){
    const pending={kind:'catalog-stale-live',path:'installation catalog',reason:options.catalogPending};
    options.report('Rust selector '+pending.kind+': '+pending.reason+'; owing all Rust targets');
    return {state:'live',targets:[],pending,allRust:true,decision:{record:'stale-live',reason:pending.kind+': '+pending.reason,blob:accepted?.blob??null}};
  }
  if(result.state==='current')return {state:'record',targets:result.targets,trusted:result.trusted,
    decision:{record:'trusted',reason:'accepted record bytes and current input key verified'+(options.catalogCurrent?'; installation catalog current':''),blob:result.trusted.blob}};
  options.report('Rust selector record pending: '+result.pending.kind+' '+result.pending.path+': '+result.pending.reason+'; building live projection');
  return {state:'live',targets:options.live(),pending:result.pending,decision:{
    record:result.pending.kind==='missing'||result.pending.kind==='unverified-record'?'absent-live':'stale-live',
    reason:result.pending.kind+' '+result.pending.path+': '+result.pending.reason,blob:accepted?.blob??null}};
}

/** A changed record cannot certify itself with recomputed payload hashes.
 * This mandatory check compares it with the actual producer before landing.
 * Stale input keys remain pending and are refreshed by the full check. */
export function verifyRustSelectorDerivation(options:{root:string;candidatePath?:string;key:KeyOptions;accepted:()=>TrustedRustSelectorRecord|undefined;build:()=>RustSelectorRecord;report:(message:string)=>void}):'current'|'pending'|'derived'{
  const path=options.candidatePath??recordPath(options.root),candidate=loadRustSelectorCandidate(path,options.key);
  const accepted=options.accepted();
  if(candidate.state==='pending'){
    if(candidate.sha256!==undefined&&candidate.sha256!==accepted?.sha256)
      throw Error('Rust selector record unverified stale candidate: '+path+'; edited record must match a fresh canonical derivation before landing');
    options.report('Rust selector record pending: '+candidate.pending.kind+' '+candidate.pending.path+': '+candidate.pending.reason);return 'pending';
  }
  if(accepted?.sha256===candidate.sha256)return 'current';
  const rebuilt=options.build();
  if(JSON.stringify(rebuilt)!==JSON.stringify(candidate.record))throw Error('Rust selector record derivation mismatch: '+path+'; candidate roles/key differ from the canonical live producer');
  return 'derived';
}
