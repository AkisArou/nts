// Test builders have one owner. Fixtures deliberately exercising Cargo's
// obsolete artifact variants are the sole exception, in a private tiny crate.
import {createRequire} from 'node:module';
import type {Node} from 'typescript/ast';
import {shellCommands} from './shell-commands.ts';

export const CARGO_TEST_SOURCE_OWNERS={
  'tooling/gate/test-profile.ts':'constructs and executes every production test build',
  'tooling/gate/test-artifacts.test.ts':'isolated Cargo cache-pruning controls must manufacture obsolete profiles and incremental variants',
} as const;

export function inspectCargoTestCalls(file:string,source:string,root:Node,offset=0):string[]{
  if(file in CARGO_TEST_SOURCE_OWNERS)return [];
  const ast=createRequire(import.meta.url)('typescript/ast') as typeof import('typescript/ast');
  const parents=new Map<Node,Node>(),scopes=new Map<Node,Map<string,Node>>(),problems:string[]=[];
  const isScope=(node:Node)=>ast.isSourceFile(node)||ast.isBlock(node)||ast.isForStatement(node)||ast.isForOfStatement(node)||
    [ast.SyntaxKind.FunctionDeclaration,ast.SyntaxKind.FunctionExpression,ast.SyntaxKind.ArrowFunction,ast.SyntaxKind.MethodDeclaration].includes(node.kind);
  const gather=(node:Node,scope:Node):void=>{
    if(isScope(node)){scope=node;scopes.set(scope,new Map());}
    if(ast.isVariableDeclaration(node)&&ast.isIdentifier(node.name)&&node.initializer)scopes.get(scope)!.set(node.name.text,node.initializer);
    if(ast.isParameterDeclaration(node)&&ast.isIdentifier(node.name))scopes.get(scope)!.set(node.name.text,node.name);
    node.forEachChild(child=>{parents.set(child,node);gather(child,scope);});
  };gather(root,root);
  const value=(node:Node|undefined,seen=new Set<Node>()):Node|undefined=>{
    if(node&&ast.isIdentifier(node)&&!seen.has(node)){
      seen.add(node);let at:Node|undefined=node;
      while(at){const found=scopes.get(at)?.get(node.text);if(found)return value(found,seen);at=parents.get(at);}
    }
    if(node&&(ast.isParenthesizedExpression(node)||ast.isAsExpression(node)||ast.isNonNullExpression(node)))return value(node.expression,seen);
    return node;
  };
  const literal=(node:Node|undefined):string|undefined=>{const item=value(node);return item&&ast.isStringLiteralLikeNode(item)?item.text:undefined;};
  const add=(node:Node)=>problems.push(file+':'+(offset+source.slice(0,node.pos).split('\n').length)+': cargo test must run through test-profile.ts');
  const visit=(node:Node):void=>{
    if(ast.isCallExpression(node)&&literal(node.arguments[0])==='cargo'){
      const args=value(node.arguments[1]),first=args&&ast.isArrayLiteralExpression(args)?literal(args.elements[0]):undefined;
      // Unknown command arrays cannot certify that the helper excludes tests.
      if(first===undefined||first==='test')add(node);
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
