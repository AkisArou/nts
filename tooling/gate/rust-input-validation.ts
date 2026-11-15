// Explicit post-run analysis. It reports potential dependencies of attempts;
// no current source observation is a historical syscall return value.
import {isAbsolute,relative,sep} from 'node:path';
import {OracleFilesystem,type InputIdentity} from '../differential/oracle-filesystem.ts';
import type {HostObservation} from '../differential/oracle-runtime.ts';
import type {InputSnapshot} from './module-closure.ts';
import type {FileObserverReceipt} from './file-input-observer.ts';
import type {InputIndexExecution,InputSubject,RuntimeObservation} from './rust-test-inputs.ts';
import {runtimeInputRequirement,type InputRequirement} from './rust-input-operations.ts';
import {runtimeRepositoryClaims,type RuntimeClaimAnswer} from './rust-input-claims.ts';
import {authenticateRustInputTrace,type RustInputCapture} from './rust-input-authentication.ts';
import {durableRecordStream} from './durable-record.ts';
import {MAX_OBSERVATION_ROW_BYTES} from './file-input-observer.ts';
import {validateReaderSourceObservations} from './reader-observations.ts';
import type {RustRuntimeTarget} from './rust-runtime-declarations.ts';
import {runtimeSourceAnchor} from './rust-source-anchor.ts';
import {readRustTestExecution,rustTestExecutionClassifier} from './rust-test-execution.ts';
import type {CaptureArtifact} from './file-input-observer.ts';
import {rustInputReportPool} from './rust-input-report.ts';

export type RuntimeSubjectAssessment={subject:InputSubject;requirement:InputRequirement;outcome:'unknown';
  state:'claimed'|'uncovered'|'literal';spelling?:string;identity?:InputIdentity;endpoint?:RuntimeClaimAnswer;
  identityBasis:'current-source';components:{observation:HostObservation;answer:RuntimeClaimAnswer}[];reason?:string};
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
export function runtimeSubjectValidator(root:string,snapshot:InputSnapshot){
  const claims=runtimeRepositoryClaims(root,snapshot),anchor=runtimeSourceAnchor(root);
  return {assess(row:RuntimeObservation,subject:InputSubject,observer:FileObserverReceipt|null):RuntimeSubjectAssessment{
    const requirement=runtimeInputRequirement(row,subject,observer),components:RuntimeSubjectAssessment['components']=[];
    const base={subject:structuredClone(subject),requirement,outcome:'unknown' as const,identityBasis:'current-source' as const,components};
    if(requirement.kind==='literal')return {...base,state:'literal'};
    if(requirement.kind==='unknown')return {...base,state:'uncovered',reason:requirement.reason};
    return anchor.fence(()=>{
    const spelling=subject.kind==='descriptor'?subject.target:subject.anchor.kind==='absolute'?subject.name:subject.anchor.path+'/'+subject.name;
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
export async function validateRustInputCapture(options:{capture:RustInputCapture;output:string;targets:ReadonlyMap<string,RuntimeTargetInputs>;execution?:CaptureArtifact&{path:string}}){
  const {capture}=options,validators=new Map<string,ReturnType<typeof runtimeSubjectValidator>>();
  const execution=options.execution?readRustTestExecution(options.execution):undefined,classifier=execution?rustTestExecutionClassifier(execution):undefined,images=new Map<number,InputIndexExecution>();
  if(execution&&JSON.stringify(execution.target)!==JSON.stringify(capture.target))throw Error('Rust input validation: replay receipt has a different Cargo target');
  const counts={runtimeAttempts:0,subjects:0,reportedSubjects:0,claimed:0,literals:0,gaps:0,probes:0,setupAttempts:0,terminalFacts:0,
    emittedExecutables:0,loaderProbes:0,repositorySubjects:0,externalSubjects:0,unresolvedSubjects:0,repositoryEndpointGaps:0,repositoryComponentGaps:0,externalEndpointGaps:0,externalComponentGaps:0};
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
    await emit({kind:'validation-start',version:4,retention:'uncovered-and-probes',index:capture.index,raw:capture.raw,sourceRoot:capture.root,outcomes:'unknown',identityBasis:'current-source'});
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
        validator=runtimeSubjectValidator(capture.root,inputs.snapshot);validators.set(source,validator);
      }
      counts.runtimeAttempts++;counts.probes+=row.probes.length;
      for(const subject of row.subjects){
        const assessment=validator.assess(row,subject,capture.observer);counts.subjects++;
        const image=images.get(row.image),classification=image?classifier?.classify(row,image,assessment):undefined;
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
          await emit({kind:'runtime-subject',source,phase:row.phase,attempt:row.attempt,image:row.image,syscall:row.syscall,args:row.args,
            ...await pool.subject({...assessment,scope})});
        }
      }
      if(row.probes.length)await emit({kind:'runtime-probes',source,phase:row.phase,attempt:row.attempt,probes:row.probes,outcome:'unknown'});
    });
    if(execution&&(receipt.complete.raw.path!==execution.raw.path||receipt.complete.raw.sha256!==execution.raw.sha256
      ||receipt.complete.raw.bytes!==execution.raw.bytes||receipt.complete.terminal.root!==execution.pid))
      throw Error('Rust input validation: replay receipt differs from authenticated raw capture');
    await emit({kind:'validation-complete',version:4,complete:true,coverage:counts.gaps||counts.probes?'incomplete':'complete',repositoryCoverage:repositoryCoverage(),counts,
      indexRowsSha256:receipt.indexRowsSha256,raw:receipt.complete.raw,terminal:receipt.complete.terminal});
    await flush();
  },{gzip:true});
  if(!receipt)throw Error('Rust input validation: authentication did not complete');
  return {counts,coverage:counts.gaps||counts.probes?'incomplete' as const:'complete' as const,repositoryCoverage:repositoryCoverage(),indexRowsSha256:receipt.indexRowsSha256};
}
