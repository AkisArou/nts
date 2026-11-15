// Portable declarations only. The ordinary execution owner must not acquire
// the graph, SDK, selector or trace validator through this module.
import {readFileSync} from 'node:fs';
import {dirname,isAbsolute,posix,relative,sep} from 'node:path';
import type {InputKind,ModuleDeclarations,ReaderInput,DirectoryCandidate} from './reader-inputs/main.ts';

export type RustInputTarget={source:string;name:string;kind:string[]};
export type RustRuntimeTarget=RustInputTarget&{unitTests:boolean;doctests:boolean};
export type RustRuntimeDeclaration={target:RustInputTarget;declarations:ModuleDeclarations};
export type RustRuntimeReader={source:string;declarations:ModuleDeclarations};
export type RustRuntimeManifest={version:1;targets:RustRuntimeDeclaration[];readers?:RustRuntimeReader[]};
const kinds=new Set<InputKind>(['module','data','inspection','conservative','file','optional-file','optional-module','membership','directory-candidates','project-config','project-choice','project-catalogue','project-members','generated-project','fixture','members','installation-inputs','cargo-inputs','dependency-source-inputs','installation-status-inputs']);
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
  const extra=kind==='fixture'?['dataNamespaces']:kind==='members'?['member','data']:kind==='project-choice'?['alternatives']:kind==='project-catalogue'?['directory']:kind==='project-members'?['prefix','optional']:kind==='generated-project'?['directory','include']:kind==='directory-candidates'?['candidates']:[];
  keys(row,['kind','path',...extra],'input in '+source);
  if(kind==='directory-candidates'){
    if(!Array.isArray(row.candidates))fail('directory candidates are not an array in '+source);
    const seen=new Set<string>();
    const candidates=row.candidates.map(value=>{
      const entry=object(value,'directory candidate');keys(entry,['name','kind'],'directory candidate');
      const name=sourcePath(entry.name,'directory candidate name'),kind=text(entry.kind,'directory candidate kind');
      if(name.includes('/')||/[*?\[\]]/.test(name)||!['optional-file','path-exists','file-exists','directory-exists'].includes(kind))fail('invalid directory candidate in '+source);
      const key=JSON.stringify([name,kind]);if(seen.has(key))fail('duplicate directory candidate in '+source);seen.add(key);
      return {name,kind:kind as DirectoryCandidate['kind']};
    });
    return {kind,path,candidates};
  }
  if(kind==='generated-project'){
    if(row.include!=='directory'&&row.include!=='typescript-tree')fail('unsupported generated project include recipe in '+source);
    return {kind,path,directory:specifier(row.directory,'generated project directory'),include:row.include};
  }
  if(kind==='project-choice')return {kind,path,alternatives:strings(row.alternatives,'project alternatives in '+source).map(value=>specifier(value,'project alternative'))};
  if(kind==='project-catalogue')return {kind,path,directory:specifier(row.directory,'project catalogue directory in '+source)};
  if(kind==='project-members'){
    const prefix=row.prefix===''?'':sourcePath(row.prefix,'project member prefix');
    if(prefix.includes('/')||/[*?\[\]]/.test(prefix))fail('project member prefix is not literal in '+source);
    if(row.optional!==undefined&&row.optional!==true)fail('project member optional mode is not true in '+source);
    return {kind,path,prefix,...(row.optional?{optional:true}:{})};
  }
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
  const manifest=object(value,'manifest');keys(manifest,['version','targets','readers'],'manifest');
  if(manifest.version!==1)fail('unsupported manifest version '+String(manifest.version));
  if(!Array.isArray(manifest.targets))fail('manifest has no target array');
  const seen=new Set<string>(),targets:RustRuntimeDeclaration[]=[],readers:RustRuntimeReader[]=[];
  const declarations=(value:unknown,source:string):ModuleDeclarations=>{
    const declared=object(value,'declarations for '+source);keys(declared,['imports','assets'],'declarations for '+source);
    const imports=strings(declared.imports,'imports for '+source).map(path=>specifier(path,'module input'));
    if(!Array.isArray(declared.assets))fail('assets are not an array for '+source);
    return {imports,assets:declared.assets.map(value=>input(value,source))};
  };
  for(const value of manifest.targets){
    const row=object(value,'target declaration');keys(row,['target','declarations'],'target declaration');
    const identity=target(row.target);
    if(seen.has(identity.source))fail('duplicate source owner '+identity.source);seen.add(identity.source);
    targets.push({target:identity,declarations:declarations(row.declarations,identity.source)});
  }
  if(manifest.readers!==undefined){
    if(!Array.isArray(manifest.readers))fail('shared readers are not an array');
    for(const value of manifest.readers){
      const row=object(value,'shared reader');keys(row,['source','declarations'],'shared reader');
      const source=sourcePath(row.source,'shared reader source');
      if(seen.has(source))fail('duplicate source owner '+source);seen.add(source);
      readers.push({source,declarations:declarations(row.declarations,source)});
    }
  }
  return {version:1,targets,...(manifest.readers===undefined?{}:{readers})};
}

