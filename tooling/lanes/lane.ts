// What is going on: every worktree, which lane it belongs to, how far it is
// from main, and what is gating -- and a lane's own tree, made or moved to a
// new topic.
//
//   node tooling/lanes/lane.ts status                 a table
//   node tooling/lanes/lane.ts status --json          the same, for an agent
//   node tooling/lanes/lane.ts start <lane> <topic>   ~/Projects/nts-lanes/<lane>, on
//                                                     branch <prefix><topic> from main
//
// A tree's lane is read from its branch prefix (`tooling/lanes/lanes.json`), so
// a tree on a branch no lane claims, or detached, is listed as such: those are
// the ones to ask about.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Lane = { session: string; branch: string; owns: string[] };
type Row = {
  path: string;
  lane: string;
  branch: string;
  ahead: number;
  behind: number;
  dirty: number;
  lastCommit: string;
  ageDays: number;
};

const git = (args: string[], cwd: string): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

const root = dirname(git(["rev-parse", "--path-format=absolute", "--git-common-dir"], process.cwd()));
// The lanes.json beside this file: the copy that shipped with this tool.
const lanes: Record<string, Lane> = JSON.parse(readFileSync(new URL("./lanes.json", import.meta.url), "utf8")).lanes;

function laneOf(branch: string): string {
  if (branch === "main") return "main";
  for (const [name, lane] of Object.entries(lanes)) if (branch.startsWith(lane.branch)) return name;
  return branch === "(detached)" ? "(detached)" : "(no lane)";
}

function worktrees(): { path: string; branch: string }[] {
  const out: { path: string; branch: string }[] = [];
  let path = "";
  for (const line of git(["worktree", "list", "--porcelain"], root).split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice(9);
    else if (line.startsWith("branch ")) out.push({ path, branch: line.slice(7).replace("refs/heads/", "") });
    else if (line === "detached") out.push({ path, branch: "(detached)" });
  }
  return out;
}

function row(path: string, branch: string): Row {
  const head = existsSync(path) ? git(["rev-parse", "HEAD"], path) : "";
  const counts = head ? git(["rev-list", "--left-right", "--count", `main...${head}`], root).split(/\s+/).map(Number) : [0, 0];
  // `--ignore-submodules=all`: a symlinked submodule makes plain status fail,
  // and then every tree with one would read as clean.
  const status = existsSync(path)
    ? spawnSync("git", ["status", "--porcelain", "--ignore-submodules=all"], { cwd: path, encoding: "utf8" }).stdout ?? ""
    : "";
  const dirty = status.split("\n").filter((l) => l && !/node_modules\/?$/.test(l)).length;
  const when = head ? Number(git(["log", "-1", "--format=%ct", head], root)) : 0;
  return {
    path: path.replace(homedir(), "~"),
    lane: laneOf(branch),
    branch,
    behind: counts[0],
    ahead: counts[1],
    dirty,
    lastCommit: head ? git(["log", "-1", "--format=%h %s", head], root).slice(0, 60) : "(missing)",
    ageDays: when ? Math.floor((Date.now() / 1000 - when) / 86400) : -1,
  };
}

