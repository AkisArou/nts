// Runtime declarations share one authority with preparation; planning stays in
// node-preloads.ts and never enters a child process through this module.
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
type DeclarationHost={fileExists:(file:string)=>boolean;readFile:(file:string)=>string|null};

export function nodeModuleFiles(root:string,name:string){
  const dir=join(root,'runtime/node',name);
  return {name,dir,bindings:join(dir,'bindings.node.mjs'),entry:join(dir,'src/main.ts'),shape:join(dir,'shape.mjs'),childFixtures:join(dir,'child-fixtures')};
}
function lines(file:string,host?:DeclarationHost){const text=host?(host.fileExists(file)?host.readFile(file):null):(existsSync(file)?readFileSync(file,'utf8'):null);return text===null?[]:text.split('\n').map(line=>line.trim()).filter(line=>line&&!line.startsWith('#'));}
export function nodeGlobalGroups(moduleDir:string,host?:DeclarationHost){
  const file=join(moduleDir,'globals');
  if(!(host?host.fileExists(file):existsSync(file)))return null;
  return lines(file,host);
}
export function nodeGlobalEntry(moduleDir:string,name:string){
  if(name==='abort')return join(moduleDir,'../../web-platform/src/core/abort.ts');
  if(name==='encoding')return join(moduleDir,'../../web-platform/src/core/encoding.ts');
  throw Error(`unknown canonical global group in ${join(moduleDir,'globals')}: ${name}`);
}

export function nodeSiblingModules(root:string,moduleDir:string,host?:DeclarationHost){
  return lines(join(moduleDir,'uses'),host).map(requestedName=>{
    const slash=requestedName.indexOf('/'),name=slash===-1?requestedName:requestedName.slice(0,slash);
    return {...nodeModuleFiles(root,name),requestedName,requestedSubpath:slash===-1?null:requestedName};
  });
}
