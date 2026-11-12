// Imported tooling modules and Worker entry closures evaluate synchronously.
// Command-only entry scripts may await at top level; libraries start main()
// behind their entry guard instead of making every import graph asynchronous.
import {readFileSync,readdirSync} from 'node:fs';
import {isAbsolute,join,relative,sep} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import type {Node} from 'typescript/ast';
import {moduleClosure} from './module-closure.ts';
import {SourceFacts} from './source-facts.ts';

export function topLevelAwaits(file:string,source:string,shared?:import('typescript/sync').API,root?:Node|SourceFacts):number[]{
  const {API}=createRequire(import.meta.url)('typescript/sync') as typeof import('typescript/sync');
  const api=root?undefined:shared??new API(),lease=api?.createSourceFile(file,source);
  try{
    const facts=root instanceof SourceFacts?root:new SourceFacts(file,source,root??lease!.sourceFile);
    return facts.topLevelAwaits.map(node=>facts.line(node.pos));
  }finally{lease?.dispose();if(!shared)api?.close();}
}

export type ModuleAsyncFacts={entries:string[];imports:string[];problems:string[];awaits:number[]};
/** Inspect the caller's existing AST before its lease ends; no parser pass. */
export function inspectModuleAsync(rootDirectory:string,file:string,source:string,root:Node|SourceFacts):ModuleAsyncFacts{
  const facts=root instanceof SourceFacts?root:new SourceFacts(file,source,root),ast=facts.ast;
  const entries=new Set<string>(),imports=new Set<string>(),problems:string[]=[];
  const workers=new Set<string>(),values=new Map<string,Node>();
  const declarations=[...facts.imports,...facts.ofKind(ast.SyntaxKind.ExportDeclaration),...facts.ofKind(ast.SyntaxKind.ImportEqualsDeclaration),...facts.calls];
  for(const node of declarations){
    const specifier=ast.isImportDeclaration(node)?node.importClause?.phaseModifier===ast.SyntaxKind.TypeKeyword?undefined:node.moduleSpecifier
      :ast.isExportDeclaration(node)?node.isTypeOnly?undefined:node.moduleSpecifier
      :ast.isImportEqualsDeclaration(node)&&!node.isTypeOnly&&ast.isExternalModuleReference(node.moduleReference)?node.moduleReference.expression
      :ast.isCallExpression(node)&&(node.expression.kind===ast.SyntaxKind.ImportKeyword||ast.isIdentifier(node.expression)&&node.expression.text==='require')?node.arguments[0]:undefined;
    if(specifier&&ast.isStringLiteralLikeNode(specifier)&&/^\.\.?\//.test(specifier.text)){
      const path=fileURLToPath(new URL(specifier.text,pathToFileURL(join(rootDirectory,file)))),part=relative(rootDirectory,path);
      if(part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part))imports.add(part.split(sep).join('/'));
    }
  }
  for(const node of facts.imports)if(ast.isStringLiteralLikeNode(node.moduleSpecifier)&&['node:worker_threads','worker_threads'].includes(node.moduleSpecifier.text)){
    const clause=node.importClause,bindings=clause?.namedBindings;
    if(clause?.name)workers.add(clause.name.text+'.Worker');
    if(bindings&&ast.isNamedImports(bindings)){for(const name of bindings.elements)if((name.propertyName?.text??name.name.text)==='Worker')workers.add(name.name.text);}
    else if(bindings&&ast.isNamespaceImport(bindings))workers.add(bindings.name.text+'.Worker');
  }
  for(const node of facts.variables)if(node.initializer){
    if(ast.isIdentifier(node.name))values.set(node.name.text,node.initializer);
    const value=node.initializer;
    if(ast.isCallExpression(value)&&ast.isIdentifier(value.expression)&&value.expression.text==='require'&&value.arguments[0]&&ast.isStringLiteralLikeNode(value.arguments[0])&&['node:worker_threads','worker_threads'].includes(value.arguments[0].text)){
      if(ast.isIdentifier(node.name))workers.add(node.name.text+'.Worker');
      else if(ast.isObjectBindingPattern(node.name))for(const name of node.name.elements)if(ast.isIdentifier(name.name)&&(name.propertyName?facts.code(name.propertyName):name.name.text)==='Worker')workers.add(name.name.text);
    }
  }
  const target=(node:Node,seen=new Set<string>()):string|undefined=>{
    if(ast.isIdentifier(node)&&node.text==='__filename'&&/\.c[jt]s$/.test(file))return join(rootDirectory,file);
    if(ast.isIdentifier(node)&&!seen.has(node.text)&&values.has(node.text)){seen.add(node.text);return target(values.get(node.text)!,seen);}
    if(ast.isCallExpression(node)&&ast.isIdentifier(node.expression)&&node.expression.text==='fileURLToPath'&&node.arguments[0])return target(node.arguments[0],seen);
    if(ast.isNewExpression(node)&&ast.isIdentifier(node.expression)&&node.expression.text==='URL'&&node.arguments?.length===2){
      const [path,base]=node.arguments;
      if(path&&ast.isStringLiteralLikeNode(path)&&base&&source.slice(base.pos,base.end).trim()==='import.meta.url')return fileURLToPath(new URL(path.text,pathToFileURL(join(rootDirectory,file))));
    }
    return undefined;
  };
  for(const node of facts.constructions){
    if(ast.isNewExpression(node)&&workers.has(source.slice(node.expression.pos,node.expression.end).trim())){
      const path=node.arguments?.[0]&&target(node.arguments[0]),part=path&&relative(rootDirectory,path);
      if(!path||part===undefined||isAbsolute(part)||part==='..'||part.startsWith('..'+sep))problems.push(`${file}: Worker entry must be an owned module-relative URL`);
      else entries.add(part.split(sep).join('/'));
    }
  }

  return {entries:[...entries],imports:[...imports],problems,awaits:facts.topLevelAwaits.map(node=>facts.line(node.pos))};
}

