// Project declarations and pending discovery have no checker execution dependency.
import {existsSync,readFileSync,lstatSync} from 'node:fs';
import {join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {projectConfig,moduleMembers,type ProjectConfig} from './reader-inputs/main.ts';
import {TOOLING_DIAGNOSTICS,parseDiagnosticRecord,type DiagnosticRecord} from './tooling-type-records.ts';
const ROOT=fileURLToPath(new URL('../..',import.meta.url));
export type TypeProject={project:ProjectConfig;policy:'tooling'|'product'|'javascript';population:{directory:string;member?:string;recursive?:boolean}[]};
export const NODE_BINDINGS=moduleMembers(new URL('../../runtime/node/',import.meta.url),'bindings.node.mjs');
export const TYPE_PROJECTS:readonly TypeProject[]=[
  {project:projectConfig(new URL('../tsconfig.json',import.meta.url),'type-check'),policy:'tooling',population:[{directory:'tooling',recursive:true}]},
  {project:projectConfig(new URL('../../runtime/node/tsconfig.bindings.json',import.meta.url),'type-check'),policy:'javascript',population:[{directory:relative(ROOT,fileURLToPath(NODE_BINDINGS.url)).split(sep).join('/'),member:NODE_BINDINGS.member,recursive:true}]},
  {project:projectConfig(new URL('../../runtime/web-platform/test/wpt/tsconfig.json',import.meta.url),'type-check'),policy:'product',population:[{directory:'runtime/web-platform/test/wpt',recursive:true}]},
  {project:projectConfig(new URL('../conformance/ecmascript/icu-compiled/tsconfig.c.json',import.meta.url),'type-check'),policy:'product',population:[{directory:'runtime/ecmascript/providers/icu/c'}]},
  {project:projectConfig(new URL('../conformance/ecmascript/icu-compiled/tsconfig.jvm.json',import.meta.url),'type-check'),policy:'product',population:[{directory:'runtime/ecmascript/providers/icu/java',recursive:true}]},
  {project:projectConfig(new URL('../../compiler/codegen/jvm/tsconfig.json',import.meta.url),'type-check'),policy:'product',population:[{directory:'compiler/codegen/jvm'}]},
];

export const typeProjectName=(definition:TypeProject)=>relative(ROOT,fileURLToPath(definition.project.url)).split(sep).join('/');
/** Only the owner observing no directory entry can discharge a lost inventory member. */
export function absentTypeModules(root:string,actual:readonly string[],previous:readonly string[]):ReadonlySet<string>{
  const present=new Set(actual),absent=new Set<string>();
  for(const file of previous)if(!present.has(file)&&lstatSync(join(root,file),{throwIfNoEntry:false})===undefined)absent.add(file);
  return absent;
}
export function readTypeRecord(root:string):DiagnosticRecord {
  const path=join(root,TOOLING_DIAGNOSTICS);return existsSync(path)?parseDiagnosticRecord(JSON.parse(readFileSync(path,'utf8'))):{version:2,projects:{}};
}
export function pendingTypeProjects(root:string):string[]{
  const recorded=readTypeRecord(root);
  return TYPE_PROJECTS.map(typeProjectName).filter(name=>existsSync(join(root,name))&&!recorded.projects[name]);
}
