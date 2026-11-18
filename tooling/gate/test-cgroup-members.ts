// Fixed resource values are fixture declarations. Physical scope identity may
// locate the row, but it never supplies the row's logical process membership.
import {readFileSync} from 'node:fs';
import {HOST_OBSERVATIONS,hostObservations,type HostObservationFixture} from './host-observations.ts';
import {durableRecord} from './durable-record.ts';
import {generatedJavaScript} from './generated-javascript.ts';

export function declareFixedMembers(env:NodeJS.ProcessEnv,group:string,members:readonly number[]):void{
  const file=env[HOST_OBSERVATIONS];if(!file)throw Error('fixture membership requires owned host observations');
  const packet=JSON.parse(readFileSync(file,'utf8')) as HostObservationFixture;
  if(packet.resident.kind==='live')return;
  const previous=packet.resident.members?.[group]??[];
  packet.resident.members={...packet.resident.members,[group]:[...new Set([...previous,...members])]};
  durableRecord(file,packet);
}
/** Scope identity is physical wiring; the member values remain the fixture's. */
export const fixtureCgroup=():string=>hostObservations({}).ownCgroup();
export function declareOwnMembers(env:NodeJS.ProcessEnv,members:readonly number[]):void{
  declareFixedMembers(env,fixtureCgroup(),members);
}

/** The named unit's shell is the known logical actor. It keeps its PID when
 * it execs the payload; the short declaration helper scans no membership. */
export function fixedMembersUnitCommand(command:readonly string[]):string[]{
  const declare=generatedJavaScript(`import{declareOwnMembers}from ${JSON.stringify(import.meta.url)};declareOwnMembers(process.env,[process.ppid]);`);
  return ['sh','-c','set -e; "$1" --input-type=module -e "$2"; shift 2; exec "$@"','fixture-members',process.execPath,declare,...command];
}
