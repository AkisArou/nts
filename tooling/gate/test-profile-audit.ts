// Test builders have one owner. Fixtures deliberately exercising Cargo's
// obsolete artifact variants are the sole exception, in a private tiny crate.
import {createRequire} from 'node:module';
import type {Node} from 'typescript/ast';
import {shellCommands} from './shell-commands.ts';

export const CARGO_TEST_SOURCE_OWNERS={
  'tooling/gate/test-profile.ts':'constructs and executes every production test build',
  'tooling/gate/test-artifacts.test.ts':'isolated Cargo cache-pruning controls must manufacture obsolete profiles and incremental variants',
} as const;

export function inspectCargoTestCalls(file:string,source:string,root:Node):string[]{
  if(file in CARGO_TEST_SOURCE_OWNERS)return [];
  const ast=createRequire(import.meta.url)('typescript/ast') as typeof import('typescript/ast');
  const values=new Map<string,Node>(),problems:string[]=[],wrappers=new Map<string,number>();
  const code=(node:Node)=>source.slice(node.pos,node.end).trim();
  const gather=(node:Node):void=>{if(ast.isVariableDeclaration(node)&&ast.isIdentifier(node.name)&&node.initializer)values.set(node.name.text,node.initializer);node.forEachChild(gather);};gather(root);
  const value=(node:Node|undefined,seen=new Set<string>()):Node|undefined=>{
    if(node&&ast.isIdentifier(node)&&values.has(node.text)&&!seen.has(node.text)){seen.add(node.text);return value(values.get(node.text),seen);}return node;
  };
  const literal=(node:Node|undefined):string|undefined=>{const item=value(node);return item&&ast.isStringLiteralLikeNode(item)?item.text:undefined;};
  const add=(node:Node)=>problems.push(file+':'+source.slice(0,node.pos).split('\n').length+': cargo test must run through test-profile.ts');
  // A helper such as cargo(args) is still an invocation, not inert test data.
  const helpers=(node:Node,owner?:{name:string;parameters:readonly {name:Node}[]}):void=>{
    let next=owner;
    if(ast.isFunctionDeclaration(node)&&node.name)next={name:node.name.text,parameters:node.parameters};
    if(ast.isVariableDeclaration(node)&&ast.isIdentifier(node.name)&&node.initializer&&ast.isArrowFunction(node.initializer))next={name:node.name.text,parameters:node.initializer.parameters};
    if(ast.isCallExpression(node)&&literal(node.arguments[0])==='cargo'&&node.arguments[1]&&ast.isIdentifier(node.arguments[1])&&next){
      const name=node.arguments[1].text,index=next.parameters.findIndex(parameter=>ast.isIdentifier(parameter.name)&&parameter.name.text===name);
      if(index>=0)wrappers.set(next.name,index);
    }
    node.forEachChild(child=>helpers(child,next));
  };helpers(root);
  const visit=(node:Node):void=>{
    if(ast.isCallExpression(node)){
      const direct=literal(node.arguments[0])==='cargo',wrapped=wrappers.get(code(node.expression));
      const args=value(direct?node.arguments[1]:wrapped===undefined?undefined:node.arguments[wrapped]);
      if((direct||wrapped!==undefined)&&(!args||!ast.isArrayLiteralExpression(args)||literal(args.elements[0])==='test'))add(node);
    }
    node.forEachChild(visit);
  };visit(root);return problems;
}

export function inspectShellCargoTests(file:string,source:string):string[]{
  const problems:string[]=[];
  for(const command of shellCommands(source).commands)if(/(?:^|\/)cargo$/.test(command.name)){
    const tail=source.slice(command.start).replace(/\\\n/g,'');
    if(/^(?:['"]?[^\s'"]+['"]?)\s+['"]?test(?:['"]?\s|['"]?$)/.test(tail))problems.push(file+':'+source.slice(0,command.start).split('\n').length+': cargo test must run through test-profile.ts');
  }
  return problems;
}
