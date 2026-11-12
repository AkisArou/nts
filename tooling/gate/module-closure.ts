// Static module membership, read from each source tree's own declarations.
import {lstatSync, readFileSync, realpathSync} from "node:fs";
import {isAbsolute, relative, resolve, sep} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {createRequire} from "node:module";
import {execFileSync} from "node:child_process";
import type {Node} from "typescript/ast";

const SOURCE = fileURLToPath(new URL("../..", import.meta.url));
export type DirectoryDeclaration = {reader: string; directory: string; files: readonly string[]};
export type ModuleClosureOptions = {sourceRoot?: string; directory?: (declaration: DirectoryDeclaration) => void};
const inside = (root: string, path: string) => {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith(".." + sep) && !isAbsolute(part);
};

/** Static declarations, including type imports and re-exports. Data strings,
 * computed imports and package resolution cannot invent file inputs. Each
 * call reads fresh bytes; cycles share only this call's visited set.
 * Module-relative URL assets are declarations too. Dot-only positions are
 * anchors, while a directory asset declares its tracked files. */
export function moduleClosure(entries: readonly string[], options: ModuleClosureOptions = {}): string[] {
  // Input provisioning imports this module before node_modules exists. Only a
  // caller actually walking a graph needs the already provisioned parser.
  const require = createRequire(import.meta.url);
  const {API} = require("typescript/sync") as typeof import("typescript/sync");
  const ast = require("typescript/ast") as typeof import("typescript/ast");
  const {isExportDeclaration, isExternalModuleReference, isImportDeclaration, isImportEqualsDeclaration, isStringLiteralLikeNode} = ast;
  const root = realpathSync(options.sourceRoot ?? SOURCE), visited = new Set<string>();
  let tracked: string[] | undefined;
  const api = new API({cwd: root});
  function asset(reader: string, path: string): void {
    if (!inside(root, path)) throw new Error("asset escapes source root: " + path);
    if (!lstatSync(path).isDirectory()) {visit(path); return;}
    if (!inside(root, realpathSync(path))) throw new Error("asset is not an owned directory: " + path);
    tracked ??= execFileSync("git", ["ls-files", "-z", "--cached"], {cwd: root, encoding: "utf8", maxBuffer: 64 << 20}).split("\0").filter(Boolean);
    const directory = relative(root, path).split(sep).join("/");
    const files = tracked.filter(file => directory === "" || file.startsWith(directory + "/"));
    options.directory?.({reader, directory, files});
    for (const file of files) visit(resolve(root, file));
  }
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
      const assets: string[] = [];
      const inspect = (node: Node): void => {
        const specifier = isImportDeclaration(node) || isExportDeclaration(node) ? node.moduleSpecifier
          : isImportEqualsDeclaration(node) && isExternalModuleReference(node.moduleReference) ? node.moduleReference.expression : undefined;
        if (specifier && isStringLiteralLikeNode(specifier) && /^\.\.?\//.test(specifier.text)) imports.push(specifier.text);
        if (ast.isNewExpression(node) && ast.isIdentifier(node.expression) && node.expression.text === "URL"
          && node.arguments?.length === 2) {
          const [literal, base] = node.arguments;
          if (literal && ast.isStringLiteralLikeNode(literal) && literal.kind === ast.SyntaxKind.StringLiteral
            && base && ast.isPropertyAccessExpression(base) && base.name.text === "url"
            && ast.isMetaProperty(base.expression) && base.expression.keywordToken === ast.SyntaxKind.ImportKeyword
            && base.expression.name.text === "meta"
            && !/^(?:\/|[a-z][a-z0-9+.-]*:)/i.test(literal.text)
            && literal.text.split("/").some(segment => segment !== "" && segment !== "." && segment !== "..")) assets.push(literal.text);
        }
        node.forEachChild(inspect);
      };
      inspect(lease.sourceFile);
      for (const specifier of imports) visit(fileURLToPath(new URL(specifier, pathToFileURL(path))));
      for (const specifier of assets) asset(name, fileURLToPath(new URL(specifier, pathToFileURL(path))));
    } finally {lease.dispose();}
  }
  try {
    for (const entry of entries) {
      if (isAbsolute(entry)) throw new Error("module entry must be repository-relative: " + entry);
      const path = resolve(root, entry);
      if (lstatSync(path).isDirectory()) asset("<entry>", path);
      else visit(path);
    }
    return [...visited].sort();
  } finally {api.close();}
}
