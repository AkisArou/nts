// The count step (docs/workflow.md, The machine: "the full check counts
// them"). Red when a branch is named by no task in docs/plan.md, a worktree is
// outside the pool, or ~/.cache holds an nts folder no entry of keep.json
// keeps, or a node test root a stopped runner left (n<pid in base 36>). Each
// red line names the item and why. It deletes nothing; it reports.
//
//   node tooling/full-check/count.ts          the lines, exit 0 green, 1 red, 2 not counted
//
// What counts as named, kept or in the pool:
//   - a branch, on the machine or on GitHub, is named when docs/plan.md (on
//     main) has it in backticks, or a backticked `prefix/*` covering it, or
//     when it is the head of an open pull request whose number docs/plan.md
//     names (#N, or a range "#A to #B"): undone work stays visible. `main` and
//     `verified` are exempt; refs/cited/* are not branches;
//   - a worktree is in the pool at ~/.cache/nts-pool/<n>, or is the shared
//     checkout, the landing check's tree (~/.cache/nts-landing/), the full
//     check's own (~/.cache/nts-full-check/) or pin.ts's build tree;
//   - an nts folder of ~/.cache is kept by an entry of keep.json, which says
//     why and, for a tool's folder, which file writes it: an entry whose
//     writer no longer names its folder is red too, so the list cannot
//     outlive the tools it describes.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { OWNER_MARK } from "../conformance/node-environment.ts";

export type Pull = { number: number; headRefName: string; isCrossRepository?: boolean };
export type Worktree = { path: string; head?: string; branch?: string; prunable?: boolean };
export type Unavailable = { error: string };
const unavailable = (x: unknown): x is Unavailable => typeof x === "object" && x !== null && "error" in x;

export type CountInput = {
  plan: string;
  /** Local branch names, without refs/heads/. */
  local: string[];
  /** GitHub's branch names, or why they could not be read. */
  remote: string[] | Unavailable;
  /** GitHub's open pull requests, or why they could not be read. */
  pulls: Pull[] | Unavailable;
  worktrees: Worktree[];
  /** The shared checkout, ~/Projects/nts. */
  shared: string;
  /** ~/.cache. */
  cache: string;
  /** The tree whose files the keep list's writers are read from. */
  root: string;
  /** The commits whose pins main uses. */
  main: string | null;
  verified: string | null;
  now: number;
};

export type CountResult = { verdict: "PASS" | "FAIL" | "INSTRUMENT"; red: string[]; notes: string[] };

const EXEMPT = new Set(["main", "verified"]);
const DAY = 86_400_000;

/** What docs/plan.md names: branches in backticks, `prefix/*` globs, and pull request numbers. */
export function planNames(plan: string): { names: Set<string>; prefixes: string[]; pulls: Set<number> } {
  const names = new Set<string>(), prefixes: string[] = [], pulls = new Set<number>();
  for (const [, raw] of plan.matchAll(/`([^`\n]+)`/g)) {
    const token = raw!.trim().replace(/^refs\/heads\//, "");
    if (/^[^\s*]+\/\*$/.test(token)) prefixes.push(token.slice(0, -1));
    else if (!/\s/.test(token)) names.add(token);
  }
  for (const [, from, to] of plan.matchAll(/#(\d+)\b(?:\s*(?:to|–)\s*#(\d+)\b)?/g)) {
    const a = Number(from), b = to === undefined ? a : Number(to);
    if (b < a || b - a > 500) { pulls.add(a); continue; }
    for (let n = a; n <= b; n++) pulls.add(n);
  }
  return { names, prefixes, pulls };
}

function branchLines(input: CountInput, red: string[], notes: string[]): void {
  const plan = planNames(input.plan);
  const named = (branch: string) => plan.names.has(branch) || plan.prefixes.some(prefix => branch.startsWith(prefix));
  const pulls = unavailable(input.pulls) ? [] : input.pulls.filter(pull => !pull.isCrossRepository);
  const pullOf = (branch: string) => pulls.filter(pull => pull.headRefName === branch);
  const judge = (branch: string, where: string) => {
    if (EXEMPT.has(branch) || named(branch)) return;
    const heads = pullOf(branch);
    if (heads.some(pull => plan.pulls.has(pull.number))) return;
    const open = heads.length ? `; the head of open pull request ${heads.map(p => `#${p.number}`).join(", ")}, which docs/plan.md does not name either` : "";
    red.push(`branch ${branch} (${where}): named by no task in docs/plan.md${open}`);
  };
  for (const branch of [...input.local].sort()) judge(branch, "on the machine");
  if (unavailable(input.remote)) notes.push(`not counted: GitHub's branches (${input.remote.error})`);
  else for (const branch of [...input.remote].sort()) judge(branch, "on GitHub");
  if (unavailable(input.pulls)) notes.push(`not counted: GitHub's open pull requests (${input.pulls.error}), so no branch is named by one`);
}

