import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SpawnSyncReturns} from 'node:child_process';
import {hostFault,userManager,userManagerFailure,UserBusUnreachableError,UserManagerSignalError,type UserManagerSpawn} from './user-manager.ts';
import {HostStateError} from './host-state.ts';
import {ToolingInstrumentError} from './step-result.ts';

type Answer={status:number|null;signal?:NodeJS.Signals|null;stdout?:string;stderr?:string;error?:Error};
function scripted(...answers:Answer[]):{spawn:UserManagerSpawn;calls:string[][]}{
  const calls:string[][]=[];
  const spawn:UserManagerSpawn=(command,args)=>{
    calls.push([command,...args]);
    const answer=answers.shift();if(!answer)throw Error('unscripted user-manager call');
    return {pid:1,output:[],stdout:answer.stdout??'',stderr:answer.stderr??'',status:answer.status,signal:answer.signal??null,
      ...(answer.error?{error:answer.error}:{})} as SpawnSyncReturns<string>;
  };
  return {spawn,calls};
}
/** A path expected to answer: a fault it raises is this test's failure, never
 * a host-state hold of its file. */
function answered<T>(call:()=>T):T{
  try{return call();}catch(error){throw new Error(`expected the user manager's answer, got: ${String(error)}`);}
}
const NOT_CONNECTED={status:1,stderr:"Failed to start a.slice: Transport endpoint is not connected\nSee user logs and 'systemctl --user status a.slice' for details.\n"};
const TIMED_OUT={status:1,stderr:'Call failed: Connection timed out\n'};

test('each transport errno, whole-line, is bus evidence; a signal is its own; other answers are neither',()=>{
  for(const text of ['Transport endpoint is not connected','Connection timed out','Connection refused','Connection reset by peer']){
    assert.deepEqual(hostFault({status:1,signal:null,stderr:`Failed to stop a.slice: ${text}\n`}),{bus:`Failed to stop a.slice: ${text}`});
    assert.deepEqual(hostFault({status:1,signal:null,stderr:`Call failed: ${text}\n`}),{bus:`Call failed: ${text}`});
  }
  assert.deepEqual(hostFault({status:null,signal:'SIGKILL',stderr:''}),{signal:'SIGKILL'});
  for(const stderr of ['Failed to connect to bus: No such file or directory','Job for a.slice failed because a timeout was exceeded.',
    'Failed to start a.slice: Unit a.slice has a bad unit file setting.','Call failed: Unit a.slice already exists.','',
    'note: Call failed: Connection timed out','Call failed: Connection timed out (retrying)'])
    assert.equal(hostFault({status:1,signal:null,stderr}),undefined,stderr);
  assert.equal(hostFault({status:0,signal:null,stderr:'Call failed: Connection timed out'}),undefined);
  // Our own spawn timeout is the caller's hang guard, not the host.
  assert.equal(hostFault({status:null,signal:'SIGTERM',stderr:'',error:Object.assign(Error('spawnSync systemctl ETIMEDOUT'),{code:'ETIMEDOUT'})}),undefined);
});

test('unreachable twice is a named host-state error after exactly one retry',()=>{
  const {spawn,calls}=scripted(NOT_CONNECTED,TIMED_OUT);
  assert.throws(()=>userManager('systemctl',['start','a.slice'],{phase:'tooling-setup'},spawn),(error:unknown)=>{
    assert.ok(error instanceof UserBusUnreachableError&&error instanceof HostStateError&&error instanceof ToolingInstrumentError);
    assert.equal(error.kind,'tooling-setup');
    assert.equal(error.message,'systemd user bus unreachable: systemctl --user start a.slice (2 attempts): Failed to start a.slice: Transport endpoint is not connected; then Call failed: Connection timed out');
    const within=error.within('resident cap: a.slice start job not answered');
    assert.ok(within instanceof UserBusUnreachableError);assert.equal(within.cause,error);assert.equal(within.kind,'tooling-setup');
    assert.match(within.message,/^resident cap: a\.slice start job not answered: systemd user bus unreachable/);
    return true;
  });
  assert.deepEqual(calls,[['systemctl','--user','start','a.slice'],['systemctl','--user','start','a.slice']]);
});

test('a call ended by a signal names the signal, not the bus',()=>{
  for(const answers of [[{status:null,signal:'SIGKILL'},{status:null,signal:'SIGKILL'}],[TIMED_OUT,{status:null,signal:'SIGKILL'}]] as Answer[][]){
    const {spawn,calls}=scripted(...answers);
    assert.throws(()=>userManager('systemctl',['stop','a.slice'],{phase:'tooling-cleanup'},spawn),(error:unknown)=>{
      assert.ok(error instanceof UserManagerSignalError&&error instanceof HostStateError);
      assert.equal(error.kind,'tooling-cleanup');
      assert.match(error.message,/^user manager call ended by signal SIGKILL \(2 attempts\): systemctl --user stop a\.slice; first attempt: /);
      assert.doesNotMatch(error.message,/bus unreachable|undefined/);
      return true;
    });
    assert.equal(calls.length,2);
  }
});

test('a transient fault is answered by its retry, and the answer says so',()=>{
  const {spawn,calls}=scripted(TIMED_OUT,{status:0,stdout:'o "/job"\n'});
  const result=answered(()=>userManager('busctl',['call','x'],{phase:'tooling-setup'},spawn));
  assert.equal(result.status,0);assert.equal(result.retried,true);assert.equal(result.stdout,'o "/job"\n');
  assert.equal(calls.length,2);
});

test('refusals and evidence-free exits return at once, named by status or signal',()=>{
  const refusal=scripted({status:1,stderr:'Job for a.slice failed: invalid unit configuration (job result: dependency).\n'});
  const refused=answered(()=>userManager('systemctl',['start','a.slice'],{phase:'tooling-setup'},refusal.spawn));
  assert.equal(refusal.calls.length,1);assert.equal(refused.retried,false);
  assert.equal(userManagerFailure(refused),'Job for a.slice failed: invalid unit configuration (job result: dependency). (exit status 1)');
  const silent=scripted({status:1});
  const empty=answered(()=>userManager('busctl',['call','x'],{phase:'tooling-setup'},silent.spawn));
  assert.equal(silent.calls.length,1);assert.equal(userManagerFailure(empty),'no stderr (exit status 1)');
  const hung=scripted({status:null,signal:'SIGTERM',error:Object.assign(Error('spawnSync systemctl ETIMEDOUT'),{code:'ETIMEDOUT'})});
  const guard=answered(()=>userManager('systemctl',['stop','a.slice'],{phase:'tooling-cleanup',timeoutMs:5},hung.spawn));
  assert.equal(hung.calls.length,1);assert.equal(userManagerFailure(guard),'no stderr (spawn error: spawnSync systemctl ETIMEDOUT)');
});
