// Audit the owned source superset as well as entry closures. Dynamic launches,
// generated scripts and shells cannot hide a reader outside an import graph.
import {readFileSync,readdirSync,existsSync,renameSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {shellCommands} from './shell-commands.ts';
import type {Node} from 'typescript/ast';
import {inspectRecordPublications,type RecordPublication} from './test-readiness.ts';
import {auditWorkerModules,inspectModuleAsync,type ModuleAsyncFacts} from './module-async.ts';
import {HOST_READ_OWNERS} from './test-host-owners.ts';

export type HostReadKind='disk'|'machine'|'kernel'|'clock'|'environment'|'fixture-constructor';
export type HostRead={file:string;line:number;kind:HostReadKind;source:string;generated:boolean};
export type HostDebt=Record<string,Partial<Record<HostReadKind,number>>>;
export const HOST_DEBT=relative(fileURLToPath(new URL('../..',import.meta.url)),fileURLToPath(new URL('./test-host-debt.json',import.meta.url))).split(sep).join('/');
// These are product implementations or benchmark subjects, not the instrument.
// Their clocks and machine APIs are behaviour nts compiles or measures.
export const HOST_AUDIT_EXCLUDED_ROOTS={
  'runtime/':'nts runtime library and its program/tool inputs',
  'benchmarks/common/':'benchmark subjects whose behaviour includes reading time',
} as const;
const excluded=(file:string)=>Object.keys(HOST_AUDIT_EXCLUDED_ROOTS).some(root=>file.startsWith(root));
const fixture=(file:string)=>/\.test\.[cm]?[jt]s$|-fixture\.[cm]?[jt]s$/.test(file);
const inside=(root:string,path:string)=>{const part=relative(root,path);return !isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep);};

/** Resolve aliases before classifying calls, including require/destructuring.
 * Embedded scripts are parsed as code too, with interpolation holes retained.
 * A path literal is conservatively a kernel read even when it is only data. */
