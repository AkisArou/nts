// Declared Programs can observe failed package searches above their source.
// These are replayed host facts, never repository reach or copier authority.
import {dirname,join,resolve} from 'node:path';
import type {HostObservation} from '../differential/oracle-runtime.ts';
import type {ProjectRequest} from './project-inputs.ts';

export type ProjectProgramProvenance={request:ProjectRequest;config:string;
  imports:{source:string;specifier:string}[];types:string[]};
export type ProjectEnvironmentAbsence={kind:'project-environment-absence';source:string;programs:ProjectProgramProvenance[]};

export function projectAncestorAbsence(source:string,observation:HostObservation):boolean{
  if(!((observation.kind==='directoryExists'||observation.kind==='fileExists')&&observation.value===false
    ||observation.kind==='runtimeKind'&&observation.value===null))return false;
  for(let parent=dirname(resolve(source));;parent=dirname(parent)){
    if(observation.path===join(parent,'node_modules'))return true;
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
      &&program.types.every(name=>typeof name==='string'&&name!==''))
    &&projectAncestorAbsence(descriptor.source,observation);
}
