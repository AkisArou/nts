// Node-only step receipt protocol shared by handled and unhandled failures.
import {renameSync,writeFileSync} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';

export type DiskBuildRefusal={root:string;target:string;outputs:('nts-dev'|'clippy')[]} & (
  {kind:'shortfall';shortBytes:number;freeBytes:number;floorBytes:number;buildReservedBytes:number;temporaryReservedBytes:number;intent?:never}
  |{kind:'target-fenced';intent:{token:string;root:string;pid:number;identity:string};
    shortBytes?:never;freeBytes?:never;floorBytes?:never;buildReservedBytes?:never;temporaryReservedBytes?:never});
/** A refusal describes the actual owner request, never a new allocation. */
export function readDiskBuildRefusal(value:unknown):DiskBuildRefusal{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid disk build refusal');
  // Main's version-1 receipts predate the discriminant. Accept only its
  // exact shortfall key set; malformed and unknown variants still refuse.
  const legacyKeys='buildReservedBytes,floorBytes,freeBytes,outputs,root,shortBytes,target,temporaryReservedBytes';
  const row=(Object.keys(value).sort().join(',')===legacyKeys?{...value,kind:'shortfall'}:value) as DiskBuildRefusal;
  if([row.root,row.target].some(path=>typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path)
    ||!Array.isArray(row.outputs)||!row.outputs.length||new Set(row.outputs).size!==row.outputs.length||row.outputs.some(name=>name!=='nts-dev'&&name!=='clippy'))
    throw Error('invalid disk build refusal');
  if(row.kind==='shortfall'){
    if(Object.keys(row).sort().join(',')!=='buildReservedBytes,floorBytes,freeBytes,kind,outputs,root,shortBytes,target,temporaryReservedBytes'
      ||[row.shortBytes,row.freeBytes,row.floorBytes,row.buildReservedBytes,row.temporaryReservedBytes].some(bytes=>!Number.isSafeInteger(bytes)||bytes<0)
      ||row.shortBytes<=0||row.floorBytes+row.buildReservedBytes+row.temporaryReservedBytes-row.freeBytes!==row.shortBytes)
      throw Error('invalid disk build refusal: shortfall');
    return {...row,outputs:[...row.outputs]};
  }
  if(row.kind==='target-fenced'){
    const intent=row.intent;
    if(Object.keys(row).sort().join(',')!=='intent,kind,outputs,root,target'||!intent||typeof intent!=='object'
      ||Object.keys(intent).sort().join(',')!=='identity,pid,root,token'
      ||typeof intent.token!=='string'||!intent.token||typeof intent.identity!=='string'||!intent.identity
      ||!Number.isSafeInteger(intent.pid)||intent.pid<=0||typeof intent.root!=='string'||!isAbsolute(intent.root)||resolve(intent.root)!==intent.root
      ||!(row.target===intent.root||row.target.startsWith(intent.root+'/')||intent.root.startsWith(row.target+'/')))
      throw Error('invalid disk build refusal: target-fenced');
    return {...row,outputs:[...row.outputs],intent:{...intent}};
  }
  throw Error('unsupported disk build refusal variant: '+JSON.stringify((row as {kind?:unknown}).kind));
}
export function describeDiskBuildRefusal(value:DiskBuildRefusal):string{
  const disk=readDiskBuildRefusal(value);
  if(disk.kind==='target-fenced')return `target-fenced: ${disk.target}; intent ${disk.intent.token} on ${disk.intent.root}; holder pid ${disk.intent.pid}, birth ${disk.intent.identity}`;
  return `shortfall: ${disk.target} needs ${disk.shortBytes} more bytes above the ${disk.floorBytes/2**30} GiB floor and active build promises (${disk.buildReservedBytes} build bytes, ${disk.temporaryReservedBytes} temporary bytes; ${disk.freeBytes} free bytes)`;
}
export type InstrumentResult={version:1;verdict:'INSTRUMENT'|'FAIL'|'NOT RUN';kind:'memory-pressure'|'case-budget'|'hung'|'runaway'|'tooling-setup'|'tooling-cleanup'|'step-bound'|'selector-setup'|'disk-capacity';step:string;attempt:string;reason:string;completedFailures?:number;disk?:DiskBuildRefusal};
export class ToolingInstrumentError extends Error{
  readonly kind:'tooling-setup'|'tooling-cleanup'|'disk-capacity';
  constructor(kind:ToolingInstrumentError['kind'],reason:string,options?:ErrorOptions){super(reason,options);this.kind=kind;this.name='ToolingInstrumentError';}
}
export class DiskBuildAdmissionError extends ToolingInstrumentError{
  readonly disk:DiskBuildRefusal;
  constructor(value:DiskBuildRefusal,reclamation=''){
    const disk=readDiskBuildRefusal(value);
    super('disk-capacity','disk build admission: '+describeDiskBuildRefusal(disk)+reclamation);
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
