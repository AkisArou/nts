// The links a tree's workspace packages need, from the tree's own lockfile.
//
//   node tooling/lanes/workspace-links.ts <tree>
//
// Prints one line per link, `<path in the tree><TAB><symlink target>`, for every
// `link:` dependency of every importer but the root: what pnpm would make in
// `<importer>/node_modules/<name>`. `inputs.sh` makes them.
//
// **Read from the tree being prepared, not the checkout it is prepared from.**
// These links used to be copied from the shared checkout, package by package.
// That holds only while both have their packages at the same paths: when a
// commit moves one (the corpora move puts the library program one level
// deeper, at `tests/programs/library`), the checkout has nothing at the
// new path and the copied links, being relative, resolve to the wrong place.
// The lockfile at the commit says exactly which links each package has, as
// paths relative to the package, so the links follow the commit.

import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

/** Every `link:` dependency in a pnpm v9 lockfile, by importer. */
export function workspaceLinks(lockfile: string): Array<{ importer: string; name: string; target: string }> {
  const links: Array<{ importer: string; name: string; target: string }> = [];
  const lines = lockfile.split("\n");
  const start = lines.indexOf("importers:");
  if (start < 0) return links;
  let importer: string | undefined;
  let dependency: string | undefined;
  for (const line of lines.slice(start + 1)) {
    // The next top-level key ends the importers.
    if (/^\S/.test(line)) break;
    const importerLine = /^ {2}(\S[^:]*):\s*$/.exec(line);
    if (importerLine) {
      importer = importerLine[1].replace(/^'|'$/g, "");
      dependency = undefined;
      continue;
    }
    const dependencyLine = /^ {6}(\S[^:]*):\s*$/.exec(line);
    if (dependencyLine) {
      dependency = dependencyLine[1].replace(/^'|'$/g, "");
      continue;
    }
    const version = /^ {8}version: link:(.+)$/.exec(line);
    if (version && importer !== undefined && importer !== "." && dependency !== undefined) {
      links.push({ importer, name: dependency, target: version[1].trim() });
    }
  }
  return links;
}

function main(): void {
  const tree = process.argv[2];
  if (tree === undefined) {
    console.error("usage: workspace-links.ts <tree>");
    process.exit(2);
  }
  const lockfile = readFileSync(join(tree, "pnpm-lock.yaml"), "utf8");
  for (const { importer, name, target } of workspaceLinks(lockfile)) {
    const at = posix.join(importer, "node_modules", name);
    // The lockfile's path is relative to the importer; the link sits in
    // `node_modules/<name>`, as many levels below it as `name` has segments
    // plus one.
    const relative = posix.relative(posix.dirname(at), posix.join(importer, target));
    console.log(`${at}\t${relative}`);
  }
}

if (process.argv[1]?.endsWith("workspace-links.ts")) main();
