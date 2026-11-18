// Cgroup filesystem observations have one errno/provenance owner. Existing
// migrations are exact source sites, never a grant to a module or fs alias.
import type {Node} from 'typescript/ast';
import type {SourceFacts} from './source-facts.ts';
export type CgroupRead={file:string;source:string;line:number};
export type CgroupReadAllowance=Pick<CgroupRead,'file'|'source'>&{count:number;issue:number};

export function inspectCgroupReads(facts:SourceFacts):CgroupRead[]{
  const ast=facts.ast;
  const path=(node:Node,seen=new Set<Node>()):boolean=>{
    if(seen.has(node))return false;seen.add(node);
    if(ast.isStringLiteralLikeNode(node)||ast.isTemplateHead(node)||ast.isTemplateMiddle(node)||ast.isTemplateTail(node))return node.text.includes('/sys/fs/cgroup');
    // Values read from a cgroup are data, not filesystem path provenance.
    // Follow path construction, not the implementation of arbitrary calls
    // or all the fields of an object whose unrelated field is a cgroup.
    if(ast.isCallExpression(node)&&!/^(?:path\.)?(?:join|resolve|dirname|normalize)$/.test(facts.ambientName(node.expression)))return false;
    if(ast.isPropertyAccessExpression(node)||ast.isElementAccessExpression(node)){
      const object=facts.resolve(node.expression),name=ast.isPropertyAccessExpression(node)?node.name.text:
        node.argumentExpression&&ast.isStringLiteralLikeNode(node.argumentExpression)?node.argumentExpression.text:undefined;
      if(ast.isObjectLiteralExpression(object)&&name!==undefined)for(const member of object.properties){
        if(ast.isPropertyAssignment(member)&&(ast.isIdentifier(member.name)||ast.isStringLiteralLikeNode(member.name))&&member.name.text===name)return path(member.initializer,seen);
        if(ast.isShorthandPropertyAssignment(member)&&ast.isIdentifier(member.name)&&member.name.text===name)return path(member.name,seen);
      }
      return false;
    }
    if(ast.isTemplateExpression(node)&&node.head.text.startsWith('/')&&!node.head.text.startsWith('/sys/fs/cgroup'))return false;
    const resolved=facts.resolve(node);
    if(resolved!==node&&path(resolved,seen))return true;
    const binding=facts.binding(node),parameter=binding?.kind==='parameter'&&facts.parents.get(binding.value);
    if(parameter&&ast.isParameterDeclaration(parameter)){
      if(parameter.initializer&&path(parameter.initializer,seen))return true;
      const fn=facts.parents.get(parameter);
      if(fn&&(ast.isFunctionDeclaration(fn)||ast.isArrowFunction(fn)||ast.isFunctionExpression(fn))){
        const index=fn.parameters.indexOf(parameter);
        for(const call of facts.calls){
          const target=facts.binding(call.expression)?.value;
          if((target===fn||facts.resolve(call.expression)===fn)&&call.arguments[index]&&path(call.arguments[index]!,seen))return true;
        }
      }
    }
    if(!ast.isCallExpression(node)&&!ast.isTemplateExpression(node)&&!ast.isTemplateSpan(node)&&!ast.isBinaryExpression(node)&&!ast.isConditionalExpression(node))return false;
    let found=false;node.forEachChild(child=>{if(path(child,seen))found=true;});return found;
  };
  return facts.calls.filter(call=>/^(?:fs|fs\/promises)(?:\.promises)?\.(?:readFile|readdir|readlink|realpath|stat|lstat|access|exists|open)(?:Sync)?$/.test(facts.ambientName(call.expression))
    &&call.arguments[0]&&path(call.arguments[0])).map(call=>({file:facts.file,line:facts.line(call.pos),source:facts.code(call).replace(/\s+/g,' ')}));
}
const key=(row:Pick<CgroupRead,'file'|'source'>)=>row.file+'\n'+row.source;
export function cgroupReadProblems(reads:readonly CgroupRead[],allowances:readonly CgroupReadAllowance[],accepted?:readonly CgroupReadAllowance[]):string[]{
  const problems:string[]=[],limits=new Map<string,number>();
  for(const row of allowances){
    if(row.issue!==873||!Number.isSafeInteger(row.count)||row.count<1||limits.has(key(row)))problems.push(`invalid cgroup read allowance: ${row.file}`);
    if(accepted&&(accepted.find(old=>key(old)===key(row))?.count??0)<row.count)problems.push(`cgroup read allowances may only shrink: ${row.file}: ${row.source}`);
    limits.set(key(row),row.count);
  }
  const counts=new Map<string,number>();
  for(const read of reads){
    if(read.file==='tooling/gate/host-observations.ts')continue;
    const id=key(read),count=(counts.get(id)??0)+1;counts.set(id,count);
    if(count>(limits.get(id)??0))problems.push(`${read.file}:${read.line}: cgroup fs read outside host-observations.ts: ${read.source}`);
  }
  return problems;
}
