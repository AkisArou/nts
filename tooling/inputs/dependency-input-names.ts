// Parser-free populations shared by the actual Git fences and their readers.
import {posix} from 'node:path';
export const DEPENDENCY_ROOT_INPUTS=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','.npmrc','.pnpmfile.cjs','pnpmfile.cjs'] as const;
export const installationSelectionPath=(path:string)=>(DEPENDENCY_ROOT_INPUTS as readonly string[]).includes(path)||path.endsWith('/package.json')||path.endsWith('/.npmrc');
/** Package code is a consumer input. Only declared command targets affect the
 * installed shims (pnpm's getBinsFromPackageManifest also reads their shebang). */
export function installationBinPaths(manifestPath:string,text:string):string[]{
  const manifest=JSON.parse(text) as {bin?:unknown;directories?:{bin?:unknown}},root=posix.dirname(manifestPath);
  if(!manifest.bin&&manifest.directories?.bin)throw Error('dependency inputs require named bin targets instead of directories.bin: '+manifestPath);
  const values=typeof manifest.bin==='string'?[manifest.bin]:manifest.bin&&typeof manifest.bin==='object'&&!Array.isArray(manifest.bin)?Object.values(manifest.bin):[];
  return [...new Set(values.map(value=>{
    if(typeof value!=='string'||!value||posix.isAbsolute(value))throw Error('invalid installation bin target: '+manifestPath);
    const path=posix.normalize(posix.join(root,value)),part=posix.relative(root,path);
    if(part==='..'||part.startsWith('../')||part==='.'||path.split('/').includes('node_modules'))throw Error('installation bin target escapes its package: '+manifestPath+' -> '+value);
    return path;
  }))].sort();
}
/** A parser-free superset of selection metadata and its declared command
 * targets. Importer directories themselves never become status pathspecs. */
export function installationStatusCandidates(tracked:readonly string[],readManifest:(path:string)=>string):string[]{
  const metadata=tracked.filter(installationSelectionPath);
  const bins=metadata.filter(path=>path==='package.json'||path.endsWith('/package.json')).flatMap(path=>installationBinPaths(path,readManifest(path)));
  return [...new Set([...DEPENDENCY_ROOT_INPUTS,...metadata,...bins])].sort();
}
export function installationStatusPaths(identity:{inputs:readonly {path:string}[];importers:readonly string[]},selectionPaths:readonly string[]=[]):string[]{
  return [...new Set([...identity.inputs.map(row=>row.path),...selectionPaths])].sort();
}
/** Git consults ancestor controls even for a literal pathspec. A directory
 * pathspec additionally reaches its tracked descendants and their controls.
 * Optional names retain the negative when a control does not exist yet. */
export function gitStatusInputPopulation(paths:readonly string[],tracked:readonly string[]):{files:string[];controls:string[];directories:string[]}{
  const selected=new Set(paths),directories=new Set<string>(),files=new Set(paths),controls=new Set<string>();
  for(const file of tracked){
    let parent=posix.dirname(file),included=false;
    while(parent!=='.'){
      if(selected.has(parent)){directories.add(parent);included=true;}
      parent=posix.dirname(parent);
    }
    if(included)files.add(file);
  }
  for(const directory of directories)files.delete(directory);
  const visited=new Set<string>();
  for(const file of files){
    let parent=posix.dirname(file);
    while(!visited.has(parent)){
      visited.add(parent);
      for(const name of ['.gitignore','.gitattributes'])controls.add(parent==='.'?name:parent+'/'+name);
      if(parent==='.')break;parent=posix.dirname(parent);
    }
  }
  // Descendant control files are already among the tracked population above.
  return {files:[...files].sort(),controls:[...controls].sort(),directories:[...directories].sort()};
}
