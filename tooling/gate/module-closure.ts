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
import {fixtureNamespaces,moduleMemberName,matchesModuleMember,type DataNamespaces,type DirectoryDeclaration,type ModuleDeclarations,type InputSnapshot,type ReaderInput,type InputEntry,type OptionalFileDeclaration,type MembershipDeclaration} from './reader-inputs/main.ts';
import {directoryEntries,metadataParents,membershipIndex} from './reader-metadata.ts';
export type {DirectoryDeclaration,ModuleDeclarations} from './reader-inputs/main.ts';

const SOURCE = fileURLToPath(new URL("../..", import.meta.url));
export type ByteInputDeclaration={reader:string;path:string};
export type ModuleClosureOptions = {sourceRoot?: string; directory?: (declaration: DirectoryDeclaration) => void;
  byteInput?:(declaration:ByteInputDeclaration)=>void;
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
 * traversal, including a later real module edge into previously owned bytes.
 * placingFiles retains every declared role except inspection-only membership,
 * including immutable project configs and inherited configs. */
export function moduleGraph(options: ModuleClosureOptions = {}) {
  // Input provisioning imports this module before node_modules exists. Only a
  // caller actually walking a graph needs the already provisioned parser.
  const require = createRequire(import.meta.url);
  const {API} = require("typescript/sync") as typeof import("typescript/sync");
  const root = realpathSync(options.sourceRoot ?? SOURCE);
  const references = new Map<string,ModuleDeclarations>();
  let tracked: string[] | undefined;
  // A graph owns one tracked inventory. Contexts select from that inventory;
  // they never need to rescan every tracked path for the same directory.
  const directoryFiles=new Map<string,string[]>(),memberFiles=new Map<string,Map<string,string[]>>();
  const sourceFiles=()=>tracked??=execFileSync("git",gitArguments(["ls-files","-z","--cached"]),{cwd:root,encoding:"utf8",maxBuffer:64<<20}).split("\0").filter(Boolean);
  function membersOf(directory:string,member?:string):string[]{
    let files=directoryFiles.get(directory);
    if(!files){
      tracked=sourceFiles();
      const prefix=directory?directory+'/':'';
      files=prefix?tracked.filter(file=>file.startsWith(prefix)):tracked;
      directoryFiles.set(directory,files);
    }
    if(!member)return files;
    let selections=memberFiles.get(directory);
    if(!selections){selections=new Map();memberFiles.set(directory,selections);}
    let selected=selections.get(member);
    if(!selected){
      selected=files.filter(file=>matchesModuleMember(directory?file.slice(directory.length+1):file,member));
      selections.set(member,selected);
    }
    return selected;
  }
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
  function describe(entries:readonly InputEntry[],reportDirectory:ModuleClosureOptions['directory']=options.directory,reportByteInput:ModuleClosureOptions['byteInput']=options.byteInput):InputSnapshot {
    const files=new Set<string>(),owned=new Set<string>(),moduleFiles=new Set<string>(),placing=new Set<string>(),directories:DirectoryDeclaration[]=[];
    const optionalFiles:OptionalFileDeclaration[]=[],memberships:MembershipDeclaration[]=[];
    type Context={entry:string;namespaces:DataNamespaces;entered:Set<string>;owned:Set<string>;projects:Set<string>;data:Set<string>};
    const contexts=new Map<string,Context>();
    const nameOf=(path:string)=>relative(root,path).split(sep).join('/');
    function asset(context:Context,reader:string,path:string,input:ReaderInput):void {
      if (!inside(root, path)) throw new Error("asset escapes source root: " + path);
      const kind=input.kind;
      if(kind==='optional-file'){
        metadataParents(root,path,'optional file');
        let stat:ReturnType<typeof lstatSync>|undefined;
        try{stat=lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
        const name=nameOf(path);
        if(stat&&(!stat.isFile()||stat.isSymbolicLink()))throw Error('optional file input is not a regular file: '+name);
        optionalFiles.push({reader,path:name,present:!!stat,context:{entry:context.entry,dataNamespaces:context.namespaces}});
        // Even an absent candidate may become bytes in the next source tree.
        reportByteInput?.({reader,path:name});
        if(stat)visit(context,path,false,false);
        return;
      }
      if(kind==='membership'){
        if(path!==root)metadataParents(root,path,'membership input');
        const stat=lstatSync(path);
        if(!stat.isDirectory()||stat.isSymbolicLink()||!inside(root,realpathSync(path)))
          throw Error('membership input is not an owned directory: '+nameOf(path));
        memberships.push({reader,directory:nameOf(path),entries:directoryEntries(path),context:{entry:context.entry,dataNamespaces:context.namespaces}});
        return;
      }
      if(kind==='fixture'){
        const namespaces=fixtureNamespaces(input.dataNamespaces??{}),entry=nameOf(path);
        const key=JSON.stringify([entry,Object.entries(namespaces).sort(([a],[b])=>a.localeCompare(b))]);
        if(contexts.has(key))return;
        const child:Context={entry,namespaces,entered:new Set(),owned:new Set(),projects:new Set(),data:new Set()};
        contexts.set(key,child);
        visit(child,path);
        for(const directory of Object.keys(namespaces))if(!child.data.has(directory))
          throw Error('fixture data namespace is not a declared data input: '+directory+' ('+entry+')');
        return;
      }
      if(kind==='project'||kind==='project-config'){
        const entry=nameOf(path);
        const key=kind+'\0'+entry;
        if(context.projects.has(key))return;
        context.projects.add(key);
        visit(context,path,kind==='project');
        const project=projectInputs([{kind:kind==='project'?'entry':'config',path:entry}],root);
        for(const config of project.configs)visit(context,resolve(root,config),false);
        for(const entry of project.roots)visit(context,resolve(root,entry));
        return;
      }
      if (!lstatSync(path).isDirectory()) {
        if(kind==='data'||kind==='inspection')throw Error('declared '+kind+' input is not a directory: '+nameOf(path));
        if(kind==='members')throw Error('declared module members input is not a directory: '+nameOf(path));
        if(kind==='file')reportByteInput?.({reader,path:nameOf(path)});
        visit(context,path,kind!=='file');return;
      }
      if(kind==='file')throw Error('declared file input is not a file: '+nameOf(path));
      if (!inside(root, realpathSync(path))) throw new Error("asset is not an owned directory: " + path);
      const member=kind==='members'?moduleMemberName(input.member):undefined;
      const directory=nameOf(path);
      // One descriptor may retain a reader's existing metadata/data population
      // while entering only its named executable members. Private data grants
      // never remove the immutable member modules visited below.
      if(kind==='members'&&input.data)asset(context,reader,path,{path:input.path,kind:'data'});
      if(kind==='data')context.data.add(directory);
      const grant=kind==='data'?Object.keys(context.namespaces).find(name=>directory===name||directory.startsWith(name+'/')):undefined;
      const members=grant?[]:membersOf(directory,member);
      const row:DirectoryDeclaration={reader,directory,files:[...members],kind:kind==='members'?'module':kind,
        ...(member?{member}:{}),
        ...(grant?{fixture:{entry:context.entry,owner:context.namespaces[grant]!}}:{})};
      directories.push(row);reportDirectory?.(row);
      if(grant)return;
      for(const file of members){
        if(kind==='data'){files.add(file);placing.add(file);}
        else visit(context,resolve(root,file),kind!=='inspection',kind!=='inspection');
      }
    }
    function visit(context:Context,path:string,enter=true,place=true):void {
      if (!inside(root, path)) throw new Error("module escapes source root: " + path);
      const name=nameOf(path);
      if(enter?context.entered.has(name):context.owned.has(name)){if(place)placing.add(name);return;}
      if (!lstatSync(path).isFile() || !inside(root, realpathSync(path))) throw new Error("module is not an owned source file: " + name);
      context.owned.add(name);owned.add(name);files.add(name);if(place)placing.add(name);
      if(!enter)return;
      context.entered.add(name);moduleFiles.add(name);
      // Aggregate ownership never suppresses another namespace context. A
      // later production import must still restore its real data membership.
      if(!/\.[cm]?[jt]sx?$/.test(path)&&!options.declarations?.has(name))return;
      const {imports,assets}=parsed(path);
      for(const specifier of imports)visit(context,fileURLToPath(new URL(specifier,pathToFileURL(path))));
      for(const input of assets)asset(context,name,fileURLToPath(new URL(input.path,pathToFileURL(path))),input);
    }
    const production:Context={entry:'<entry>',namespaces:{},entered:new Set(),owned:new Set(),projects:new Set(),data:new Set()};
    for(const entry of entries){
      if(typeof entry!=='string'){
        asset(production,'<entry>',fileURLToPath(entry.url),{path:entry.url.href,kind:entry.kind,
          ...(entry.kind==='fixture'?{dataNamespaces:entry.dataNamespaces}:entry.kind==='members'?{member:entry.member,...(entry.data?{data:true}:{})}:{})});
        continue;
      }
      if(isAbsolute(entry))throw Error('module entry must be repository-relative: '+entry);
      const path=resolve(root,entry);
      if(lstatSync(path).isDirectory())asset(production,'<entry>',path,{path:entry,kind:'module'});
      else visit(production,path);
    }
    return {files:[...files].sort(),ownedFiles:[...owned].sort(),moduleFiles:[...moduleFiles].sort(),placingFiles:[...placing].sort(),directories,optionalFiles,memberships};
  }
  return {describe,closure:(entries:readonly InputEntry[],reportDirectory?:ModuleClosureOptions['directory'])=>describe(entries,reportDirectory??options.directory).files,
    membershipIndex:()=>membershipIndex(sourceFiles()),close:()=>api?.close()};
}

/** A public walk always gets a fresh graph, including fresh source bytes. */
export function moduleClosure(entries: readonly InputEntry[], options: ModuleClosureOptions = {}): string[] {
  const graph = moduleGraph(options);
  try {return graph.closure(entries);} finally {graph.close();}
}
