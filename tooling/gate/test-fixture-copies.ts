// Fixture module inputs belong to copyModuleClosure, including private mutants.
// Inspect the host audit's existing AST; strings used as test data are not code.
import {dirname,extname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {moduleClosure} from './module-closure.ts';
import type {Node} from 'typescript/ast';
import {SourceFacts} from './source-facts.ts';

// These fixtures copy a complete discovered namespace or compare bytes without
// executing the copies. They have no selected dependency list to go stale.
export const FIXTURE_COPY_EXCLUSIONS:Readonly<Record<string,string>>={
 'tooling/bench/compile-producer.test.ts':'Digest-input byte copies; copied modules are never executed.',
 'tooling/census/sampling-cli.test.ts':'Discovers every tooling directory and mirrors the whole namespace.',
 'tooling/census/typescript-record-cli.test.ts':'Mirrors the entire tooling namespace.',
 'tooling/bench/build-records.test.ts':'Discovers every tooling directory; no selected dependency list.',
 'tooling/records/record-pending-outcomes.test.ts':'Mirrors the entire tooling namespace.',
 'tooling/differential/oracle-reservation-fixture.ts':'Mirrors the entire tooling namespace.',
 'tooling/differential/oracle-dependencies.test.ts':'Mirrors the entire tooling namespace.',
};
// Single entry scripts are checked, not assumed, to have no relative imports
// or named assets. Adding a dependency makes their raw copy an audit failure.
const STANDALONE_ENTRIES:Readonly<Record<string,readonly string[]>>={
 'tooling/apple/ios-readiness.test.ts':['tooling/gate/costs.mjs'],
};
export type FixtureCopy={file:string;line:number;source:string;input:string};

export function inspectFixtureCopies(rootDirectory:string,file:string,text:string,tree:Node|SourceFacts):FixtureCopy[]{
 if(file==='tooling/gate/module-closure-fixture.ts')return [];
 const facts=tree instanceof SourceFacts?tree:new SourceFacts(file,text,tree),ast=facts.ast;
 const {parents,calls}=facts;
 const code=(node:Node)=>facts.code(node);
 const binding=(node:Node)=>facts.binding(node,false);
 const unwrap=(node:Node)=>facts.unwrap(node);
 const name=(node:Node)=>facts.name(node,false);
 const product=(groups:string[][]):string[][]=>groups.reduce<string[][]>((all,group)=>all.flatMap(prefix=>group.map(value=>[...prefix,value])),[[]]);
 const paths=(input:Node,depth=0):string[]=>{
  const node=unwrap(input);if(depth>16)return ['__unknown__'];
  if(ast.isStringLiteralLikeNode(node))return [node.text];
  if(ast.isArrayLiteralExpression(node))return node.elements.flatMap(value=>paths(value,depth+1));
  if(ast.isIdentifier(node)){
   const value=binding(node);if(value)return paths(value.value,depth+1);
   if(node.text==='__dirname')return [dirname(join(rootDirectory,file))];
   if(node.text==='__filename')return [join(rootDirectory,file)];
   return ['__unknown__'];
  }
  if(ast.isTemplateExpression(node))return product([ [node.head.text],...node.templateSpans.flatMap(span=>[paths(span.expression,depth+1),[span.literal.text]]) ]).map(parts=>parts.join(''));
  if(ast.isBinaryExpression(node)&&code(node.operatorToken)==='+')return product([paths(node.left,depth+1),paths(node.right,depth+1)]).map(parts=>parts.join(''));
  if(ast.isPropertyAccessExpression(node)&&['pathname','href'].includes(node.name.text))return paths(node.expression,depth+1);
  if(ast.isNewExpression(node)&&ast.isIdentifier(node.expression)&&node.expression.text==='URL'&&node.arguments?.[0]&&node.arguments[1]&&code(node.arguments[1])==='import.meta.url')
   return paths(node.arguments[0],depth+1).map(path=>fileURLToPath(new URL(path,pathToFileURL(join(rootDirectory,file)))));
  if(ast.isCallExpression(node)){
   const called=name(node.expression);
   if(['path.join','path.resolve','path.posix.join','path.posix.normalize'].includes(called))return product(node.arguments.map(value=>paths(value,depth+1))).map(parts=>called.endsWith('normalize')?parts.join(''):resolve(...parts));
   if(called==='url.fileURLToPath'&&node.arguments[0])return paths(node.arguments[0],depth+1);
   if(called==='path.dirname'&&node.arguments[0])return paths(node.arguments[0],depth+1).map(dirname);
  }
  return ['__unknown__'];
 };
 const readValues=Array.from({length:17},()=>new Map<Node,string[]>());
 const reads=(input:Node,depth=0):string[]=>{
  const node=unwrap(input);if(depth>16)return [];
  const cache=readValues[depth]!,known=cache.get(node);if(known)return known;
  let found:string[];
  if(ast.isIdentifier(node)){const value=binding(node);found=value&&value.kind!=='parameter'?reads(value.value,depth+1):[];}
  else if(ast.isCallExpression(node)&&name(node.expression)==='JSON.stringify')found=[];
  else if(ast.isCallExpression(node)&&/^(?:fs|fs\/promises)(?:\.promises)?\.readFile(?:Sync)?$/.test(name(node.expression))&&node.arguments[0])found=paths(node.arguments[0]);
  else found=[...facts.childrenOf(node)].flatMap(child=>reads(child,depth+1));
  cache.set(node,found);return found;
 };
 const found:FixtureCopy[]=[],seen=new Set<string>();
 for(const call of calls){
  if(!ast.isCallExpression(call))continue;
  const called=name(call.expression),args=call.arguments;
  const inputs=/^(?:fs|fs\/promises)(?:\.promises)?\.(?:cp|copyFile|symlink)(?:Sync)?$/.test(called)&&args[0]?paths(args[0]):
   /^(?:fs|fs\/promises)(?:\.promises)?\.writeFile(?:Sync)?$/.test(called)&&args[1]?reads(args[1]):[];
  for(const input of inputs){
   if(!isAbsolute(input)&&!input.startsWith('tooling/'))continue;
   const part=relative(rootDirectory,isAbsolute(input)?input:resolve(rootDirectory,input)).split(sep).join('/');
   if(!part.startsWith('tooling/'))continue;
   const module=/\.[cm]?[jt]sx?$/.test(part);
   if(extname(part)&&!module&&!part.includes('__unknown__'))continue;
   if(called.includes('writeFile')&&!module&&!part.includes('__unknown__'))continue;
   // Data, shell entry scripts, package installs and whole-namespace mirrors
   // are explicit inputs. Relative JS imports are the closure owner's job.
   if(/\.(?:json|sh|txt|tsv|md)$/.test(part)||part.includes('/node_modules/'))continue;
   const reason=FIXTURE_COPY_EXCLUSIONS[file];
   if(reason){
    if(file==='tooling/bench/compile-producer.test.ts')continue;
    // Only a loop over the complete discovered namespace gets this exemption.
    // A selected array in the same fixture remains an error.
    let at:Node|undefined=call,whole=false;
    while(at){
     if(ast.isForOfStatement(at)){
      let entries=unwrap(at.expression);
      for(let n=0;n<12&&ast.isIdentifier(entries);n++){const value=binding(entries);if(!value)break;entries=unwrap(value.value);}
      if(ast.isCallExpression(entries)&&name(entries.expression)==='fs.readdirSync'&&entries.arguments[0])
       for(const directory of paths(entries.arguments[0])){
        const prefix=relative(rootDirectory,directory).split(sep).join('/');
        if((prefix==='tooling'||prefix.startsWith('tooling/'))&&part.startsWith(prefix+'/'))whole=true;
       }
     }
     at=parents.get(at);
    }
    if(whole)continue;
   }
   const key=String(call.pos)+':'+input;if(seen.has(key))continue;seen.add(key);
   found.push({file,line:facts.line(call.pos),source:code(call).replace(/\s+/g,' ').slice(0,240),input:part});
  }
 }
 return found;
}

export function fixtureCopyProblems(root:string,copies:readonly FixtureCopy[]):string[]{
 return copies.filter(row=>{
  if(!STANDALONE_ENTRIES[row.file]?.includes(row.input))return true;
  return moduleClosure([row.input],{sourceRoot:root}).some(file=>file!==row.input);
 }).map(row=>`${row.file}:${row.line}: fixture copies tooling code outside copyModuleClosure (${row.input}): ${row.source}`);
}
