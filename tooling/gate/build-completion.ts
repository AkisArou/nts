// A successful owner build proves warmth. Merely creating a target directory
// does not: interrupted builds keep the unconsumed part of their promise.
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {versionedRecord} from './state-file.ts';
import {assertStateVersion} from './state-version.ts';

export type BuildOutputName='nts-dev'|'clippy';
export function buildGeneration(root:string,name:BuildOutputName):string {
  // Comments and unrelated manifest sections do not make a cache obsolete.
  // Profile values and the pinned toolchain do. Cargo's ambient configuration
  // boundary is owned separately from this declared-output contract.
  const manifest=readFileSync(join(root,'Cargo.toml'),'utf8');
  const sections=manifest.split(/(?=^\[)/m).filter(section=>name==='nts-dev'
    ? /^\[profile\.(?:nts-dev|release)(?:\.|\])/.test(section)
    : /^\[profile\.dev(?:\.|\])/.test(section));
  const normalized=sections.map(section=>section.split('\n').map(line=>line.replace(/#.*$/,'').trim()).filter(Boolean).join('\n'));
  const toolchain=join(root,'rust-toolchain.toml');
  return createHash('sha256').update(JSON.stringify({name,profiles:normalized,
    toolchain:existsSync(toolchain)?readFileSync(toolchain,'utf8').split('\n').map(line=>line.replace(/#.*$/,'').trim()).filter(Boolean):[]})).digest('hex');
}
const marker=(output:string)=>join(output,'.nts-complete.json');
export function completedBuild(root:string,name:BuildOutputName,output:string):boolean {
  if(!existsSync(output)||!existsSync(marker(output)))return false;
  const record=JSON.parse(readFileSync(marker(output),'utf8')) as {version?:unknown;generation?:unknown};
  assertStateVersion(record,1,marker(output));
  return record.version===1&&record.generation===buildGeneration(root,name);
}
export function completeBuild(root:string,name:BuildOutputName,output:string):void {
  // Fixture tool controls may deliberately produce no output at all.
  if(existsSync(output))versionedRecord(marker(output),1,{version:1,generation:buildGeneration(root,name)});
}
