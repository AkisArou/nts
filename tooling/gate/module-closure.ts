// Static module membership, read from each source tree's own declarations.
import {lstatSync, readFileSync, realpathSync} from "node:fs";
import {isAbsolute, relative, resolve, sep} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {createRequire} from "node:module";
import type {Node} from "typescript/ast";

const SOURCE = fileURLToPath(new URL("../..", import.meta.url));
export type ModuleClosureOptions = {sourceRoot?: string};
const inside = (root: string, path: string) => {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith(".." + sep) && !isAbsolute(part);
};

/** Static declarations, including type imports and re-exports. Data strings,
 * computed imports and package resolution cannot invent file inputs. Each
 * call reads fresh bytes; cycles share only this call's visited set.
 * A module reached only by dynamic import() must be named as another entry. */
export function moduleClosure(entries: readonly string[], options: ModuleClosureOptions = {}): string[] {
  // Input provisioning imports this module before node_modules exists. Only a
  // caller actually walking a graph needs the already provisioned parser.
  const require = createRequire(import.meta.url);
  const {API} = require("typescript/sync") as typeof import("typescript/sync");
  const {isExportDeclaration, isExternalModuleReference, isImportDeclaration, isImportEqualsDeclaration, isStringLiteralLikeNode} = require("typescript/ast") as typeof import("typescript/ast");
  const root = realpathSync(options.sourceRoot ?? SOURCE), visited = new Set<string>();
  const api = new API({cwd: root});
  function visit(path: string): void {
    if (!inside(root, path)) throw new Error("module escapes source root: " + path);
    const name = relative(root, path).split(sep).join("/");
    if (visited.has(name)) return;
    if (!lstatSync(path).isFile() || !inside(root, realpathSync(path))) throw new Error("module is not an owned source file: " + name);
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
      if (isAbsolute(entry)) throw new Error("module entry must be repository-relative: " + entry);
      visit(resolve(root, entry));
    }
    return [...visited].sort();
  } finally {api.close();}
}