export function readRustRuntimeManifest(path:string):RustRuntimeManifest{
  return parseRustRuntimeManifest(JSON.parse(readFileSync(path,'utf8')) as unknown);
}

/** Consume the selector's existing Cargo response. This module never invokes
 * Cargo or infers a target from an executable filename. The traced build binds
 * this portable inventory independently before coverage is accepted. */
export function cargoRustTargetInventory(value:unknown,root:string,scope:'workspace'|'repository'='workspace'):Map<string,RustRuntimeTarget[]>{
  if(!isAbsolute(root))fail('Cargo source root is not absolute');
  const metadata=object(value,'Cargo metadata');
  if(metadata.version!==1)fail('unsupported Cargo metadata version '+String(metadata.version));
  if(!Array.isArray(metadata.packages)||!Array.isArray(metadata.workspace_members))fail('Cargo metadata has no workspace inventory');
  const members=new Set(strings(metadata.workspace_members,'Cargo workspace members'));
  if(members.size!==metadata.workspace_members.length)fail('duplicate Cargo workspace member');
  const groups=new Map<string,RustRuntimeTarget[]>(),sources=new Set<string>(),found=new Set<string>();
  const local=(value:unknown,purpose:string):string=>{
    const path=text(value,purpose);if(!isAbsolute(path))fail(purpose+' is not absolute');
    return sourcePath(relative(root,path).split(sep).join('/'),purpose);
  };
  for(const value of metadata.packages){
    const row=object(value,'Cargo package'),id=text(row.id,'Cargo package id');
    const member=members.has(id),manifestPath=text(row.manifest_path,'Cargo manifest');
    if(!isAbsolute(manifestPath))fail('Cargo manifest is not absolute');
    const part=relative(root,manifestPath),inRoot=part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part);
    if(!member&&(scope!=='repository'||!inRoot))continue;
    if(found.has(id))fail('duplicate Cargo repository package '+id);found.add(id);
    const manifest=local(row.manifest_path,'Cargo manifest'),directory=dirname(manifest).split(sep).join('/');
    const crate=directory==='.'?'':directory;
    if(groups.has(crate))fail('ambiguous Cargo package directory '+crate);
    if(!Array.isArray(row.targets))fail('Cargo package has no targets: '+id);
    const targets:RustRuntimeTarget[]=[];
    for(const value of row.targets){
      const entry=object(value,'Cargo target');
      if(typeof entry.test!=='boolean')fail('Cargo target has no test setting: '+id);
      if(typeof entry.doctest!=='boolean')fail('Cargo target has no doctest setting: '+id);
      if(!member&&(!Array.isArray(entry.kind)||!entry.kind.some(kind=>['lib','rlib','dylib','cdylib','staticlib','proc-macro'].includes(String(kind)))))continue;
      const identity=target({source:local(entry.src_path,'Cargo target source'),name:entry.name,kind:entry.kind});
      // Cargo's doctest setting is independent of test and applies only to
      // library targets: https://doc.rust-lang.org/cargo/reference/cargo-targets.html#the-doctest-field
      const doctests=entry.doctest&&identity.kind.some(kind=>['lib','rlib','dylib','cdylib','staticlib','proc-macro'].includes(kind));
      if(sources.has(identity.source))fail('ambiguous Cargo source owner '+identity.source);
      sources.add(identity.source);targets.push({...identity,unitTests:entry.test,doctests});
    }
    groups.set(crate,targets);
  }
  for(const id of members)if(!found.has(id))fail('Cargo workspace member has no package: '+id);
  return groups;
}

/** Test eligibility does not decide whether a production library can be
 * linked by another target. Keep that complete identity in the same parser. */
export function cargoRustRuntimeTargets(value:unknown,root:string):Map<string,RustRuntimeTarget[]>{
  return new Map([...cargoRustTargetInventory(value,root)].map(([directory,targets])=>[directory,targets.filter(row=>row.unitTests||row.doctests)]));
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
  for(const row of manifest.readers??[]){
    if(declarations.has(row.source)||expected.has(row.source))fail('duplicate source owner '+row.source);
    declarations.set(row.source,row.declarations);
  }
  return declarations;
}
