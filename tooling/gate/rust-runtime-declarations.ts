// Portable declarations only. The ordinary execution owner must not acquire
// the graph, SDK, selector or trace validator through this module.
import {readFileSync} from 'node:fs';
import {posix} from 'node:path';
import type {InputKind,ModuleDeclarations,ReaderInput} from './reader-inputs/main.ts';

export type RustInputTarget={source:string;name:string;kind:string[]};
export type RustRuntimeDeclaration={target:RustInputTarget;declarations:ModuleDeclarations};
export type RustRuntimeManifest={version:1;targets:RustRuntimeDeclaration[]};
const kinds=new Set<InputKind>(['module','data','inspection','file','optional-file','membership','project','project-config','fixture','members']);
function fail(message:string):never{throw Error('Rust runtime declarations: '+message);}
function object(value:unknown,purpose:string):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))fail(purpose+' is not an object');
  return value as Record<string,unknown>;
}
function keys(value:Record<string,unknown>,allowed:readonly string[],purpose:string):void{
  for(const name of Object.keys(value))if(!allowed.includes(name))fail(purpose+' has unknown field '+name);
}
function text(value:unknown,purpose:string):string{
  if(typeof value!=='string'||!value||/[\x00-\x1f\\]/.test(value))fail(purpose+' is not a portable string');
  return value;
}
function sourcePath(value:unknown,purpose:string):string{
  const path=text(value,purpose);
  if(path.startsWith('/')||path.split('/').some(part=>part===''||part==='.'||part==='..'))fail(purpose+' is not repository-relative: '+path);
  return path;
}
function specifier(value:unknown,purpose:string):string{
  const path=text(value,purpose);
  if(path.startsWith('/')||/^[a-z][a-z0-9+.-]*:/i.test(path)||/[?#]/.test(path))fail(purpose+' is not a literal relative input: '+path);
  return path;
}
function strings(value:unknown,purpose:string):string[]{
  if(!Array.isArray(value))fail(purpose+' is not an array');
  return value.map((entry,index)=>text(entry,purpose+'['+index+']'));
}
function target(value:unknown):RustInputTarget{
  const row=object(value,'target');keys(row,['source','name','kind'],'target');
  const source=sourcePath(row.source,'target source'),name=text(row.name,'target name'),kind=strings(row.kind,'target kind');
  if(!kind.length||new Set(kind).size!==kind.length||kind.some(part=>!/^[-a-z0-9]+$/.test(part)))fail('invalid target kind for '+source);
  return {source,name,kind};
}
function input(value:unknown,source:string):ReaderInput{
  const row=object(value,'input in '+source),path=specifier(row.path,'input path in '+source),kind=text(row.kind,'input kind') as InputKind;
  if(!kinds.has(kind))fail('unknown input kind '+kind+' in '+source);
  const extra=kind==='fixture'?['dataNamespaces']:kind==='members'?['member','data']:[];
  keys(row,['kind','path',...extra],'input in '+source);
  if(kind==='fixture'){
    const namespaces=object(row.dataNamespaces,'fixture namespaces in '+source),dataNamespaces:Record<string,string>={};
    for(const [name,owner]of Object.entries(namespaces)){
      sourcePath(name,'fixture namespace');
      Object.defineProperty(dataNamespaces,name,{value:text(owner,'fixture owner'),enumerable:true});
    }
    return {kind,path,dataNamespaces};
  }
  if(kind==='members'){
    const member=sourcePath(row.member,'module member');
    if(member.includes('/')||/[*?\[\]]/.test(member))fail('module member is not a literal basename in '+source);
    if(row.data!==undefined&&row.data!==true)fail('module member data role is not true in '+source);
    return {kind,path,member,...(row.data?{data:true}:{})};
  }
  return {kind,path};
}

export function parseRustRuntimeManifest(value:unknown):RustRuntimeManifest{
  const manifest=object(value,'manifest');keys(manifest,['version','targets'],'manifest');
  if(manifest.version!==1)fail('unsupported manifest version '+String(manifest.version));
  if(!Array.isArray(manifest.targets))fail('manifest has no target array');
  const seen=new Set<string>(),targets:RustRuntimeDeclaration[]=[];
  for(const value of manifest.targets){
    const row=object(value,'target declaration');keys(row,['target','declarations'],'target declaration');
    const identity=target(row.target);
    if(seen.has(identity.source))fail('duplicate source owner '+identity.source);seen.add(identity.source);
    const declared=object(row.declarations,'declarations for '+identity.source);keys(declared,['imports','assets'],'declarations for '+identity.source);
    const imports=strings(declared.imports,'imports for '+identity.source).map(path=>specifier(path,'module input'));
    if(!Array.isArray(declared.assets))fail('assets are not an array for '+identity.source);
    const assets=declared.assets.map(value=>input(value,identity.source));
    targets.push({target:identity,declarations:{imports,assets}});
  }
  return {version:1,targets};
}

export function readRustRuntimeManifest(path:string):RustRuntimeManifest{
  return parseRustRuntimeManifest(JSON.parse(readFileSync(path,'utf8')) as unknown);
}

/** Cargo supplies this inventory. Never invent ownership from an executable
 * basename or the manifest itself; omissions and shared sources are errors. */
export function bindRustRuntimeDeclarations(manifest:RustRuntimeManifest,inventory:readonly RustInputTarget[]):Map<string,ModuleDeclarations>{
  const expected=new Map<string,RustInputTarget>();
  for(const entry of inventory){
    if(expected.has(entry.source))fail('ambiguous Cargo source owner '+entry.source);
    expected.set(entry.source,entry);
  }
  const declarations=new Map<string,ModuleDeclarations>();
  for(const row of manifest.targets){
    const actual=expected.get(row.target.source);
    if(!actual)fail('declaration has no Cargo target: '+row.target.source);
    if(actual.name!==row.target.name||JSON.stringify([...actual.kind].sort())!==JSON.stringify([...row.target.kind].sort()))
      fail('Cargo target mismatch for '+row.target.source+': '+row.target.name+' ['+row.target.kind.join(',')+']');
    // Normalize only to detect aliases; URL resolution and root containment
    // remain the canonical graph's responsibility.
    for(const path of row.declarations.imports)if(posix.isAbsolute(posix.normalize(path)))fail('absolute module input in '+row.target.source);
    declarations.set(row.target.source,row.declarations);
  }
  for(const source of expected.keys())if(!declarations.has(source))fail('Cargo target lacks runtime declarations: '+source);
  return declarations;
}
