import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SpawnSyncReturns} from 'node:child_process';
import {busUnreachable,userManager,userManagerFailure,UserBusUnreachableError,type UserManagerSpawn} from './user-manager.ts';
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
const NOT_CONNECTED={status:1,stderr:"Failed to start a.slice: Transport endpoint is not connected\nSee user logs and 'systemctl --user status a.slice' for details.\n"};
const TIMED_OUT={status:1,stderr:'Call failed: Connection timed out\n'};

test('each transport errno, whole-line, is bus-unreachable; other answers are not',()=>{
  for(const text of ['Transport endpoint is not connected','Connection timed out','Connection refused','Connection reset by peer']){
    assert.equal(busUnreachable({status:1,signal:null,stderr:`Failed to stop a.slice: ${text}\n`}),`Failed to stop a.slice: ${text}`);
    assert.equal(busUnreachable({status:1,signal:null,stderr:`Call failed: ${text}\n`}),`Call failed: ${text}`);
  }
  assert.equal(busUnreachable({status:null,signal:'SIGKILL',stderr:''}),'ended by signal SIGKILL');
  for(const stderr of ['Failed to connect to bus: No such file or directory','Job for a.slice failed because a timeout was exceeded.',
    'Failed to start a.slice: Unit a.slice has a bad unit file setting.','Call failed: Unit a.slice already exists.','',
    'note: Call failed: Connection timed out','Call failed: Connection timed out (retrying)'])
    assert.equal(busUnreachable({status:1,signal:null,stderr}),undefined,stderr);
  assert.equal(busUnreachable({status:0,signal:null,stderr:'Call failed: Connection timed out'}),undefined);
  // Our own spawn timeout is the caller's hang guard, not the bus.
  assert.equal(busUnreachable({status:null,signal:'SIGTERM',stderr:'',error:Object.assign(Error('spawnSync systemctl ETIMEDOUT'),{code:'ETIMEDOUT'})}),undefined);
});

test('unreachable twice is a named instrument error after exactly one retry',()=>{
  for(const [phase,answers] of [['tooling-setup',[NOT_CONNECTED,TIMED_OUT]],['tooling-cleanup',[{status:null,signal:'SIGKILL'},{status:null,signal:'SIGKILL'}]]] as const){
    const {spawn,calls}=scripted(...answers);
    assert.throws(()=>userManager('systemctl',['start','a.slice'],{phase},spawn),(error:unknown)=>{
      assert.ok(error instanceof UserBusUnreachableError&&error instanceof ToolingInstrumentError);
      assert.equal(error.kind,phase);
      assert.match(error.message,/^systemd user bus unreachable: systemctl --user start a\.slice \(2 attempts\): /);
      assert.doesNotMatch(error.message,/undefined/);
      if(phase==='tooling-setup')assert.match(error.message,/Transport endpoint is not connected; then Call failed: Connection timed out$/);
      else assert.match(error.message,/ended by signal SIGKILL; then ended by signal SIGKILL$/);
      return true;
    });
    assert.deepEqual(calls,[['systemctl','--user','start','a.slice'],['systemctl','--user','start','a.slice']]);
  }
});

test('a transient fault is answered by its retry, and the answer says so',()=>{
  const {spawn,calls}=scripted(TIMED_OUT,{status:0,stdout:'o "/job"\n'});
  const result=userManager('busctl',['call','x'],{phase:'tooling-setup'},spawn);
  assert.equal(result.status,0);assert.equal(result.retried,true);assert.equal(result.stdout,'o "/job"\n');
  assert.equal(calls.length,2);
});

test('refusals and evidence-free exits return at once, named by status or signal',()=>{
  const refusal=scripted({status:1,stderr:'Job for a.slice failed: invalid unit configuration (job result: dependency).\n'});
  const refused=userManager('systemctl',['start','a.slice'],{phase:'tooling-setup'},refusal.spawn);
  assert.equal(refusal.calls.length,1);assert.equal(refused.retried,false);
  assert.equal(userManagerFailure(refused),'Job for a.slice failed: invalid unit configuration (job result: dependency). (exit status 1)');
  const silent=scripted({status:1});
  const empty=userManager('busctl',['call','x'],{phase:'tooling-setup'},silent.spawn);
  assert.equal(silent.calls.length,1);assert.equal(userManagerFailure(empty),'no stderr (exit status 1)');
  const hung=scripted({status:null,signal:'SIGTERM',error:Object.assign(Error('spawnSync systemctl ETIMEDOUT'),{code:'ETIMEDOUT'})});
  const guard=userManager('systemctl',['stop','a.slice'],{phase:'tooling-cleanup',timeoutMs:5},hung.spawn);
  assert.equal(hung.calls.length,1);assert.equal(userManagerFailure(guard),'no stderr (spawn error: spawnSync systemctl ETIMEDOUT)');
});
