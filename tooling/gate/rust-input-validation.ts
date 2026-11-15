// Explicit post-run analysis. It reports potential dependencies of attempts;
// no current source observation is a historical syscall return value.
import {isAbsolute,relative,sep} from 'node:path';
import {OracleFilesystem,type InputIdentity} from '../differential/oracle-filesystem.ts';
import type {HostObservation} from '../differential/oracle-runtime.ts';
import type {InputSnapshot} from './module-closure.ts';
import type {FileObserverReceipt} from './file-input-observer.ts';
import type {InputIndexExecution,InputSubject,RuntimeObservation} from './rust-test-inputs.ts';
import {runtimeInputRequirement,type InputRequirement} from './rust-input-operations.ts';
import {compileRuntimeRepositoryClaims,type RuntimeClaimAnswer} from './rust-input-claims.ts';
import {authenticateRustInputTrace,type RustInputCapture} from './rust-input-authentication.ts';
import {durableRecordStream} from './durable-record.ts';
import {MAX_OBSERVATION_ROW_BYTES} from './file-input-observer.ts';
import {validateReaderSourceObservations} from './reader-observations.ts';
import type {RustRuntimeTarget} from './rust-runtime-declarations.ts';
import {runtimeSourceAnchor} from './rust-source-anchor.ts';
import {readRustTestExecution,rustTestExecutionClassifier} from './rust-test-execution.ts';
import type {CaptureArtifact} from './file-input-observer.ts';
import {rustInputReportPool} from './rust-input-report.ts';
import {readRustBuildProvenance,runtimeProvenanceClassifier,runtimeInstalledInputClassifier} from './rust-input-provenance.ts';

export type RuntimeSubjectAssessment={subject:InputSubject;requirement:InputRequirement;outcome:'unknown';
  state:'claimed'|'uncovered'|'literal';spelling?:string;identity?:InputIdentity;endpoint?:RuntimeClaimAnswer;
  identityBasis:'current-source'|'capture-components'|'capture-descriptor';components:{observation:HostObservation;answer:RuntimeClaimAnswer}[];reason?:string};
const inside=(root:string,path:string)=>{const part=relative(root,path);return part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part);};

/** Scope is a report of current component identity, never an exemption or a
 * syscall outcome. An unresolved spelling cannot certify an external input. */
export function runtimeAssessmentScope(root:string,assessment:RuntimeSubjectAssessment){
  const components=assessment.components.map((row,index)=>({index,scope:inside(root,row.observation.path)?'repository' as const:'external' as const,
    path:row.observation.path,state:row.answer.kind}));
  const identity=assessment.identity,exact=identity&&(identity.state==='resolved'||identity.path===identity.component);
  const endpoint=exact?{scope:inside(root,identity.path)?'repository' as const:'external' as const,path:identity.path,
    state:assessment.endpoint?.kind??'uncovered' as const}:undefined;
  return {scope:assessment.state==='literal'?'literal' as const:endpoint?.scope??'unresolved' as const,
    ...(endpoint?{endpoint}:{}),components,
    repositoryEndpointGaps:endpoint?.scope==='repository'&&endpoint.state!=='claimed'?1:0,
    repositoryComponentGaps:components.filter(row=>row.scope==='repository'&&row.state!=='claimed').length,
    externalEndpointGaps:endpoint?.scope==='external'&&endpoint.state!=='claimed'?1:0,
    externalComponentGaps:components.filter(row=>row.scope==='external'&&row.state!=='claimed').length};
}

/** An endpoint claim alone never covers a path through undeclared aliases.
 * Resolve raw component order first, then check every recorded component's
 * own required role. Outside components remain explicit gaps for a separately
 * bound external protocol; an outside spelling cannot bypass source claims. */
