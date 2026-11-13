// Process signals have one policy owner. Libraries register named resources.
import type {Node} from 'typescript/ast';
import {posix} from 'node:path';
import {SourceFacts} from './source-facts.ts';

export const COMMAND_SIGNAL_OWNER='tooling/differential/command-entry/main.ts';
const methods=new Set(['on','once','addListener','prependListener','prependOnceListener']);

/** Borrow the shared lexical facts; path-shaped fixture strings are data.
 * Unknown event names cannot certify that a call excludes process signals. */
export function inspectCommandSignals(facts:SourceFacts):string[]{
  if(facts.file===COMMAND_SIGNAL_OWNER)return [];
  const ast=facts.ast,problems:string[]=[];
  const entryMethod=(node:Node,method:string):boolean=>{
    const called=facts.name(node),suffix='.'+method;
    return called.endsWith(suffix)&&posix.normalize(posix.join(posix.dirname(facts.file),called.slice(0,-suffix.length)))===COMMAND_SIGNAL_OWNER;
  };
  const ownsResources=facts.calls.some(call=>entryMethod(call.expression,'registerCommandCloser'));
  if(ownsResources&&facts.calls.some(call=>entryMethod(call.expression,'exitCommand'))){
    for(const node of facts.ofKind(ast.SyntaxKind.CatchClause)){
      if(!ast.isCatchClause(node))continue;
      const variable=node.variableDeclaration?.name,first=node.block.statements[0];
      let safe=false;
      if(variable&&ast.isIdentifier(variable)&&first&&ast.isIfStatement(first)&&ast.isCallExpression(first.expression)){
        const call=first.expression,arg=call.arguments[0],body=first.thenStatement;
        const thrown=ast.isBlock(body)?body.statements[0]:body;
        safe=entryMethod(call.expression,'isCommandExit')&&arg!==undefined&&ast.isIdentifier(arg)&&arg.text===variable.text
          &&thrown!==undefined&&ast.isThrowStatement(thrown)&&thrown.expression!==undefined&&ast.isIdentifier(thrown.expression)&&thrown.expression.text===variable.text;
      }
      if(!safe)problems.push(`${facts.file}:${facts.line(node.pos)}: a resource-owning exitCommand entry must rethrow isCommandExit before classifying a caught error`);
    }
  }
  const name=(input:Node,seen=new Set<Node>()):string|undefined=>{
    const node=facts.unwrap(input);if(seen.has(node))return;seen.add(node);
    if(ast.isIdentifier(node)){
      const binding=facts.binding(node);
      if(binding){
        if(binding.kind!=='value')return;
        const base=name(binding.value,seen);return base&&(binding.member?base+'.'+binding.member:base);
      }
      const imported=facts.importNames.get(node.text);
      if(imported)return imported.replace(/^(process|events)\.default$/,'$1');
      return ['process','global','globalThis','require'].includes(node.text)?node.text:undefined;
    }
    if(ast.isPropertyAccessExpression(node)){
      const base=name(node.expression,seen);
      return base?`${base}.${node.name.text}`.replace(/^(global|globalThis)\.process/,'process'):undefined;
    }
    if(ast.isElementAccessExpression(node)&&node.argumentExpression){
      const base=name(node.expression,seen),key=facts.resolve(node.argumentExpression,false);
      return base?`${base}.${ast.isStringLiteralLikeNode(key)?key.text:'<dynamic>'}`.replace(/^(global|globalThis)\.process/,'process'):undefined;
    }
    if(ast.isCallExpression(node)){
      const called=name(node.expression,seen);
      if(called?.endsWith('.bind'))return called.slice(0,-5);
      if(called==='require'&&node.arguments[0]){
        const module=facts.resolve(node.arguments[0],false);
        if(ast.isStringLiteralLikeNode(module)&&/^(?:node:)?(?:process|events)$/.test(module.text))return module.text.replace(/^node:/,'');
      }
    }
    return;
  };
  const receiver=(input:Node):Node|undefined=>{
    const node=facts.unwrap(input);
    return ast.isPropertyAccessExpression(node)||ast.isElementAccessExpression(node)?node.expression:undefined;
  };
  const bound=(input:Node,seen=new Set<Node>()):readonly Node[]=>{
    const node=facts.resolve(input,false);if(seen.has(node))return [];seen.add(node);
    if(ast.isCallExpression(node)&&name(node.expression)?.endsWith('.bind')){
      const target=receiver(node.expression);
      return [...(target?bound(target,seen):[]),...node.arguments.slice(1)];
    }
    return [];
  };
  for(const call of facts.calls){
    let called=name(call.expression),target:Node=call.expression,args:readonly Node[]=call.arguments;
    if(called?.endsWith('.call')){called=called.slice(0,-5);target=receiver(target)??target;args=args.slice(1);}
    else if(called?.endsWith('.apply')){
      called=called.slice(0,-6);target=receiver(target)??target;
      const list=args[1]&&facts.resolve(args[1],false);
      args=list&&ast.isArrayLiteralExpression(list)?list.elements:[];
    }
    args=[...bound(target),...args];
    if(ownsResources&&called==='process.exit'){
      problems.push(`${facts.file}:${facts.line(call.pos)}: process.exit bypasses command resources; use the command entry's exitCommand transfer`);continue;
    }
    let event:Node|undefined,relevant=false;
    if(called?.startsWith('process.')){
      const method=called.slice('process.'.length);
      if(methods.has(method)||method==='<dynamic>'){event=args[0];relevant=true;}
    }else if((called==='events.on'||called==='events.once')&&args[0]&&name(args[0])==='process'){
      event=args[1];relevant=true;
    }
    if(!relevant)continue;
    const value=event&&facts.resolve(event,false),literal=value&&ast.isStringLiteralLikeNode(value)?value.text:undefined;
    if(literal!==undefined&&!literal.startsWith('SIG'))continue;
    problems.push(`${facts.file}:${facts.line(call.pos)}: process signal ${literal??'<dynamic>'} must be owned by ${COMMAND_SIGNAL_OWNER}: ${facts.code(call).replace(/\s+/g,' ').slice(0,240)}`);
  }
  return problems;
}
