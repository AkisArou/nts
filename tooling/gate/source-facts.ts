// One structural pass over a leased module. Rules select indexed rows and use
// the same lexical bindings, parents and source positions; they never rebuild
// those tables. Nothing here outlives the caller's source-file lease.
import {createRequire} from 'node:module';
import type {Node,CallExpression,NewExpression,VariableDeclaration,ImportDeclaration} from 'typescript/ast';
import {shellCommands,type ShellCommands} from './shell-commands.ts';
import {posix} from 'node:path';
import {fixtureNamespaces,moduleMemberName,type ModuleDeclarations,type ReaderInput,type DataNamespaces} from './reader-inputs/main.ts';

type Syntax=typeof import('typescript/ast');
let syntax:Syntax|undefined;
export function sourceSyntax():Syntax{return syntax??=createRequire(import.meta.url)('typescript/ast') as Syntax;}
export type SourceBinding={value:Node;member?:string;kind:'value'|'parameter'|'function'};
export type SourceInput={file:string;source:string;parseFile?:string};
/** At most sixteen source leases and two MiB of leased source text per batch.
 * One larger module runs alone; the iterator also holds one pending input. */
export const SOURCE_BATCH_MODULES=16;
export const SOURCE_BATCH_BYTES=2*1024*1024;

export class SourceFacts {
  readonly file:string;readonly source:string;readonly root:Node;
  readonly ast=sourceSyntax();
  readonly nodes:Node[]=[];
  readonly calls:CallExpression[]=[];
  readonly constructions:NewExpression[]=[];
  readonly variables:VariableDeclaration[]=[];
  readonly imports:ImportDeclaration[]=[];
  readonly importNames=new Map<string,string>();
  readonly parents=new Map<Node,Node>();
  readonly scopes=new Map<Node,Map<string,SourceBinding>>();
  readonly topLevelAwaits:Node[]=[];
  private readonly kinds=new Map<number,Node[]>();
  private readonly ranges=new Map<Node,{start:number;end:number}>();
  private readonly scopeAt=new Map<Node,Node>();
  private readonly bindings=new Map<Node,SourceBinding|null>();
  private readonly textCache=new Map<Node,string>();
  private readonly nameCache=[new Map<Node,string>(),new Map<Node,string>()];
  private shellCache:ShellCommands|undefined;
  private readonly callOrders:number[]=[];
  private readonly lines=[0];
  private ambientAliases:Map<string,string>|undefined;