export function runtimeSubjectValidator(root:string,snapshot:InputSnapshot,options:{capturedIdentities?:boolean;memoizeClaims?:boolean}={}){
  const claims=compileRuntimeRepositoryClaims(root,snapshot,{memoize:options.memoizeClaims??true}),anchor=runtimeSourceAnchor(root);
  return {matchingStatistics:claims.statistics,assess(row:RuntimeObservation,subject:InputSubject,observer:FileObserverReceipt|null):RuntimeSubjectAssessment{
    const requirement=runtimeInputRequirement(row,subject,observer),components:RuntimeSubjectAssessment['components']=[];
    const captured=options.capturedIdentities||subject.kind==='path'&&subject.resolution!==undefined;
    const identityBasis:RuntimeSubjectAssessment['identityBasis']=captured?(subject.kind==='descriptor'?'capture-descriptor':'capture-components'):'current-source';
    const base={subject:structuredClone(subject),requirement,outcome:'unknown' as const,identityBasis,components};
    if(requirement.kind==='literal')return {...base,state:'literal'};
    if(requirement.kind==='unknown')return {...base,state:'uncovered',reason:requirement.reason};
    return anchor.fence(()=>{
    const spelling=subject.kind==='descriptor'?subject.target:subject.anchor.kind==='absolute'?subject.name:subject.anchor.path+'/'+subject.name;
    if(captured){
      let identity:InputIdentity;
      if(subject.kind==='descriptor')identity={state:'resolved',path:subject.target};
      else{
        const proof=subject.resolution;
        if(!proof||proof.state==='unavailable')return {...base,state:'uncovered',spelling,reason:'capture-time pathname identity unavailable'+(proof?': '+proof.error:'')};
        if(proof.finalLink&&requirement.following==='no-follow')return {...base,state:'uncovered',spelling,reason:'capture-time final no-follow link identity was not retained'};
        for(const part of proof.components){
          const observations:HostObservation[]=[{kind:'runtimeKind',path:part.path,value:part.kind==='missing'?null:part.kind}];
          if(part.kind==='symlink'&&part.link!==undefined)observations.push({kind:'readlink',path:part.path,value:part.link});
          for(const observation of observations)components.push({observation,answer:inside(root,observation.path)?claims.matchComponent(observation):anchor.component(observation)});
        }
        const final=proof.components.at(-1);
        identity=proof.state==='resolved'?{state:'resolved',path:proof.path}:{state:proof.state,path:spelling,component:proof.path,kind:final?.kind==='missing'?null:final?.kind??null};
      }
      const endpoint=claims.match(requirement,identity),complete=endpoint.kind==='claimed'&&components.every(row=>row.answer.kind==='claimed');
      return {...base,state:complete?'claimed':'uncovered',spelling,identity,endpoint};
    }
    const facts:HostObservation[]=[],filesystem=new OracleFilesystem(fact=>{facts.push(fact);});
    const recordComponents=()=>{for(const observation of facts){
      const answer=inside(root,observation.path)?claims.matchComponent(observation):anchor.component(observation);
      components.push({observation:structuredClone(observation),answer});
    }};
    let identity:InputIdentity;
    try{identity=filesystem.inputIdentity(spelling,root,subject.kind!=='descriptor'&&requirement.following!=='no-follow',fact=>{facts.push(fact);});}
    catch(error){recordComponents();return {...base,state:'uncovered',spelling,reason:'source identity unresolved: '+String(error)};}
    recordComponents();
    const endpoint=claims.match(requirement,identity),complete=endpoint.kind==='claimed'&&components.every(row=>row.answer.kind==='claimed');
    return {...base,state:complete?'claimed':'uncovered',spelling,identity,endpoint};
    });
  }};
}

export type RuntimeTargetInputs={target:RustRuntimeTarget;snapshot:InputSnapshot};
/** Matching is provisional during the exact index pass being authenticated.
 * Atomic publication waits for native/derived equality and terminal drain.
 * There is no second index read whose changed rows could inherit authority.
 * Product status and setup work remain separate from runtime coverage. */
