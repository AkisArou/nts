// One strict project owns tooling. Only its legacy diagnostic counts may fall;
// imported compiler/runtime sources keep the settings of their own projects.
import {readFileSync,readdirSync,existsSync,mkdirSync,renameSync,writeFileSync} from 'node:fs';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import type {API as CheckerAPI} from 'typescript/sync';

export const TOOLING_PROJECT='tooling/tsconfig.json';
export const TOOLING_DIAGNOSTICS='results/tooling-types/diagnostics.json';
export type DiagnosticCounts=Record<string,number>;
export type DiagnosticRecord={version:1;modules:DiagnosticCounts};
export type TypeDiagnostic={fileName?:string;code:number;text:string;startPosition?:{line:number;character:number}};
export type ToolingTypeResult={modules:string[];counts:DiagnosticCounts;diagnostics:TypeDiagnostic[];problems:string[]};
const moduleName=(name:string)=>name.startsWith('tooling/')&&/\.(?:ts|mjs)$/.test(name)&&!name.split('/').includes('node_modules');
const normalize=(path:string)=>path.split(sep).join('/');
const named=(root:string,path:string)=>normalize(relative(root,path));

export function toolingModules(root:string):string[]{
  const modules:string[]=[];
  const walk=(directory:string):void=>{
    for(const entry of readdirSync(join(root,directory),{withFileTypes:true})){
      if(entry.name==='node_modules')continue;
      const path=directory+'/'+entry.name;
      if(entry.isDirectory())walk(path);
      else if(moduleName(path)){
        if(!entry.isFile())throw Error('tooling module must be an owned regular file: '+path);
        modules.push(path);
      }
    }
  };walk('tooling');return modules.sort();
}

export function strictProjectProblems(options:Record<string,unknown>):string[]{
  const problems:string[]=[];
  for(const name of ['strict','noUncheckedIndexedAccess','noUnusedLocals','noUnusedParameters','noImplicitReturns',
    'noFallthroughCasesInSwitch','noImplicitOverride','noUncheckedSideEffectImports','allowJs','checkJs','noEmit'])
    if(options[name]!==true)problems.push('tooling strict project requires '+name+'=true');
  for(const name of ['noImplicitAny','strictNullChecks','strictFunctionTypes','strictBindCallApply','strictPropertyInitialization',
    'strictBuiltinIteratorReturn','noImplicitThis','useUnknownInCatchVariables','alwaysStrict'])
    if(options[name]===false)problems.push('tooling strict project cannot disable '+name);
  if(options.noCheck===true)problems.push('tooling strict project cannot enable noCheck');
  return problems;
}

export function parseDiagnosticRecord(value:unknown):DiagnosticRecord {
  if(typeof value!=='object'||value===null)throw Error('invalid tooling diagnostic record');
  const record=value as {version?:unknown;modules?:unknown};
  if(record.version!==1||typeof record.modules!=='object'||record.modules===null||Array.isArray(record.modules))throw Error('invalid tooling diagnostic record');
  for(const [file,count] of Object.entries(record.modules))if(!moduleName(file)||!Number.isSafeInteger(count)||Number(count)<=0)
    throw Error('invalid tooling diagnostic count: '+file);
  return {version:1,modules:record.modules as DiagnosticCounts};
}

export function diagnosticChanges(actual:DiagnosticCounts,record:DiagnosticRecord):{problems:string[];improved:string[]} {
  const problems:string[]=[],improved:string[]=[];
  for(const [file,count] of Object.entries(actual))if(count>(record.modules[file]??0))
    problems.push(`${file}: strict diagnostics rose from ${record.modules[file]??0} to ${count}`);
  for(const [file,count] of Object.entries(record.modules))if((actual[file]??0)<count)
    improved.push(`${file}: strict diagnostics fell from ${count} to ${actual[file]??0}`);
  return {problems,improved};
}

/** An absent record is initialized only by an explicit first publication.
 * Subsequent publications never accept a rise, even on --record. */
export function writeDiagnosticRecord(path:string,result:ToolingTypeResult,previous?:DiagnosticRecord):void {
  const problems=[...result.problems,...(previous?diagnosticChanges(result.counts,previous).problems:[])];
  if(problems.length)throw Error(problems.join('\n'));
  const modules=Object.fromEntries(Object.entries(result.counts).filter(([,count])=>count>0).sort());
  mkdirSync(dirname(path),{recursive:true});
  const next=path+'.'+process.pid;writeFileSync(next,JSON.stringify({version:1,modules},null,2)+'\n');renameSync(next,path);
}

