// Process signals have one policy owner. Libraries register named resources.
import type {Node} from 'typescript/ast';
import {SourceFacts} from './source-facts.ts';

export const COMMAND_SIGNAL_OWNER='tooling/differential/command-entry/main.ts';
const methods=new Set(['on','once','addListener','prependListener','prependOnceListener']);

/** Borrow the shared lexical facts; path-shaped fixture strings are data.
 * Unknown event names cannot certify that a call excludes process signals. */
export function inspectCommandSignals(facts:SourceFacts):string[]{
  if(facts.file===COMMAND_SIGNAL_OWNER)return [];
  const ast=facts.ast,problems:string[]=[];
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
    if(ast.isCallExpression(node)&&name(node.expression,seen)==='require'&&node.arguments[0]){
      const module=facts.resolve(node.arguments[0],false);
      if(ast.isStringLiteralLikeNode(module)&&/^(?:node:)?(?:process|events)$/.test(module.text))return module.text.replace(/^node:/,'');
    }
    return;
  };
  for(const call of facts.calls){
    const called=name(call.expression);let event:Node|undefined,relevant=false;
    if(called?.startsWith('process.')){
      const method=called.slice('process.'.length);
      if(methods.has(method)||method==='<dynamic>'){event=call.arguments[0];relevant=true;}
      else if(method.endsWith('.call')&&methods.has(method.slice(0,-5))){event=call.arguments[1];relevant=true;}
    }else if((called==='events.on'||called==='events.once')&&call.arguments[0]&&name(call.arguments[0])==='process'){
      event=call.arguments[1];relevant=true;
    }
    if(!relevant)continue;
    const value=event&&facts.resolve(event,false),literal=value&&ast.isStringLiteralLikeNode(value)?value.text:undefined;
    if(literal!==undefined&&!literal.startsWith('SIG'))continue;
    problems.push(`${facts.file}:${facts.line(call.pos)}: process signal ${literal??'<dynamic>'} must be owned by ${COMMAND_SIGNAL_OWNER}: ${facts.code(call).replace(/\s+/g,' ').slice(0,240)}`);
  }
  return problems;
}
