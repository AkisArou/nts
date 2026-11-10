// The processes that use a tree: their working directory, their executable or
// one of their open files is the tree or under it. Read from /proc and never
// signalled. A landing gives a task's pool tree back only once nothing uses it
// (pool.ts's release): a tree reset under a process still running in it
// changes the files that process reads, and its results look like defects.
import { readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** A process that uses a tree, and how: "its working directory", "its executable <path>", "an open file <path>". */
export type TreeUser = { pid: number; command: string; where: string };

/**
 * Every process this user can read whose working directory, executable or an
 * open file is `tree` or under it, by pid; never the process that asks. A
 * process another user owns, or one that ends while it is read, is skipped.
 */
export function treeUsers(tree: string, { proc = "/proc", self = process.pid }: { proc?: string; self?: number } = {}): TreeUser[] {
  let root: string;
  try { root = realpathSync(tree); } catch { return []; }
  // A file deleted while open reads as "<path> (deleted)": it was still in the tree.
  const under = (target: string) => { const path = target.replace(/ \(deleted\)$/, ""); return path === root || path.startsWith(root + sep) ? path : null; };
  const shown = (path: string) => relative(root, path) || ".";
  const link = (pid: string, name: string) => { try { return readlinkSync(join(proc, pid, name)); } catch { return null; } };
  let pids: string[];
  try { pids = readdirSync(proc).filter(name => /^[1-9][0-9]*$/.test(name)); } catch { return []; }
  const users: TreeUser[] = [];
  for (const pid of pids) {
    if (Number(pid) === self) continue;
    let where: string | null = null;
    const cwd = link(pid, "cwd");
    if (cwd !== null && under(cwd) !== null) where = "its working directory";
    const exe = where === null ? link(pid, "exe") : null;
    const ran = exe === null ? null : under(exe);
    if (ran !== null) where = `its executable ${shown(ran)}`;
    if (where === null) {
      let fds: string[] = [];
      try { fds = readdirSync(join(proc, pid, "fd")); } catch { continue; }
      for (const fd of fds) {
        const target = link(pid, join("fd", fd)), open = target === null ? null : under(target);
        if (open !== null) { where = `an open file ${shown(open)}`; break; }
      }
    }
    if (where === null) continue;
    let command = "?";
    try { command = readFileSync(join(proc, pid, "comm"), "utf8").trim() || "?"; } catch { /* it ended */ }
    users.push({ pid: Number(pid), command, where });
  }
  return users.sort((a, b) => a.pid - b.pid);
}

/** The users in words: "pid 123 zsh (its working directory), pid 456 node (an open file target/x)", the first `most` and how many more. */
export function describeUsers(users: readonly TreeUser[], most = 3): string {
  const named = users.slice(0, most).map(user => `pid ${user.pid} ${user.command} (${user.where})`);
  return users.length > most ? `${named.join(", ")} and ${users.length - most} more` : named.join(", ");
}
