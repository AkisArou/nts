// Declared Programs can observe failed package searches above their source.
// These are replayed host facts, never repository reach or copier authority.
import {dirname,join,resolve} from 'node:path';
import type {HostObservation} from '../differential/oracle-runtime.ts';
import type {ProjectRequest} from './project-discovery.ts';

export type ProjectProgramProvenance={request:ProjectRequest;config:string;
  imports:{source:string;specifier:string}[];types:string[];ownerLookups?:string[]};
export type ProjectEnvironmentAbsence={kind:'project-environment-absence';source:string;programs:ProjectProgramProvenance[]};

export function projectAncestorAbsence(source:string,observation:HostObservation):boolean{
  if(!((observation.kind==='directoryExists'||observation.kind==='fileExists')&&observation.value===false
    ||observation.kind==='runtimeKind'&&observation.value===null))return false;
  for(let parent=dirname(resolve(source));;parent=dirname(parent)){
    if(observation.path===join(parent,'node_modules'))return true;
    if(dirname(parent)===parent)return false;
  }
}
/** Only compiled modules perform the emitter's nearest-config walk. Its
 * out-of-source negative suffix remains a host fact with Program provenance. */
export function projectOwnerAncestorAbsence(source:string,observation:HostObservation):boolean{
  if(!(observation.kind==='fileExists'&&observation.value===false||observation.kind==='runtimeKind'&&observation.value===null))return false;
  for(let parent=dirname(resolve(source));;parent=dirname(parent)){
    if(observation.path===join(parent,'tsconfig.json'))return true;
    if(dirname(parent)===parent)return false;
  }
}
export function projectEnvironmentFact(descriptor:ProjectEnvironmentAbsence,observation:HostObservation):boolean{
  const local=(path:string)=>typeof path==='string'&&path!==''&&!path.startsWith('/')&&!path.split('/').some(part=>part==='..'||part==='.'||part==='');
  return descriptor.kind==='project-environment-absence'&&resolve(descriptor.source)===descriptor.source
    &&descriptor.programs.length>0&&descriptor.programs.every(program=>local(program.config)
      &&(program.request.kind==='config'||program.request.kind==='generated')&&local(program.request.path)
      &&(program.request.kind!=='generated'||local(program.request.directory)&&(program.request.include==='directory'||program.request.include==='typescript-tree'))
      &&program.imports.every(row=>local(row.source)&&typeof row.specifier==='string'&&row.specifier!=='')
      &&program.types.every(name=>typeof name==='string'&&name!=='')
      &&(program.ownerLookups===undefined||program.ownerLookups.length>0&&program.ownerLookups.every(path=>local(path)&&! /\.d\.[cm]?ts$/.test(path))))
    &&(projectAncestorAbsence(descriptor.source,observation)
      ||projectOwnerAncestorAbsence(descriptor.source,observation)&&descriptor.programs.some(program=>program.ownerLookups?.length));
}
