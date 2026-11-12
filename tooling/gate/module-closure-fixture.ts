// Test repositories carry the modules their entry points actually import.
// Package installations and non-module assets remain explicit fixture inputs.
import {copyFileSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync} from "node:fs";
import {dirname, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {moduleGraph, type ModuleClosureOptions} from "./module-closure.ts";
import {OracleFilesystem} from "../differential/oracle-filesystem.ts";
import {outsideSource} from "./source-containment.ts";
export {moduleClosure} from "./module-closure.ts";

const SOURCE = fileURLToPath(new URL("../..", import.meta.url));
const info = (path: string) => {
  try {return lstatSync(path);}
  catch (error) {if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error;}
};

export type FixtureClosureOptions = ModuleClosureOptions & {link?: boolean; owningProject?: boolean};

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
  let files: string[];
  try {files = graph.closure([...entries, ...(options.owningProject ? projectInputs(entries, source) : [])]);}
  finally {graph.close();}
  for (const name of files) {
    const from = resolve(source, name), to = resolve(destination, name);
    if (to === from) throw new Error("fixture destination is the source: " + name);
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
  return files;
}
