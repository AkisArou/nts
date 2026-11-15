// One gate owner checks each project under its own declarations and ratchet.
import {readFileSync,readdirSync,existsSync,mkdirSync,renameSync,writeFileSync} from 'node:fs';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {fileInput} from './reader-inputs/main.ts';
import {TYPE_PROJECTS,typeProjectName,readTypeRecord,type TypeProject} from './tooling-type-projects.ts';
import {OracleFilesystem} from '../differential/oracle-filesystem.ts';
import {pendingLine,improvedLine} from '../records/pending.ts';
import {TOOLING_DIAGNOSTICS,projectTypeChanges,serializeDiagnosticRecord,
  type DiagnosticCounts,type DiagnosticRecord,type ProjectTypeRecord} from './tooling-type-records.ts';

const ROOT=fileURLToPath(new URL('../..',import.meta.url));
export type TypeDiagnostic={fileName?:string;code:number;text:string;startPosition?:{line:number;character:number}};
export type ToolingTypeResult={modules:string[];counts:DiagnosticCounts;diagnostics:TypeDiagnostic[];problems:string[];source:string};
const RECIPE_INPUTS=[fileInput(new URL('./tooling-types.ts',import.meta.url)),fileInput(new URL('./tooling-type-records.ts',import.meta.url)),fileInput(new URL('./tooling-type-projects.ts',import.meta.url)),
  fileInput(new URL('../../pnpm-lock.yaml',import.meta.url)),fileInput(new URL('../../package.json',import.meta.url)),fileInput(new URL('../../.tool-versions',import.meta.url))];
const normalize=(path:string)=>path.split(sep).join('/');
const named=(root:string,path:string)=>normalize(relative(root,path));
const moduleName=(name:string)=>/\.(?:[cm]?[jt]sx?)$/.test(name)&&!name.split('/').includes('node_modules');
const hash=(body:string)=>createHash('sha256').update(body).digest('hex');

function populationModules(root:string,population:TypeProject['population']):string[]{
  const modules:string[]=[];
  const walk=(directory:string,member:string|undefined,recursive:boolean):void=>{
    if(!existsSync(join(root,directory)))return;
    for(const entry of readdirSync(join(root,directory),{withFileTypes:true})){
      if(entry.name==='node_modules'||entry.name.startsWith('.'))continue;
      const path=directory+'/'+entry.name;
      if(entry.isDirectory()){if(recursive)walk(path,member,recursive);}
      else if(member?entry.name===member:/\.(?:[cm]?ts|tsx)$/.test(path)||(directory==='tooling'||directory.startsWith('tooling/'))&&path.endsWith('.mjs')){
        if(!entry.isFile())throw Error('checked module must be an owned regular file: '+path);
        modules.push(path);
      }
    }
  };
  for(const row of population)walk(row.directory,row.member,row.recursive??false);
  return [...new Set(modules)].sort();
}
export function strictProjectProblems(options:Record<string,unknown>,policy:TypeProject['policy']='tooling'):string[]{
  const problems:string[]=[],required=policy==='tooling'?['strict','noUncheckedIndexedAccess','noUnusedLocals','noUnusedParameters','noImplicitReturns',
    'noFallthroughCasesInSwitch','noImplicitOverride','noUncheckedSideEffectImports','allowJs','checkJs','noEmit']:policy==='javascript'?['strict','allowJs','checkJs','noEmit']:['strict'];
  for(const name of required)if(options[name]!==true)problems.push('strict project requires '+name+'=true');
  for(const name of ['noImplicitAny','strictNullChecks','strictFunctionTypes','strictBindCallApply','strictPropertyInitialization',
    'strictBuiltinIteratorReturn','noImplicitThis','useUnknownInCatchVariables','alwaysStrict'])
    if(options[name]===false)problems.push('strict project cannot disable '+name);
  if(options.noCheck===true)problems.push('strict project cannot enable noCheck');
  return problems;
}

/** The compiler's own read graph is the input identity. Computing it again
 * rechecks source edits without replacing the established diagnostic limits. */