export async function validateRustInputCapture(options:{capture:RustInputCapture;output:string;targets:ReadonlyMap<string,RuntimeTargetInputs>;execution?:CaptureArtifact&{path:string};build?:CaptureArtifact&{path:string};memoizeClaims?:boolean}){
  const {capture}=options,validators=new Map<string,ReturnType<typeof runtimeSubjectValidator>>(),installed=new Map<string,ReturnType<typeof runtimeInstalledInputClassifier>>();
  const execution=options.execution?readRustTestExecution(options.execution):undefined,classifier=execution?rustTestExecutionClassifier(execution):undefined,images=new Map<number,InputIndexExecution>();
  const buildReference=options.build??(execution?.cargo.path?{...execution.cargo,path:execution.cargo.path}:undefined);
  const build=buildReference?readRustBuildProvenance(buildReference):{artifacts:[],outputDirectories:[]};
  if(execution?.provenance&&execution.provenance.sourceRoot!==capture.root)throw Error('Rust input validation: capture provenance has a different source root');
  const provenance=runtimeProvenanceClassifier({sourceRoot:capture.root,...build,roots:execution?.provenance?.roots??[],...(execution?.provenance?{window:execution.provenance.window}:{})});
  if(execution&&buildReference&&(buildReference.sha256!==execution.cargo.sha256||buildReference.bytes!==execution.cargo.bytes))
    throw Error('Rust input validation: Cargo provenance differs from replay receipt');
  if(execution&&JSON.stringify(execution.target)!==JSON.stringify(capture.target))throw Error('Rust input validation: replay receipt has a different Cargo target');
  const counts={runtimeAttempts:0,subjects:0,reportedSubjects:0,claimed:0,literals:0,gaps:0,probes:0,setupAttempts:0,terminalFacts:0,
    emittedExecutables:0,loaderProbes:0,ownedOutputs:0,buildArtifacts:0,buildScriptOutputs:0,hostEnvironment:0,buildNamespace:0,installedDependencies:0,
    repositorySubjects:0,externalSubjects:0,unresolvedSubjects:0,repositoryEndpointGaps:0,repositoryComponentGaps:0,externalEndpointGaps:0,externalComponentGaps:0};
  const unresolvedByKind:Record<string,number>={};
  const repositoryCoverage=()=>counts.repositoryEndpointGaps||counts.repositoryComponentGaps?'incomplete' as const:
    counts.unresolvedSubjects||counts.probes?'unresolved' as const:'complete' as const;
  let receipt:Awaited<ReturnType<typeof authenticateRustInputTrace>>|undefined;
  await durableRecordStream(options.output,async append=>{
    let batch:string[]=[],size=0;
    const flush=async()=>{if(size){const text=batch.join('');batch=[];size=0;await append(text);}};
    const emit=async(value:unknown)=>{
      const line=JSON.stringify(value)+'\n',bytes=Buffer.byteLength(line);
      if(bytes>MAX_OBSERVATION_ROW_BYTES)throw Error('Rust input validation: report row exceeds bounded row size');
      batch.push(line);size+=bytes;if(size>=64*1024)await flush();
    };
    const pool=rustInputReportPool(emit);
    await emit({kind:'validation-start',version:6,retention:'uncovered-and-probes',index:capture.index,raw:capture.raw,sourceRoot:capture.root,outcomes:'unknown',identityBasis:'capture-identity-or-labelled-history',
      provenance:{build:buildReference??null,execution:options.execution??null}});
    receipt=await authenticateRustInputTrace(capture,async row=>{
      if(row.kind==='execution'){images.set(row.id,row);return;}
      if(row.kind==='terminal-fact'){counts.terminalFacts++;return;}
      if(row.kind!=='observation')return;
      if(row.phase!=='test-runtime'&&row.phase!=='doctest-runtime'){
        counts.setupAttempts++;return;
      }
      const source=row.source,inputs=source?options.targets.get(source):undefined;
      if(!source||!inputs||inputs.target.source!==source)throw Error('Rust input validation: runtime source has no Cargo declaration: '+String(source));
      if(row.phase==='test-runtime'&&!inputs.target.unitTests||row.phase==='doctest-runtime'&&!inputs.target.doctests)
        throw Error('Rust input validation: target does not own '+row.phase+': '+source);
      if(row.phase==='test-runtime'&&(!capture.target||capture.target.source!==source||capture.target.name!==inputs.target.name
        ||JSON.stringify([...capture.target.kind].sort())!==JSON.stringify([...inputs.target.kind].sort())))
        throw Error('Rust input validation: Cargo artifact target mismatch: '+source);
      let validator=validators.get(source);
      if(!validator){
        validateReaderSourceObservations(inputs.snapshot,capture.root);
        for(const fact of inputs.snapshot.observations)if(fact.environment)
          await emit({kind:'project-host-observation',source,observation:fact.observation,environment:fact.environment,scope:'host-environment'});
        for(const fact of inputs.snapshot.observations)if(fact.dependency)
          await emit({kind:'project-installed-observation',source,observation:fact.observation,dependency:fact.dependency,scope:'installed-dependency'});
        validator=runtimeSubjectValidator(capture.root,inputs.snapshot,{capturedIdentities:execution?.version===2||build.buildNamespace!==undefined,memoizeClaims:options.memoizeClaims??true});validators.set(source,validator);
        installed.set(source,runtimeInstalledInputClassifier(capture.root,inputs.snapshot));
      }
      counts.runtimeAttempts++;counts.probes+=row.probes.length;
      const image=images.get(row.image);if(image)classifier?.observe(row,image);
      for(const subject of row.subjects){
        counts.subjects++;
        const requirement=runtimeInputRequirement(row,subject,capture.observer);
        const known=provenance.classify(subject,requirement)??installed.get(source)?.classify(subject,requirement);
        if(known){
          if(known.kind==='owned-output')counts.ownedOutputs++;
          else if(known.kind==='cargo-artifact')counts.buildArtifacts++;
          else if(known.kind==='build-script-output')counts.buildScriptOutputs++;
          else if(known.kind==='build-namespace')counts.buildNamespace++;
          else if(known.kind==='installed-dependency')counts.installedDependencies++;
          else counts.hostEnvironment++;
          if(inside(capture.root,known.path))counts.repositorySubjects++;else counts.externalSubjects++;
          continue;
        }
        const assessment=validator.assess(row,subject,capture.observer);
        const classification=image?classifier?.classify(row,image,assessment):undefined;
        if(classification?.kind==='emitted-executable')counts.emittedExecutables++;
        else if(classification?.kind==='loader-probe')counts.loaderProbes++;
        else if(assessment.state==='claimed')counts.claimed++;else if(assessment.state==='literal')counts.literals++;else counts.gaps++;
        const scope=runtimeAssessmentScope(capture.root,assessment);
        if(scope.scope==='repository')counts.repositorySubjects++;else if(scope.scope==='external')counts.externalSubjects++;
        else if(scope.scope==='unresolved'&&!classification)counts.unresolvedSubjects++;
        if(!classification){
          counts.repositoryEndpointGaps+=scope.repositoryEndpointGaps;counts.repositoryComponentGaps+=scope.repositoryComponentGaps;
          counts.externalEndpointGaps+=scope.externalEndpointGaps;counts.externalComponentGaps+=scope.externalComponentGaps;
        }
        // The authenticated raw stream retains every attempt. The decision
        // report counts discharged subjects and keeps full evidence only
        // where a declaration or provenance obligation remains unresolved.
        if(!classification&&assessment.state==='uncovered'){
          counts.reportedSubjects++;
          const key=assessment.requirement.kind+':'+row.syscall;unresolvedByKind[key]=(unresolvedByKind[key]??0)+1;
          await emit({kind:'runtime-subject',source,phase:row.phase,attempt:row.attempt,image:row.image,syscall:row.syscall,args:row.args,
            ...await pool.subject({...assessment,scope})});
        }
      }
      if(row.probes.length)await emit({kind:'runtime-probes',source,phase:row.phase,attempt:row.attempt,probes:row.probes,outcome:'unknown'});
    });
    if(execution&&(receipt.complete.raw.path!==execution.raw.path||receipt.complete.raw.sha256!==execution.raw.sha256
      ||receipt.complete.raw.bytes!==execution.raw.bytes||receipt.complete.terminal.root!==execution.pid))
      throw Error('Rust input validation: replay receipt differs from authenticated raw capture');
    await emit({kind:'validation-complete',version:6,complete:true,coverage:counts.gaps||counts.probes?'incomplete':'complete',repositoryCoverage:repositoryCoverage(),counts,unresolvedByKind,
      indexRowsSha256:receipt.indexRowsSha256,raw:receipt.complete.raw,terminal:receipt.complete.terminal});
    await flush();
  },{gzip:true});
  if(!receipt)throw Error('Rust input validation: authentication did not complete');
  return {counts,unresolvedByKind,coverage:counts.gaps||counts.probes?'incomplete' as const:'complete' as const,repositoryCoverage:repositoryCoverage(),indexRowsSha256:receipt.indexRowsSha256,
    matching:[...validators].map(([source,validator])=>({source,...validator.matchingStatistics()}))};
}
