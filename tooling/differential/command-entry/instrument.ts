// Node-only step receipt protocol shared by handled and unhandled failures.
import {renameSync,writeFileSync} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';

export type DiskBuildRefusal={root:string;target:string;outputs:('nts-dev'|'clippy')[];shortBytes:number;freeBytes:number;floorBytes:number;buildReservedBytes:number;temporaryReservedBytes:number};
/** A refusal describes the actual owner request, never a new allocation. */
export function readDiskBuildRefusal(value:unknown):DiskBuildRefusal{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid disk build refusal');
  const row=value as DiskBuildRefusal;
  if(Object.keys(row).sort().join(',')!=='buildReservedBytes,floorBytes,freeBytes,outputs,root,shortBytes,target,temporaryReservedBytes'
    ||[row.root,row.target].some(path=>typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path)
    ||!Array.isArray(row.outputs)||!row.outputs.length||new Set(row.outputs).size!==row.outputs.length||row.outputs.some(name=>name!=='nts-dev'&&name!=='clippy')
    ||[row.shortBytes,row.freeBytes,row.floorBytes,row.buildReservedBytes,row.temporaryReservedBytes].some(bytes=>!Number.isSafeInteger(bytes)||bytes<0)
    ||row.shortBytes<=0||row.floorBytes+row.buildReservedBytes+row.temporaryReservedBytes-row.freeBytes!==row.shortBytes)
    throw Error('invalid disk build refusal');
  return {...row,outputs:[...row.outputs]};
}
export type InstrumentResult={version:1;verdict:'INSTRUMENT'|'FAIL'|'NOT RUN';kind:'memory-pressure'|'case-budget'|'hung'|'runaway'|'tooling-setup'|'tooling-cleanup'|'step-bound'|'selector-setup'|'disk-capacity';step:string;attempt:string;reason:string;completedFailures?:number;disk?:DiskBuildRefusal};
export class ToolingInstrumentError extends Error{
  readonly kind:'tooling-setup'|'tooling-cleanup'|'disk-capacity';
  constructor(kind:ToolingInstrumentError['kind'],reason:string,options?:ErrorOptions){super(reason,options);this.kind=kind;this.name='ToolingInstrumentError';}
}
export class DiskBuildAdmissionError extends ToolingInstrumentError{
  readonly disk:DiskBuildRefusal;
  constructor(value:DiskBuildRefusal){
    const disk=readDiskBuildRefusal(value);
    super('disk-capacity',`disk build admission: ${disk.target} needs ${disk.shortBytes} more bytes above the ${disk.floorBytes/2**30} GiB floor and active build promises (${disk.buildReservedBytes} build bytes, ${disk.temporaryReservedBytes} temporary bytes; ${disk.freeBytes} free bytes)`);
    this.name='DiskBuildAdmissionError';this.disk=disk;
  }
}
export function publishInstrumentResult(result:InstrumentResult,env:NodeJS.ProcessEnv):void{
  const path=env.NTS_GATE_STEP_RESULT;if(!path||!result.step||!result.attempt)return;
  const temporary=`${path}.${process.pid}`;writeFileSync(temporary,JSON.stringify(result)+'\n');renameSync(temporary,path);
}
export function publishToolingFailure(error:ToolingInstrumentError,env:NodeJS.ProcessEnv=process.env):void{
  if(error.kind!=='tooling-setup'&&error.kind!=='tooling-cleanup'&&error.kind!=='disk-capacity')throw Error('invalid tooling instrument kind');
  const disk=error.kind==='disk-capacity'?readDiskBuildRefusal((error as DiskBuildAdmissionError).disk):undefined;
  publishInstrumentResult({version:1,verdict:'INSTRUMENT',kind:error.kind,step:env.NTS_GATE_STEP??'',attempt:env.NTS_GATE_STEP_ATTEMPT??'',reason:error.message,...(disk?{disk}:{})},env);
}
