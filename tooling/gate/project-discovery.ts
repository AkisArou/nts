// The pinned compiler owns config matching. A replay parses only the config;
// it constructs no Program and keeps no result across validation calls.
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {isAbsolute,relative,resolve,sep} from 'node:path';
import {OracleFilesystem} from '../differential/oracle-filesystem.ts';
import {prepareGeneratedProject,type GeneratedInclude} from './generated-project.ts';
import type {MetadataChange} from './reader-metadata.ts';

export type ProjectRequest={kind:'config';path:string}|{kind:'generated';path:string;directory:string;include:GeneratedInclude};
export type ProjectMatch={request:ProjectRequest;files:string[]};

function local(value:unknown,purpose:string,empty=false):string{
  if(typeof value!=='string'||(!empty&&!value)||/[\\\x00-\x1f]/.test(value)||isAbsolute(value)
    ||value!==''&&value.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('invalid project discovery '+purpose);
  return value;
}
/** Decoding a query never acquires a compiler or reads its claimed paths. */
export function projectRequest(value:unknown):ProjectRequest{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('project discovery request is not an object');
  const row=value as Record<string,unknown>,fields=row.kind==='config'?['kind','path']:row.kind==='generated'?['kind','path','directory','include']:[];
  if(!fields.length||Object.keys(row).sort().join()!==fields.sort().join())throw Error('invalid project discovery request fields');
  const path=local(row.path,'config path');
  if(row.kind==='config')return {kind:'config',path};
  if(row.include!=='directory'&&row.include!=='typescript-tree')throw Error('invalid project discovery include recipe');
  return {kind:'generated',path,directory:local(row.directory,'directory',true),include:row.include};
}

export function projectMatch(source:string,request:ProjectRequest,files:readonly string[]):ProjectMatch{
  const query=projectRequest(request),seen=new Set<string>();
  const paths=files.map(file=>{
    const path=relative(source,file).split(sep).join('/');local(path,'matched file');
    if(resolve(source,path)!==file||seen.has(path))throw Error('invalid or duplicate project discovery match: '+file);
    seen.add(path);return path;
  });
  return {request:query,files:paths};
}

/** One lazily acquired, explicitly closed SDK session for a validation. Every
 * read owns a fresh filesystem capture and an actual native config parse. */
export function projectDiscoveryOwner(source:string,generatedTemporaryParent?:string){
  const require=createRequire(import.meta.url);
  let api:import('typescript/sync').API|undefined,filesystem:OracleFilesystem|undefined,closed=false;
  const state=()=>{if(!filesystem)throw Error('project discovery has no active filesystem transaction');return filesystem;};
  const acquire=()=>{
    if(api)return api;
    const {API}=require('typescript/sync') as typeof import('typescript/sync'),{serverFS}=require('typescript/fs') as typeof import('typescript/fs');
    return api=new API({cwd:source,fs:{directoryExists:path=>state().directoryExists(path),fileExists:path=>state().fileExists(path),
      getAccessibleEntries:path=>({...state().getAccessibleEntries(path),symlinks:undefined}),
      realpath:path=>state().realpath(path),stat:path=>state().stat(path),readFile:path=>state().readFile(path)??undefined,
      writeFile:serverFS.error,removeFile:serverFS.error}});
  };
  return {read(value:ProjectRequest):ProjectMatch{
    if(closed||filesystem)throw Error('project discovery owner is closed or already reading');
    const request=projectRequest(value);filesystem=new OracleFilesystem();
    let generated:ReturnType<typeof prepareGeneratedProject>|undefined,primary:unknown;
    try{
      if(request.kind==='generated')generated=prepareGeneratedProject({source,extends:request.path,directory:request.directory,include:request.include,parent:generatedTemporaryParent});
      const parsed=acquire().parseConfigFile(generated?.config??resolve(source,request.path));
      if(parsed.errors.length)throw Error('project discovery config cannot be parsed: '+request.path+'\n'+parsed.errors.map(error=>'TS'+error.code+': '+error.text).join('\n'));
      return projectMatch(source,request,parsed.fileNames);
    }catch(error){primary=error;throw error;}
    finally{
      filesystem=undefined;
      try{generated?.close();}catch(cleanup){if(primary!==undefined)throw new AggregateError([primary,cleanup],'project discovery and generated config cleanup failed');throw cleanup;}
    }
  },close(){
    if(filesystem)throw Error('project discovery cannot close an active read');
    if(closed)return;closed=true;api?.close();
  }};
}

/** A post-change Program cannot query a root that disappeared. Replay its
 * request at the committed base and attribute removed matches to the deleted
 * paths, never to a raw directory listing or an unrelated dirty path. */
export function removedProjectMatches<R extends ProjectMatch>(source:string,rows:Iterable<R>,changes:readonly MetadataChange[]):Map<R,string[]>{
  const deleted=changes.filter(change=>change.deleted),affected=new Map<R,string[]>();
  if(!deleted.length)return affected;
  const owner=projectDiscoveryOwner(source),queries=new Map<string,ProjectMatch>();
  try{for(const row of rows){
    // A newly declared config is already an exact byte input of its reader;
    // it supplies no discovery request at the old source.
    if(!existsSync(resolve(source,row.request.path)))continue;
    const key=JSON.stringify(row.request);
    let before=queries.get(key);if(!before){before=owner.read(row.request);queries.set(key,before);}
    const current=new Set(row.files),removed=before.files.filter(file=>!current.has(file));
    const paths=deleted.filter(change=>removed.some(file=>file===change.path||file.startsWith(change.path+'/'))).map(change=>change.path);
    if(paths.length)affected.set(row,paths);
  }}finally{owner.close();}
  return affected;
}