export function checkTypeProject(root:string,definition:TypeProject):ToolingTypeResult {
  const require=createRequire(import.meta.url),{API}=require('typescript/sync') as typeof import('typescript/sync');
  const {serverFS}=require('typescript/fs') as typeof import('typescript/fs');
  const filesystem=new OracleFilesystem(),reads=new Map<string,{path:string;sha:string}>();
  const inputName=(path:string)=>path===root||path.startsWith(root+sep)?'<root>/'+named(root,path):normalize(path);
  const api=new API({cwd:root,fs:{directoryExists:filesystem.directoryExists,fileExists:filesystem.fileExists,realpath:filesystem.realpath,stat:filesystem.stat,
    getAccessibleEntries:path=>({...filesystem.getAccessibleEntries(path),symlinks:undefined}),writeFile:serverFS.error,removeFile:serverFS.error,
    readFile(path){const body=filesystem.readFile(path);if(body!==null){const name=inputName(path),sha=hash(body),old=reads.get(name);if(old&&old.sha!==sha)throw Error('type input changed during checking: '+path);reads.set(name,{path,sha});}return body??undefined;}}});
  try{
    const config=typeProjectName(definition),project=api.parseConfigFile(join(root,config));
    const expected=populationModules(root,definition.population),configured=project.fileNames.map(path=>named(root,path)).filter(moduleName);
    const modules=definition.policy==='tooling'?expected:[...new Set([...expected,...configured])].sort();
    const problems=strictProjectProblems(project.options as Record<string,unknown>,definition.policy);
    if(definition.policy==='tooling')for(const file of configured)if(!expected.includes(file))problems.push('strict project names an unowned tooling module: '+file);
    for(const file of modules){const source=readFileSync(join(root,file),'utf8');
      const header=/^(?:#![^\n]*\n)?(?:\s|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/.exec(source)?.[0]??'';
      if(/@ts-nocheck\b/.test(header))problems.push('module disables type checking: '+file);}
    const program=api.createProgram(project.fileNames,project.options,{projectReferences:project.projectReferences});
    try{
      const owned=modules.filter(file=>{const present=program.getSourceFileMetadata(join(root,file))!==undefined;if(!present)problems.push('module missing from its strict project: '+file);return present;}).map(file=>join(root,file));
      const infrastructure=[...project.errors,...program.getProgramDiagnostics(),...program.getGlobalDiagnostics()];
      const diagnostics=[...infrastructure,...(owned.length?[...program.getSyntacticDiagnostics(owned),...program.getBindDiagnostics(owned),...program.getSemanticDiagnostics(owned)]:[])];
      const identity=(d:typeof diagnostics[number])=>JSON.stringify([d.fileName,d.pos,d.end,d.code,d.text]);
      const invalidProject=new Set(infrastructure.map(identity));
      const unique=[...new Map(diagnostics.map(d=>[identity(d),d])).values()];
      const counts:DiagnosticCounts={},ownedNames=new Set(modules);
      for(const diagnostic of unique){const file=diagnostic.fileName?named(root,diagnostic.fileName):undefined;
        if(file&&ownedNames.has(file)&&!invalidProject.has(identity(diagnostic)))counts[file]=(counts[file]??0)+1;else problems.push(`strict project TS${diagnostic.code}: ${diagnostic.text}`);}
      for(const input of reads.values())if(hash(readFileSync(input.path,'utf8'))!==input.sha)problems.push('type input changed during checking: '+input.path);
      if(JSON.stringify(populationModules(root,definition.population))!==JSON.stringify(expected))problems.push('type project population changed during checking: '+config);
      const options=JSON.parse(JSON.stringify(project.options,(_key,value:unknown)=>{return typeof value==='string'&&value.startsWith(root+sep)?inputName(value):value;})) as unknown;
      const recipe=RECIPE_INPUTS.map(url=>[named(ROOT,fileURLToPath(url)),hash(readFileSync(url,'utf8'))]);
      const source='sha256:'+hash(JSON.stringify({config,options,modules,reads:[...reads].sort(([a],[b])=>a.localeCompare(b)).map(([path,input])=>[path,input.sha]),recipe}));
      return {modules,counts,diagnostics:unique,problems,source};
    }finally{program.dispose();}
  }finally{api.close();}
}
export function checkToolingTypes(root:string):ToolingTypeResult{return checkTypeProject(root,TYPE_PROJECTS[0]!);}
export type TypeCheckResult={projects:Record<string,ToolingTypeResult>;problems:string[]};
export function checkTypeProjects(root:string,definitions:readonly TypeProject[]=TYPE_PROJECTS):TypeCheckResult {
  const projects:Record<string,ToolingTypeResult>={},problems:string[]=[];
  for(const definition of definitions){const name=typeProjectName(definition);try{const result=checkTypeProject(root,definition);projects[name]=result;problems.push(...result.problems.map(problem=>name+': '+problem));}
    catch(error){problems.push(name+': '+String(error));}}
  return {projects,problems};
}
export const typeRow=(result:ToolingTypeResult):ProjectTypeRecord=>({modules:result.modules,counts:result.counts,source:result.source});
export function typeRecordChanges(result:TypeCheckResult,record:DiagnosticRecord):{problems:string[];pending:string[];improved:string[];stale:string[]}{
  const problems=[...result.problems],pending:string[]=[],improved:string[]=[],stale:string[]=[];
  for(const name of Object.keys(record.projects))if(!result.projects[name])problems.push('recorded type project was dropped: '+name);
  for(const [name,actual]of Object.entries(result.projects)){const previous=record.projects[name];if(!previous){pending.push(name);continue;}
    const changed=projectTypeChanges(typeRow(actual),previous);problems.push(...changed.problems.map(problem=>name+': '+problem));
    if(changed.improved.length)improved.push(name);if(previous.source!==actual.source)stale.push(name);}
  return {problems,pending,improved,stale};
}
export function typeProjectSourceKey(root:string,name:string):string|null {
  const definition=TYPE_PROJECTS.find(row=>typeProjectName(row)===name);if(!definition||!existsSync(join(root,name)))return null;
  const checked=checkTypeProject(root,definition);if(checked.problems.length)throw Error(checked.problems.join('\n'));return checked.source;
}
export function writeTypeProjectRecord(path:string,result:TypeCheckResult,previous:DiagnosticRecord):void {
  const changes=typeRecordChanges(result,previous);if(changes.problems.length)throw Error(changes.problems.join('\n'));
  const next:DiagnosticRecord={version:2,projects:Object.fromEntries(Object.entries(result.projects).map(([name,row])=>[name,typeRow(row)]))};
  mkdirSync(dirname(path),{recursive:true});const temporary=path+'.'+process.pid;writeFileSync(temporary,serializeDiagnosticRecord(next));renameSync(temporary,path);
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{
    const args=process.argv.slice(2);if(args.some(arg=>!['--record','--initialize','--json'].includes(arg)))throw Error('usage: tooling-types.ts [--record [--initialize]] [--json]');
    if(args.includes('--initialize')&&(!args.includes('--record')||existsSync(join(ROOT,TOOLING_DIAGNOSTICS))))throw Error('--initialize requires --record and an absent tooling diagnostic record');
    if(!args.includes('--initialize')&&!existsSync(join(ROOT,TOOLING_DIAGNOSTICS)))throw Error('tooling diagnostic record is missing');
    const root=ROOT,result=checkTypeProjects(root),previous=readTypeRecord(root),changes=typeRecordChanges(result,previous);
    if(changes.problems.length){console.error(changes.problems.join('\n'));process.exitCode=1;}else{
      if(args.includes('--record'))writeTypeProjectRecord(join(root,TOOLING_DIAGNOSTICS),result,previous);
      for(const name of changes.pending)console.log(pendingLine(name,TOOLING_DIAGNOSTICS));
      for(const name of new Set([...changes.improved,...changes.stale]))console.log(improvedLine(name,TOOLING_DIAGNOSTICS,'previous measurement','rechecked current inputs without a diagnostic increase'));
      if(args.includes('--json'))console.log(JSON.stringify(result,null,2));
      else console.log(`strict types: ${Object.keys(result.projects).length} projects; ${Object.values(result.projects).reduce((n,row)=>n+row.modules.length,0)} checked modules; ${changes.pending.length} pending project(s)`);
    }
  }catch(error){console.error(error instanceof Error?error.stack:String(error));process.exitCode=1;}
}
