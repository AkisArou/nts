// Parser-free populations shared by the actual Git fences and their readers.
import {posix} from 'node:path';
export const DEPENDENCY_ROOT_INPUTS=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','.npmrc','.pnpmfile.cjs','pnpmfile.cjs'] as const;
export const installationSelectionPath=(path:string)=>(DEPENDENCY_ROOT_INPUTS as readonly string[]).includes(path)||path.endsWith('/package.json')||path.endsWith('/.npmrc');
/** The immutable selection tree contains exactly these metadata files. Any
 * importer pnpm can select must have one of these staged package manifests. */
export function installationStatusCandidates(tracked:readonly string[]):string[]{
  const metadata=tracked.filter(installationSelectionPath);
  return [...new Set([...DEPENDENCY_ROOT_INPUTS,...metadata,...metadata.filter(path=>path.endsWith('/package.json')).map(path=>posix.dirname(path))])].sort();
}
export function installationStatusPaths(identity:{inputs:readonly {path:string}[];importers:readonly string[]},selectionPaths:readonly string[]=[]):string[]{
  return [...new Set([...identity.inputs.map(row=>row.path),...identity.importers.filter(path=>path!=='.'),...selectionPaths])].sort();
}
/** Git consults ancestor controls even for a literal pathspec. A directory
 * pathspec additionally reaches its tracked descendants and their controls.
 * Optional names retain the negative when a control does not exist yet. */
export function gitStatusInputPopulation(paths:readonly string[],tracked:readonly string[]):{files:string[];controls:string[];directories:string[]}{
  const directories=paths.filter(path=>tracked.some(file=>file.startsWith(path+'/')));
  const files=new Set(paths.filter(path=>!directories.includes(path))),controls=new Set<string>();
  for(const file of tracked)if(paths.some(path=>file.startsWith(path+'/')))files.add(file);
  for(const file of files){
    let parent=posix.dirname(file);
    for(;;){
      for(const name of ['.gitignore','.gitattributes'])controls.add(parent==='.'?name:parent+'/'+name);
      if(parent==='.')break;parent=posix.dirname(parent);
    }
  }
  // A selected directory can itself contain a control before any other file.
  for(const file of tracked)if(/(?:^|\/)\.(?:gitignore|gitattributes)$/.test(file)
    &&paths.some(path=>file.startsWith(path+'/')))controls.add(file);
  return {files:[...files].sort(),controls:[...controls].sort(),directories:[...directories].sort()};
}
