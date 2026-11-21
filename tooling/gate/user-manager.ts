// The one owner of a call to the systemd user manager (systemctl --user,
// busctl --user). A manager unreachable over its bus, or a call ended by a
// signal, is machine state (a HostStateError); a manager that answers and
// refuses is evidence against the caller, a failure.
import {spawnSync,type SpawnSyncReturns} from 'node:child_process';
import {HostStateError} from './host-state.ts';

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

/** A manager call that ended without the manager's answer, on both attempts. */
export abstract class UserManagerError extends HostStateError{
  declare readonly kind:UserManagerPhase;
  /** The same fault, with its caller's context and this instance as its cause. */
  within(context:string):UserManagerError{
    const Same=this.constructor as new(kind:UserManagerPhase,reason:string,options?:ErrorOptions)=>UserManagerError;
    return new Same(this.kind,`${context}: ${this.message}`,{cause:this});
  }
}
/** The user manager was unreachable over its bus on both attempts. */
export class UserBusUnreachableError extends UserManagerError{
  constructor(kind:UserManagerPhase,reason:string,options?:ErrorOptions){super(kind,reason,options);this.name='UserBusUnreachableError';}
}
/** The call itself was ended by a signal (an OOM kill, say): that is all it shows. */
export class UserManagerSignalError extends UserManagerError{
  constructor(kind:UserManagerPhase,reason:string,options?:ErrorOptions){super(kind,reason,options);this.name='UserManagerSignalError';}
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

type HostFault={bus:string}|{signal:string};
/** One attempt's machine-state evidence: a transport errno line, or an end
 * by signal. Undefined when the manager answered, or the call failed for any
 * other reason; our own spawn timeout is a caller's hang guard. */
export function hostFault(result:Pick<UserManagerResult,'status'|'signal'|'stderr'|'error'>):HostFault|undefined{
  if(result.error)return;
  if(result.status===null)return {signal:result.signal??'(none reported)'};
  if(result.status===0)return;
  const line=TRANSPORT.exec(result.stderr)?.[0];
  return line===undefined?undefined:{bus:line};
}
const evidence=(fault:HostFault)=>'bus' in fault?fault.bus:`ended by signal ${fault.signal}`;

/**
 * Runs `command --user args` once, and once more only when the first attempt
 * shows machine state. Every caller's call is idempotent at the manager. A
 * second such attempt is a named HostStateError: the bus, when both attempts
 * name a transport errno, or the signal that ended the second. Any other
 * outcome returns to the caller, which decides what its refusal means.
 */
export function userManager(command:UserManagerCommand,args:readonly string[],
  options:{phase:UserManagerPhase;timeoutMs?:number},spawn:UserManagerSpawn=spawnSync):UserManagerResult{
  const attempt=(retried:boolean):UserManagerResult=>{
    const result=spawn(command,['--user',...args],{encoding:'utf8',...(options.timeoutMs===undefined?{}:{timeout:options.timeoutMs})});
    return {status:result.status,signal:result.signal,stdout:result.stdout??'',stderr:result.stderr??'',...(result.error?{error:result.error}:{}),retried};
  };
  const first=attempt(false),firstFault=hostFault(first);
  if(firstFault===undefined)return first;
  const second=attempt(true),secondFault=hostFault(second);
  if(secondFault===undefined)return second;
  const call=`${command} --user ${args.join(' ')}`;
  if('signal' in secondFault)
    throw new UserManagerSignalError(options.phase,`user manager call ended by signal ${secondFault.signal} (2 attempts): ${call}; first attempt: ${evidence(firstFault)}`);
  if('signal' in firstFault)
    throw new UserManagerSignalError(options.phase,`user manager call ended by signal ${firstFault.signal} (2 attempts): ${call}; then ${secondFault.bus}`);
  throw new UserBusUnreachableError(options.phase,`systemd user bus unreachable: ${call} (2 attempts): ${firstFault.bus}; then ${secondFault.bus}`);
}
