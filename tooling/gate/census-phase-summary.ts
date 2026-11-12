// Arithmetic consumes observations only. Scope CPU remains the independent
// total; a signed remainder exposes missing work and accidental double counts.
import type {CensusPhaseFrame} from '../census/phase-costs.ts';
import type {Check} from './case-costs.ts';

export const CENSUS_PHASE_STEPS=new Set(['typescript-c','typescript-llvm','typescript-jvm','test262-cases','test262-builtins-cases','test262-rest-cases','test262-jvm','test262-llvm']);
const GROUPS={materialization:[],native_capture_check:['capture'],lowering:['lower','prepare'],emission:['c.emit','llvm.emit','jvm.emit'],host_compile_link:[],execution:[],comparison:[]} as const;
type Name=keyof typeof GROUPS;
export type CensusPhaseRow={phase:Name|'unattributed';cases:number|null;cpu_s:number|null;known_cpu_s:number;wall_s:number|null;self_cpu_s:number;child_cpu_s:number;missing_observations:number};
type CompilerPhase=Pick<Check,'phases'|'complete'>&{pid?:number};

export function censusPhaseSummary(frames:readonly CensusPhaseFrame[],compilers:readonly CompilerPhase[],stepCpu:number|undefined,expectedFrames=frames.length){
  const rows=new Map<Name,CensusPhaseRow>();
  for(const name of Object.keys(GROUPS) as Name[])rows.set(name,{phase:name,cases:0,cpu_s:0,known_cpu_s:0,wall_s:0,self_cpu_s:0,child_cpu_s:0,missing_observations:0});
  let observations=0;
  const add=(row:CensusPhaseRow,wall:number,self:number|null,child:number|null)=>{
    observations++;row.wall_s=(row.wall_s??0)+wall;
    if(self===null||child===null)row.missing_observations++;
    row.self_cpu_s+=self??0;row.child_cpu_s+=child??0;row.known_cpu_s+=(self??0)+(child??0);
  };
  for(const frame of frames)for(const phase of frame.phases){
    const row=rows.get(phase.phase)!;row.cases=(row.cases??0)+1;add(row,phase.wall_s,phase.self_cpu_s,phase.child_cpu_s);
  }
  for(const compiler of compilers)for(const name of ['native_capture_check','lowering','emission'] as const){
    const parts=compiler.phases.filter(phase=>(GROUPS[name] as readonly string[]).includes(phase.phase));
    if(!parts.length)continue;
    const row=rows.get(name)!;row.cases=(row.cases??0)+1;
    for(const phase of parts)add(row,phase.wall_s,phase.self_cpu_s,phase.child_cpu_s);
  }
  for(const row of rows.values())row.cpu_s=row.missing_observations?null:row.known_cpu_s;
  const attributed=[...rows.values()].reduce((sum,row)=>sum+row.known_cpu_s,0);
  const total=typeof stepCpu==='number'&&Number.isFinite(stepCpu)&&stepCpu>=0?stepCpu:null;
  const remainder=total===null?null:total-attributed;
  // Each phase subtracts two microsecond rusage readings, plus one final
  // microsecond scope counter. This is quantization, not an allowed cost drift.
  const tolerance=(2*observations+1)/1e6;
  const unmeasured=frames.flatMap(frame=>frame.unmeasured.map(error=>`${frame.project}: ${error}`));
  const compilerPids=new Set(compilers.filter(row=>row.complete).map(row=>row.pid));
  for(const frame of frames)for(const pid of frame.compiler_pids)if(!compilerPids.has(pid))unmeasured.push(`${frame.project}: missing complete compiler phase record for ${pid}`);
  if(expectedFrames>frames.length)unmeasured.push(`missing census phase frames: ${expectedFrames-frames.length} of ${expectedFrames}`);
  const partial=unmeasured.length>0||compilers.some(row=>!row.complete)||[...rows.values()].some(row=>row.missing_observations>0);
  const unattributed:CensusPhaseRow={phase:'unattributed',cases:null,cpu_s:remainder,known_cpu_s:remainder??0,wall_s:null,self_cpu_s:0,child_cpu_s:0,missing_observations:0};
  return {version:1,status:total===null?'unmeasured':partial?'partial':remainder! < -tolerance?'inconsistent':'complete',
    cpu_measure:'getrusage-self-and-wait4-children-v1',step_cpu_measure:'cgroup-v2-scope-v1',step_cpu_s:total,
    attributed_cpu_s:attributed,unattributed_cpu_s:remainder,quantization_tolerance_s:tolerance,
    rows:[...rows.values(),unattributed],unmeasured,
    notes:['Phase wall is summed worker time; concurrent workers overlap, so it is not step wall.',
      'Capture/check, lower/prepare and emission use the compiler phase owner; other phases use worker self CPU and each waited child.',
      'Unattributed is signed scope CPU minus known phase CPU, including startup, dispatch, cleanup and missing observations; it is never clamped to zero.']};
}
