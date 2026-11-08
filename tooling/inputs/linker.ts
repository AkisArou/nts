// Link a tree's inputs -- what no commit carries: the third-party clones, the
// native checker's upstream corpora, node and the workspace's node_modules --
// with that tree's own linker.
//
//   node tooling/inputs/linker.ts gate <shared checkout> <tree>   what a gate tree runs in
//   node tooling/inputs/linker.ts work <shared checkout> <tree>   what a pool tree works in
//
// The linker belongs to the tree, not to the caller: main may have added an
// input a historical commit lacks, or dropped one it still needs. So where it
// lives is part of each commit. It is `tooling/inputs/link.sh`; a commit from
// before it moved there has it at `tooling/lanes/inputs.sh`, where `work` was
// called `lane`. A tree with neither is refused, never linked by guesswork: a
// tree missing an input does not fail, it answers emptily.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type Use = "gate" | "work";
export type Linker = { script: string; args: [string] };

/** `tree`'s own linker for `use`, as its commit names it; null when the tree has none. */
export function linkerOf(tree: string, use: Use): Linker | null {
  const script = join(tree, "tooling/inputs/link.sh");
  if (existsSync(script)) return { script, args: [use] };
  const before = join(tree, "tooling/lanes/inputs.sh");
  if (existsSync(before)) return { script: before, args: [use === "work" ? "lane" : use] };
  return null;
}

/** A linker that could not link: `status` is its own exit status, null when it did not exit. */
export class LinkError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) { super(message); this.status = status; }
}

/**
 * Link `tree`'s inputs from the shared checkout `root` with the tree's own
 * linker. Throws a LinkError, naming the tree, when it has none or the linker
 * fails; `inherit` passes the linker's output through instead of keeping its
 * tail for the message.
 */
export function linkTree(tree: string, use: Use, root: string, options: { env?: NodeJS.ProcessEnv; inherit?: boolean } = {}): void {
  const linker = linkerOf(tree, use);
  if (!linker) throw new LinkError(`${tree} has no input linker: neither tooling/inputs/link.sh nor tooling/lanes/inputs.sh`, null);
  const r = spawnSync("sh", [linker.script, ...linker.args, root, tree], {
    cwd: tree, env: options.env ?? process.env, encoding: "utf8", maxBuffer: 64 << 20, stdio: options.inherit ? "inherit" : "pipe",
  });
  if (r.error || r.signal || r.status !== 0) {
    const said = `${r.stderr ?? ""}${r.stdout ?? ""}`.trim().split("\n").slice(-3).join("; ");
    throw new LinkError(`inputs for ${tree}: ${said || r.error?.message || (r.signal ? `killed by ${r.signal}` : `exit ${r.status}`)}`, r.error || r.signal ? null : r.status);
  }
}

// The command line exits with the linker's own status, so a caller such as
// pinned.sh reports the candidate's failure as the candidate gave it.
function main(argv: string[]): number {
  const [use, root, tree] = argv;
  if ((use !== "gate" && use !== "work") || !root || !tree) {
    console.error("usage: node tooling/inputs/linker.ts gate|work <shared checkout> <tree>");
    return 2;
  }
  try { linkTree(resolve(tree), use, resolve(root), { inherit: true }); return 0; }
  catch (error) {
    console.error(`linker: ${(error as Error).message}`);
    return error instanceof LinkError && error.status ? error.status : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
