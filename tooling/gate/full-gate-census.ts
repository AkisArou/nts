// A checked inventory of unknown reach. A new unplaced path must be reviewed,
// even if another path acquired a reader in the same change.
import {existsSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

export const FULL_GATE_RECORD=relative(fileURLToPath(new URL('../..',import.meta.url)),fileURLToPath(new URL('../../results/gate/full-gate.json',import.meta.url))).replaceAll('\\','/');
type FullPath={path:string;reasons:string[]};
export type FullGateRecord={version:1;files:string[]}|{version:2;files:string[];policy:FullPath[]};
export type InputDirectory={reader:string;directory:string;files:number;steps:string[];fixture?:{entry:string;owner:string}};
export type FullGateCensus={version:2;tracked:number;full:FullPath[];unplaced:FullPath[];policy:FullPath[];directories:InputDirectory[]};

export function collectFullGateCensus(paths:readonly string[],inspect:(path:string)=>{full:boolean;reasons:string[];policyReasons?:string[]},directories:InputDirectory[]):FullGateCensus {
  const full:FullPath[]=[],unplaced:FullPath[]=[],policy:FullPath[]=[];
  for(const path of [...new Set(paths)].sort()){
    const result=inspect(path);if(!result.full)continue;
    const row={path,reasons:result.reasons};full.push(row);
    if(result.policyReasons?.length)policy.push({path,reasons:[...new Set(result.policyReasons)].sort()});
    else unplaced.push(row);
  }
  return {version:2,tracked:new Set(paths).size,full,unplaced,policy,directories};
}
export function parseFullGateRecord(value:unknown):FullGateRecord {
  if(typeof value!=='object'||value===null)throw Error('full-gate census record must be an object');
  const row=value as Record<string,unknown>,files=row.files;
  if((row.version!==1&&row.version!==2)||!Array.isArray(files)||files.some(file=>typeof file!=='string'||!file||file.startsWith('/')||file.split('/').some(part=>part==='.'||part==='..')||/[\\\x00-\x1f]/.test(file)))throw Error('full-gate census record has invalid paths or version');
  const names=files as string[];
  if(new Set(names).size!==names.length||[...names].sort().some((name,index)=>name!==names[index]))throw Error('full-gate census record paths must be unique and sorted');
  // A version-one record held both kinds. Its held coverage still rejects
  // new fallback paths during the one-time writer migration.
  if(row.version===1)return {version:1,files:names};
  const policy=row.policy;
  if(!Array.isArray(policy)||policy.some(item=>typeof item!=='object'||item===null||typeof item.path!=='string'||!Array.isArray(item.reasons)||!item.reasons.length||item.reasons.some((reason:unknown)=>typeof reason!=='string'||!reason)))throw Error('full-gate census record has invalid policy inventory');
  const entries=policy as FullPath[];
  parseFullGateRecord({version:1,files:entries.map(item=>item.path)});
  return {version:2,files:names,policy:entries};
}
export function fullGateProblems(before:FullGateRecord,after:FullGateCensus):string[] {
  const held=new Set(before.files);
  return after.unplaced.filter(row=>!held.has(row.path)).map(row=>`${row.path} newly owes the full gate: ${row.reasons.join('; ')}`);
}
/** Unknown reach can only shrink. Explicit full policies are listed, not
 * ratcheted: their source rules govern them and owe the full gate. */
export function runFullGateCensus(root:string,collect:()=>FullGateCensus,{record=false,initialize=false}:{record?:boolean;initialize?:boolean}={}):{census:FullGateCensus;problems:string[]} {
  const file=join(root,FULL_GATE_RECORD);
  if(initialize&&!record)throw Error('full-gate census --initialize requires --record');
  if(initialize&&existsSync(file))throw Error('full-gate census record already exists');
  if(!initialize&&!existsSync(file))throw Error('full-gate census record is missing');
  // Source closure discovery reads this declared leaf during initialization.
  // Only the initializer creates it; a failed collection removes its seed.
  if(initialize){mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify({version:2,files:[],policy:[]})+'\n',{flag:'wx'});}
  try {
    const before=parseFullGateRecord(JSON.parse(readFileSync(file,'utf8'))),census=collect();
    const problems=initialize?[]:fullGateProblems(before,census);
    if(record&&!problems.length){
      const next:FullGateRecord={version:2,files:census.unplaced.map(row=>row.path).sort(),policy:census.policy};
      const pending=file+'.next';writeFileSync(pending,JSON.stringify(next,null,2)+'\n');renameSync(pending,file);
    }
    return {census,problems};
  } catch(error) {if(initialize)rmSync(file,{force:true});throw error;}
}