export function inspectHostSource(file:string,source:string,shared?:import('typescript/sync').API,inspectRoot?:(file:string,source:string,root:Node)=>void):{reads:HostRead[];references:string[]} {
  const require=createRequire(import.meta.url);
  const {API}=require('typescript/sync') as typeof import('typescript/sync');
  const ast=require('typescript/ast') as typeof import('typescript/ast');
  const api=shared??new API(),reads:HostRead[]=[],references=new Set<string>();
  function parse(text:string,offset=0,generated=false,depth=0):void {
    const lease=api.createSourceFile(file+(generated?'.generated.ts':''),text),aliases=new Map<string,string>();
    const code=(node:Node)=>text.slice(node.pos,node.end).trim();
    const name=(node:Node):string=>{
      if(ast.isIdentifier(node))return aliases.get(node.text)??node.text;
      if(ast.isPropertyAccessExpression(node))return name(node.expression)+'.'+node.name.text;
      if(ast.isElementAccessExpression(node)&&node.argumentExpression&&ast.isStringLiteralLikeNode(node.argumentExpression))return name(node.expression)+'.'+node.argumentExpression.text;
      if(ast.isCallExpression(node)&&['require','createRequire(import.meta.url)'].includes(name(node.expression))&&node.arguments[0]&&ast.isStringLiteralLikeNode(node.arguments[0]))return node.arguments[0].text.replace(/^node:/,'');
      return code(node);
    };
    function declarations(node:Node):void {
      if(ast.isImportDeclaration(node)&&ast.isStringLiteralLikeNode(node.moduleSpecifier)){
        const module=node.moduleSpecifier.text.replace(/^node:/,''),clause=node.importClause;
        references.add(node.moduleSpecifier.text);
        if(clause?.name)aliases.set(clause.name.text,module);
        const bindings=clause?.namedBindings;
        if(bindings){if(ast.isNamespaceImport(bindings))aliases.set(bindings.name.text,module);
          else for(const item of bindings.elements)aliases.set(item.name.text,module+'.'+(item.propertyName?.text??item.name.text));}
      }
      node.forEachChild(declarations);
    }
    declarations(lease.sourceFile);
    for(let pass=0;pass<3;pass++){
      const bind=(node:Node):void=>{
        if(ast.isVariableDeclaration(node)&&node.initializer){
          const value=name(node.initializer);
          if(ast.isIdentifier(node.name)&&/^(?:process|fs|fs\/promises|os|performance|Date)(?:\.|$)/.test(value))aliases.set(node.name.text,value);
          if(ast.isObjectBindingPattern(node.name))for(const element of node.name.elements)if(element.name&&ast.isIdentifier(element.name))aliases.set(element.name.text,value+'.'+(element.propertyName?code(element.propertyName):element.name.text));
        }
        node.forEachChild(bind);
      };bind(lease.sourceFile);
    }
    const add=(kind:HostReadKind,node:Node)=>reads.push({file,line:offset+text.slice(0,node.pos).split('\n').length,kind,source:code(node).replace(/\s+/g,' ').slice(0,240),generated});
    const literal=(value:string,node:Node):void=>{
      if(/^\/(?:proc(?:\/|$)|sys\/fs\/cgroup)/.test(value))add('kernel',node);
      if(/^(?:\.\.?\/|tooling\/|runtime\/)/.test(value)&&/\.(?:[cm]?[jt]s|sh)$/.test(value))references.add(value);
      // Parse code strings, not arbitrary prose mentioning an API.
      if(depth<3&&/(?:\b(?:process|performance|Date)\.|\brequire\s*\(|\bfrom\s*['"]node:|\bstatfs|\/proc\/|\/sys\/fs\/cgroup)/.test(value)&&/[;{}=()]|\n/.test(value))parse(value,offset+text.slice(0,node.pos).split('\n').length-1,true,depth+1);
    };
    function visit(node:Node):void {
      if(ast.isCallExpression(node)){
        const called=name(node.expression);
        if(/^(?:fs|fs\/promises)(?:\.promises)?\.statfs(?:Sync)?$/.test(called))add('disk',node);
        if(/^os\.(?:cpus|availableParallelism|loadavg|freemem|totalmem)$/.test(called))add('machine',node);
        if(/^(?:performance|Date)\.now$|^process\.(?:hrtime|cpuUsage|resourceUsage|uptime)(?:\.bigint)?$/.test(called))add('clock',node);
        if(called==='Object.assign'&&node.arguments.slice(1).some(arg=>name(arg)==='process.env'))add('environment',node);
        if(['import','require'].includes(called)&&node.arguments[0]&&ast.isStringLiteralLikeNode(node.arguments[0]))references.add(node.arguments[0].text);
      }
      if(ast.isSpreadAssignment(node)&&name(node.expression)==='process.env')add('environment',node);
      if(ast.isPropertyAssignment(node)&&code(node.name)==='env'&&name(node.initializer)==='process.env')add('environment',node);
      if(ast.isStringLiteralLikeNode(node))literal(node.text,node);
      if(ast.isTemplateExpression(node))literal(node.head.text+node.templateSpans.map(span=>'__fixture_expression'+span.literal.text).join(''),node);
      node.forEachChild(visit);
    }
    try{if(!generated)inspectRoot?.(file,text,lease.sourceFile);visit(lease.sourceFile);}finally{lease.dispose();}
  }
  try {
    if(file.endsWith('.sh')){
      const shell=shellCommands(source);
      for(const command of shell.commands)if(/(?:^|\/)(?:nproc|free|df|vmstat)$/.test(command.name))
        reads.push({file,line:source.slice(0,command.start).split('\n').length,kind:'kernel',source:command.name,generated:false});
      let offset=0;
      for(const [index,line] of source.split('\n').entries()){
        const start=offset;offset+=line.length+1;
        if(line.trim().startsWith('#')||shell.data.some(range=>start>=range.start&&start<range.end))continue;
        for(const match of line.matchAll(/(?:\/proc(?:\/[\w${}/.-]*)?|\/sys\/fs\/cgroup[\w${}/.-]*)/g))reads.push({file,line:index+1,kind:'kernel',source:match[0],generated:false});
        for(const match of line.matchAll(/(?:tooling|runtime)\/[\w./-]+\.(?:[cm]?[jt]s|sh)\b/g))references.add(match[0]);
      }
      // Shell heredocs and node -e payloads are code, including their aliases.
      parse(source,0,true);
    } else if(file.endsWith('.rs')) {
      // Rust test fixtures must ask the TypeScript fixture owner for the packet.
      for(const [index,line] of source.split('\n').entries())if(/\.env\s*\(\s*"NTS_(?:MEMINFO|VMSTAT|HOST_OBSERVATIONS)"/.test(line))reads.push({file,line:index+1,kind:'fixture-constructor',source:line.trim(),generated:false});
    } else parse(source);
    return {reads,references:[...references]};
  } finally {if(!shared)api.close();}
}

export function hostReadProblems(reads:readonly HostRead[],debt:HostDebt,owners=HOST_READ_OWNERS):string[] {
  const problems:string[]=[],counts:HostDebt={};
  for(const read of reads){
    if(owners[read.file]?.kinds.includes(read.kind)||read.generated&&owners[read.file]?.generatedKinds?.includes(read.kind))continue;
    if(read.kind==='environment'&&fixture(read.file)||read.kind==='fixture-constructor'){
      problems.push(`${read.file}:${read.line}: forbidden ${read.kind}: ${read.source}`);continue;
    }
    const row=counts[read.file]??={};row[read.kind]=(row[read.kind]??0)+1;
    if(row[read.kind]!>(debt[read.file]?.[read.kind]??0))problems.push(`${read.file}:${read.line}: ${read.kind} read outside its owner: ${read.source}`);
  }
  return problems;
}

/** The tool can publish only improvements; a raised count never becomes a baseline. */
export function recordHostDebt(path:string,reads:readonly HostRead[],debt:HostDebt):void {
  const problems=hostReadProblems(reads,debt);
  if(problems.length)throw new Error(problems.join('\n'));
  const next:HostDebt={};
  for(const read of reads){
    if(HOST_READ_OWNERS[read.file]?.kinds.includes(read.kind)||read.generated&&HOST_READ_OWNERS[read.file]?.generatedKinds?.includes(read.kind))continue;
    const row=next[read.file]??={};row[read.kind]=(row[read.kind]??0)+1;
  }
  const pending=path+'.'+process.pid;
  writeFileSync(pending,JSON.stringify(Object.fromEntries(Object.entries(next).sort()),null,2)+'\n');renameSync(pending,path);
}

export function auditTestHost(root:string,debt?:HostDebt){
  const {API}=createRequire(import.meta.url)('typescript/sync') as typeof import('typescript/sync');
  const api=new API(),sources=new Map<string,{reads:HostRead[];references:string[]}>(),moduleFacts=new Map<string,ModuleAsyncFacts>(),publications:RecordPublication[]=[];
  const inspect=(file:string,source:string,node:Node)=>{if(file.startsWith('tooling/')&&/\.[cm]?[jt]s$/.test(file)){
    moduleFacts.set(file,inspectModuleAsync(root,file,source,node));
    publications.push(...inspectRecordPublications(file,source,api,node));
  }};
  try {
  const visit=(directory:string,rustOnly=false):void=>{
    for(const entry of readdirSync(join(root,directory),{withFileTypes:true})){
      if(entry.name==='node_modules')continue;
      const file=directory+'/'+entry.name;
      if(entry.isDirectory())visit(file,rustOnly);
      else if(entry.isFile()&&(rustOnly?/\.rs$/.test(file):/\.(?:[cm]?[jt]s|sh|rs)$/.test(file)))sources.set(file,inspectHostSource(file,readFileSync(join(root,file),'utf8'),api,inspect));
    }
  };visit('tooling');visit('compiler',true);visit('runtime',true);
  const reach=(file:string,seen:Set<string>):void=>{
    if(seen.has(file))return;seen.add(file);
    for(const reference of sources.get(file)?.references??[]){
      if(!reference.startsWith('.')&&!reference.startsWith('tooling/')&&!reference.startsWith('runtime/'))continue;
      const path=resolve(root,reference.startsWith('.')?dirname(file):'',reference);
      if(!inside(root,path))continue; // Generated scripts resolve relative to their fixture directory.
      const name=relative(root,path).split(sep).join('/');
      if(excluded(name))continue;
      if(!sources.has(name)&&existsSync(path)&&/\.[cm]?[jt]s$/.test(name))sources.set(name,inspectHostSource(name,readFileSync(path,'utf8'),api));
      if(sources.has(name))reach(name,seen);
    }
  };
  const closures=[...sources.keys()].filter(file=>/\.test\.[cm]?[jt]s$/.test(file)).sort().map(entry=>{
    const members=new Set<string>();reach(entry,members);return {entry,modules:[...members].sort()};
  });
  const reached=new Set(closures.flatMap(row=>row.modules));
  const reads=[...sources.entries()].flatMap(([file,row])=>file.startsWith('tooling/')&&(reached.has(file)||fixture(file))||file.endsWith('.rs')?row.reads:[]);
  return {files:sources.size,closures,reads,publications,problems:[...publications.map(row=>`${row.file}:${row.line}: generated JSON publisher must use durableRecord: ${row.source}`),...hostReadProblems(reads,debt??JSON.parse(readFileSync(join(root,HOST_DEBT),'utf8')) as HostDebt),...auditWorkerModules(root,moduleFacts).problems]};
  } finally {api.close();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const root=fileURLToPath(new URL('../..',import.meta.url)),result=auditTestHost(root);
  if(process.argv.includes('--record')&&!result.problems.length)recordHostDebt(join(root,HOST_DEBT),result.reads,JSON.parse(readFileSync(join(root,HOST_DEBT),'utf8')) as HostDebt);
  if(process.argv.includes('--json'))console.log(JSON.stringify(result,null,2));
  else if(result.problems.length)console.error(result.problems.join('\n'));
  else console.log(`test host ownership: ${result.files} sources, ${result.closures.length} entry closures, ${result.reads.length} reads checked`);
  process.exitCode=result.problems.length?1:0;
}