/** File-scoped diagnostics still resolve the complete dependency graph. The
 * instrument owns tooling diagnostics; product sources use their own projects. */
export function checkToolingTypes(root:string):ToolingTypeResult {
  const {API}=createRequire(import.meta.url)('typescript/sync') as typeof import('typescript/sync');
  const api:CheckerAPI=new API({cwd:root});
  try{
    const project=api.parseConfigFile(join(root,TOOLING_PROJECT)),modules=toolingModules(root);
    const configured=project.fileNames.map(path=>named(root,path)).filter(moduleName).sort();
    const problems=strictProjectProblems(project.options as Record<string,unknown>);
    const expected=new Set(modules),covered=new Set(configured);
    for(const file of modules)if(!covered.has(file))problems.push('tooling module missing from the strict project: '+file);
    for(const file of configured)if(!expected.has(file))problems.push('strict project names an unowned tooling module: '+file);
    for(const file of modules){
      const source=readFileSync(join(root,file),'utf8');
      const header=/^(?:#![^\n]*\n)?(?:\s|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/.exec(source)?.[0]??'';
      if(/@ts-nocheck\b/.test(header))problems.push('tooling module disables type checking: '+file);
    }
    const program=api.createProgram(project.fileNames,project.options);
    try{
      const owned=configured.filter(file=>expected.has(file)).map(file=>join(root,file));
      const diagnostics=[...project.errors,...program.getProgramDiagnostics(),...program.getGlobalDiagnostics(),
        ...(owned.length?[...program.getSyntacticDiagnostics(owned),...program.getBindDiagnostics(owned),...program.getSemanticDiagnostics(owned)]:[])];
      const unique=[...new Map(diagnostics.map(d=>[JSON.stringify([d.fileName,d.pos,d.end,d.code,d.text]),d])).values()];
      const counts:DiagnosticCounts={};
      for(const diagnostic of unique){
        const file=diagnostic.fileName?named(root,diagnostic.fileName):undefined;
        if(file&&expected.has(file))counts[file]=(counts[file]??0)+1;
        else problems.push(`strict project TS${diagnostic.code}: ${diagnostic.text}`);
      }
      return {modules,counts,diagnostics:unique,problems};
    }finally{program.dispose();}
  }finally{api.close();}
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{
    const args=process.argv.slice(2);
    if(args.some(arg=>!['--record','--initialize','--json'].includes(arg))||args.includes('--initialize')&&!args.includes('--record'))throw Error('usage: tooling-types.ts [--record [--initialize]] [--json]');
    const root=fileURLToPath(new URL('../..',import.meta.url)),path=join(root,TOOLING_DIAGNOSTICS),result=checkToolingTypes(root);
    const initialize=args.includes('--initialize');
    if(initialize&&existsSync(path))throw Error('tooling diagnostic record already exists; --initialize cannot replace it');
    if(!initialize&&!existsSync(path))throw Error('tooling diagnostic record is missing');
    const previous=initialize?undefined:parseDiagnosticRecord(JSON.parse(readFileSync(path,'utf8')));
    const changes=previous?diagnosticChanges(result.counts,previous):{problems:[],improved:[]};
    const problems=[...result.problems,...changes.problems];
    if(problems.length){
      console.error(problems.join('\n'));
      for(const diagnostic of result.diagnostics){
        const file=diagnostic.fileName?named(root,diagnostic.fileName):'project';
        if(!previous||result.counts[file]!>(previous.modules[file]??0))console.error(`${file}:${(diagnostic.startPosition?.line??0)+1}:${(diagnostic.startPosition?.character??0)+1} TS${diagnostic.code}: ${diagnostic.text}`);
      }
      process.exitCode=1;
    }else{
      if(args.includes('--record'))writeDiagnosticRecord(path,result,previous);
      if(args.includes('--json'))console.log(JSON.stringify(result,null,2));
      else console.log(`tooling strict types: ${result.modules.length} modules; ${Object.values(result.counts).reduce((sum,n)=>sum+n,0)} recorded diagnostics; ${changes.improved.length} improved modules`);
    }
  }catch(error){console.error(error instanceof Error?error.stack:String(error));process.exitCode=1;}
}