  constructor(file:string,source:string,root:Node){
    this.file=file;this.source=source;this.root=root;
    const ast=this.ast,kind=ast.SyntaxKind;
    for(let at=source.indexOf('\n');at>=0;at=source.indexOf('\n',at+1))this.lines.push(at+1);
    const functions=new Set([kind.FunctionDeclaration,kind.FunctionExpression,kind.ArrowFunction,kind.MethodDeclaration,kind.Constructor,kind.GetAccessor,kind.SetAccessor]);
    const visit=(node:Node,scope:Node,functionDepth:number):void=>{
      const start=this.nodes.length;this.nodes.push(node);
      let rows=this.kinds.get(node.kind);if(!rows)this.kinds.set(node.kind,rows=[]);rows.push(node);
      // Function declarations bind in the enclosing scope, before entering
      // their own parameters and body.
      if(ast.isFunctionDeclaration(node)&&node.name)this.scopes.get(scope)?.set(node.name.text,{value:node,kind:'function'});
      if(node===root||ast.isBlock(node)||ast.isForStatement(node)||ast.isForOfStatement(node)||functions.has(node.kind)){
        scope=node;this.scopes.set(scope,new Map());
      }
      this.scopeAt.set(node,scope);
      if(functions.has(node.kind))functionDepth++;
      if(functionDepth===0&&(ast.isAwaitExpression(node)||ast.isForOfStatement(node)&&node.awaitModifier
        ||ast.isVariableDeclarationList(node)&&(node.flags&ast.NodeFlags.AwaitUsing)===ast.NodeFlags.AwaitUsing))this.topLevelAwaits.push(node);
      const values=this.scopes.get(scope)!;
      if(ast.isCallExpression(node)){this.calls.push(node);this.callOrders.push(start);}
      if(ast.isNewExpression(node))this.constructions.push(node);
      if(ast.isImportDeclaration(node)){
        this.imports.push(node);
        if(ast.isStringLiteralLikeNode(node.moduleSpecifier)){
          const module=node.moduleSpecifier.text.replace(/^node:/,''),clause=node.importClause,names=clause?.namedBindings;
          if(clause?.name)this.importNames.set(clause.name.text,module);
          if(names){if(ast.isNamespaceImport(names))this.importNames.set(names.name.text,module);
            else for(const entry of names.elements)this.importNames.set(entry.name.text,module+'.'+(entry.propertyName?.text??entry.name.text));}
        }
      }
      if(ast.isParameterDeclaration(node)&&ast.isIdentifier(node.name))values.set(node.name.text,{value:node.name,kind:'parameter'});
      if(ast.isVariableDeclaration(node)){
        this.variables.push(node);
        if(node.initializer){
          if(ast.isIdentifier(node.name))values.set(node.name.text,{value:node.initializer,kind:'value'});
          else if(ast.isObjectBindingPattern(node.name))for(const entry of node.name.elements)if(entry.name&&ast.isIdentifier(entry.name))
            values.set(entry.name.text,{value:node.initializer,member:entry.propertyName?this.code(entry.propertyName):entry.name.text,kind:'value'});
        }
      }
      if(ast.isForOfStatement(node)&&ast.isVariableDeclarationList(node.initializer))for(const entry of node.initializer.declarations)
        if(ast.isIdentifier(entry.name))values.set(entry.name.text,{value:node.expression,kind:'value'});
      node.forEachChild(child=>{this.parents.set(child,node);visit(child,scope,functionDepth);});
      this.ranges.set(node,{start,end:this.nodes.length});
    };
    visit(root,root,0);
  }
  ofKind(kind:number):readonly Node[]{return this.kinds.get(kind)??[];}
  get shell():ShellCommands{return this.shellCache??=shellCommands(this.source);}
  ofKinds(...kinds:number[]):readonly Node[]{return kinds.flatMap(kind=>this.ofKind(kind)).sort((a,b)=>this.ranges.get(a)!.start-this.ranges.get(b)!.start);}
  within(node:Node,kind:number):readonly Node[]{
    const range=this.ranges.get(node);if(!range)return [];
    const rows=this.ofKind(kind),bound=(position:number)=>{let low=0,high=rows.length;while(low<high){const mid=(low+high)>>>1;if(this.ranges.get(rows[mid]!)!.start<position)low=mid+1;else high=mid;}return low;};
    return rows.slice(bound(range.start),bound(range.end));
  }
  code(node:Node):string{let value=this.textCache.get(node);if(value===undefined){value=this.source.slice(node.pos,node.end).trim();this.textCache.set(node,value);}return value;}
  line(position:number):number{
    let low=0,high=this.lines.length;
    while(low<high){const mid=(low+high)>>>1;if(this.lines[mid]!<=position)low=mid+1;else high=mid;}
    return low;
  }
  *ancestors(node:Node):Iterable<Node>{let at=this.parents.get(node);while(at){yield at;at=this.parents.get(at);}}
  /** Immediate child rows come from preorder intervals, without asking the
   * parser for the tree again. Value propagation can memoize these edges. */
  *childrenOf(node:Node):Iterable<Node>{
    const range=this.ranges.get(node);if(!range)return;
    for(let at=range.start+1;at<range.end;){const child=this.nodes[at]!;yield child;at=this.ranges.get(child)!.end;}
  }
  callsWithin(node:Node):readonly CallExpression[]{
    const range=this.ranges.get(node);if(!range)return [];
    const bound=(position:number)=>{let low=0,high=this.callOrders.length;while(low<high){const mid=(low+high)>>>1;if(this.callOrders[mid]!<position)low=mid+1;else high=mid;}return low;};
    return this.calls.slice(bound(range.start),bound(range.end));
  }
  binding(node:Node,functions=true):SourceBinding|undefined{
    if(!this.ast.isIdentifier(node))return;
    let value=this.bindings.get(node);
    if(value===undefined){
      let scope=this.scopeAt.get(node);value=null;
      while(scope){const found=this.scopes.get(scope)?.get(node.text);if(found){value=found;break;}
        let at=this.parents.get(scope);while(at&&!this.scopes.has(at))at=this.parents.get(at);scope=at;}
      this.bindings.set(node,value);
    }
    return value&&(!functions&&value.kind==='function'?false:true)?value:undefined;
  }
  unwrap(input:Node):Node{
    const ast=this.ast;let node=input;
    while(ast.isAwaitExpression(node)||ast.isParenthesizedExpression(node)||ast.isAsExpression(node)||ast.isNonNullExpression(node)||ast.isSatisfiesExpression(node))node=node.expression;
    return node;
  }
  resolve(input:Node,functions=true,seen=new Set<Node>()):Node{
    const node=this.unwrap(input);if(seen.has(node))return node;seen.add(node);
    const value=this.binding(node,functions);
    return value&&!value.member&&value.kind!=='parameter'?this.resolve(value.value,functions,seen):node;
  }
  name(input:Node,functions=true):string{
    const cache=this.nameCache[functions?1:0]!;let value=cache.get(input);
    if(value===undefined){value=this.nameAt(input,functions,0);cache.set(input,value);}return value;
  }
  private nameAt(input:Node,functions:boolean,depth:number):string{
    const ast=this.ast,node=this.unwrap(input);if(depth>12)return this.code(node);
    if(ast.isIdentifier(node)){
      const value=this.binding(node,functions);
      if(value?.kind==='parameter')return node.text;
      return value?this.nameAt(value.value,functions,depth+1)+(value.member?'.'+value.member:''):this.importNames.get(node.text)??node.text;
    }
    if(ast.isPropertyAccessExpression(node))return this.nameAt(node.expression,functions,depth+1)+'.'+node.name.text;
    if(ast.isElementAccessExpression(node)&&node.argumentExpression&&ast.isStringLiteralLikeNode(node.argumentExpression))return this.nameAt(node.expression,functions,depth+1)+'.'+node.argumentExpression.text;
    if(ast.isCallExpression(node)&&node.arguments[0]&&ast.isStringLiteralLikeNode(node.arguments[0])&&
      (node.expression.kind===ast.SyntaxKind.ImportKeyword||ast.isIdentifier(node.expression)&&node.expression.text==='require'))return node.arguments[0].text.replace(/^node:/,'');
    return this.code(node);
  }
  /** Preserve the host rule's conservative, module-wide ambient aliases.
   * Its three propagation rounds select variable rows, never AST traversals. */
  ambientName(node:Node):string{
    const ast=this.ast;
    const name=(node:Node):string=>{
      if(ast.isIdentifier(node))return this.ambientAliases!.get(node.text)??node.text;
      if(ast.isPropertyAccessExpression(node))return name(node.expression)+'.'+node.name.text;
      if(ast.isElementAccessExpression(node)&&node.argumentExpression&&ast.isStringLiteralLikeNode(node.argumentExpression))return name(node.expression)+'.'+node.argumentExpression.text;
      if(ast.isCallExpression(node)&&['require','createRequire(import.meta.url)'].includes(name(node.expression))&&node.arguments[0]&&ast.isStringLiteralLikeNode(node.arguments[0]))return node.arguments[0].text.replace(/^node:/,'');
      return this.code(node);
    };
    if(!this.ambientAliases){
      this.ambientAliases=new Map(this.importNames);
      for(let pass=0;pass<3;pass++)for(const variable of this.variables)if(variable.initializer){
        const value=name(variable.initializer);
        if(ast.isIdentifier(variable.name)&&/^(?:process|fs|fs\/promises|os|performance|Date)(?:\.|$)/.test(value))this.ambientAliases.set(variable.name.text,value);
        if(ast.isObjectBindingPattern(variable.name))for(const entry of variable.name.elements)if(entry.name&&ast.isIdentifier(entry.name))
          this.ambientAliases.set(entry.name.text,value+'.'+(entry.propertyName?this.code(entry.propertyName):entry.name.text));
      }
    }
    return name(node);
  }
  moduleDeclarations():ModuleDeclarations{
    const ast=this.ast,imports:string[]=[],assets:ReaderInput[]=[];
    const fixtureGrants=(node:Node|undefined):DataNamespaces=>{
      const fail=():never=>{throw Error('fixtureInput needs literal dataNamespaces owners: '+this.file);};
      if(!node||!ast.isObjectLiteralExpression(node)||node.properties.length!==1)return fail();
      const property=node.properties[0];
      if(!property||!ast.isPropertyAssignment(property)
        ||!(ast.isIdentifier(property.name)||ast.isStringLiteral(property.name))||property.name.text!=='dataNamespaces'
        ||!ast.isObjectLiteralExpression(property.initializer))return fail();
      const owners:Record<string,string>={};
      for(const entry of property.initializer.properties){
        if(!ast.isPropertyAssignment(entry)||!(ast.isIdentifier(entry.name)||ast.isStringLiteral(entry.name))
          ||!ast.isStringLiteral(entry.initializer)||Object.hasOwn(owners,entry.name.text))return fail();
        Object.defineProperty(owners,entry.name.text,{value:entry.initializer.text,enumerable:true});
      }
      return fixtureNamespaces(owners);
    };
    for(const node of [...this.imports,...this.ofKind(ast.SyntaxKind.ExportDeclaration),...this.ofKind(ast.SyntaxKind.ImportEqualsDeclaration),...this.calls]){
      const specifier=ast.isImportDeclaration(node)||ast.isExportDeclaration(node)?node.moduleSpecifier
        :ast.isImportEqualsDeclaration(node)&&ast.isExternalModuleReference(node.moduleReference)?node.moduleReference.expression
        :ast.isCallExpression(node)&&node.expression.kind===ast.SyntaxKind.ImportKeyword?node.arguments[0]:undefined;
      if(specifier&&ast.isStringLiteralLikeNode(specifier)&&/^\.\.?\//.test(specifier.text))imports.push(specifier.text);
    }
    for(const node of this.constructions)if(ast.isIdentifier(node.expression)&&node.expression.text==='URL'&&node.arguments?.length===2){
      const [literal,base]=node.arguments;
      if(literal&&ast.isStringLiteralLikeNode(literal)&&literal.kind===ast.SyntaxKind.StringLiteral&&base&&ast.isPropertyAccessExpression(base)&&base.name.text==='url'
        &&ast.isMetaProperty(base.expression)&&base.expression.keywordToken===ast.SyntaxKind.ImportKeyword&&base.expression.name.text==='meta'
        &&!/^(?:\/|[a-z][a-z0-9+.-]*:)/i.test(literal.text)&&literal.text.split('/').some(segment=>segment!==''&&segment!=='.'&&segment!=='..')){
        const parent=this.parents.get(node);
        const called=parent&&ast.isCallExpression(parent)&&parent.arguments[0]===node?this.name(parent.expression):'';
        const owned=/^(\.{1,2}\/.*)\.(dataDirectory|fileInput|projectInput|projectConfig|fixtureInput|moduleMembers)$/.exec(called);
        const owner=owned&&posix.normalize(posix.join(posix.dirname(this.file),owned[1]!))==='tooling/gate/reader-inputs/main.ts';
        if(owner&&owned![2]==='fixtureInput'){
          if(!parent||!ast.isCallExpression(parent)||parent.arguments.length!==2)throw Error('fixtureInput needs an entry and namespace owners: '+this.file);
          assets.push({path:literal.text,kind:'fixture',dataNamespaces:fixtureGrants(parent.arguments[1])});
        }else if(owner&&owned![2]==='moduleMembers'){
          if(!parent||!ast.isCallExpression(parent)||![2,3].includes(parent.arguments.length)||!parent.arguments[1]||!ast.isStringLiteral(parent.arguments[1]))
            throw Error('moduleMembers needs a directory and literal member name: '+this.file);
          let data:true|undefined;
          if(parent.arguments.length===3){
            const options=parent.arguments[2];
            const property=options&&ast.isObjectLiteralExpression(options)&&options.properties.length===1?options.properties[0]:undefined;
            if(!property||!ast.isPropertyAssignment(property)||!(ast.isIdentifier(property.name)||ast.isStringLiteral(property.name))
              ||property.name.text!=='data'||property.initializer.kind!==ast.SyntaxKind.TrueKeyword)
              throw Error('moduleMembers data role must be literal {data:true}: '+this.file);
            data=true;
          }
          assets.push({path:literal.text,kind:'members',member:moduleMemberName(parent.arguments[1].text),...(data?{data}:{})});
        }else assets.push({path:literal.text,kind:owner&&parent&&ast.isCallExpression(parent)&&parent.arguments.length===1
          ?(owned![2]==='dataDirectory'?'data':owned![2]==='fileInput'?'file':owned![2]==='projectConfig'?'project-config':'project'):'module'});
      }
    }
    return {imports,assets};
  }
}

export type ShellSourceFacts={file:string;source:string;offset:number;shell:ShellCommands};
export function shellSourceFacts(file:string,source:string,offset=0):ShellSourceFacts{return {file,source,offset,shell:shellCommands(source)};}

/** Generated code shares one fact table even when several rules select it.
 * A session covers one parent module and is released before the next module. */
export class GeneratedSourceFacts {
  readonly api:import('typescript/sync').API;readonly file:string;
  private readonly rows=new Map<string,SourceFacts>();
  private readonly leases:import('typescript/sync').RetainedSourceFile[]=[];
  readonly shells:ShellSourceFacts[]=[];
  constructor(api:import('typescript/sync').API,file:string){this.api=api;this.file=file;}
  get(source:string):SourceFacts{
    let facts=this.rows.get(source);if(facts)return facts;
    const lease=this.api.createSourceFile(this.file+'.generated.ts',source);this.leases.push(lease);
    facts=new SourceFacts(this.file,source,lease.sourceFile);this.rows.set(source,facts);return facts;
  }
  shell(source:string,offset:number):void{if(!this.shells.some(row=>row.source===source&&row.offset===offset))this.shells.push(shellSourceFacts(this.file,source,offset));}
  close():void{for(const lease of this.leases)lease.dispose();this.leases.length=0;this.rows.clear();}
}

/** The public sync API batches retained-source requests through generators.
 * Inspect and release one bounded batch before reading the next one. */
export function inspectSourceBatches(api:import('typescript/sync').API,inputs:Iterable<SourceInput>,inspect:(facts:SourceFacts)=>void):{modules:number;batches:number;largestBatchModules:number;largestBatchBytes:number}{
  const totals={modules:0,batches:0,largestBatchModules:0,largestBatchBytes:0};
  const iterator=inputs[Symbol.iterator]();let next=iterator.next();
  while(!next.done){
    const batch:SourceInput[]=[];let bytes=0;
    while(!next.done&&batch.length<SOURCE_BATCH_MODULES){
      const input=next.value,size=Buffer.byteLength(input.source);if(batch.length&&bytes+size>SOURCE_BATCH_BYTES)break;
      batch.push(input);bytes+=size;next=iterator.next();
    }
    const leases:(import('typescript/sync').RetainedSourceFile|undefined)[]=api.batch(...batch.map(input=>api.createSourceFile.gen(input.parseFile??input.file,input.source)));
    totals.modules+=batch.length;totals.batches++;totals.largestBatchModules=Math.max(totals.largestBatchModules,batch.length);totals.largestBatchBytes=Math.max(totals.largestBatchBytes,bytes);
    try{for(let i=0;i<batch.length;i++){
      const input=batch[i]!,lease=leases[i]!;
      try{inspect(new SourceFacts(input.file,input.source,lease.sourceFile));}
      finally{lease.dispose();leases[i]=undefined;}
    }}finally{for(const lease of leases)lease?.dispose();}
  }
  return totals;
}
