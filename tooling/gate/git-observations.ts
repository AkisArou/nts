// Command position is syntax: a call's first argument, an argv vector's first
// element, a probe's command property, or a shell command word. Local direct
// process forwarders keep the command first too; ordinary string data is not
// searched for command names.
import {existsSync,readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {dirname,join,posix,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import type {Node} from 'typescript/ast';
import {SourceFacts,GeneratedSourceFacts,inspectSourceBatches,type ShellSourceFacts,type SourceInput} from './source-facts.ts';
import {shellCommands,type ShellCommands} from './shell-commands.ts';
import {GIT_NO_OPTIONAL_LOCKS} from './git-arguments/main.ts';
import {durableRecord} from './durable-record.ts';
import {assertStateVersion,assertWritableState} from './state-version.ts';
import {infrastructureProbe} from './infrastructure-probe.ts';
import {runAsCommand} from '../differential/command-entry/main.ts';
import {inspectRecordPublications} from './test-readiness.ts';
import {withLock} from '../landing/lock.ts';

export type GitInvocation={file:string;line:number;kind:'call'|'argv'|'probe'|'shell';source:string;protected:boolean};
type DebtRow=Pick<GitInvocation,'file'|'kind'|'source'>&{count:number};
export type GitDebt={version:1;sites:DebtRow[]};
export const GIT_DEBT_FILE=relative(fileURLToPath(new URL('../..',import.meta.url)),fileURLToPath(new URL('../../results/git-observations/unprotected.json',import.meta.url))).split(sep).join('/');
export const EMPTY_GIT_DEBT:GitDebt={version:1,sites:[]};
const isGit=(value:string|undefined)=>value!==undefined&&/(?:^|\/)git$/.test(value);
const key=(row:Pick<GitInvocation,'file'|'kind'|'source'>)=>JSON.stringify([row.file,row.kind,row.source]);

/** One local convention, not argument-flow inference: a function passing its
 * own parameter directly to child_process takes that command parameter first. */
export function inspectCommandForwarders(facts:SourceFacts,offset=0):string[]{
  const ast=facts.ast,problems:string[]=[],seen=new Set<Node>();
  for(const call of facts.calls){
    if(!/^child_process\.(?:spawn|spawnSync|execFile|execFileSync)$/.test(facts.name(call.expression)))continue;
    const command=call.arguments[0];if(!command)continue;
    const binding=facts.binding(facts.unwrap(command));if(binding?.kind!=='parameter')continue;
    for(const node of facts.ancestors(call)){
      if(!(ast.isFunctionDeclaration(node)||ast.isFunctionExpression(node)||ast.isArrowFunction(node)
        ||ast.isMethodDeclaration(node)||ast.isConstructorDeclaration(node)||ast.isGetAccessorDeclaration(node)||ast.isSetAccessorDeclaration(node)))continue;
      const at=node.parameters.findIndex(parameter=>parameter.name===binding.value);
      if(at>0&&!seen.has(node)){
        seen.add(node);problems.push(`${facts.file}:${offset+facts.line(call.pos)}: command forwarder must take its command as the first parameter: ${facts.code(call).replace(/\s+/g,' ')}`);
      }
      break;
    }
  }
  return problems;
}

export function inspectGitInvocations(facts:SourceFacts,offset=0):GitInvocation[]{
  const ast=facts.ast,rows:GitInvocation[]=[];
  const value=(node:Node|undefined)=>node&&facts.resolve(node);
  const literal=(node:Node|undefined)=>{const v=value(node);return v&&ast.isStringLiteralLikeNode(v)?v.text:undefined;};
  const owner=(node:Node|undefined):boolean=>{
    const v=value(node);if(!v||!ast.isCallExpression(v))return false;
    const called=facts.name(v.expression),match=/^(\.{1,2}\/.*)\.gitArguments$/.exec(called);
    return !!match&&posix.normalize(posix.join(posix.dirname(facts.file),match[1]!))==='tooling/gate/git-arguments/main.ts';
  };
  const protectedArgs=(node:Node|undefined):boolean=>{
    if(owner(node))return true;
    const v=value(node);return !!v&&ast.isArrayLiteralExpression(v)&&literal(v.elements[0])===GIT_NO_OPTIONAL_LOCKS;
  };
  const add=(node:Node,kind:GitInvocation['kind'],protected_:boolean)=>rows.push({file:facts.file,line:offset+facts.line(node.pos),kind,source:facts.code(node).replace(/\s+/g,' '),protected:protected_});
  for(const call of facts.calls)if(isGit(literal(call.arguments[0])))add(call,'call',protectedArgs(call.arguments[1]));
  for(const node of facts.ofKind(ast.SyntaxKind.ArrayLiteralExpression))if(ast.isArrayLiteralExpression(node)&&isGit(literal(node.elements[0]))){
    const next=node.elements[1];add(node,'argv',literal(next)===GIT_NO_OPTIONAL_LOCKS||!!next&&ast.isSpreadElement(next)&&owner(next.expression));
  }
  for(const node of facts.ofKind(ast.SyntaxKind.ObjectLiteralExpression))if(ast.isObjectLiteralExpression(node)){
    let command:Node|undefined,args:Node|undefined;
    for(const property of node.properties){
      if(ast.isPropertyAssignment(property)){
        const name=ast.isIdentifier(property.name)||ast.isStringLiteralLikeNode(property.name)?property.name.text:undefined;
        if(name==='command')command=property.initializer;else if(name==='args')args=property.initializer;
      }else if(ast.isShorthandPropertyAssignment(property)&&ast.isIdentifier(property.name)&&property.name.text==='args')args=property.name;
    }
    if(isGit(literal(command)))add(node,'probe',protectedArgs(args));
  }
  return rows;
}

export function inspectShellGit(file:string,source:string,shell:ShellCommands,offset=0):GitInvocation[]{
  return shell.commands.filter(command=>isGit(command.name)).map(command=>({file,line:offset+source.slice(0,command.start).split('\n').length,kind:'shell',
    source:source.slice(command.start,command.args.at(-1)?.end??command.start+command.name.length).replace(/\s+/g,' '),
    protected:command.args[0]?.value===GIT_NO_OPTIONAL_LOCKS&&!command.args[0]?.dynamic}));
}
export function inspectGeneratedGitShells(shells:readonly ShellSourceFacts[]):GitInvocation[]{
  return shells.flatMap(row=>inspectShellGit(row.file,row.source,row.shell,row.offset));
}

/** Python's own AST supplies literal argv positions in the small legacy tools.
 * Parse all files in one question; their modules are never imported/executed. */
export function inspectPythonGit(inputs:readonly {file:string;source:string}[]):GitInvocation[]{
  if(!inputs.length)return [];
  const script=`import ast,json,sys\nrows=[]\nfor item in json.load(sys.stdin):\n tree=ast.parse(item['source'],filename=item['file'])\n for n in ast.walk(tree):\n  if not isinstance(n,(ast.List,ast.Tuple)) or not n.elts: continue\n  first=n.elts[0]\n  if not isinstance(first,ast.Constant) or not isinstance(first.value,str) or first.value.split('/')[-1]!='git': continue\n  second=n.elts[1] if len(n.elts)>1 else None\n  rows.append(dict(file=item['file'],line=n.lineno,kind='argv',source=' '.join(ast.get_source_segment(item['source'],n).split()),protected=isinstance(second,ast.Constant) and second.value=='--no-optional-locks'))\nprint(json.dumps(rows))\n`;
  return JSON.parse(infrastructureProbe({purpose:'parse Python Git argv declarations',command:'python3',args:['-c',script],input:JSON.stringify(inputs)}).stdout) as GitInvocation[];
}

export function parseGitDebt(value:unknown):GitDebt{
  assertStateVersion(value,1,GIT_DEBT_FILE);
  if(!value||typeof value!=='object'||(value as GitDebt).version!==1||!Array.isArray((value as GitDebt).sites))throw Error('invalid Git observation record');
  const row=value as GitDebt,seen=new Set<string>();
  for(const site of row.sites){
    if(!site||typeof site.file!=='string'||!site.file.startsWith('tooling/')||!['call','argv','probe','shell'].includes(site.kind)||typeof site.source!=='string'||!site.source||!Number.isSafeInteger(site.count)||site.count<1||seen.has(key(site)))throw Error('invalid Git observation record');
    seen.add(key(site));
  }
  return row;
}
export function gitInvocationProblems(rows:readonly GitInvocation[],debt:GitDebt):string[]{
  const ceiling=new Map(debt.sites.map(row=>[key(row),row.count])),counts=new Map<string,number>(),problems:string[]=[];
  for(const row of rows)if(!row.protected){const id=key(row),count=(counts.get(id)??0)+1;counts.set(id,count);
    if(count>(ceiling.get(id)??0))problems.push(`${row.file}:${row.line}: Git invocation must disable optional index locks through gitArguments: ${row.source}`);
  }
  return problems;
}
export function recordGitDebt(path:string,rows:readonly GitInvocation[],previous?:GitDebt):void{
  mkdirSync(dirname(path),{recursive:true});
  withLock(path+'.lock',()=>{
    assertWritableState(path,1);
    const current=existsSync(path)?parseGitDebt(JSON.parse(readFileSync(path,'utf8'))):undefined;
    if(!previous&&current)throw Error('Git observation record already exists');
    const ceiling=current??previous;
    if(ceiling){const problems=gitInvocationProblems(rows,ceiling);if(problems.length)throw Error(problems.join('\n'));}
    const sites=new Map<string,DebtRow>();
    for(const row of rows)if(!row.protected){const id=key(row),old=sites.get(id);sites.set(id,{file:row.file,kind:row.kind,source:row.source,count:(old?.count??0)+1});}
    durableRecord(path,{version:1,sites:[...sites.values()].sort((a,b)=>key(a).localeCompare(key(b)))} satisfies GitDebt);
  });
}

/** The standalone writer uses the same facts and inspectors as the host gate.
 * It does not run unrelated verdict checks while initializing its own record. */
export function collectGitInvocations(root:string):GitInvocation[]{
  const files:string[]=[],python:{file:string;source:string}[]=[],rows:GitInvocation[]=[],forwarders:string[]=[];
  const visit=(directory:string):void=>{for(const entry of readdirSync(join(root,directory),{withFileTypes:true})){
    if(entry.name==='node_modules')continue;const file=directory+'/'+entry.name;
    if(entry.isDirectory())visit(file);else if(entry.isFile()){if(/\.[cm]?[jt]s$/.test(file))files.push(file);
      else if(file.endsWith('.sh')){const source=readFileSync(join(root,file),'utf8');rows.push(...inspectShellGit(file,source,shellCommands(source)));}
      else if(file.endsWith('.py'))python.push({file,source:readFileSync(join(root,file),'utf8')});}
  }};visit('tooling');
  const {API}=createRequire(import.meta.url)('typescript/sync') as typeof import('typescript/sync'),api=new API();
  function *inputs():Iterable<SourceInput>{for(const file of files)yield {file,source:readFileSync(join(root,file),'utf8')};}
  try{inspectSourceBatches(api,inputs(),facts=>{
    forwarders.push(...inspectCommandForwarders(facts));
    rows.push(...inspectGitInvocations(facts));const generated=new GeneratedSourceFacts(api,facts.file);
    try{inspectRecordPublications(facts.file,facts.source,api,facts,(_text,tree,offset)=>{rows.push(...inspectGitInvocations(tree,offset));forwarders.push(...inspectCommandForwarders(tree,offset));},generated);
      rows.push(...inspectGeneratedGitShells(generated.shells));}finally{generated.close();}
  });}finally{api.close();}
  if(forwarders.length)throw Error(forwarders.join('\n'));
  return [...rows,...inspectPythonGit(python)];
}

runAsCommand(import.meta.url,async()=>{
  const args=process.argv.slice(2);if(args.some(arg=>!['--record','--initialize','--json'].includes(arg))||args.includes('--initialize')&&!args.includes('--record'))throw Error('usage: git-observations.ts [--record [--initialize]] [--json]');
  const root=fileURLToPath(new URL('../..',import.meta.url)),file=join(root,GIT_DEBT_FILE),initialize=args.includes('--initialize');
  if(initialize&&existsSync(file))throw Error('Git observation record already exists');
  const previous=initialize?undefined:parseGitDebt(JSON.parse(readFileSync(file,'utf8')));
  const invocations=collectGitInvocations(root),problems=previous?gitInvocationProblems(invocations,previous):[];
  if(problems.length)throw Error(problems.join('\n'));
  if(args.includes('--record'))recordGitDebt(file,invocations,previous);
  console.log(JSON.stringify({sites:invocations.length,unprotected:invocations.filter(row=>!row.protected).length,...(args.includes('--json')?{invocations}:{})}));
});
