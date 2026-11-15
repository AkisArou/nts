// Structural Rust module inputs. These are potential compile-source edges,
// never runtime byte reads. Macro-generated modules require an explicit owner.
// Directory rules: https://doc.rust-lang.org/reference/items/modules.html
import {lstatSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {metadataParents} from './reader-metadata.ts';
import {isAbsolute,resolve,relative,sep} from 'node:path';
import {posix} from 'node:path';
import {rustTokens,type RustToken} from './rust-test-paths.ts';

export type RustModuleEdge={name:string;candidates:string[];explicitPath:boolean};
function pathLiteral(token:RustToken|undefined,file:string):string{
  if(!token?.literal)throw Error('Rust module path is not literal: '+file);
  let path:string;
  const raw=/^r(#{0,255})"([\s\S]*)"\1$/.exec(token.text);
  if(raw)path=raw[2]!;
  else{try{path=JSON.parse(token.text) as string;}catch{throw Error('unsupported Rust module path escape: '+file);}}
  if(typeof path!=='string'||!path||path.startsWith('/')||/[\\\x00-\x1f]/.test(path))throw Error('Rust module path is not relative: '+file);
  const parts=path.split('/');let named=false;
  for(const part of parts){if(part==='..'&&named)throw Error('Rust module path has an unsupported interior parent component: '+file);if(part!=='.'&&part!==''&&part!=='..')named=true;}
  return path;
}
const contains=(nodes:readonly RustToken[],word:string):boolean=>nodes.some(node=>!node.literal&&(node.text===word||node.children&&contains(node.children,word)));

/** directory is the compiler's current module directory. Root modules and
 * explicit #[path] loads use their containing directory; a normal foo.rs
 * load uses foo/, while foo/mod.rs uses foo/. Inline scopes keep that base. */
export function rustModuleEdges(file:string,source:string,directory:string):RustModuleEdge[]{
  const edges:RustModuleEdge[]=[];
  function walk(nodes:readonly RustToken[],moduleDirectory:string,pathDirectory:string):void{
    let selectedPath:string|undefined;
    for(let index=0;index<nodes.length;index++){
      const node=nodes[index]!;
      if(node.text==='#'){
        const inner=nodes[index+1]?.text==='!',attribute=nodes[index+(inner?2:1)];
        if(attribute?.text!=='['||!attribute.children)throw Error('unsupported Rust module attribute: '+file);
        const values=attribute.children;
        if(values[0]?.text==='path'){
          if(inner||values.length!==3||values[1]?.text!=='='||selectedPath!==undefined)throw Error('unsupported Rust module path attribute: '+file);
          selectedPath=pathLiteral(values[2],file);
        }else if(values[0]?.text==='cfg_attr'&&contains(values,'path'))throw Error('conditional Rust module path needs an explicit owner: '+file);
        index+=inner?2:1;continue;
      }
      if(node.text==='pub'){
        if(nodes[index+1]?.text==='(')index++;
        continue;
      }
      if(node.text==='mod'){
        const rawName=nodes[++index]?.text,name=rawName?.replace(/^r#/,''),body=nodes[++index];
        if(!name||!/^[A-Za-z_]\w*$/.test(name)||!body)throw Error('unsupported Rust module declaration: '+file);
        if(body.text==='{'){
          const next=selectedPath===undefined?posix.join(moduleDirectory,name):posix.join(pathDirectory,selectedPath);
          walk(body.children??[],next,next);
        }else if(body.text===';'){
          const candidates=selectedPath===undefined?[posix.join(moduleDirectory,name+'.rs'),posix.join(moduleDirectory,name,'mod.rs')]:[posix.join(pathDirectory,selectedPath)];
          edges.push({name,candidates,explicitPath:selectedPath!==undefined});
        }else throw Error('unsupported Rust module body: '+file);
        selectedPath=undefined;continue;
      }
      if(node.children){
        if(contains(node.children,'mod'))throw Error('Rust module inside an unsupported item or macro needs an explicit owner: '+file);
        // Other items have no file module edges. Do not interpret quoted source,
        // function bodies or macro token trees as compiled module declarations.
        if(node.text==='{')selectedPath=undefined;
      }else if(node.text===';')selectedPath=undefined;
    }
    if(selectedPath!==undefined)throw Error('Rust module path has no module declaration: '+file);
  }
  walk(rustTokens(source),directory,posix.dirname(file));return edges;
}

export function rustChildDirectory(path:string,explicitPath:boolean):string{
  return explicitPath||posix.basename(path)==='mod.rs'?posix.dirname(path):path.slice(0,-'.rs'.length);
}


export type RustModuleCandidate={reader:string;path:string;present:boolean};
export type BuildModuleInputs={imports:ReadonlyMap<string,readonly string[]>;files:ReadonlySet<string>;candidates:readonly RustModuleCandidate[];sources:readonly {path:string;sha256:string}[]};
/** A one-call composition may reuse a root's structural result only until
 * this complete source/candidate replay, before any target is returned. */
export function validateRustBuildModules(root:string,build:BuildModuleInputs):void{
  for(const row of build.sources){
    const path=resolve(root,row.path);metadataParents(root,path,'Rust module');
    const stat=lstatSync(path);
    if(!stat.isFile()||stat.isSymbolicLink()||createHash('sha256').update(readFileSync(path)).digest('hex')!==row.sha256)
      throw Error('Rust module source changed during batch: '+row.path);
  }
  for(const row of build.candidates){
    const path=resolve(root,row.path);metadataParents(root,path,'Rust module');
    let present=false;
    try{const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Rust module is not an owned source file: '+row.path);present=true;}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(present!==row.present)throw Error('Rust module candidate changed during batch: '+row.path);
  }
}
/** Each target retains its actual module directory contexts. The imports map
 * merges only contexts within this one target; another target is discovered
 * independently. Every compiled source still needs its explicit reader row. */
export function rustBuildModules(root:string,entry:string,declared:(path:string)=>boolean):BuildModuleInputs{
  const imports=new Map<string,string[]>(),files=new Set<string>(),seen=new Set<string>(),candidates=new Map<string,RustModuleCandidate>(),sources=new Map<string,string>();
  const queue=[{path:entry,directory:posix.dirname(entry)}];
  const owned=(path:string):string=>{
    const part=relative(root,resolve(root,path));
    if(isAbsolute(part)||part==='..'||part.startsWith('..'+sep))throw Error('Rust module escapes source root: '+path);
    return part.split(sep).join('/');
  };
  while(queue.length){
    const {path,directory}=queue.pop()!,key=JSON.stringify([path,directory]);if(seen.has(key))continue;seen.add(key);
    if(!declared(path))throw Error('Rust runtime inputs: traversed Rust reader has no declaration: '+path);
    const absolute=resolve(root,path);metadataParents(root,absolute,'Rust module');
    if(!lstatSync(absolute).isFile()||lstatSync(absolute).isSymbolicLink())throw Error('Rust module is not an owned source file: '+path);
    files.add(path);const edges=imports.get(path)??[];imports.set(path,edges);
    const bytes=readFileSync(absolute),sha256=createHash('sha256').update(bytes).digest('hex'),previous=sources.get(path);
    if(previous&&previous!==sha256)throw Error('Rust module source changed during discovery: '+path);sources.set(path,sha256);
    for(const edge of rustModuleEdges(path,bytes.toString('utf8'),directory)){
      const choices=edge.candidates.map(owned),present=choices.filter(candidate=>{
        metadataParents(root,resolve(root,candidate),'Rust module');
        let exists=false;
        try{const stat=lstatSync(resolve(root,candidate));if(stat.isSymbolicLink()||!stat.isFile())throw Error('Rust module is not an owned source file: '+candidate);exists=true;}
        catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
        const row={reader:path,path:candidate,present:exists},key=JSON.stringify([path,candidate]),before=candidates.get(key);
        if(before&&before.present!==exists)throw Error('Rust module candidate changed during discovery: '+candidate);
        candidates.set(key,row);return exists;
      });
      if(present.length!==1)throw Error('Rust module '+edge.name+' has '+present.length+' source candidates in '+path+': '+choices.join(', '));
      const target=present[0]!;if(!edges.includes(target))edges.push(target);
      queue.push({path:target,directory:rustChildDirectory(target,edge.explicitPath)});
    }
  }
  return {imports,files,candidates:[...candidates.values()],sources:[...sources].map(([path,sha256])=>({path,sha256}))};
}
