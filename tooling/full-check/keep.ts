// The kept-path declarations, shared by inventory and pressure reclamation.
import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
export type FolderStat = (path:string)=>{isDirectory():boolean;isSymbolicLink():boolean;mtimeMs:number};
export type TargetLock={path:string;owner:string};
export type TargetDeclaration=string|{tree:string;lock:TargetLock};
export type Keep = (
  | { kind: "kept" | "pool" | "pins"; why: string; writer?: string }
  | { kind: "runs" | "logs"; who: string; why: string; writer?: string }
  | { kind: "scratch"; writer: string; days?: number }
  | { kind: "folders" | "issue-scratch"; why: string; folders: Record<string, Keep> }
) & { targets?: Record<string, TargetDeclaration>; targetScratch?: Record<string,string>; legacyTargetScratch?: string[] };

export const KEEP_FILE = fileURLToPath(new URL("keep.json", import.meta.url));

export function readKeep(file = KEEP_FILE): Record<string, Keep> {
  const value = JSON.parse(readFileSync(file, "utf8")) as Record<string, Keep>;
  const inside = (path: string) => path !== "" && !isAbsolute(path) && path.split("/").every(part => part !== "" && part !== "." && part !== "..");
  const check = (name: string, keep: Keep, top = false) => {
    if(keep.targetScratch!==undefined||keep.legacyTargetScratch!==undefined){
      if(!top||keep.kind!=='pool')throw Error(`${file}: ${name} scratch declarations require a top-level pool`);
      for(const [child,writer] of Object.entries(keep.targetScratch??{}))if(!inside(child)||child.includes('/')||typeof writer!=='string'||!writer)throw Error(`${file}: invalid target scratch declaration ${child}`);
      if(keep.legacyTargetScratch!==undefined&&(!Array.isArray(keep.legacyTargetScratch)||keep.legacyTargetScratch.some(child=>typeof child!=='string'||!inside(child)||child.includes('/'))))throw Error(`${file}: invalid legacy scratch layout`);
    }
    if (keep.targets !== undefined) {
      if (!top) throw new Error(`${file}: ${name} declares targets; only a top-level rule does`);
      if (keep.kind === "pool") throw new Error(`${file}: ${name} is a pool, whose kind declares each slot's target`);
      if (typeof keep.targets !== "object" || keep.targets === null || Array.isArray(keep.targets)) throw new Error(`${file}: ${name}'s targets are not a map of target to tree`);
      for (const [target, declaration] of Object.entries(keep.targets)) {
        const tree=typeof declaration==='string'?declaration:declaration?.tree;
        if(typeof declaration!=='string'){
          const lock=declaration?.lock;
          if(!lock||!inside(lock.path)||lock.owner!=='tooling/conformance/pin.ts')throw Error(`${file}: ${name}/${target} has an unknown target lock owner or path`);
        }
        if (!inside(target) || typeof tree !== "string" || !inside(tree)) throw new Error(`${file}: ${name} declares target ${target} of tree ${String(tree)}; both must be relative paths inside its folder`);
      }
    }
    if (!["kept", "pool", "pins", "runs", "logs", "scratch", "folders", "issue-scratch"].includes(keep.kind)) throw new Error(`${file}: ${name} has an unknown kind ${String(keep.kind)}`);
    if (keep.kind === "scratch" && !keep.writer) throw new Error(`${file}: the scratch root ${name} names no writer`);
    if (keep.kind !== "scratch" && !keep.why) throw new Error(`${file}: ${name} does not say why it is kept`);
    if (keep.kind === "folders" || keep.kind === "issue-scratch") for (const [child, inner] of Object.entries(keep.folders)) {
      if(keep.kind==='issue-scratch'&&/^[0-9]+$/.test(child))throw Error(`${file}: ${name}/${child} is kept by issue state or committed record citation, not a keep.json row`);
      check(`${name}/${child}`, inner);
    }
  };
  for (const [name, keep] of Object.entries(value)) check(name, keep, true);
  return value;
}

function targetSlots(dir:string,stat:FolderStat=lstatSync):{name:string;path:string}[]{
  let names:string[];
  try{names=readdirSync(dir);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
  return names.sort().flatMap(name=>{
    const path=join(dir,name);
    try{const info=stat(path);return info.isDirectory()||info.isSymbolicLink()?[{name,path}]:[];}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
  });
}
/** A declared cargo target and the tree whose builds write it. */
export type DeclaredTarget = { target: string; tree: string; lock?:TargetLock };
/** Every cargo target keep.json declares under `cache`, pool slots' included, whether or not it exists. */
export function declaredTargets(cache: string, keep: Record<string, Keep>, stat?: FolderStat): DeclaredTarget[] {
  return Object.entries(keep).flatMap(([name, rule]) => rule.kind === "pool"
    ? targetSlots(join(cache, name), stat).filter(slot => /^\d+$/.test(slot.name)).map(slot => ({ target: join(slot.path, "target"), tree: slot.path }))
    : Object.entries(rule.targets ?? {}).map(([target, declaration]) => {
      const tree=typeof declaration==='string'?declaration:declaration.tree;
      return {target:join(cache,name,target),tree:join(cache,name,tree),...(typeof declaration==='string'?{}:{lock:{owner:declaration.lock.owner,path:join(cache,name,declaration.lock.path)}})};
    }));
}

/** Run log roots whose raw cost evidence has the same retention contract. */
export function declaredRunRoots(cache:string,keep:Record<string,Keep>):string[]{
  const roots:string[]=[];
  const visit=(path:string,rule:Keep)=>{
    if(rule.kind==='runs')roots.push(join(path,'runs'));
    else if(rule.kind==='logs')roots.push(path);
    else if(rule.kind==='folders')for(const [name,child] of Object.entries(rule.folders))visit(join(path,name),child);
  };
  for(const [name,rule] of Object.entries(keep))visit(join(cache,name),rule);
  return roots;
}

/** Explicit writer-owned namespaces. Legacy names are a bounded migration,
 * removed once no pool tree carries the old layout and no legacy trash remains. */
export function targetScratch(keep:Record<string,Keep>=readKeep()):{names:Record<string,string>;legacy:readonly string[]}{
  const pools=Object.values(keep).filter(rule=>rule.kind==='pool');
  return {names:Object.assign({},...pools.map(rule=>rule.targetScratch??{})) as Record<string,string>,legacy:pools.flatMap(rule=>rule.legacyTargetScratch??[])};
}
