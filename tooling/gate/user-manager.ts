// The one owner of a call to the systemd user manager (systemctl --user,
// busctl --user). A manager that cannot be reached over its bus is machine
// state, an instrument outcome; a manager that answers and refuses is evidence
// against the caller, a failure.
import {spawnSync,type SpawnSyncReturns} from 'node:child_process';
import {ToolingInstrumentError} from './step-result.ts';

/** sd-bus's transport errnos, in systemctl's and busctl's whole-line forms.
 * A missing socket or runtime directory ("Failed to connect to bus: No such
 * file or directory") is configuration, and stays a failure. */
const TRANSPORT=/^(?:Failed to [^:\n]+|Call failed): (?:Transport endpoint is not connected|Connection timed out|Connection refused|Connection reset by peer)$/m;

export type UserManagerCommand='systemctl'|'busctl';
export type UserManagerPhase='tooling-setup'|'tooling-cleanup';
export type UserManagerResult={status:number|null;signal:NodeJS.Signals|null;stdout:string;stderr:string;error?:Error;
  /** This answer followed one bus-unreachable attempt. */
  retried:boolean};
export type UserManagerSpawn=(command:string,args:string[],options:{encoding:'utf8';timeout?:number})=>SpawnSyncReturns<string>;

/** The user manager was unreachable on both attempts. */
export class UserBusUnreachableError extends ToolingInstrumentError{
  declare readonly kind:UserManagerPhase;
  constructor(kind:UserManagerPhase,reason:string){super(kind,reason);this.name='UserBusUnreachableError';}
}

/** How a call ended, never 'undefined': its exit status or signal, or its spawn error. */
export function userManagerExit(result:Pick<UserManagerResult,'status'|'signal'|'error'>):string{
  if(result.error)return `spawn error: ${result.error.message}`;
  if(result.status===null)return `ended by signal ${result.signal??'(none reported)'}`;
  return `exit status ${result.status}`;
}
/** A refusal's evidence: its stderr, or that it printed none, and how it ended. */
export function userManagerFailure(result:UserManagerResult):string{
  return `${result.stderr.trim()||'no stderr'} (${userManagerExit(result)})`;
}

/** The bus-unreachable evidence of one attempt, or undefined when the manager
 * answered or the call failed for another reason. Our own spawn timeout is a
 * caller's hang guard, never the bus. */
export function busUnreachable(result:Pick<UserManagerResult,'status'|'signal'|'stderr'|'error'>):string|undefined{
  if(result.error)return;
  if(result.status===null)return `ended by signal ${result.signal??'(none reported)'}`;
  if(result.status===0)return;
  return TRANSPORT.exec(result.stderr)?.[0];
}

/**
 * Runs `command --user args` once, and once more only when the first attempt
 * found the bus unreachable. Every caller's call is idempotent at the manager.
 * A second bus-unreachable attempt is a named instrument error; any other
 * outcome returns to the caller, which decides what its refusal means.
 */
export function userManager(command:UserManagerCommand,args:readonly string[],
  options:{phase:UserManagerPhase;timeoutMs?:number},spawn:UserManagerSpawn=spawnSync):UserManagerResult{
  const attempt=(retried:boolean):UserManagerResult=>{
    const result=spawn(command,['--user',...args],{encoding:'utf8',...(options.timeoutMs===undefined?{}:{timeout:options.timeoutMs})});
    return {status:result.status,signal:result.signal,stdout:result.stdout??'',stderr:result.stderr??'',...(result.error?{error:result.error}:{}),retried};
  };
  const first=attempt(false),firstBus=busUnreachable(first);
  if(firstBus===undefined)return first;
  const second=attempt(true),secondBus=busUnreachable(second);
  if(secondBus===undefined)return second;
  throw new UserBusUnreachableError(options.phase,
    `systemd user bus unreachable: ${command} --user ${args.join(' ')} (2 attempts): ${firstBus}; then ${secondBus}`);
}
