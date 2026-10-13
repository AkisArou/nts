// What is going on: every worktree, which lane it belongs to, how far it is
// from main, and what is gating.
//
//   node tooling/lanes/lane.ts status          a table
//   node tooling/lanes/lane.ts status --json   the same, for an agent
//
// A tree's lane is read from its branch prefix (`tooling/lanes/lanes.json`), so
// a tree on a branch no lane claims, or detached, is listed as such: those are
// the ones to ask about.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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

function marker(): string | null {
  const file = join(homedir(), ".cache/nts-parallel-20261004/mainctl/GATE-RUNNING");
  return existsSync(file) ? readFileSync(file, "utf8").trim() || "(empty)" : null;
}

function status(json: boolean): void {
  const rows = worktrees().map(({ path, branch }) => row(path, branch));
  rows.sort((a, b) => a.lane.localeCompare(b.lane) || a.path.localeCompare(b.path));
  const main = git(["log", "-1", "--format=%h %s (%cr)", "main"], root);
  if (json) {
    console.log(JSON.stringify({ main, gate: marker(), landing: landing(), trees: rows }, null, 2));
    return;
  }
  console.log(`main: ${main}`);
  console.log(`gate: ${marker() ?? "free"}`);
  const l = landing();
  if (l) console.log(`last landing: ${l.state} ${String(l.commit ?? "").slice(0, 12)} at ${l.at}`);
  console.log("");
  const head = ["lane", "branch", "+ahead", "-behind", "dirty", "age", "tree", "last commit"];
  const cells = rows.map((r) => [r.lane, r.branch, `+${r.ahead}`, `-${r.behind}`, r.dirty ? String(r.dirty) : "", r.ageDays >= 0 ? `${r.ageDays}d` : "?", r.path, r.lastCommit]);
  const width = head.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  for (const line of [head, ...cells]) console.log(line.map((c, i) => (i === line.length - 1 ? c : c.padEnd(width[i]))).join("  "));
}

const [command, ...rest] = process.argv.slice(2);
if (command === "status") status(rest.includes("--json"));
else {
  console.error("usage: node tooling/lanes/lane.ts status [--json]");
  process.exitCode = 2;
}
