// Finite installed-package data, supplied explicitly by the source owner.
import {createHash} from 'node:crypto';
import {constants,closeSync,existsSync,fstatSync,openSync,readFileSync,readSync} from 'node:fs';
import {dirname,join,relative,resolve,isAbsolute,sep} from 'node:path';
import {dependencyInventory,dependencyPackageInventory,type DependencyEntry} from './dependency-inventory.ts';
import type {Identity} from './dependency-identity.ts';

export type DependencyPackage={path:string;name:string;version:string;contentSha256:string};
export type DependencyCatalog={version:1;tree:string;identity:Identity;recipes:{path:string;sha256:string}[];
  inventorySha256:string;entries:DependencyEntry[];packages:DependencyPackage[]};
export type DependencyCatalogTrust={catalogPath:string;catalogSha256:string};
export function readDependencyCatalogTrust(value:unknown):DependencyCatalogTrust|null{
  if(value===null)return null;
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid installation catalog trust input');
  const row=value as DependencyCatalogTrust;
  if(Object.keys(row).some(key=>key!=='catalogPath'&&key!=='catalogSha256')||typeof row.catalogPath!=='string'
    ||!isAbsolute(row.catalogPath)||resolve(row.catalogPath)!==row.catalogPath||typeof row.catalogSha256!=='string'||!/^[a-f0-9]{64}$/.test(row.catalogSha256))
    throw Error('invalid installation catalog trust input');
  return {catalogPath:row.catalogPath,catalogSha256:row.catalogSha256};
}
export const dependencyHash=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
export const localDependencyPath=(path:string)=>typeof path==='string'&&path!==''&&!isAbsolute(path)&&!path.split(sep).some(part=>part==='..'||part==='.'||part==='');

export function installationCatalog(tree:string,identity:Identity,recipes:DependencyCatalog['recipes']):DependencyCatalog{
  const directories=identity.importers.map(path=>join(tree,path,'node_modules')).filter(existsSync);
  const entries=dependencyInventory(tree,directories),packageEntries=dependencyPackageInventory(entries),packages:DependencyPackage[]=[];
  for(const entry of packageEntries)if(entry.kind==='file'&&entry.path.endsWith('/package.json')){
    const metadata=JSON.parse(readFileSync(join(tree,entry.path),'utf8')) as {name?:unknown;version?:unknown};
    if(typeof metadata.name!=='string'||typeof metadata.version!=='string')continue;
    const path=dirname(entry.path),prefix=path+sep;
    packages.push({path,name:metadata.name,version:metadata.version,
      contentSha256:dependencyHash(JSON.stringify(entries.filter(row=>row.path===path||row.path.startsWith(prefix))))});
  }
  return {version:1,tree,identity:structuredClone(identity),recipes:structuredClone(recipes),inventorySha256:dependencyHash(JSON.stringify(entries)),entries,packages};
}

export const MAX_INSTALLATION_CATALOG_BYTES=16*2**20;
export function installationCatalogBytes(path:string):Buffer{
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const info=fstatSync(fd);
    if(!info.isFile()||!Number.isSafeInteger(info.size)||info.size>MAX_INSTALLATION_CATALOG_BYTES)throw Error('installation catalog is not a bounded regular file: '+path);
    const bytes=Buffer.allocUnsafe(info.size+1);let at=0;
    while(at<bytes.length){const size=readSync(fd,bytes,at,bytes.length-at,null);if(size===0)break;at+=size;}
    if(at!==info.size)throw Error('installation catalog changed during bounded read: '+path);
    return bytes.subarray(0,at);
  }finally{closeSync(fd);}
}
/** A pin mismatch is a named live-build condition, never an installation. */
export function readDependencyCatalog(trust:DependencyCatalogTrust|null,tree:string):
  {state:'current';catalog:DependencyCatalog}|{state:'pending';reason:string}{
  if(trust===null)return {state:'pending',reason:'installation catalog is missing'};
  if(!isAbsolute(trust.catalogPath)||!/^[a-f0-9]{64}$/.test(trust.catalogSha256))throw Error('invalid installation catalog trust input');
  let bytes:Buffer;
  try{bytes=installationCatalogBytes(trust.catalogPath);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {state:'pending',reason:'installation catalog is missing: '+trust.catalogPath};throw error;}
  if(dependencyHash(bytes)!==trust.catalogSha256)throw Error('installation catalog digest mismatch: '+trust.catalogPath);
  const catalog=JSON.parse(bytes.toString('utf8')) as DependencyCatalog;
  if(catalog.version!==1||typeof catalog.tree!=='string'||!isAbsolute(catalog.tree)||!Array.isArray(catalog.entries)||!Array.isArray(catalog.packages)
    ||!Array.isArray(catalog.recipes)||!catalog.identity||!Array.isArray(catalog.identity.inputs)
    ||dependencyHash(JSON.stringify(catalog.entries))!==catalog.inventorySha256)throw Error('invalid installation catalog schema: '+trust.catalogPath);
  const paths=new Set<string>();
  for(const row of catalog.entries){
    if(!row||!localDependencyPath(row.path)||!row.path.split(sep).includes('node_modules')||paths.has(row.path))throw Error('invalid installation catalog member');
    paths.add(row.path);
    if(row.kind==='file'){
      if(!Number.isSafeInteger(row.bytes)||row.bytes<0||!/^[a-f0-9]{64}$/.test(row.sha256)||!Number.isInteger(row.mode))throw Error('invalid installation catalog file');
    }else if(row.kind==='link'){
      if(typeof row.target!=='string'||isAbsolute(row.target)||!localDependencyPath(relative(catalog.tree,resolve(catalog.tree,dirname(row.path),row.target))))throw Error('installation catalog link escapes tree');
    }else if(row.kind!=='directory'||!Number.isInteger(row.mode))throw Error('invalid installation catalog directory');
  }
  const packages=new Set<string>();
  for(const row of catalog.packages){
    if(!row||!localDependencyPath(row.path)||typeof row.name!=='string'||!row.name||typeof row.version!=='string'||!row.version||packages.has(row.path)
      ||dependencyHash(JSON.stringify(catalog.entries.filter(entry=>entry.path===row.path||entry.path.startsWith(row.path+sep))))!==row.contentSha256)
      throw Error('invalid installation catalog package identity');
    packages.add(row.path);
  }
  const {key,...identity}=catalog.identity;
  if(dependencyHash(JSON.stringify(identity))!==key)throw Error('installation catalog identity mismatch');
  for(const row of [...catalog.identity.inputs,...catalog.recipes]){
    if(!localDependencyPath(row.path)||typeof row.sha256!=='string')throw Error('installation catalog pin escapes source: '+String(row.path));
    const path=resolve(tree,row.path),part=relative(tree,path);
    if(isAbsolute(part)||part==='..'||part.startsWith('..'+sep))throw Error('installation catalog pin escapes source: '+row.path);
    let actual:string;try{actual=dependencyHash(readFileSync(path));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;actual='absent';}
    if(actual!==row.sha256)return {state:'pending',reason:'installation catalog pin changed: '+row.path};
  }
  return {state:'current',catalog};
}
