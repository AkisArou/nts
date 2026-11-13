// Project discovery and parsed config inputs have one owner for selectors and staging.
import {createRequire} from 'node:module';
import {lstatSync} from 'node:fs';
import {join,relative,resolve,sep} from 'node:path';
import {OracleFilesystem} from '../differential/oracle-filesystem.ts';

export type ProjectInputs={configs:string[];roots:string[]};
export type ProjectRequest={kind:'entry'|'config';path:string};
const info=(path:string)=>{try{return lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}};
/** The oracle owns project discovery; the pinned parser owns config inheritance,
 * include/exclude expansion and declared roots. Observe its actual config reads
 * rather than maintaining a second interpretation of extends. */
export function projectInputs(entries: readonly ProjectRequest[], source: string): ProjectInputs {
  const require = createRequire(import.meta.url);
  const {API} = require("typescript/sync") as typeof import("typescript/sync");
  const {serverFS} = require("typescript/fs") as typeof import("typescript/fs");
  const filesystem = new OracleFilesystem(), configs = new Set<string>(), roots = new Set<string>();
  const owned = (path: string): string => {
    const name = relative(source, path);
    if (name === ".." || name.startsWith(".." + sep) || resolve(source, name) !== path)
      throw new Error("project input escapes source root: " + path);
    return name.split(sep).join("/");
  };
  const api = new API({cwd: source, fs: {
    directoryExists: serverFS.useOS, fileExists: serverFS.useOS, getAccessibleEntries: serverFS.useOS,
    realpath: serverFS.useOS, stat: serverFS.useOS, writeFile: serverFS.error, removeFile: serverFS.error,
    readFile(path) {
      const bytes = filesystem.readFile(path);
      // Installed packages are an explicit fixture input, shared by their owner.
      if (bytes !== null && !path.split(sep).includes("node_modules")) configs.add(owned(path));
      return bytes ?? undefined;
    },
  }});
  const projects = new Set<string>();
  function add(project: string): void {
    if (projects.has(project)) return;
    projects.add(project); configs.add(owned(project));
    const parsed = api.parseConfigFile(project);
    if (parsed.errors.length) throw new Error("owning project cannot be parsed: " + project + "\n" +
      parsed.errors.map(error => `TS${error.code}: ${error.text}`).join("\n"));
    for (const file of parsed.fileNames) roots.add(owned(file));
    for (const reference of parsed.projectReferences ?? []) {
      const path = info(reference.path)?.isDirectory() ? join(reference.path, "tsconfig.json") : reference.path;
      add(path);
    }
  }
  try {
    for (const entry of entries) {
      const project = entry.kind==='config'?resolve(source,entry.path):filesystem.projectFor(resolve(source, entry.path));
      if (!project) throw new Error("compiled input has no owning project: " + entry.path);
      add(project);
    }
    return {configs:[...configs],roots:[...roots]};
  } finally {api.close();}
}

