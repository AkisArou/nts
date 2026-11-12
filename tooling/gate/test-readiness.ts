// Child producers publish complete records. Synchronous parent setup is a
// different phase; only source that reaches a script/eval sink is parsed.
import {createRequire} from 'node:module';
import type {Node} from 'typescript/ast';

export type RecordPublication={file:string;line:number;source:string};
type Binding={value:Node;member?:string};

/** Consume the host audit's leased root, and retain only detached findings. */
export function inspectRecordPublications(file:string,source:string,shared?:import('typescript/sync').API,root?:Node):RecordPublication[]{
  const require=createRequire(import.meta.url),{API}=require('typescript/sync') as typeof import('typescript/sync');
  const ast=require('typescript/ast') as typeof import('typescript/ast');
  const api=shared??new API(),found:RecordPublication[]=[],seen=new Set<string>(),parsed=new Set<string>();
  function parse(text:string,offset=0,generated=false,depth=0,borrowed?:Node):void{
    if(depth>6)return;
    if(generated){if(parsed.has(text))return;parsed.add(text);}
    const lease=borrowed?undefined:api.createSourceFile(file+(generated?'.generated.ts':''),text),tree=borrowed??lease!.sourceFile;
    const parents=new Map<Node,Node>(),scopes=new Map<Node,Map<string,Binding>>(),imports=new Map<string,string>();
    const code=(node:Node)=>text.slice(node.pos,node.end).trim();
    const isScope=(node:Node)=>ast.isSourceFile(node)||ast.isBlock(node)||[ast.SyntaxKind.FunctionDeclaration,ast.SyntaxKind.FunctionExpression,ast.SyntaxKind.ArrowFunction,ast.SyntaxKind.MethodDeclaration,ast.SyntaxKind.Constructor,ast.SyntaxKind.GetAccessor,ast.SyntaxKind.SetAccessor].includes(node.kind)||ast.isForStatement(node)||ast.isForOfStatement(node);
    function gather(node:Node,scope:Node):void{
      if(isScope(node)){scope=node;scopes.set(scope,new Map());}
      const bindings=scopes.get(scope)!;
      if(ast.isImportDeclaration(node)&&ast.isStringLiteralLikeNode(node.moduleSpecifier)){
        const module=node.moduleSpecifier.text.replace(/^node:/,''),clause=node.importClause,names=clause?.namedBindings;
        if(clause?.name)imports.set(clause.name.text,module);
        if(names){if(ast.isNamespaceImport(names))imports.set(names.name.text,module);
          else for(const entry of names.elements)imports.set(entry.name.text,module+'.'+(entry.propertyName?.text??entry.name.text));}
      }
      if(ast.isVariableDeclaration(node)&&node.initializer){
        if(ast.isIdentifier(node.name))bindings.set(node.name.text,{value:node.initializer});
        else if(ast.isObjectBindingPattern(node.name))for(const entry of node.name.elements)if(entry.name&&ast.isIdentifier(entry.name))bindings.set(entry.name.text,{value:node.initializer,member:entry.propertyName?code(entry.propertyName):entry.name.text});
      }
      // Function declarations belong to the surrounding scope, not their body.
      node.forEachChild(child=>{
        parents.set(child,node);
        if(ast.isFunctionDeclaration(child)&&child.name)bindings.set(child.name.text,{value:child});
        gather(child,scope);
      });
    }
    gather(tree,tree);
    const binding=(node:Node):Binding|undefined=>{
      if(!ast.isIdentifier(node))return undefined;
      let at:Node|undefined=node;
      while(at){const value=scopes.get(at)?.get(node.text);if(value)return value;at=parents.get(at);}
      return undefined;
    };
    const unwrap=(node:Node):Node=>{
      while(ast.isAwaitExpression(node)||ast.isParenthesizedExpression(node)||ast.isAsExpression(node)||ast.isNonNullExpression(node)||ast.isSatisfiesExpression(node))node=node.expression;
      return node;
    };
    const name=(input:Node,steps=0):string=>{
      const node=unwrap(input);if(steps>10)return code(node);
      if(ast.isIdentifier(node)){
        const value=binding(node);return value?name(value.value,steps+1)+(value.member?'.'+value.member:''):imports.get(node.text)??node.text;
      }
      if(ast.isPropertyAccessExpression(node))return name(node.expression,steps+1)+'.'+node.name.text;
      if(ast.isElementAccessExpression(node)&&node.argumentExpression&&ast.isStringLiteralLikeNode(node.argumentExpression))return name(node.expression,steps+1)+'.'+node.argumentExpression.text;
      if(ast.isCallExpression(node)&&node.arguments[0]&&ast.isStringLiteralLikeNode(node.arguments[0])&&
        (node.expression.kind===ast.SyntaxKind.ImportKeyword||ast.isIdentifier(node.expression)&&node.expression.text==='require'))return node.arguments[0].text.replace(/^node:/,'');
      return code(node);
    };
    const resolved=(input:Node,steps=0):Node=>{
      const node=unwrap(input);if(steps>10)return node;
      const value=binding(node);return value&&!value.member?resolved(value.value,steps+1):node;
    };
    const returned=(node:Node):Node|undefined=>{
      const value=resolved(node);
      if(ast.isFunctionDeclaration(value)||ast.isFunctionExpression(value)||ast.isArrowFunction(value)){
        if(!value.body)return undefined;
        if(!ast.isBlock(value.body))return value.body;
        for(const statement of value.body.statements)if(ast.isReturnStatement(statement)&&statement.expression)return statement.expression;
      }
      return undefined;
    };
    const jsonValue=(input:Node,steps=0):boolean=>{
      if(steps>10)return false;const node=resolved(input);
      if(ast.isCallExpression(node)&&name(node.expression)==='JSON.stringify')return true;
      if(ast.isStringLiteralLikeNode(node))return /^\s*[\[{]/.test(node.text);
      return ast.isBinaryExpression(node)&&code(node.operatorToken)==='+'&&(jsonValue(node.left,steps+1)||jsonValue(node.right,steps+1));
    };
    const pathKind=(input:Node,pattern:RegExp,steps=0):boolean=>{
      if(steps>10)return false;const node=resolved(input);
      if(ast.isStringLiteralLikeNode(node))return pattern.test(node.text);
      if(ast.isTemplateExpression(node))return pattern.test(node.templateSpans.at(-1)!.literal.text);
      if(ast.isBinaryExpression(node)&&code(node.operatorToken)==='+')return pathKind(node.right,pattern,steps+1);
      if(ast.isCallExpression(node))return node.arguments.some(value=>pathKind(value,pattern,steps+1));
      return false;
    };
    const render=(input:Node,steps=0):string|undefined=>{
      if(steps>10)return undefined;const node=resolved(input);
      if(ast.isStringLiteralLikeNode(node))return node.text;
      if(ast.isTemplateExpression(node))return node.head.text+node.templateSpans.map(span=>{
        const expression=unwrap(span.expression);
        const hole=ast.isCallExpression(expression)&&name(expression.expression)==='JSON.stringify'&&expression.arguments[0]
          ?JSON.stringify(render(expression.arguments[0],steps+1)??'__fixture_expression'):'__fixture_expression';
        return hole+span.literal.text;
      }).join('');
      if(ast.isBinaryExpression(node)&&code(node.operatorToken)==='+'){
        const left=render(node.left,steps+1),right=render(node.right,steps+1);
        return left!==undefined&&right!==undefined?left+right:undefined;
      }
      if(ast.isCallExpression(node)){
        const value=returned(node.expression);if(value)return render(value,steps+1);
        if(/(?:^|\/)generated-javascript\.ts\.generatedJavaScript$/.test(name(node.expression))&&node.arguments[0])return render(node.arguments[0],steps+1);
      }
      return undefined;
    };
    const isWrite=(node:Node)=>/^(?:fs|fs\/promises)(?:\.promises)?\.writeFile(?:Sync)?$/.test(name(node));
    // The sealed oracle cannot import a repository owner. Its one inline
    // publisher is accepted only with this complete, parsed atomic shape.
    const sealedWrites=new Set<Node>();
    function sealedPublisher(node:Node):void{
      if(file!=='tooling/census/output-oracle.ts'||!generated||!ast.isFunctionDeclaration(node)||node.name?.text!=='publishOracleTerminal'||!node.body)return;
      const statements=node.body.statements;
      if(node.parameters.length!==1||!ast.isIdentifier(node.parameters[0]!.name)||statements.length!==3)return;
      const [declaration,write,rename]=statements;
      if(!declaration||!ast.isVariableStatement(declaration)||declaration.declarationList.declarations.length!==1)return;
      const temporary=declaration.declarationList.declarations[0]!;
      if(!ast.isIdentifier(temporary.name)||!temporary.initializer||!(declaration.declarationList.flags&ast.NodeFlags.Const))return;
      const init=temporary.initializer;
      // Match marker + "." + crypto.randomUUID() + ".partial", by AST.
      if(!ast.isBinaryExpression(init)||code(init.operatorToken)!=='+'||!ast.isStringLiteralLikeNode(init.right)||init.right.text!=='.partial')return;
      const unique=init.left;
      if(!ast.isBinaryExpression(unique)||code(unique.operatorToken)!=='+'||!ast.isCallExpression(unique.right)||name(unique.right.expression)!=='crypto.randomUUID'||unique.right.arguments.length)return;
      const prefix=unique.left;
      if(!ast.isBinaryExpression(prefix)||code(prefix.operatorToken)!=='+'||!ast.isIdentifier(prefix.left)||prefix.left.text!=='marker'||!ast.isStringLiteralLikeNode(prefix.right)||prefix.right.text!=='.')return;
      if(!write||!rename||!ast.isExpressionStatement(write)||!ast.isCallExpression(write.expression)||!ast.isExpressionStatement(rename)||!ast.isCallExpression(rename.expression))return;
      const w=write.expression,r=rename.expression,[target,value]=w.arguments,[from,to]=r.arguments;
      if(name(w.expression)!=='fs.writeFileSync'||w.arguments.length!==2||!target||!ast.isIdentifier(target)||target.text!==temporary.name.text||!value||!ast.isCallExpression(value)||name(value.expression)!=='JSON.stringify'||value.arguments.length!==1||!value.arguments[0]||!ast.isIdentifier(value.arguments[0])||value.arguments[0].text!==node.parameters[0]!.name.text)return;
      if(name(r.expression)!=='fs.renameSync'||r.arguments.length!==2||!from||!to||!ast.isIdentifier(from)||from.text!==temporary.name.text||!ast.isIdentifier(to)||to.text!=='marker')return;
      sealedWrites.add(w);
    }
    const gatherPublishers=(node:Node):void=>{sealedPublisher(node);node.forEachChild(gatherPublishers);};gatherPublishers(tree);
    const embedded=(node:Node):void=>{
      const value=render(node);
      if(value!==undefined)parse(value,offset+text.slice(0,node.pos).split('\n').length-1,true,depth+1);
    };
    function visit(node:Node):void{
      if(ast.isCallExpression(node)){
        if(generated&&isWrite(node.expression)&&node.arguments[0]&&node.arguments[1]&&
          (jsonValue(node.arguments[1])||pathKind(node.arguments[0],/\.json(?:\.|$)/))&&!sealedWrites.has(node)){
          const line=offset+text.slice(0,node.pos).split('\n').length,source=code(node).replace(/\s+/g,' '),key=line+':'+source;
          if(!seen.has(key)){seen.add(key);found.push({file,line,source});}
        }
        if(isWrite(node.expression)&&node.arguments[0]&&node.arguments[1]&&
          (pathKind(node.arguments[0],/\.[cm]?[jt]s$/)||node.arguments[2]&&code(node.arguments[2]).includes('0o755')))embedded(node.arguments[1]);
        if(/(?:^|\/)generated-javascript\.ts\.generatedJavaScript$/.test(name(node.expression))&&node.arguments[0])embedded(node.arguments[0]);
        // Only arguments at a process invocation are code. An unrelated array
        // containing "-e" or a returned template remains ordinary data.
        if(/^(?:child_process\.(?:spawn|spawnSync|execFile|execFileSync)|(?:.*\.)?(?:spawnTest|activeCommand|compileActive)|spawn|spawnSync)$/.test(name(node.expression))){
          for(const argument of node.arguments){const args=resolved(argument);if(!ast.isArrayLiteralExpression(args))continue;
            for(let i=0;i+1<args.elements.length;i++){const flag=resolved(args.elements[i]!);if(ast.isStringLiteralLikeNode(flag)&&['-e','--eval','-p','--print'].includes(flag.text))embedded(args.elements[i+1]!);}
          }
        }
      }
      node.forEachChild(visit);
    }
    try{visit(tree);}finally{lease?.dispose();}
  }
  try{parse(source,0,false,0,root);}finally{if(!shared)api.close();}
  return found;
}
