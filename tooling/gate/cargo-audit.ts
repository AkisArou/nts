// Cargo discovery has one owner. Other launchers pass through its API or CLI.
import type {Node} from 'typescript/ast';
import {SourceFacts} from './source-facts.ts';
import {shellCommands,type ShellCommands} from './shell-commands.ts';

export function inspectCargoCalls(file:string,source:string,root:Node|SourceFacts,offset=0):string[]{
  if(file==='tooling/gate/cargo.ts')return [];
  const facts=root instanceof SourceFacts?root:new SourceFacts(file,source,root),ast=facts.ast;
  const cargo=(input:Node|undefined):boolean=>{
    if(!input)return false;const node=facts.resolve(input,false);
    if(ast.isStringLiteralLikeNode(node))return /(?:^|\/)cargo$/.test(node.text);
    if(ast.isConditionalExpression(node))return cargo(node.whenTrue)||cargo(node.whenFalse);
    if(ast.isBinaryExpression(node))return cargo(node.left)||cargo(node.right);
    return false;
  };
  return facts.calls.filter(call=>/(?:^|\.)(?:spawn|spawnSync|execFile|execFileSync)$/.test(facts.name(call.expression))&&cargo(call.arguments[0]))
    .map(call=>`${file}:${offset+facts.line(call.pos)}: Cargo must run through tooling/gate/cargo.ts`);
}
export function inspectShellCargoCalls(file:string,source:string,shell:ShellCommands=shellCommands(source)):string[]{
  return shell.commands.filter(command=>/(?:^|\/)cargo$/.test(command.name)).map(command=>
    `${file}:${source.slice(0,command.start).split('\n').length}: Cargo must run through tooling/gate/cargo.ts`);
}
