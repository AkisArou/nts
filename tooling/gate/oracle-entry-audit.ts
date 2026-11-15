// Executable entries consume a seal at a named boundary. Recipe assets and
// source-inspection populations are not executable import edges.
import {posix} from 'node:path';
import type {Node} from 'typescript/ast';
import type {SourceFacts} from './source-facts.ts';
import {shellNodeInvocations,type ShellCommands} from './shell-commands.ts';
export type OracleEntryFacts={file:string;entry:boolean;imports:string[];commands:string[];boundary:'prepared'|'sealed-parent'|null};
export type OracleEntryRow={entry:string;owner:string;kind:'prepared'|'sealed-parent'|'no-consumer'|'missing';chain:string[]};
const consumerOwners=new Set(['tooling/differential/oracle-emit.ts','tooling/differential/check-command.ts']);
const modulePath=(file:string,target:string)=>target.startsWith('.')?posix.normalize(posix.join(posix.dirname(file),target)):target.startsWith('file:')?new URL(target).pathname.replace(/^.*?(?=tooling\/)/,''):target;

export function oracleEntryFacts(facts:SourceFacts):OracleEntryFacts{
  const ast=facts.ast;
  const functionNode=(node:Node)=>ast.isFunctionDeclaration(node)||ast.isFunctionExpression(node)||ast.isArrowFunction(node)||ast.isMethodDeclaration(node);
  const owner=(node:Node):Node=>{for(let parent=facts.parents.get(node);parent;parent=facts.parents.get(parent))if(functionNode(parent))return parent;return facts.root;};
  const bound=(node:Node,path:string,member:string)=>{
    const name=facts.name(node),at=name.lastIndexOf('.');
    return at>=0&&name.slice(at+1)===member&&modulePath(facts.file,name.slice(0,at))===path;
  };
  const commandEntry=(node:Node)=>bound(node,'tooling/differential/command-entry/main.ts','runAsCommand');
  const edges=new Map<Node,Node[]>(),calls=new Map<Node,typeof facts.calls>();
  const append=(from:Node,to:Node)=>{const rows=edges.get(from)??[];rows.push(to);edges.set(from,rows);};
  for(const call of facts.calls){
    const from=owner(call),rows=calls.get(from)??[];rows.push(call);calls.set(from,rows);
    const target=facts.resolve(call.expression);if(functionNode(target))append(from,target);
    if(commandEntry(call.expression)&&call.arguments[1]){const main=facts.resolve(call.arguments[1]);if(functionNode(main))append(from,main);}
  }
  const reached=new Set<Node>(),queue=[facts.root];
  while(queue.length){const node=queue.pop()!;if(reached.has(node))continue;reached.add(node);queue.push(...edges.get(node)??[]);}
  const executed=[...reached].flatMap(node=>calls.get(node)??[]);
  const prepared=executed.some(call=>bound(call.expression,'tooling/gate/canonical-environment.ts','withPreparedOracle')||bound(call.expression,'tooling/gate/canonical-environment.ts','sealOracleRun'));
  const sealed=executed.some(call=>bound(call.expression,'tooling/gate/host-environment.ts','requireSealedOracleRun')||bound(call.expression,'tooling/differential/oracle-seal/main.ts','assertSealedOracleRun'));
  const argv=facts.nodes.some(node=>ast.isPropertyAccessExpression(node)&&facts.code(node)==='process.argv'&&reached.has(owner(node)));
  const commands:string[]=[];
  const urls=(input:Node,seen=new Set<Node>()):void=>{
    if(seen.has(input))return;seen.add(input);const node=facts.resolve(input);
    if(node!==input){urls(node,seen);return;}
    if(ast.isNewExpression(node)&&facts.name(node.expression)==='URL'&&node.arguments?.[0]&&ast.isStringLiteralLikeNode(node.arguments[0])&&node.arguments[1]&&facts.code(node.arguments[1])==='import.meta.url')commands.push(modulePath(facts.file,node.arguments[0].text));
    node.forEachChild(child=>{urls(child,seen);});
  };
  for(const call of executed)if(/(?:^|\.)(?:spawn|spawnSync|execFile|execFileSync|activeCommand|compileActive)$/.test(facts.name(call.expression)))for(const argument of call.arguments)urls(argument);
  for(const node of facts.constructions)if(reached.has(owner(node))&&/(?:^|\.)Worker$/.test(facts.name(node.expression)))for(const argument of node.arguments??[])urls(argument);
  return {file:facts.file,entry:executed.some(call=>commandEntry(call.expression))||argv,imports:facts.hostModuleImports().map(path=>modulePath(facts.file,path)),commands:[...new Set(commands)],boundary:prepared?'prepared':sealed?'sealed-parent':null};
}

/** Shell entry paths come from Node's actual argument position, after the
 * shared observer has consumed prefixes, eval programs and redirections. */
export function oracleShellEntries(file:string,source:string,shell:ShellCommands,files:ReadonlySet<string>):{entry:string;line:number}[]{
  const result:{entry:string;line:number}[]=[];
  for(const invocation of shellNodeInvocations(shell,source)){
    const word=invocation.script;if(!word||word.value==='-')continue;
    let value=word.value;
    const tooling=value.indexOf('tooling/');if(tooling>=0)value=value.slice(tooling);
    const candidates=[value,posix.normalize(posix.join(posix.dirname(file),value.replace(/^\//,'')))];
    const entry=candidates.find(path=>files.has(path));
    if(entry)result.push({entry,line:source.slice(0,invocation.command.start).split('\n').length});
  }
  return result;
}

export function auditOracleEntries(modules:ReadonlyMap<string,OracleEntryFacts>,shells:readonly {file:string;source:string;shell:ShellCommands}[]):{rows:OracleEntryRow[];problems:string[]}{
  const files=new Set(modules.keys()),roots=new Set([...modules.values()].filter(row=>row.entry).map(row=>row.file));
  const shellEdges=new Map<string,string[]>();
  for(const shell of shells){const entries=oracleShellEntries(shell.file,shell.source,shell.shell,files);if(entries.length){roots.add(shell.file);shellEdges.set(shell.file,entries.map(row=>row.entry));for(const row of entries)roots.add(row.entry);}}
  const rows:OracleEntryRow[]=[],problems:string[]=[];
  for(const entry of [...roots].sort()){
    let relevant=false;const queue:{file:string;chain:string[];command:boolean}[]=[{file:entry,chain:[entry],command:true}],seen=new Set<string>();
    while(queue.length){
      const next=queue.shift()!,key=next.file+'\0'+next.command;if(seen.has(key))continue;seen.add(key);
      const facts=modules.get(next.file);
      if(next.command&&facts?.boundary){rows.push({entry,owner:facts.file,kind:facts.boundary,chain:next.chain});relevant=true;continue;}
      if(consumerOwners.has(next.file)){
        const line=`${entry}: oracle consumer has no preparation owner or sealed-parent handoff: ${next.chain.join(' -> ')}`;
        problems.push(line);rows.push({entry,owner:next.file,kind:'missing',chain:next.chain});relevant=true;continue;
      }
      for(const child of facts?.imports??[])if(modules.has(child))queue.push({file:child,chain:[...next.chain,child],command:false});
      for(const child of [...facts?.commands??[],...shellEdges.get(next.file)??[]])if(modules.has(child))queue.push({file:child,chain:[...next.chain,child],command:true});
    }
    if(!relevant)rows.push({entry,owner:entry,kind:'no-consumer',chain:[entry]});
  }
  return {rows,problems};
}
