// Test repositories carry the modules their entry points actually import.
// Package installations and non-module assets remain explicit fixture inputs.
import {copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync} from "node:fs";
import {dirname, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {moduleGraph, type ModuleClosureOptions} from "./module-closure.ts";
import {OracleFilesystem} from "../differential/oracle-filesystem.ts";
import {outsideSource} from "./source-containment.ts";
import type {InputSnapshot} from './reader-inputs.ts';
import {durableRecord} from './durable-record.ts';
import {assertStateVersion} from './state-version.ts';
export {moduleClosure} from "./module-closure.ts";

const SOURCE = fileURLToPath(new URL("../..", import.meta.url));
const info = (path: string) => {
  try {return lstatSync(path);}
  catch (error) {if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error;}
};

export type FixtureClosureOptions = ModuleClosureOptions & {link?: boolean; owningProject?: boolean;
  /** These already-populated directories belong to this fixture, at the same
   * relative position as a production-declared data input. Values name owners,
   * never another source path or a list of module dependencies. */
  dataNamespaces?:Readonly<Record<string,string>>;
  /** A whole namespace mirror already links these exact source inputs. Reuse
   * them read-only; missing inputs still require owned, real parent folders. */
  reuseSourceLinks?:boolean};

export const FIXTURE_INPUT_MANIFEST='.nts-fixture-inputs.json';
type FixtureDataInput={directory:string;fixtureOwner:string;readers:string[]};
type FixtureInputManifest={version:1;data:FixtureDataInput[]};
const under=(directory:string,file:string)=>file===directory||file.startsWith(directory+'/');
const canonical=(name:string)=>name.length>0&&!name.startsWith('/')&&!/[\\\x00-\x1f]/.test(name)&&name.split('/').every(part=>part!==''&&part!=='.'&&part!=='..');

/** A fixture has one synchronous staging owner. Each complete publication is
 * atomic; subsequent calls preserve earlier data ownership in that manifest. */
function readFixtureInputs(destination:string):FixtureInputManifest{
  const file=join(destination,FIXTURE_INPUT_MANIFEST),stat=info(file);if(!stat)return {version:1,data:[]};
  if(!stat.isFile()||stat.isSymbolicLink())throw Error('fixture input manifest is not an owned file: '+file);
  const value:unknown=JSON.parse(readFileSync(file,'utf8'));assertStateVersion(value,1,file);
  if(!value||typeof value!=='object')throw Error('invalid fixture input manifest: '+file);
  const row=value as Record<string,unknown>;
  if(row.version!==1||!Array.isArray(row.data))throw Error('invalid fixture input manifest: '+file);
  const data:FixtureDataInput[]=[];
  for(const item of row.data as unknown[]){
    if(!item||typeof item!=='object')throw Error('invalid fixture input manifest: '+file);
    const entry=item as Record<string,unknown>;
    if(typeof entry.directory!=='string'||!canonical(entry.directory)||typeof entry.fixtureOwner!=='string'||!entry.fixtureOwner.trim()
      ||!Array.isArray(entry.readers)||entry.readers.some(reader=>typeof reader!=='string'||!canonical(reader)))throw Error('invalid fixture input manifest: '+file);
    data.push({directory:entry.directory,fixtureOwner:entry.fixtureOwner,readers:entry.readers as string[]});
  }
  return {version:1,data};
}

function fixtureData(snapshot:InputSnapshot,destination:string,source:string,options:Pick<FixtureClosureOptions,'dataNamespaces'|'link'|'reuseSourceLinks'>){
  const declared=new Map<string,Set<string>>();
  for(const row of snapshot.directories)if(row.kind==='data'){
    const readers=declared.get(row.directory)??new Set<string>();readers.add(row.reader);declared.set(row.directory,readers);
  }
  const owned=new Set(snapshot.ownedFiles),selected=new Map<string,string>();
  for(const [directory,owner]of Object.entries(options.dataNamespaces??{})){
    if(!canonical(directory)||!declared.has(directory))throw Error('fixture data namespace is not a declared data input: '+directory);
    if(typeof owner!=='string'||!owner.trim())throw Error('fixture data namespace has no fixture owner: '+directory);
    if(!info(join(destination,directory))?.isDirectory()||info(join(destination,directory))?.isSymbolicLink())throw Error('fixture data namespace is not an owned directory: '+directory);
    selected.set(directory,owner);
  }
  // Reject nested grants: their owner would otherwise depend on iteration order.
  const names=[...selected.keys()];
  for(const [index,name]of names.entries())for(const other of names.slice(index+1))if(under(name,other)||under(other,name))throw Error('overlapping fixture data namespaces: '+name+' and '+other);
  const manifest=readFixtureInputs(destination),entries=new Map(manifest.data.map(row=>[row.directory,row]));
  for(const previous of entries.keys())for(const directory of declared.keys()){
    if((under(previous,directory)||under(directory,previous))&&!selected.has(previous))throw Error('fixture data namespace already has an owner; repeat its explicit grant: '+previous);
  }
  const granted=(name:string)=>names.some(directory=>under(directory,name));
  const overlapsGrant=(name:string)=>names.some(directory=>under(directory,name)||under(name,directory));
  const sourceDirectory=(name:string,path:string)=>options.reuseSourceLinks&&!overlapsGrant(name)
    &&realpathSync(path)===join(source,name)&&info(join(source,name))?.isDirectory();
  function privateTree(directory:string):void{
    let parent=destination;
    for(const part of ['',...directory.split('/')]){
      parent=join(parent,part);const stat=info(parent);
      if(stat&&(!stat.isDirectory()||stat.isSymbolicLink())
        &&!(stat.isSymbolicLink()&&sourceDirectory(relative(destination,parent).split(sep).join('/'),parent)))throw Error('fixture data namespace has an unowned parent: '+directory);
    }
    const expected=new Set(snapshot.files.filter(file=>under(directory,file))),allowedDirectories=new Set<string>([directory]);
    for(const file of expected)for(let parent=dirname(file);under(directory,parent);parent=dirname(parent)){allowedDirectories.add(parent);if(parent===directory)break;}
    const walk=(name:string):void=>{
      const path=join(destination,name),stat=info(path);if(!stat)return;
      // Module links always retain their production identity. Unsubstituted
      // data may reuse that exact identity only through the explicit linking
      // options; a private data grant still owns real paths, never data links.
      const linkedDirectory=stat.isSymbolicLink()&&sourceDirectory(name,path);
      if(stat.isSymbolicLink()&&!linkedDirectory){
        if((owned.has(name)||!granted(name)&&(options.link||options.reuseSourceLinks))
          &&realpathSync(path)===join(source,name)&&info(join(source,name))?.isFile()){
          if(!expected.has(name))throw Error('fixture data input needs an explicit namespace grant: '+name);
          return;
        }
        throw Error('fixture data namespace contains an unowned path: '+name);
      }
      const isDirectory=stat.isDirectory()||linkedDirectory;
      if(!stat.isFile()&&!isDirectory)throw Error('fixture data namespace contains an unowned path: '+name);
      if(!granted(name)&&!(isDirectory?allowedDirectories:expected).has(name))throw Error('fixture data input needs an explicit namespace grant: '+name);
      if(isDirectory){for(const entry of readdirSync(path))walk(name+'/'+entry);return;}
      if(owned.has(name)&&!readFileSync(path).equals(readFileSync(join(source,name))))throw Error('fixture data namespace cannot replace module-owned input: '+name);
    };walk(directory);
  }
  for(const directory of declared.keys())privateTree(directory);
  for(const [directory,fixtureOwner]of selected){
    for(const previous of entries.keys())if(previous!==directory&&(under(previous,directory)||under(directory,previous)))throw Error('overlapping fixture data namespaces: '+previous+' and '+directory);
    const before=entries.get(directory);
    if(before&&before.fixtureOwner!==fixtureOwner)throw Error('fixture data namespace already has another owner: '+directory);
    const readers=[...declared].filter(([name])=>under(directory,name)||under(name,directory)).flatMap(([,readers])=>[...readers]);
    entries.set(directory,{directory,fixtureOwner,readers:[...new Set([...(before?.readers??[]),...readers])].sort()});
  }
  return {files:snapshot.files.filter(file=>owned.has(file)||!names.some(directory=>under(directory,file))),manifest:{version:1,data:[...entries.values()].sort((a,b)=>a.directory.localeCompare(b.directory))} satisfies FixtureInputManifest,publish:selected.size>0};
}

/** The oracle owns project discovery; the pinned parser owns config inheritance,
 * include/exclude expansion and declared roots. Observe its actual config reads
 * rather than maintaining a second interpretation of extends. */
function projectInputs(entries: readonly string[], source: string): string[] {
  const require = createRequire(import.meta.url);
  const {API} = require("typescript/sync") as typeof import("typescript/sync");
  const {serverFS} = require("typescript/fs") as typeof import("typescript/fs");
  const filesystem = new OracleFilesystem(), inputs = new Set<string>();
  const owned = (path: string): string => {
    const name = relative(source, path);
    if (name === ".." || name.startsWith(".." + sep) || resolve(source, name) !== path)
      throw new Error("fixture project input escapes source root: " + path);
    return name.split(sep).join("/");
  };
  const api = new API({cwd: source, fs: {
    directoryExists: serverFS.useOS, fileExists: serverFS.useOS, getAccessibleEntries: serverFS.useOS,
    realpath: serverFS.useOS, stat: serverFS.useOS, writeFile: serverFS.error, removeFile: serverFS.error,
    readFile(path) {
      const bytes = filesystem.readFile(path);
      // Installed packages are an explicit fixture input, shared by their owner.
      if (bytes !== null && !path.split(sep).includes("node_modules")) inputs.add(owned(path));
      return bytes ?? undefined;
    },
  }});
  const projects = new Set<string>();
  function add(project: string): void {
    if (projects.has(project)) return;
    projects.add(project); inputs.add(owned(project));
    const parsed = api.parseConfigFile(project);
    if (parsed.errors.length) throw new Error("fixture owning project cannot be parsed: " + project + "\n" +
      parsed.errors.map(error => `TS${error.code}: ${error.text}`).join("\n"));
    for (const file of parsed.fileNames) inputs.add(owned(file));
    for (const reference of parsed.projectReferences ?? []) {
      const path = info(reference.path)?.isDirectory() ? join(reference.path, "tsconfig.json") : reference.path;
      add(path);
    }
  }
  try {
    for (const entry of entries) {
      const project = filesystem.projectFor(resolve(source, entry));
      if (!project) throw new Error("fixture module has no owning project: " + entry);
      add(project);
    }
    return [...inputs];
  } finally {api.close();}
}

/** Complete the graph before callers apply private mutations. Existing equal
 * modules are harmless; a different fixture file is never overwritten. */
export function copyModuleClosure(entries: readonly string[], root: string, options: FixtureClosureOptions = {}): string[] {
  const source = realpathSync(options.sourceRoot ?? SOURCE);
  const destination = outsideSource(source, root, "fixture destination");
  const graph = moduleGraph({...options, sourceRoot: source});
  let snapshot:InputSnapshot;
  try {snapshot=graph.describe([...entries,...(options.owningProject?projectInputs(entries,source):[])]);}
  finally {graph.close();}
  const data=fixtureData(snapshot,destination,source,options),files=data.files;
  const inputs=files.map(name=>{
    const from=resolve(source,name),to=resolve(destination,name);
    if (to === from) throw new Error("fixture destination is the source: " + name);
    if(!lstatSync(from).isFile()||!realpathSync(from).startsWith(source+sep))throw Error('fixture input is not an owned source file: '+name);
    return {name,from,to};
  });
  for(const {name,from,to}of inputs){
    if(options.reuseSourceLinks&&info(to)&&realpathSync(to)===from)continue;
    let parent = destination;
    for (const part of ["", ...relative(destination, dirname(to)).split(sep).filter(Boolean)]) {
      parent = join(parent, part);
      if (!info(parent)) mkdirSync(parent, {recursive: true});
      const stat = lstatSync(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("fixture module parent is not a directory: " + parent);
    }
    const existing = info(to);
    if (existing) {
      if (options.link ? existing.isSymbolicLink() && realpathSync(to) === from : existing.isFile() && readFileSync(to).equals(readFileSync(from))) continue;
      throw new Error("fixture module already has different input: " + name);
    }
    if (options.link) symlinkSync(from, to);
    else copyFileSync(from, to);
  }
  if(data.publish)durableRecord(join(destination,FIXTURE_INPUT_MANIFEST),data.manifest);
  return files;
}