const inside = (path: string, root: string) => {
  const r = relative(root, path);
  return r !== "" && !r.startsWith("..") && !isAbsolute(r);
};
const real = (path: string) => { try { return realpathSync(path); } catch { return resolve(path); } };

export function poolWorktree(path: string, cache: string): string | null {
  const p = real(path), c = real(cache);
  if (inside(p, join(c, "nts-pool"))) return /^\d+$/.test(relative(join(c, "nts-pool"), p)) ? "the pool" : null;
  if (inside(p, join(c, "nts-landing"))) return "the landing check's";
  if (inside(p, join(c, "nts-full-check"))) return "the full check's";
  if (p === join(c, "nts-pins", "tree")) return "pin.ts's build tree";
  return null;
}

function worktreeLines(input: CountInput, red: string[]): void {
  const shared = real(input.shared);
  for (const tree of [...input.worktrees].sort((a, b) => a.path.localeCompare(b.path))) {
    const what = tree.branch ? tree.branch.replace(/^refs\/heads\//, "") : tree.head ? `detached at ${tree.head.slice(0, 12)}` : "no HEAD";
    if (tree.prunable) { red.push(`worktree ${tree.path} (${what}): its folder is gone; \`git worktree prune\` forgets it`); continue; }
    if (real(tree.path) === shared || poolWorktree(tree.path, input.cache)) continue;
    red.push(`worktree ${tree.path} (${what}): outside the pool (~/.cache/nts-pool/<n>)`);
  }
}

type Entry = { name: string; path: string; mtimeMs: number };
/** The folders (and links) of a directory; files are not folders. */
function folders(dir: string): Entry[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().flatMap(name => {
    const path = join(dir, name), st = lstatSync(path);
    return st.isDirectory() || st.isSymbolicLink() ? [{ name, path, mtimeMs: st.mtimeMs }] : [];
  });
}

/**
 * Why a folder of ~/.cache is kept (keep.json), and what is checked inside it:
 *   kept     nothing inside;
 *   pool     only pool slots, ~/.cache/nts-pool/<n>;
 *   runs     its runs/ hold three days of logs;
 *   pins     pin.ts's tree, target and lock, and the pins of main and verified;
 *   scratch  a tool's scratch root: what a run leaves for a day is a leftover;
 *   folders  each folder in it kept by a rule of its own.
 * `writer` is the file that writes the folder; a writer that no longer names
 * it makes its entry red, so the list cannot outlive the tools it describes.
 */
export type Keep =
  | { kind: "kept" | "pool" | "pins"; why: string; writer?: string }
  | { kind: "runs"; who: string; why: string; writer?: string }
  | { kind: "scratch"; writer: string }
  | { kind: "folders"; why: string; folders: Record<string, Keep> };

export const KEEP_FILE = fileURLToPath(new URL("keep.json", import.meta.url));

export function readKeep(file = KEEP_FILE): Record<string, Keep> {
  const value = JSON.parse(readFileSync(file, "utf8")) as Record<string, Keep>;
  const check = (name: string, keep: Keep) => {
    if (!["kept", "pool", "pins", "runs", "scratch", "folders"].includes(keep.kind)) throw new Error(`${file}: ${name} has an unknown kind ${String(keep.kind)}`);
    if (keep.kind === "scratch" && !keep.writer) throw new Error(`${file}: the scratch root ${name} names no writer`);
    if (keep.kind !== "scratch" && !keep.why) throw new Error(`${file}: ${name} does not say why it is kept`);
    if (keep.kind === "folders") for (const [child, inner] of Object.entries(keep.folders)) check(`${name}/${child}`, inner);
  };
  for (const [name, keep] of Object.entries(value)) check(name, keep);
  return value;
}

export type Context = { cache: string; main: string | null; verified: string | null; now: number; root: string };
const days = (ms: number) => (ms / DAY).toFixed(1);
const display = (path: string, context: Context) => `~/.cache/${relative(context.cache, path)}`;
/** "3 folders, 1.5 to 9.0 days old (a, b, c)": a group of leftovers as one line, its first names shown. */
function aged(entries: Entry[], context: Context): string {
  const ages = entries.map(entry => context.now - entry.mtimeMs).sort((a, b) => a - b);
  const names = entries.slice(0, 3).map(entry => entry.name).join(", ") + (entries.length > 3 ? ", ..." : "");
  const span = ages.length === 1 ? `${days(ages[0]!)} days old` : `${days(ages[0]!)} to ${days(ages.at(-1)!)} days old`;
  return `${entries.length} folder(s), ${span} (${names})`;
}

/** Whether `writer` (repo-relative) still names the folder at `path` (relative to ~/.cache). */
export function writerNames(root: string, writer: string, path: string): boolean {
  const file = join(root, writer);
  if (!existsSync(file)) return false;
  const text = readFileSync(file, "utf8"), parts = path.split("/");
  const spellings = [path, parts.map(part => `"${part}"`).join(", "), parts.map(part => `"${part}"`).join(").join(")];
  return spellings.some(spelling => text.includes(spelling));
}

function judgeFolder(entry: Entry, keep: Keep, context: Context): string[] {
  const at = relative(context.cache, entry.path);
  const lines: string[] = [];
  if ("writer" in keep && keep.writer && !writerNames(context.root, keep.writer, at)) {
    lines.push(`${display(entry.path, context)}: keep.json keeps it for ${keep.writer}, which no longer writes it; take the entry out`);
  }
  const children = folders(entry.path);
  switch (keep.kind) {
    case "kept": break;
    case "pool":
      for (const child of children) if (!/^\d+$/.test(child.name)) lines.push(`${display(child.path, context)}: not a pool slot (~/.cache/nts-pool/<n>)`);
      break;
    case "runs": {
      const old = folders(join(entry.path, "runs")).filter(run => run.name !== "latest" && context.now - run.mtimeMs > 3 * DAY);
      if (old.length) lines.push(`${display(join(entry.path, "runs"), context)}: ${aged(old, context)} of ${keep.who}; logs are kept three days`);
      break;
    }
    case "pins": {
      const used = new Set(["tree", "target", "build.lock", ...[context.main, context.verified].flatMap(sha => sha ? [sha.slice(0, 12)] : [])]);
      for (const child of children) {
        if (used.has(child.name) || (child.name.includes(".partial-") && context.now - child.mtimeMs < DAY)) continue;
        lines.push(`${display(child.path, context)}: a pin main does not use (it uses the pins of main${context.verified ? " and verified" : ""})`);
      }
      break;
    }
    case "scratch": {
      const left = children.filter(child => context.now - child.mtimeMs > DAY);
      if (left.length) lines.push(`${display(entry.path, context)}: ${aged(left, context)} left by ${keep.writer}; a run removes its own folder`);
      break;
    }
    case "folders":
      for (const child of children) {
        const inner = keep.folders[child.name];
        if (!inner) lines.push(`${display(child.path, context)}: kept by no entry of keep.json under ${entry.name}/`);
        else lines.push(...judgeFolder(child, inner, context));
      }
      break;
  }
  return lines;
}

/**
 * ~/.cache/n<pid in base 36>: the NODE_TEST_DIR roots of
 * tooling/conformance/node-environment.ts, short for node's socket names. One
 * holds only its mark and node's `.tmp.*` test folders, which is how one is
 * told from another tool's folder named n<letters> (nvim, node); a day after
 * its runner is gone it is a leftover.
 */
function nodeTestRoots(input: CountInput, context: Context): string[] {
  const owner = (dir: string) => { try { return Number(readFileSync(join(dir, OWNER_MARK), "utf8").trim().split(" ")[0]); } catch { return null; } };
  const running = (pid: number | null) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; } };
  const left = folders(input.cache).filter(entry => /^n[0-9a-z]{2,7}$/.test(entry.name)
    && readdirSync(entry.path).every(name => name === OWNER_MARK || name.startsWith(".tmp."))
    && input.now - entry.mtimeMs > DAY && !running(owner(entry.path)));
  return left.length ? [`~/.cache/n<pid>: ${aged(left, context)}, NODE_TEST_DIR roots left by tooling/conformance/node-environment.ts; a runner removes its own`] : [];
}

