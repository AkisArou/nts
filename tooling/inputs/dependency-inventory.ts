// One finite inventory algorithm serves verified installations and sealed images.
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,readdirSync,readlinkSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
export type DependencyEntry={path:string;kind:'directory';mode:number}|{path:string;kind:'file';mode:number;bytes:number;sha256:string}|{path:string;kind:'link';target:string};
/** The sealed image's mode policy, also used when comparing installed content. */
export const dependencyImageMode=(entry:Exclude<DependencyEntry,{kind:'link'}>)=>entry.kind==='directory'||entry.mode&0o111?0o555:0o444;
/** Runtime package content excludes installer bookkeeping and acquisition provenance. */
export function dependencyPackageContent(entries:DependencyEntry[]):string{
  return createHash('sha256').update(JSON.stringify(dependencyPackageInventory(entries).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0).map(entry=>
    entry.kind==='link'?entry:{...entry,mode:dependencyImageMode(entry)}))).digest('hex');
}
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const inside=(root:string,path:string)=>{const part=relative(root,path);return !isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep);};
export function dependencyInventory(root:string,directories:readonly string[]=[root]):DependencyEntry[]{
  const result:DependencyEntry[]=[];
  const walk=(directory:string)=>{
    for(const name of readdirSync(directory).sort()){
      const file=join(directory,name),info=lstatSync(file),path=relative(root,file);
      if(info.isSymbolicLink()){
        const target=readlinkSync(file);
        if(isAbsolute(target)||!inside(root,resolve(dirname(file),target)))throw Error('oracle dependency link escapes capture: '+file);
        result.push({path,kind:'link',target});
      }else if(info.isDirectory()){result.push({path,kind:'directory',mode:info.mode&0o777});walk(file);}
      else if(info.isFile()){const bytes=readFileSync(file);result.push({path,kind:'file',mode:info.mode&0o777,bytes:bytes.length,sha256:hash(bytes)});}
      else throw Error('oracle dependency capture contains unsupported file: '+file);
    }
  };
  for(const directory of directories){
    if(!inside(root,directory))throw Error('dependency inventory directory escapes root: '+directory);
    if(directory!==root){const info=lstatSync(directory);if(!info.isDirectory()||info.isSymbolicLink())throw Error('dependency inventory root is not a regular directory: '+directory);
      result.push({path:relative(root,directory),kind:'directory',mode:info.mode&0o777});}
    walk(directory);
  }
  return result;
}
export function dependencyPackageInventory(entries:DependencyEntry[]):DependencyEntry[]{
  const bookkeeping=(path:string)=>path.split(sep).some((part,i,parts)=>parts[i-1]==='node_modules'&&part==='.bin')||
    /(?:^|\/)node_modules\/(?:\.modules\.yaml|\.pnpm-workspace-state-v1\.json)$/.test(path)||
    /(?:^|\/)node_modules\/\.pnpm\/lock\.yaml$/.test(path);
  // Workspace aliases are layout facts, retained in the full installation
  // inventory. Their implementations belong to each consumer's live closure,
  // never to the installed third-party package image.
  return entries.filter(entry=>!bookkeeping(entry.path)&&entry.path.split(sep).includes('node_modules')&&
    !(entry.kind==='link'&&!resolve('/',dirname(entry.path),entry.target).split(sep).includes('node_modules')));
}
