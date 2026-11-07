// Test repositories carry the modules their entry points actually import.
// Package installations and non-module assets remain explicit fixture inputs.
import {copyFileSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync} from "node:fs";
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {API} from "typescript/sync";
import {isExportDeclaration, isExternalModuleReference, isImportDeclaration, isImportEqualsDeclaration, isStringLiteralLikeNode, type Node} from "typescript/ast";

const SOURCE = fileURLToPath(new URL("../..", import.meta.url));
type ClosureOptions = {sourceRoot?: string};
const inside = (root: string, path: string) => {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith(".." + sep) && !isAbsolute(part);
};
const info = (path: string) => {
  try {return lstatSync(path);}
  catch (error) {if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error;}
};

/** Static declarations, including type imports and re-exports. Data strings,
 * computed imports and package resolution cannot invent file inputs. Each
 * call reads fresh bytes; cycles share only this call's visited set.
 * A module reached only by dynamic import() must be named as a fixture entry. */
export function moduleClosure(entries: readonly string[], options: ClosureOptions = {}): string[] {
  const root = realpathSync(options.sourceRoot ?? SOURCE), visited = new Set<string>();
  const api = new API({cwd: root});
  function visit(path: string): void {
    if (!inside(root, path)) throw new Error("fixture module escapes source root: " + path);
    const name = relative(root, path).split(sep).join("/");
    if (visited.has(name)) return;
    if (!lstatSync(path).isFile() || !inside(root, realpathSync(path))) throw new Error("fixture module is not an owned source file: " + name);
    visited.add(name);
    if (!/\.[cm]?[jt]sx?$/.test(path)) return;
    const lease = api.createSourceFile(path, readFileSync(path, "utf8"));
    try {
      const imports: string[] = [];
      const inspect = (node: Node): void => {
        const specifier = isImportDeclaration(node) || isExportDeclaration(node) ? node.moduleSpecifier
          : isImportEqualsDeclaration(node) && isExternalModuleReference(node.moduleReference) ? node.moduleReference.expression : undefined;
        if (specifier && isStringLiteralLikeNode(specifier) && /^\.\.?\//.test(specifier.text)) imports.push(specifier.text);
        node.forEachChild(inspect);
      };
      inspect(lease.sourceFile);
      for (const specifier of imports) visit(fileURLToPath(new URL(specifier, pathToFileURL(path))));
    } finally {lease.dispose();}
  }
  try {
    for (const entry of entries) {
      if (isAbsolute(entry)) throw new Error("fixture entry must be repository-relative: " + entry);
      visit(resolve(root, entry));
    }
    return [...visited].sort();
  } finally {api.close();}
}

/** Complete the graph before callers apply private mutations. Existing equal
 * modules are harmless; a different fixture file is never overwritten. */
export function copyModuleClosure(entries: readonly string[], root: string, options: ClosureOptions & {link?: boolean} = {}): string[] {
  const source = realpathSync(options.sourceRoot ?? SOURCE), requested = resolve(root);
  let ancestor = requested;
  while (!info(ancestor)) ancestor = dirname(ancestor);
  const destination = resolve(realpathSync(ancestor), relative(ancestor, requested));
  if (inside(source, destination)) throw new Error("fixture destination resolves inside source tree: " + root);
  const files = moduleClosure(entries, {sourceRoot: source});
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