function landing(): Record<string, unknown> | null {
  const file = join(homedir(), ".cache/nts-land/status.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

/** The landings waiting for the lock, oldest first: land.ts's queue files. */
function queue(): { sha: string; tree: string; waitingMin: number; train?: string }[] {
  const dir = join(homedir(), ".cache/nts-land/queue");
  if (!existsSync(dir)) return [];
  const rows = [];
  for (const name of readdirSync(dir)) {
    try {
      const e = JSON.parse(readFileSync(join(dir, name), "utf8"));
      rows.push({ at: e.at, sha: String(e.sha).slice(0, 12), tree: e.tree, waitingMin: Math.round((Date.now() - e.at) / 60000) });
    } catch {
      // being written, or removed as it was read
    }
  }
  return rows.sort((a, b) => a.at - b.at).map(({ at: _, ...r }) => r);
}

function marker(): string | null {
  const file = join(homedir(), ".cache/nts-parallel-20261004/mainctl/GATE-RUNNING");
  return existsSync(file) ? readFileSync(file, "utf8").trim() || "(empty)" : null;
}

function status(json: boolean): void {
  const rows = worktrees().map(({ path, branch }) => row(path, branch));
  rows.sort((a, b) => a.lane.localeCompare(b.lane) || a.path.localeCompare(b.path));
  const main = git(["log", "-1", "--format=%h %s (%cr)", "main"], root);
  if (json) {
    console.log(JSON.stringify({ main, gate: marker(), landing: landing(), queue: queue(), trees: rows }, null, 2));
    return;
  }
  console.log(`main: ${main}`);
  console.log(`gate: ${marker() ?? "free"}`);
  const l = landing();
  if (l) console.log(`last landing: ${l.state} ${String(l.commit ?? "").slice(0, 12)} at ${l.at}`);
  const q = queue();
  // Landings started by a land.ts older than the train wait without a queue
  // file, and are not listed.
  if (q.length > 0) {
    console.log(`queued (the next to hold the lock gates up to six of them as one train):`);
    for (const e of q) console.log(`  ${e.sha}  ${String(e.waitingMin).padStart(4)} min  ${e.tree}`);
  }
  console.log("");
  const head = ["lane", "branch", "+ahead", "-behind", "dirty", "age", "tree", "last commit"];
  const cells = rows.map((r) => [r.lane, r.branch, `+${r.ahead}`, `-${r.behind}`, r.dirty ? String(r.dirty) : "", r.ageDays >= 0 ? `${r.ageDays}d` : "?", r.path, r.lastCommit]);
  const width = head.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  for (const line of [head, ...cells]) console.log(line.map((c, i) => (i === line.length - 1 ? c : c.padEnd(width[i]))).join("  "));
}

/**
 * A lane's tree at `~/Projects/nts-lanes/<lane>`, on a new topic branch from
 * main, with its inputs linked (`inputs.sh lane`).
 *
 * A tree that exists must be clean first: `refs/stash` is one stack shared by
 * every worktree, so a stash made here is popped by whichever lane pops next.
 * Commit unfinished work as `WIP:` instead, which `land` refuses to land.
 */
function start(name: string | undefined, topic: string | undefined): void {
  const lane = name ? lanes[name] : undefined;
  if (!name || !lane || !topic) {
    throw new Error(`usage: lane.ts start <lane> <topic>; lanes: ${Object.keys(lanes).join(" ")}`);
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(topic)) throw new Error(`a topic is lower-case words joined by - (${topic})`);
  const tree = join(homedir(), "Projects/nts-lanes", name);
  const branch = `${lane.branch}${topic}`;
  const exists = (ref: string) => spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${ref}`], { cwd: root }).status === 0;
  if (!existsSync(tree)) {
    mkdirSync(dirname(tree), { recursive: true });
    const args = exists(branch) ? ["worktree", "add", tree, branch] : ["worktree", "add", "-b", branch, tree, "main"];
    execFileSync("git", args, { cwd: root, stdio: "inherit" });
  } else {
    const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: tree, encoding: "utf8" });
    if (dirty.status !== 0 || dirty.stdout.trim()) {
      throw new Error(`${tree} has uncommitted work: commit it (\`WIP:\` is fine), then start again`);
    }
    execFileSync("git", exists(branch) ? ["switch", branch] : ["switch", "-c", branch, "main"], { cwd: tree, stdio: "inherit" });
  }
  execFileSync("sh", [fileURLToPath(new URL("./inputs.sh", import.meta.url)), "lane", root, tree], { stdio: "inherit" });
  console.log(`${name}: ${tree.replace(homedir(), "~")} on ${branch}`);
  console.log("  work, build and commit there; its target/ is its own. Land with:");
  console.log("  node tooling/lanes/land.ts HEAD   (from the tree, in the background)");
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "status") status(rest.includes("--json"));
  else if (command === "start") start(rest[0], rest[1]);
  else throw new Error("usage: node tooling/lanes/lane.ts status [--json] | start <lane> <topic>");
} catch (e) {
  console.error(`lane: ${(e as Error).message}`);
  process.exitCode = 2;
}
