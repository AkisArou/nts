// Fixed resource values are fixture declarations. Physical scope identity may
// locate the row, but it never supplies the row's logical process membership.
import {readFileSync} from 'node:fs';
import {HOST_OBSERVATIONS,hostObservations,parseMemberDeclaration,type HostObservationFixture} from './host-observations.ts';
import {durableRecord} from './durable-record.ts';
import {generatedJavaScript} from './generated-javascript.ts';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';

export function declareFixedMembers(env:NodeJS.ProcessEnv,group:string,members:readonly number[]):void{
  const file=env[HOST_OBSERVATIONS];if(!file)throw Error('fixture membership requires owned host observations');
  const packet=JSON.parse(readFileSync(file,'utf8')) as HostObservationFixture;
  if(packet.resident.kind==='live')return;
  const directory=packet.memberDeclarations?.directory;
  if(!directory)throw Error('fixture membership requires a declared record directory');
  // Each declaration owns one publication. Readers union immutable records;
  // no actor can overwrite a peer's row or the resource packet's reading.
  durableRecord(join(directory,randomUUID()+'.json'),parseMemberDeclaration({version:1,group,members:[...members]}));
}
/** Scope identity is physical wiring; the member values remain the fixture's. */
export const fixtureCgroup=():string=>hostObservations({}).ownCgroup();
export function declareOwnMembers(env:NodeJS.ProcessEnv,members:readonly number[]):void{
  declareFixedMembers(env,fixtureCgroup(),members);
}

/** The named unit's shell is the known logical actor. It keeps its PID when
 * it execs the payload; the short declaration helper scans no membership. */
export function fixedMembersUnitCommand(command:readonly string[]):string[]{
  const [node,...entry]=fixedMembersEntryArguments();
  return ['sh','-c','set -e; "$1" --input-type=module -e "$2"; shift 2; exec "$@"','fixture-members',node!,entry[2]!,...command];
}

export function fixedMembersEntryArguments():string[]{
  const declare=generatedJavaScript(`import{declareOwnMembers}from ${JSON.stringify(import.meta.url)};declareOwnMembers(process.env,[process.ppid]);`);
  return [process.execPath,'--input-type=module','-e',declare];
}