function cacheLines(input: CountInput, keep: Record<string, Keep>, red: string[]): void {
  const context: Context = { cache: input.cache, main: input.main, verified: input.verified, now: input.now, root: input.root };
  for (const entry of folders(input.cache).filter(entry => /^nts(?:[-_.]|$)/.test(entry.name))) {
    const rule = keep[entry.name];
    if (!rule) red.push(`${display(entry.path, context)}: an nts folder no rule keeps`);
    else red.push(...judgeFolder(entry, rule, context));
  }
  red.push(...nodeTestRoots(input, context));
}

export function count(input: CountInput, keep: Record<string, Keep> = readKeep()): CountResult {
  const red: string[] = [], notes: string[] = [];
  branchLines(input, red, notes);
  worktreeLines(input, red);
  cacheLines(input, keep, red);
  return { verdict: red.length ? "FAIL" : notes.length ? "INSTRUMENT" : "PASS", red, notes };
}

// ---------------------------------------------------------------------------
// What the machine holds, read without changing anything.
// ---------------------------------------------------------------------------
function read(command: string, args: string[], cwd: string): { ok: true; out: string } | { ok: false; error: string } {
  const r = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 1 << 26, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  if (r.error || r.status !== 0) return { ok: false, error: (r.error?.message ?? r.stderr.trim()) || `exit ${r.status}` };
  return { ok: true, out: r.stdout };
}