export function auditModuleAsync(root:string,parsed?:ReadonlyMap<string,ModuleAsyncFacts>):{entries:string[];modules:string[];problems:string[]}{
  const {API}=createRequire(import.meta.url)('typescript/sync') as typeof import('typescript/sync');
  let api:import('typescript/sync').API|undefined;
  const facts=new Map(parsed),entries=new Set<string>(),problems:string[]=[];
  const inspect=(file:string):ModuleAsyncFacts=>{
    const known=facts.get(file);if(known)return known;
    const source=readFileSync(join(root,file),'utf8');api??=new API();const lease=api.createSourceFile(file,source);
    try{const row=inspectModuleAsync(root,file,source,lease.sourceFile);facts.set(file,row);return row;}finally{lease.dispose();}
  };
  const visit=(directory:string):void=>{for(const entry of readdirSync(join(root,directory),{withFileTypes:true})){
    if(entry.name==='node_modules')continue;const file=directory+'/'+entry.name;
    if(entry.isDirectory())visit(file);else if(/\.[cm]?[jt]s$/.test(file))inspect(file);
  }};
  try{
    if(!parsed)visit('tooling');
    for(const row of facts.values()){for(const entry of row.entries)entries.add(entry);problems.push(...row.problems);}
    const workers=new Set(entries.size?moduleClosure([...entries],{sourceRoot:root}):[]);
    // The source inventory owns tooling modules, not generated node_modules
    // outputs or external package graphs a command provisions later.
    const imported=new Set([...facts.values()].flatMap(row=>row.imports).filter(file=>facts.has(file)));
    const modules=[...new Set([...workers,...imported])].sort();
    for(const file of modules)if(/\.[cm]?[jt]s$/.test(file))for(const line of inspect(file).awaits){
      const reason=workers.has(file)?'a Worker module closure':'an imported tooling module';
      problems.push(`${file}:${line}: top-level await in ${reason}; start work from a message or main()`);
    }
    return {entries:[...entries].sort(),modules,problems};
  }finally{api?.close();}
}
