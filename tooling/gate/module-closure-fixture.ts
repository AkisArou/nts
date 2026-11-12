// Test repositories carry the modules their entry points actually import.
// Package installations and non-module assets remain explicit fixture inputs.
import {copyFileSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync} from "node:fs";
import {dirname, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {moduleClosure, type ModuleClosureOptions} from "./module-closure.ts";
import {outsideSource} from "./source-containment.ts";
export {moduleClosure} from "./module-closure.ts";

const SOURCE = fileURLToPath(new URL("../..", import.meta.url));
const info = (path: string) => {
  try {return lstatSync(path);}
  catch (error) {if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error;}
};

/** Complete the graph before callers apply private mutations. Existing equal
 * modules are harmless; a different fixture file is never overwritten. */
export function copyModuleClosure(entries: readonly string[], root: string, options: ModuleClosureOptions & {link?: boolean} = {}): string[] {
  const source = realpathSync(options.sourceRoot ?? SOURCE);
  const destination = outsideSource(source, root, "fixture destination");
  const files = moduleClosure(entries, {...options, sourceRoot: source});
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