export function parseWorktrees(porcelain: string): Worktree[] {
  return porcelain.split("\n\n").filter(block => block.trim()).map(block => {
    const tree: Worktree = { path: "" };
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) tree.path = line.slice(9);
      else if (line.startsWith("HEAD ")) tree.head = line.slice(5);
      else if (line.startsWith("branch ")) tree.branch = line.slice(7);
      else if (line.startsWith("prunable")) tree.prunable = true;
    }
    return tree;
  });
}

export function gather(repo: string, cache = join(homedir(), ".cache"), now = Date.now()): CountInput {
  const git = (args: string[]) => {
    const r = read("git", args, repo);
    if (!r.ok) throw new Error(`git ${args.join(" ")}: ${r.error}`);
    return r.out;
  };
  const sha = (rev: string) => { const r = read("git", ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], repo); return r.ok ? r.out.trim() : null; };
  const remote = read("git", ["ls-remote", "--heads", "origin"], repo);
  const pulls = read("gh", ["pr", "list", "--state", "open", "--limit", "1000", "--json", "number,headRefName,isCrossRepository"], repo);
  return {
    plan: git(["show", "main:docs/plan.md"]),
    local: git(["for-each-ref", "--format=%(refname)", "refs/heads/"]).split("\n").filter(Boolean).map(ref => ref.slice("refs/heads/".length)),
    remote: remote.ok ? remote.out.split("\n").filter(Boolean).map(line => line.split("\t")[1]!.slice("refs/heads/".length)) : { error: remote.error },
    pulls: pulls.ok ? JSON.parse(pulls.out) as Pull[] : { error: pulls.error },
    worktrees: parseWorktrees(git(["worktree", "list", "--porcelain"])),
    shared: dirname(git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim()),
    cache,
    root: git(["rev-parse", "--show-toplevel"]).trim(),
    main: sha("main"),
    verified: sha("verified"),
    now,
  };
}

export function countLines(result: CountResult): string[] {
  return [
    `count: ${result.verdict} -- ${result.red.length} red line(s)`,
    ...result.red.map(line => `  red: ${line}`),
    ...result.notes.map(line => `  ${line}`),
  ];
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = count(gather(process.cwd()));
    console.log(countLines(result).join("\n"));
    process.exitCode = result.verdict === "PASS" ? 0 : result.verdict === "FAIL" ? 1 : 2;
  } catch (error) {
    console.log(`count: NOT COUNTED -- ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
