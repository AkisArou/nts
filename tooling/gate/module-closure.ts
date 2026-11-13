import {gitArguments} from "./git-arguments/main.ts";
// Module membership, read from each source tree's own declarations.
// Literal relative import() is followed like a static import; computed imports
// (variables or interpolated templates) must be named as another entry.
import {lstatSync, readFileSync, realpathSync} from "node:fs";
import {isAbsolute, relative, resolve, sep} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {createRequire} from "node:module";
import {execFileSync} from "node:child_process";
import {SourceFacts} from './source-facts.ts';
import {projectInputs} from './project-inputs.ts';
import type {DirectoryDeclaration,ModuleDeclarations,InputSnapshot,InputKind,InputEntry} from './reader-inputs/main.ts';
export type {DirectoryDeclaration,ModuleDeclarations} from './reader-inputs/main.ts';

const SOURCE = fileURLToPath(new URL("../..", import.meta.url));
export type ModuleClosureOptions = {sourceRoot?: string; directory?: (declaration: DirectoryDeclaration) => void;
  /** A caller which already owns parsed source facts supplies detached edges. */
  declarations?:ReadonlyMap<string,ModuleDeclarations>};
const inside = (root: string, path: string) => {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith(".." + sep) && !isAbsolute(part);
};

/** Declarations, including type imports, re-exports and literal relative
 * import() calls. Data strings,
 * computed imports and package resolution cannot invent file inputs. Each
 * graph reads fresh bytes; closures share only this graph's parsed references.
 * Module-relative URL assets are declarations too. Dot-only positions are
 * anchors, while a directory asset declares its tracked files. Exact fileInput
 * bytes stay owned but do not enter imports; moduleFiles records that separate
 * traversal, including a later real module edge into previously owned bytes. */
export function moduleGraph(options: ModuleClosureOptions = {}) {
  // Input provisioning imports this module before node_modules exists. Only a
  // caller actually walking a graph needs the already provisioned parser.
  const require = createRequire(import.meta.url);
  const {API} = require("typescript/sync") as typeof import("typescript/sync");
  const root = realpathSync(options.sourceRoot ?? SOURCE);
  const references = new Map<string,ModuleDeclarations>();
  let tracked: string[] | undefined;
  let api:import('typescript/sync').API|undefined;
  function parsed(path: string) {
    const known = references.get(path);
    if (known) return known;
    const supplied=options.declarations?.get(relative(root,path).split(sep).join('/'));
    if(supplied){references.set(path,supplied);return supplied;}
    api??=new API({cwd:root});
    const source=readFileSync(path,'utf8'),lease=api.createSourceFile(path,source);
    try {
      const result=new SourceFacts(relative(root,path).split(sep).join('/'),source,lease.sourceFile).moduleDeclarations();
      references.set(path,result);return result;
    } finally {lease.dispose();}
  }
  function describe(entries:readonly InputEntry[],reportDirectory:ModuleClosureOptions['directory']=options.directory):InputSnapshot {
    const visited=new Set<string>(),owned=new Set<string>(),moduleFiles=new Set<string>(),directories:DirectoryDeclaration[]=[],projectEntries=new Set<string>();
    function asset(reader:string,path:string,kind:InputKind):void {
      if (!inside(root, path)) throw new Error("asset escapes source root: " + path);
      if(kind==='project'){
        const entry=relative(root,path).split(sep).join('/');
        if(projectEntries.has(entry))return;
        projectEntries.add(entry);
        visit(path);
        const project=projectInputs([entry],root);
        for(const config of project.configs)visit(resolve(root,config),false);
        for(const entry of project.roots)visit(resolve(root,entry));
        return;
      }
      if (!lstatSync(path).isDirectory()) {
        if(kind==='data')throw Error('declared data input is not a directory: '+relative(root,path));
        visit(path,kind!=='file');return;
      }
      if(kind==='file')throw Error('declared file input is not a file: '+relative(root,path));
      if (!inside(root, realpathSync(path))) throw new Error("asset is not an owned directory: " + path);
      tracked ??= execFileSync("git",gitArguments( ["ls-files", "-z", "--cached"]), {cwd: root, encoding: "utf8", maxBuffer: 64 << 20}).split("\0").filter(Boolean);
      const directory = relative(root, path).split(sep).join("/");
      const files = tracked.filter(file => directory === "" || file.startsWith(directory + "/"));
      const row={reader,directory,files,kind};directories.push(row);reportDirectory?.(row);
      for(const file of files){if(kind==='data')visited.add(file);else visit(resolve(root,file));}
    }
    function visit(path: string,enter=true): void {
      if (!inside(root, path)) throw new Error("module escapes source root: " + path);
      const name = relative(root, path).split(sep).join("/");
      if(enter?moduleFiles.has(name):owned.has(name))return;
      if (!lstatSync(path).isFile() || !inside(root, realpathSync(path))) throw new Error("module is not an owned source file: " + name);
      owned.add(name);visited.add(name);
      if(!enter)return;
      moduleFiles.add(name);
      // A non-JS reader (for example a harness manifest) can supply the same
      // detached declarations. Its adapter owns parsing that source format.
      if(!/\.[cm]?[jt]sx?$/.test(path)&&!options.declarations?.has(name))return;
      const {imports, assets} = parsed(path);
      for (const specifier of imports) visit(fileURLToPath(new URL(specifier, pathToFileURL(path))));
      for(const input of assets)asset(name,fileURLToPath(new URL(input.path,pathToFileURL(path))),input.kind);
    }

    for (const entry of entries) {
      if(typeof entry!=='string'){
        asset('<entry>',fileURLToPath(entry.url),entry.kind);
        continue;
      }
      if (isAbsolute(entry)) throw new Error("module entry must be repository-relative: " + entry);
      const path = resolve(root, entry);
      if (lstatSync(path).isDirectory()) asset("<entry>", path,'module');
      else visit(path);
    }
    return {files:[...visited].sort(),ownedFiles:[...owned].sort(),moduleFiles:[...moduleFiles].sort(),directories};
  }
  return {describe,closure:(entries:readonly InputEntry[],reportDirectory?:ModuleClosureOptions['directory'])=>describe(entries,reportDirectory??options.directory).files,close:()=>api?.close()};
}

/** A public walk always gets a fresh graph, including fresh source bytes. */
export function moduleClosure(entries: readonly InputEntry[], options: ModuleClosureOptions = {}): string[] {
  const graph = moduleGraph(options);
  try {return graph.closure(entries);} finally {graph.close();}
}
