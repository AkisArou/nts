// A checked inventory of unknown reach. A new unplaced path must be reviewed,
// even if another path acquired a reader in the same change.
import {existsSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

export const FULL_GATE_RECORD=relative(fileURLToPath(new URL('../..',import.meta.url)),fileURLToPath(new URL('../../results/gate/full-gate.json',import.meta.url))).replaceAll('\\','/');
export type FullGateRecord={version:1;files:string[]};
export type InputDirectory={reader:string;directory:string;files:number;steps:string[]};
export type FullGateCensus={version:1;tracked:number;full:{path:string;reasons:string[]}[];directories:InputDirectory[]};

export function collectFullGateCensus(paths:readonly string[],inspect:(path:string)=>{full:boolean;reasons:string[]},directories:InputDirectory[]):FullGateCensus {
  const full:FullGateCensus['full']=[];
  for(const path of [...new Set(paths)].sort()){
    const result=inspect(path);if(result.full)full.push({path,reasons:result.reasons});
  }
  return {version:1,tracked:new Set(paths).size,full,directories};
}
export function parseFullGateRecord(value:unknown):FullGateRecord {
  if(typeof value!=='object'||value===null)throw Error('full-gate census record must be an object');
  const row=value as Record<string,unknown>,files=row.files;
  if(row.version!==1||!Array.isArray(files)||files.some(file=>typeof file!=='string'||!file||file.startsWith('/')||file.split('/').some(part=>part==='.'||part==='..')||/[\\\x00-\x1f]/.test(file)))throw Error('full-gate census record has invalid paths or version');
  const names=files as string[];
  if(new Set(names).size!==names.length||[...names].sort().some((name,index)=>name!==names[index]))throw Error('full-gate census record paths must be unique and sorted');
  return {version:1,files:names};
}
export function fullGateProblems(before:FullGateRecord,after:FullGateCensus):string[] {
  const held=new Set(before.files);
  return after.full.filter(row=>!held.has(row.path)).map(row=>`${row.path} newly owes the full gate: ${row.reasons.join('; ')}`);
}
/** The writer can retire held paths, but cannot add one or raise the count. */
export function runFullGateCensus(root:string,collect:()=>FullGateCensus,{record=false,initialize=false}:{record?:boolean;initialize?:boolean}={}):{census:FullGateCensus;problems:string[]} {
  const file=join(root,FULL_GATE_RECORD);
  if(initialize&&!record)throw Error('full-gate census --initialize requires --record');
  if(initialize&&existsSync(file))throw Error('full-gate census record already exists');
  if(!initialize&&!existsSync(file))throw Error('full-gate census record is missing');
  // Source closure discovery reads this declared leaf during initialization.
  // Only the initializer creates it; a failed collection removes its seed.
  if(initialize){mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify({version:1,files:[]})+'\n',{flag:'wx'});}
  try {
    const before=parseFullGateRecord(JSON.parse(readFileSync(file,'utf8'))),census=collect();
    const problems=initialize?[]:fullGateProblems(before,census);
    if(record&&!problems.length){
      const next:FullGateRecord={version:1,files:census.full.map(row=>row.path).sort()};
      const pending=file+'.next';writeFileSync(pending,JSON.stringify(next,null,2)+'\n');renameSync(pending,file);
    }
    return {census,problems};
  } catch(error) {if(initialize)rmSync(file,{force:true});throw error;}
}
