// Test builders have one owner. Fixtures deliberately exercising Cargo's
// obsolete artifact variants are the sole exception, in a private tiny crate.
import type {Node} from 'typescript/ast';
import {shellCommands,type ShellCommands} from './shell-commands.ts';
import {SourceFacts} from './source-facts.ts';

export const CARGO_TEST_SOURCE_OWNERS={
  'tooling/gate/test-profile.ts':'constructs and executes every production test build',
  'tooling/gate/test-artifacts.test.ts':'isolated Cargo cache-pruning controls must manufacture obsolete profiles and incremental variants',
} as const;

export function inspectCargoTestCalls(file:string,source:string,root:Node|SourceFacts,offset=0):string[]{
  if(file in CARGO_TEST_SOURCE_OWNERS)return [];
  const facts=root instanceof SourceFacts?root:new SourceFacts(file,source,root),ast=facts.ast,problems:string[]=[];
  const value=(node:Node|undefined):Node|undefined=>node&&facts.resolve(node,false);
  const literal=(node:Node|undefined):string|undefined=>{const item=value(node);return item&&ast.isStringLiteralLikeNode(item)?item.text:undefined;};
  const add=(node:Node)=>problems.push(file+':'+(offset+facts.line(node.pos))+': cargo test must run through test-profile.ts');
  for(const node of facts.calls){
    if(ast.isCallExpression(node)&&literal(node.arguments[0])==='cargo'){
      const args=value(node.arguments[1]),first=args&&ast.isArrayLiteralExpression(args)?literal(args.elements[0]):undefined;
      // Unknown command arrays cannot certify that the helper excludes tests.
      if(first===undefined||first==='test')add(node);
    }
  }
  return problems;
}

export function inspectShellCargoTests(file:string,source:string,shell:ShellCommands=shellCommands(source)):string[]{
  const problems:string[]=[];
  for(const command of shell.commands)if(/(?:^|\/)cargo$/.test(command.name)){
    const tail=source.slice(command.start).replace(/\\\n/g,'');
    if(/^(?:['"]?[^\s'"]+['"]?)\s+['"]?test(?:['"]?\s|['"]?$)/.test(tail))problems.push(file+':'+source.slice(0,command.start).split('\n').length+': cargo test must run through test-profile.ts');
  }
  return problems;
}
