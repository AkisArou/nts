// Node-only step receipt protocol shared by handled and unhandled failures.
import {renameSync,writeFileSync} from 'node:fs';

export type InstrumentResult={version:1;verdict:'INSTRUMENT'|'FAIL'|'NOT RUN';kind:'memory-pressure'|'case-budget'|'hung'|'runaway'|'tooling-setup'|'tooling-cleanup'|'step-bound'|'selector-setup';step:string;attempt:string;reason:string;completedFailures?:number};
export class ToolingInstrumentError extends Error{
  readonly kind:'tooling-setup'|'tooling-cleanup';
  constructor(kind:ToolingInstrumentError['kind'],reason:string,options?:ErrorOptions){super(reason,options);this.kind=kind;this.name='ToolingInstrumentError';}
}
export function publishInstrumentResult(result:InstrumentResult,env:NodeJS.ProcessEnv):void{
  const path=env.NTS_GATE_STEP_RESULT;if(!path||!result.step||!result.attempt)return;
  const temporary=`${path}.${process.pid}`;writeFileSync(temporary,JSON.stringify(result)+'\n');renameSync(temporary,path);
}
export function publishToolingFailure(error:ToolingInstrumentError,env:NodeJS.ProcessEnv=process.env):void{
  if(error.kind!=='tooling-setup'&&error.kind!=='tooling-cleanup')throw Error('invalid tooling instrument kind');
  publishInstrumentResult({version:1,verdict:'INSTRUMENT',kind:error.kind,step:env.NTS_GATE_STEP??'',attempt:env.NTS_GATE_STEP_ATTEMPT??'',reason:error.message},env);
}
