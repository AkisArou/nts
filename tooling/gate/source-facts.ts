// One structural pass over a leased module. Rules select indexed rows and use
// the same lexical bindings, parents and source positions; they never rebuild
// those tables. Nothing here outlives the caller's source-file lease.
import {createRequire} from 'node:module';
import type {Node,CallExpression,NewExpression,VariableDeclaration,ImportDeclaration,BindingName} from 'typescript/ast';
import {shellCommands,type ShellCommands} from './shell-commands.ts';
import {posix} from 'node:path';
import {fixtureNamespaces,moduleMemberName,projectCatalogue,projectRole,relativeProjectInput,projectMemberPrefix,directoryCandidates,type DirectoryCandidate,type ModuleDeclarations,type ReaderInput,type DataNamespaces,type InputKind} from './reader-inputs/main.ts';

const INPUT_OWNER='tooling/gate/reader-inputs/main.ts';
const READER_FACTORIES:Readonly<Record<string,{owner:string;kind:InputKind}>>={
  dataDirectory:{owner:INPUT_OWNER,kind:'data'},
  inspectionDirectory:{owner:INPUT_OWNER,kind:'inspection'},
  conservativeDirectory:{owner:INPUT_OWNER,kind:'conservative'},
  fileInput:{owner:INPUT_OWNER,kind:'file'},
  optionalFile:{owner:INPUT_OWNER,kind:'optional-file'},
  optionalModule:{owner:INPUT_OWNER,kind:'optional-module'},
  directoryMembership:{owner:INPUT_OWNER,kind:'membership'},
  directoryCandidates:{owner:INPUT_OWNER,kind:'directory-candidates'},
  projectConfig:{owner:INPUT_OWNER,kind:'project-config'},
  projectChoice:{owner:INPUT_OWNER,kind:'project-choice'},
  projectCatalogue:{owner:INPUT_OWNER,kind:'project-catalogue'},
  projectMembers:{owner:INPUT_OWNER,kind:'project-members'},
  generatedProject:{owner:INPUT_OWNER,kind:'generated-project'},
  fixtureInput:{owner:INPUT_OWNER,kind:'fixture'},
  moduleMembers:{owner:INPUT_OWNER,kind:'members'},
  installationInputs:{owner:INPUT_OWNER,kind:'installation-inputs'},
  cargoInputs:{owner:INPUT_OWNER,kind:'cargo-inputs'},
  dependencySourceInputs:{owner:INPUT_OWNER,kind:'dependency-source-inputs'},
  installationStatusInputs:{owner:INPUT_OWNER,kind:'installation-status-inputs'},
  acceptedRevisionData:{owner:'tooling/gate/accepted-revision-data.ts',kind:'accepted-revision'},
};

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
  private moduleEdges:{all:string[];host:string[];local:string[]}|undefined;

  readerFactory(expression:Node):{name:string;kind:InputKind}|undefined{
    const match=/^(\.{1,2}\/.*)\.([A-Za-z_]\w*)$/.exec(this.name(expression));
    const factory=match&&READER_FACTORIES[match[2]!];
    if(factory&&posix.normalize(posix.join(posix.dirname(this.file),match![1]!))===factory.owner)
      return {name:match![2]!,kind:factory.kind};
    return undefined;
  }

  constructor(file:string,source:string,root:Node){
    this.file=file;this.source=source;this.root=root;
    const ast=this.ast,kind=ast.SyntaxKind;
    for(let at=source.indexOf('\n');at>=0;at=source.indexOf('\n',at+1))this.lines.push(at+1);
    const functions=new Set([kind.FunctionDeclaration,kind.FunctionExpression,kind.ArrowFunction,kind.MethodDeclaration,kind.Constructor,kind.GetAccessor,kind.SetAccessor]);
    const parameter=(name:BindingName,values:Map<string,SourceBinding>):void=>{
      if(ast.isIdentifier(name))values.set(name.text,{value:name,kind:'parameter'});
      else for(const element of name.elements)if(ast.isBindingElement(element)&&element.name)parameter(element.name,values);
    };
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
      if(ast.isParameterDeclaration(node))parameter(node.name,values);
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
  private moduleImports():{all:string[];host:string[];local:string[]}{
    if(this.moduleEdges)return this.moduleEdges;
    const ast=this.ast,all:string[]=[],host:string[]=[],local:string[]=[];
    for(const node of [...this.imports,...this.ofKind(ast.SyntaxKind.ExportDeclaration),...this.ofKind(ast.SyntaxKind.ImportEqualsDeclaration),...this.calls]){
      const specifier=ast.isImportDeclaration(node)||ast.isExportDeclaration(node)?node.moduleSpecifier
        :ast.isImportEqualsDeclaration(node)&&ast.isExternalModuleReference(node.moduleReference)?node.moduleReference.expression
        :ast.isCallExpression(node)&&node.expression.kind===ast.SyntaxKind.ImportKeyword?node.arguments[0]:undefined;
      if(!specifier||!ast.isStringLiteralLikeNode(specifier)||!/^\.\.?\//.test(specifier.text))continue;
      local.push(specifier.text);
      const typeOnly=ast.isImportDeclaration(node)?node.importClause?.phaseModifier===ast.SyntaxKind.TypeKeyword
        :(ast.isExportDeclaration(node)||ast.isImportEqualsDeclaration(node))&&node.isTypeOnly;
      if(!typeOnly){all.push(specifier.text);host.push(specifier.text);}
    }
    for(const node of this.ofKind(ast.SyntaxKind.ImportType))if(ast.isImportTypeNode(node)&&ast.isLiteralTypeNode(node.argument)&&ast.isStringLiteralLikeNode(node.argument.literal)){
      const specifier=node.argument.literal.text;if(/^\.\.?\//.test(specifier))local.push(specifier);
    }
    return this.moduleEdges={all,host,local};
  }
  /** Clause-level type imports are erased. Named type specifiers retain the
   * side-effect import produced by Node's verbatim module stripping. */
  hostModuleImports():string[]{return [...this.moduleImports().host];}
  /** Relative source edges needed to reproduce a fixture's local type inputs.
   * Package resolution and runtime reader assets keep their separate owners. */
  localTypeImports():string[]{
    const ast=this.ast,local=[...this.moduleImports().local];
    if(ast.isSourceFile(this.root))for(const ref of this.root.referencedFiles){
      local.push(/^(?:[\/]|[a-z][a-z0-9+.-]*:)/i.test(ref.fileName)||/^\.\.?\//.test(ref.fileName)||ref.fileName.includes('\\')?ref.fileName:'./'+ref.fileName);
    }
    return [...new Set(local)];
  }
  moduleDeclarations():ModuleDeclarations{
    const ast=this.ast,imports=[...this.moduleImports().all],assets:ReaderInput[]=[];
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
    for(const node of this.constructions)if(ast.isIdentifier(node.expression)&&node.expression.text==='URL'&&node.arguments?.length===2){
      const [literal,base]=node.arguments;
      if(literal&&ast.isStringLiteralLikeNode(literal)&&literal.kind===ast.SyntaxKind.StringLiteral&&base&&ast.isPropertyAccessExpression(base)&&base.name.text==='url'
        &&ast.isMetaProperty(base.expression)&&base.expression.keywordToken===ast.SyntaxKind.ImportKeyword&&base.expression.name.text==='meta'
        &&!/^(?:\/|[a-z][a-z0-9+.-]*:)/i.test(literal.text)){
        const parent=this.parents.get(node);
        const factory=parent&&ast.isCallExpression(parent)&&parent.arguments[0]===node?this.readerFactory(parent.expression):undefined;
        const owner=!!factory;
        if(owner&&['generatedProject','optionalModule'].includes(factory!.name)&&!literal.text.split('/').some(segment=>segment!==''&&segment!=='.'&&segment!=='..'))throw Error(factory!.name+' needs a file URL: '+this.file);
        if(!literal.text.split('/').some(segment=>segment!==''&&segment!=='.'&&segment!=='..')
          &&!(owner&&['directoryMembership','projectMembers','directoryCandidates','conservativeDirectory','installationInputs','cargoInputs','dependencySourceInputs','installationStatusInputs'].includes(factory!.name)))continue;
        if(owner&&['optionalFile','optionalModule','directoryMembership','conservativeDirectory','acceptedRevisionData','installationInputs','cargoInputs','dependencySourceInputs','installationStatusInputs'].includes(factory!.name)
          &&(!parent||!ast.isCallExpression(parent)||parent.arguments.length!==1))
          throw Error(factory!.name+' needs exactly one URL input: '+this.file);
        const role=(index:number)=>{
          const value=parent&&ast.isCallExpression(parent)?parent.arguments[index]:undefined;
          if(!value||!ast.isStringLiteral(value))throw Error('project input needs a literal type-check or compiled-program role: '+this.file);
          return projectRole(value.text);
        };
        if(owner&&factory!.name==='projectConfig'){
          if(!parent||!ast.isCallExpression(parent)||parent.arguments.length!==2)throw Error('projectConfig needs a URL and literal role: '+this.file);
          assets.push({path:literal.text,kind:'project-config',role:role(1)});
        }else if(owner&&factory!.name==='directoryCandidates'){
          const values=parent&&ast.isCallExpression(parent)&&parent.arguments.length===2?parent.arguments[1]:undefined;
          if(!values||!ast.isArrayLiteralExpression(values))throw Error('directoryCandidates needs one URL and literal candidates: '+this.file);
          const rows=values.elements.map(value=>{
            if(!ast.isObjectLiteralExpression(value)||value.properties.length!==2)throw Error('directoryCandidates needs literal name/kind rows: '+this.file);
            const row:Record<string,string>={};
            for(const field of value.properties){
              if(!ast.isPropertyAssignment(field)||!(ast.isIdentifier(field.name)||ast.isStringLiteral(field.name))||!ast.isStringLiteral(field.initializer)||Object.hasOwn(row,field.name.text))
                throw Error('directoryCandidates needs literal name/kind rows: '+this.file);
              row[field.name.text]=field.initializer.text;
            }
            return {name:row.name!,kind:row.kind as DirectoryCandidate['kind']};
          });
          assets.push({path:literal.text,kind:'directory-candidates',candidates:directoryCandidates(new URL('file:///candidates'),rows).candidates});
        }else if(owner&&factory!.name==='fixtureInput'){
          if(!parent||!ast.isCallExpression(parent)||parent.arguments.length!==2)throw Error('fixtureInput needs an entry and namespace owners: '+this.file);
          assets.push({path:literal.text,kind:'fixture',dataNamespaces:fixtureGrants(parent.arguments[1])});
        }else if(owner&&factory!.name==='projectChoice'){
          const alternatives=parent&&ast.isCallExpression(parent)&&parent.arguments.length===3?parent.arguments[1]:undefined;
          if(!alternatives||!ast.isArrayLiteralExpression(alternatives)||alternatives.elements.some(node=>!ast.isStringLiteral(node)))
            throw Error('projectChoice needs one URL and literal relative alternatives: '+this.file);
          assets.push({path:literal.text,kind:'project-choice',role:role(2),alternatives:alternatives.elements.map(node=>relativeProjectInput((node as import('typescript/ast').StringLiteral).text))});
        }else if(owner&&factory!.name==='generatedProject'){
          if(!parent||!ast.isCallExpression(parent)||parent.arguments.length!==4||!parent.arguments[1]||!parent.arguments[2]
            ||!ast.isStringLiteral(parent.arguments[1])||!ast.isStringLiteral(parent.arguments[2]))throw Error('generatedProject needs a config URL, literal directory and include recipe: '+this.file);
          const include=parent.arguments[2].text;if(include!=='directory'&&include!=='typescript-tree')throw Error('unsupported generated project include recipe: '+this.file);
          assets.push({path:literal.text,kind:'generated-project',role:role(3),directory:relativeProjectInput(parent.arguments[1].text),include});
        }else if(owner&&['projectCatalogue','projectMembers'].includes(factory!.name)){
          if(!parent||!ast.isCallExpression(parent)||![3,4].includes(parent.arguments.length)||!parent.arguments[1]||!ast.isStringLiteral(parent.arguments[1]))
            throw Error(factory!.name+' needs one URL and a literal selection: '+this.file);
          const selection=parent.arguments[1].text;
          if(factory!.name==='projectMembers'){
            let optional:true|undefined;
            if(parent.arguments.length===4){
              const options=parent.arguments[3],property=options&&ast.isObjectLiteralExpression(options)&&options.properties.length===1?options.properties[0]:undefined;
              if(!property||!ast.isPropertyAssignment(property)||!(ast.isIdentifier(property.name)||ast.isStringLiteral(property.name))||property.name.text!=='optional'||property.initializer.kind!==ast.SyntaxKind.TrueKeyword)
                throw Error('projectMembers optional mode must be literal {optional:true}: '+this.file);
              optional=true;
            }
            assets.push({path:literal.text,kind:'project-members',role:role(2),prefix:projectMemberPrefix(selection),...(optional?{optional}:{})});
          }else{
            if(parent.arguments.length!==3)throw Error('projectCatalogue needs a URL, selection and literal role: '+this.file);
            projectCatalogue(new URL('file:///catalogue.tsv'),selection,role(2));
            assets.push({path:literal.text,kind:'project-catalogue',role:role(2),directory:selection});
          }
        }else if(owner&&factory!.name==='moduleMembers'){
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
        }else assets.push({path:literal.text,kind:factory&&parent&&ast.isCallExpression(parent)&&parent.arguments.length===1?factory.kind:'module'});
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
