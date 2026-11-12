// Generated producers publish records through durableRecord, just as live
// gate owners do. Parent-side synchronous fixture setup is a different phase.
import {createRequire} from 'node:module';
import type {Node} from 'typescript/ast';

export type RecordPublication={file:string;line:number;source:string};

/** Parse generated source, including templates and concatenated fragments.
 * Comments or strings that merely name writeFileSync cannot authorize a write. */
export function inspectRecordPublications(file:string,source:string,shared?:import('typescript/sync').API):RecordPublication[]{
  const require=createRequire(import.meta.url),{API}=require('typescript/sync') as typeof import('typescript/sync');
  const ast=require('typescript/ast') as typeof import('typescript/ast');
  const api=shared??new API(),found:RecordPublication[]=[],seen=new Set<string>();
  function parse(text:string,offset=0,generated=false,depth=0):void{
    if(depth>4)return;
    const lease=api.createSourceFile(file+(generated?'.generated.ts':''),text);
    const aliases=new Map<string,string>(),values=new Map<string,Node>();
    const code=(node:Node)=>text.slice(node.pos,node.end).trim();
    const name=(node:Node):string=>{
      if(ast.isIdentifier(node))return aliases.get(node.text)??node.text;
      if(ast.isPropertyAccessExpression(node))return name(node.expression)+'.'+node.name.text;
      if(ast.isElementAccessExpression(node)&&node.argumentExpression&&ast.isStringLiteralLikeNode(node.argumentExpression))return name(node.expression)+'.'+node.argumentExpression.text;
      if(ast.isCallExpression(node)&&name(node.expression)==='require'&&node.arguments[0]&&ast.isStringLiteralLikeNode(node.arguments[0]))return node.arguments[0].text.replace(/^node:/,'');
      return code(node);
    };
    function declarations(node:Node):void{
      if(ast.isImportDeclaration(node)&&ast.isStringLiteralLikeNode(node.moduleSpecifier)){
        const module=node.moduleSpecifier.text.replace(/^node:/,''),clause=node.importClause;
        if(clause?.name)aliases.set(clause.name.text,module);
        const bindings=clause?.namedBindings;
        if(bindings){if(ast.isNamespaceImport(bindings))aliases.set(bindings.name.text,module);
          else for(const entry of bindings.elements)aliases.set(entry.name.text,module+'.'+(entry.propertyName?.text??entry.name.text));}
      }
      if(ast.isVariableDeclaration(node)&&node.initializer&&ast.isIdentifier(node.name))values.set(node.name.text,node.initializer);
      node.forEachChild(declarations);
    }
    declarations(lease.sourceFile);
    for(let pass=0;pass<3;pass++){
      function bind(node:Node):void{
        if(ast.isVariableDeclaration(node)&&node.initializer){
          const value=name(node.initializer);
          if(ast.isIdentifier(node.name)&&/^(?:fs|fs\/promises|JSON)(?:\.|$)/.test(value))aliases.set(node.name.text,value);
          if(ast.isObjectBindingPattern(node.name))for(const entry of node.name.elements)if(ast.isIdentifier(entry.name))aliases.set(entry.name.text,value+'.'+(entry.propertyName?code(entry.propertyName):entry.name.text));
        }
        node.forEachChild(bind);
      }
      bind(lease.sourceFile);
    }
    const jsonValue=(node:Node,steps=0):boolean=>{
      if(steps>5)return false;
      if(ast.isIdentifier(node)&&values.has(node.text))return jsonValue(values.get(node.text)!,steps+1);
      if(ast.isCallExpression(node)&&name(node.expression)==='JSON.stringify')return true;
      if(ast.isStringLiteralLikeNode(node))return /^\s*[\[{]/.test(node.text);
      if(ast.isBinaryExpression(node)&&code(node.operatorToken)==='+')return jsonValue(node.left,steps+1)||jsonValue(node.right,steps+1);
      return false;
    };
    const jsonPath=(node:Node,steps=0):boolean=>{
      if(steps>5)return false;
      if(ast.isIdentifier(node)&&values.has(node.text))return jsonPath(values.get(node.text)!,steps+1);
      if(ast.isStringLiteralLikeNode(node))return /\.json$/.test(node.text);
      if(ast.isBinaryExpression(node)&&code(node.operatorToken)==='+')return jsonPath(node.right,steps+1);
      if(ast.isCallExpression(node))return node.arguments.some(value=>jsonPath(value,steps+1));
      return false;
    };
    const render=(node:Node):string|undefined=>{
      if(ast.isStringLiteralLikeNode(node))return node.text;
      if(ast.isTemplateExpression(node))return node.head.text+node.templateSpans.map(span=>'__fixture_expression'+span.literal.text).join('');
      if(ast.isBinaryExpression(node)&&code(node.operatorToken)==='+'){
        const left=render(node.left),right=render(node.right);
        return left!==undefined&&right!==undefined?left+right:undefined;
      }
      return undefined;
    };
    function visit(node:Node):void{
      if(generated&&ast.isCallExpression(node)&&/^(?:fs|fs\/promises)(?:\.promises)?\.writeFile(?:Sync)?$/.test(name(node.expression))&&
          node.arguments[0]&&node.arguments[1]&&(jsonValue(node.arguments[1])||jsonPath(node.arguments[0]))){
        const line=offset+text.slice(0,node.pos).split('\n').length,source=code(node).replace(/\s+/g,' '),key=line+':'+source;
        if(!seen.has(key)){seen.add(key);found.push({file,line,source});}
      }
      const embedded=render(node);
      if(embedded!==undefined){
        parse(embedded,offset+text.slice(0,node.pos).split('\n').length-1,true,depth+1);
        // A full template or concatenation is one generated source, rather
        // than unrelated fragments with different import/alias bindings.
        if(ast.isTemplateExpression(node)||ast.isBinaryExpression(node))return;
      }
      node.forEachChild(visit);
    }
    try{visit(lease.sourceFile);}finally{lease.dispose();}
  }
  try{parse(source);}finally{if(!shared)api.close();}
  return found;
}
