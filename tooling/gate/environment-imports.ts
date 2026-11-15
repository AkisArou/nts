// Moved environment APIs have one owner, including in generated Node programs.
import {posix} from 'node:path';
import type {Node,TemplateExpression} from 'typescript/ast';
import * as host from './host-environment.ts';
import * as infrastructure from './host-infrastructure.ts';
import * as runtime from '../differential/oracle-runtime.ts';
import * as services from '../differential/oracle-services.ts';
import * as budget from '../differential/oracle-budget.ts';
import * as snapshot from '../differential/oracle-snapshot.ts';
import type {SourceFacts} from './source-facts.ts';
const moved=new Set([...Object.keys(host),...Object.keys(infrastructure)]);
const movedOracle=new Set([...Object.keys(runtime),...Object.keys(services),...Object.keys(budget),...Object.keys(snapshot)]);
const canonical=(path:string)=>/(?:^|\/)canonical-environment\.ts$/.test(path);
const emitter=(path:string)=>/(?:^|\/)oracle-emit\.ts$/.test(path);
const forbidden=(name:string,path:string)=>moved.has(name)&&canonical(path)||movedOracle.has(name)&&emitter(path)||path==='__fixture_expression'&&(moved.has(name)||movedOracle.has(name));
const hostOwner=(path:string)=>/(?:^|\/)(?:host-environment|host-infrastructure)\.ts$/.test(path);

/** Resolve only syntax-owned literals/URLs, never evaluate generated code. */
function literal(facts:SourceFacts,node:Node,seen=new Set<Node>()):string|undefined{
  if(seen.has(node))return;seen.add(node);
  const ast=facts.ast,value=facts.resolve(node);
  if(value!==node)return literal(facts,value,seen);
  if(ast.isStringLiteralLikeNode(value))return value.text;
  if(ast.isParenthesizedExpression(value)||ast.isAwaitExpression(value))return literal(facts,value.expression,seen);
  if(ast.isPropertyAccessExpression(value)&&value.name.text==='href')return literal(facts,value.expression,seen);
  if(ast.isNewExpression(value)&&facts.name(value.expression)==='URL'&&value.arguments?.length===2){
    const path=value.arguments[0],base=value.arguments[1];
    if(path&&ast.isStringLiteralLikeNode(path)&&base&&facts.code(base)==='import.meta.url')
      return new URL(path.text,'file:///'+facts.file).href;
  }
  if(ast.isCallExpression(value)&&facts.name(value.expression)==='JSON.stringify'&&value.arguments.length===1){
    const text=literal(facts,value.arguments[0]!,seen);if(text!==undefined)return JSON.stringify(text);
  }
  return;
}
export function generatedScriptText(facts:SourceFacts,node:TemplateExpression):string{
  return node.head.text+node.templateSpans.map(span=>(literal(facts,span.expression)??'__fixture_expression')+span.literal.text).join('');
}

export function movedEnvironmentImportProblems(facts:SourceFacts,argv:readonly string[]=[],offset=0):string[]{
  const ast=facts.ast,problems:string[]=[];
  const report=(node:Node,name:string)=>problems.push(`${facts.file}:${offset+facts.line(node.pos)}: ${name} must be imported from its declaring owner, not its former preparation module`);
  const pathOf=(node:Node):string|undefined=>{
    const value=facts.resolve(node);
    if(ast.isStringLiteralLikeNode(value))return value.text;
    if(ast.isElementAccessExpression(value)&&facts.code(value.expression)==='process.argv'&&value.argumentExpression&&ast.isNumericLiteral(value.argumentExpression))return argv[Number(value.argumentExpression.text)-1];
    return literal(facts,value);
  };
  for(const node of facts.imports){
    if(!ast.isStringLiteralLikeNode(node.moduleSpecifier))continue;
    const path=node.moduleSpecifier.text,bindings=node.importClause?.namedBindings;
    if(!bindings||!ast.isNamedImports(bindings))continue;
    for(const element of bindings.elements){const name=element.propertyName?.text??element.name.text;
      if(forbidden(name,path)&&!hostOwner(path))report(node,name);
    }
  }
  for(const row of facts.variables){
    if(!ast.isObjectBindingPattern(row.name)||!row.initializer)continue;
    let value=facts.resolve(row.initializer);if(ast.isAwaitExpression(value))value=facts.resolve(value.expression);
    if(!ast.isCallExpression(value)||value.expression.kind!==ast.SyntaxKind.ImportKeyword||!value.arguments[0])continue;
    const path=pathOf(value.arguments[0]);
    if(path===undefined)continue;
    for(const element of row.name.elements){const part=element.propertyName??element.name;if(!part)continue;const name=facts.code(part);if(forbidden(name,path))report(row,name);}
  }
  for(const node of facts.nodes)if(ast.isPropertyAccessExpression(node)){
    const name=facts.name(node),match=/^(.*(?:canonical-environment|oracle-emit)\.ts)\.([A-Za-z_]\w*)$/.exec(name);
    if(match&&forbidden(node.name.text,posix.normalize(match[1]!)))report(node,node.name.text);
  }
  return problems;
}
