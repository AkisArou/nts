// A process or task stat record has one reader and one parser. Any other source
// that names such a path splits the record itself, so a short read during exit
// would fail differently there. Like a kernel host read, a path literal is
// conservatively a read even when it is only data.
import type {Node} from 'typescript/ast';
import type {SourceFacts} from './source-facts.ts';

export type ProcessStatPath={file:string;line:number;source:string};
/** Exactly these modules may name the path, each for its stated reason. */
export const PROCESS_STAT_PATH_OWNERS:Readonly<Record<string,string>>={
  'tooling/differential/process-stat/main.ts':'the reader and strict parser every caller uses',
  'tooling/gate/process-stat-audit.test.ts':'mutation inputs to this audit, inspected and never executed',
};
const HOLE='\u0000';
// A segment is a literal or an interpolated hole; /proc/stat itself is the
// machine-wide CPU record, and status or statm are other records. The host
// path starts the text or follows a delimiter (a command line or embedded
// script); a computed prefix names a supplied fixture tree, not the host's.
const STAT_PATH=/(?:^|[^\w.\-/\u0000])\/proc\/[^/\s]+(?:\/task\/[^/\s]+)?\/stat(?![\w.-])/;

export function inspectProcessStatPaths(facts:SourceFacts):ProcessStatPath[]{
  const ast=facts.ast;
  const joining=(node:Node)=>ast.isCallExpression(node)&&/^(?:path\.)?(?:join|resolve)$/.test(facts.ambientName(node.expression));
  const plus=(node:Node)=>ast.isBinaryExpression(node)&&node.operatorToken.kind===ast.SyntaxKind.PlusToken;
  const text=(node:Node,seen:Set<Node>):string=>{
    if(seen.has(node))return HOLE;seen.add(node);
    if(ast.isStringLiteralLikeNode(node))return node.text;
    if(ast.isTemplateExpression(node))return node.head.text+node.templateSpans.map(span=>HOLE+span.literal.text).join('');
    if(ast.isParenthesizedExpression(node))return text(node.expression,seen);
    if(ast.isBinaryExpression(node)&&plus(node))return text(node.left,seen)+text(node.right,seen);
    if(ast.isCallExpression(node)&&joining(node))return node.arguments.map(argument=>text(argument,seen)).join('/');
    if(ast.isIdentifier(node)){const value=facts.resolve(node);return value===node?HOLE:text(value,seen);}
    return HOLE;
  };
  // Inspect only the outermost path expression, so one path is one row.
  const inner=(node:Node)=>{
    let parent=facts.parents.get(node);
    while(parent&&ast.isParenthesizedExpression(parent))parent=facts.parents.get(parent);
    return !!parent&&(plus(parent)||joining(parent)&&(parent as import('typescript/ast').CallExpression).arguments.some(argument=>argument===node||facts.unwrap(argument)===node));
  };
  const rows:ProcessStatPath[]=[];
  for(const node of facts.ofKinds(ast.SyntaxKind.StringLiteral,ast.SyntaxKind.NoSubstitutionTemplateLiteral,ast.SyntaxKind.TemplateExpression,ast.SyntaxKind.BinaryExpression,ast.SyntaxKind.CallExpression)){
    if(ast.isBinaryExpression(node)&&!plus(node)||ast.isCallExpression(node)&&!joining(node)||inner(node))continue;
    if(STAT_PATH.test(text(node,new Set())))rows.push({file:facts.file,line:facts.line(node.pos),source:facts.code(node).replace(/\s+/g,' ').slice(0,240)});
  }
  return rows;
}

export function processStatPathProblems(paths:readonly ProcessStatPath[],owners:Readonly<Record<string,string>>=PROCESS_STAT_PATH_OWNERS):string[]{
  return paths.filter(path=>!Object.hasOwn(owners,path.file)).map(path=>
    `${path.file}:${path.line}: process stat path outside tooling/differential/process-stat/main.ts; read it through readProcessStat, readProcessStats or readTaskStats: ${path.source}`);
}
