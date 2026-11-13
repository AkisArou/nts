// Only producers load the parser. Consumers execute the authenticated emitted
// module graph without TypeScript stripping or preparation dependencies.
import {createRequire,isBuiltin,stripTypeScriptTypes} from 'node:module';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {isAbsolute,posix,relative,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {runtimeModuleName,RUNTIME_MODULE_LIMIT} from './runtime-paths/main.ts';

type Module={source:string;name:string;text:string;sourceSha256:string};
export type RuntimeModules={entry:string;modules:Module[]};
function failure(reason:string):never{throw Error('oracle runtime module: '+reason);}
const hash=(bytes:string)=>createHash('sha256').update(bytes).digest('hex');
/** The bootstrap uses the same strip-only producer without entering its dynamic loader. */
export const stripRuntimeSource=(source:string):string=>stripTypeScriptTypes(source,{mode:'strip'});
const outputName=(name:string)=>name.replace(/\.(?:m?ts|m?js)$/,'.mjs');
/** Every publication reads fresh source bytes and owns its traversal state. */
export function compileRuntimeModules(sourceRoot:string,entry:string):RuntimeModules{
  const root=resolve(sourceRoot);
  if(realpathSync(root)!==root)failure('source root is an alias: '+root);
  const require=createRequire(import.meta.url),{API}=require('typescript/sync') as typeof import('typescript/sync');
  const ast=require('typescript/ast') as typeof import('typescript/ast'),api=new API();
  const modules=new Map<string,Module>(),outputs=new Map<string,string>();
  const sourceName=(file:string)=>{
    const name=relative(root,file).split(sep).join('/');
    if(isAbsolute(name)||name==='..'||name.startsWith('../')||!runtimeModuleName(outputName(name)))failure('source escapes its canonical namespace: '+file);
    try{if(realpathSync(file)!==file||!lstatSync(file).isFile())failure('source is not an owned file: '+file);}
    catch(error){failure('source is missing or not owned: '+file+' ('+String(error)+')');}
    return name;
  };
  const visit=(file:string):void=>{
    const name=sourceName(file);if(modules.has(name))return;
    if(!/\.(?:m?ts|m?js)$/.test(name))failure('unsupported source: '+name);
    if(modules.size>=RUNTIME_MODULE_LIMIT)failure('module limit '+RUNTIME_MODULE_LIMIT+' exceeded at '+name);
    const emitted=outputName(name),alias=outputs.get(emitted);
    if(alias&&alias!==name)failure('two sources select '+emitted+': '+alias+' and '+name);
    const source=readFileSync(file,'utf8'),text=stripRuntimeSource(source);
    const module={source:name,name:emitted,text,sourceSha256:hash(source)};
    modules.set(name,module);outputs.set(emitted,name);
    const targets=new Set<string>();
    const lease=api.createSourceFile(file+'.runtime.mjs',text);
    try{
      const declarations:import('typescript/ast').Node[]=[];
      const collect=(node:import('typescript/ast').Node):void=>{
        if(ast.isImportDeclaration(node)||ast.isExportDeclaration(node)||ast.isCallExpression(node)&&node.expression.kind===ast.SyntaxKind.ImportKeyword)declarations.push(node);
        node.forEachChild(collect);
      };
      collect(lease.sourceFile);
      const changes:{pos:number;end:number;text:string}[]=[];
      for(const node of declarations){
        let specifier;
        if(ast.isImportDeclaration(node)||ast.isExportDeclaration(node))specifier=node.moduleSpecifier;
        else if(ast.isCallExpression(node)&&node.expression.kind===ast.SyntaxKind.ImportKeyword){
          specifier=node.arguments[0];
          if(!specifier||!ast.isStringLiteralLikeNode(specifier))failure('computed import is not a closed module input: '+name);
        }
        if(!specifier)continue;
        if(!ast.isStringLiteralLikeNode(specifier))failure('unsupported import in '+name);
        const spec=specifier.text;if(isBuiltin(spec))continue;
        if(!/^\.{1,2}\//.test(spec)||/[\\%?#]/.test(spec))failure('non-canonical import '+spec+' in '+name);
        const target=fileURLToPath(new URL(spec,pathToFileURL(file))),targetName=sourceName(target);
        let canonical=posix.relative(posix.dirname(name),targetName);if(!canonical.startsWith('../')&&!canonical.startsWith('./'))canonical='./'+canonical;
        if(canonical!==spec)failure('aliased import '+spec+' in '+name);
        targets.add(target);
        let replacement=posix.relative(posix.dirname(emitted),outputName(targetName));if(!replacement.startsWith('../')&&!replacement.startsWith('./'))replacement='./'+replacement;
        // The AST selects the literal; retain its leading comments/trivia.
        const original=text.slice(specifier.pos,specifier.end),trivia=/^(?:\s|\/\/[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)*/.exec(original)![0];
        changes.push({pos:specifier.pos,end:specifier.end,text:trivia+JSON.stringify(replacement)});
      }
      for(const change of changes.sort((a,b)=>b.pos-a.pos))module.text=module.text.slice(0,change.pos)+change.text+module.text.slice(change.end);
    }finally{lease.dispose();}
    // Only primitive paths survive the lease; graph depth retains no SDK ASTs.
    for(const target of targets)visit(target);
  };
  try{visit(resolve(root,entry));return {entry:outputName(sourceName(resolve(root,entry))),modules:[...modules.values()].sort((a,b)=>a.name.localeCompare(b.name))};}
  finally{api.close();}
}
