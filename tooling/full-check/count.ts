// The count step (docs/workflow.md, The machine: "the full check counts
// them"). Red when a branch is named by no open issue nor docs/plan.md, a worktree is
// outside the pool, or ~/.cache holds an nts folder no entry of keep.json
// keeps, or a node test root a stopped runner left (n<pid in base 36>), or
// an empty nts slice is bound to no active unit. Each red line names the
// item and why. It reports; of what it reports, the full check removes
// four kinds itself (sweep below): what a stopped run left in a tool's
// scratch root past that root's age, the full check's own pins of commits
// that are neither main nor verified, the logs of gates run by hand past
// three days, and an empty nts slice bound to no active unit, stopped by
// name. Everything else stays a line.
//
//   node tooling/full-check/count.ts          the lines, exit 0 green, 1 red, 2 not counted
//
// What counts as named, kept or in the pool:
//   - a branch, on the machine or on GitHub, is named when it is a task's,
//     `<N>` or `<N>-<slug>` with issue N open (tooling/tasks/branch.ts; only
//     which issues are open is read, never what they say), when docs/plan.md
//     (on main) has it in backticks, or a backticked `prefix/*` covering it, or
//     when it is the head or the base of an open pull request whose number
//     docs/plan.md names (#N, or a range "#A to #B"): undone work stays
//     visible, and deleting a base would close the pull request. `main` and
//     `verified` are exempt; refs/cited/* are not branches;
//   - a worktree is in the pool at ~/.cache/nts-pool/<n>, or is the shared
//     checkout, the landing check's tree (~/.cache/nts-landing/), the full
//     check's own (~/.cache/nts-full-check/), pin.ts's build tree or
//     pinned.sh's (~/.cache/nts-gate/tree), or docs/plan.md names its path in
//     backticks: a task's tree from before the pool, kept with its task;
//   - an nts folder of ~/.cache is kept by an entry of keep.json, which says
//     why and, for a tool's folder, which file writes it: an entry whose
//     writer no longer names its folder is red too, so the list cannot
//     outlive the tools it describes;
//   - a pin is used when it is main's or verified's, or a records unit of the
//     full check records with it now.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { OWNER_MARK } from "../conformance/node-environment.ts";
import { removable as makeRemovable } from "../gate/run-temporary.ts";
import { issueOfBranch } from "../tasks/branch.ts";

export type Pull = { number: number; headRefName: string; baseRefName?: string; isCrossRepository?: boolean };
export type Worktree = { path: string; head?: string; branch?: string; prunable?: boolean };
/** One loaded slice of the user manager, as the count judges it. */
export type Slice = {
  unit: string;
  /** Started transiently by a tool, not a structural parent slice systemd holds of its own. */
  transient: boolean;
  /** ActiveState is active. */
  active: boolean;
  /** Its cgroup holds a process (its own or a descendant's), the kernel's `populated`. */
  populated: boolean;
  /** Its `BindsTo` units. */
  bindsTo: string[];
  /** How long it has been active, from its ActiveEnterTimestamp; null when unread. */
  ageMs: number | null;
};
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
  /** The numbers of GitHub's open issues, or why they could not be read. */
  issues: number[] | Unavailable;
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
  /** The pins the full check's records units record with now (service.ts's recordingPins), by folder name. */
  held?: string[];
  /** The user manager's loaded slices, or why they could not be read. */
  slices: Slice[] | Unavailable;
  /** The names of the user manager's units whose ActiveState is active. */
  activeUnits: string[];
  now: number;
};

/** A leftover of a kind the full check removes itself, and why it is one. */
export type Removable = { path: string; why: string };
/** A slice the count found empty and bound to no active unit: the sweep stops it by name. */
export type Stoppable = { unit: string; why: string };
export type CountResult = { verdict: "PASS" | "FAIL" | "INSTRUMENT"; red: string[]; notes: string[]; removable: Removable[]; stoppable: Stoppable[] };

const EXEMPT = new Set(["main", "verified"]);
const DAY = 86_400_000;

/** What docs/plan.md names: branches and paths (`~/...` or `/...`) in backticks, `prefix/*` globs, and pull request numbers. */
export function planNames(plan: string): { names: Set<string>; prefixes: string[]; paths: Set<string>; pulls: Set<number> } {
  const names = new Set<string>(), prefixes: string[] = [], paths = new Set<string>(), pulls = new Set<number>();
  for (const [, raw] of plan.matchAll(/`([^`\n]+)`/g)) {
    const token = raw!.trim().replace(/^refs\/heads\//, "");
    if (/^(?:~\/|\/)\S+$/.test(token)) paths.add(token.replace(/\/+$/, ""));
    else if (/^[^\s*]+\/\*$/.test(token)) prefixes.push(token.slice(0, -1));
    else if (!/\s/.test(token)) names.add(token);
  }
  for (const [, from, to] of plan.matchAll(/#(\d+)\b(?:\s*(?:to|–)\s*#(\d+)\b)?/g)) {
    const a = Number(from), b = to === undefined ? a : Number(to);
    if (b < a || b - a > 500) { pulls.add(a); continue; }
    for (let n = a; n <= b; n++) pulls.add(n);
  }
  return { names, prefixes, paths, pulls };
}

function branchLines(input: CountInput, red: string[], notes: string[]): void {
  const plan = planNames(input.plan);
  // A task's branch names its issue (tooling/tasks/branch.ts): it is named while that issue is open.
  const openIssues = new Set(unavailable(input.issues) ? [] : input.issues);
  const issue = (branch: string) => { const n = issueOfBranch(branch); return n !== null && openIssues.has(n); };
  const named = (branch: string) => issue(branch) || plan.names.has(branch) || plan.prefixes.some(prefix => branch.startsWith(prefix));
  const pulls = unavailable(input.pulls) ? [] : input.pulls.filter(pull => !pull.isCrossRepository);
  const pullOf = (branch: string) => pulls.filter(pull => pull.headRefName === branch);
  // A branch an open pull request is based on is that pull request's: deleting
  // it would close the pull request (landing/git.ts keeps it the same way).
  const basedOn = (branch: string) => pulls.filter(pull => pull.baseRefName === branch);
  const judge = (branch: string, where: string) => {
    if (EXEMPT.has(branch) || named(branch)) return;
    const heads = pullOf(branch);
    if (heads.some(pull => plan.pulls.has(pull.number))) return;
    if (basedOn(branch).some(pull => plan.pulls.has(pull.number))) return;
    const open = heads.length ? `; the head of open pull request ${heads.map(p => `#${p.number}`).join(", ")}, which docs/plan.md does not name either` : "";
    red.push(`branch ${branch} (${where}): named by no open issue and not in docs/plan.md${open}`);
  };
  for (const branch of [...input.local].sort()) judge(branch, "on the machine");
  if (unavailable(input.remote)) notes.push(`not counted: GitHub's branches (${input.remote.error})`);
  else for (const branch of [...input.remote].sort()) judge(branch, "on GitHub");
  if (unavailable(input.pulls)) notes.push(`not counted: GitHub's open pull requests (${input.pulls.error}), so no branch is named by one`);
  if (unavailable(input.issues)) notes.push(`not counted: GitHub's open issues (${input.issues.error}), so no branch is named by one`);
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
  if (p === join(c, "nts-gate", "tree")) return "pinned.sh's tree";
  return null;
}

function worktreeLines(input: CountInput, red: string[]): void {
  const shared = real(input.shared), home = dirname(input.cache);
  const named = new Set([...planNames(input.plan).paths].map(path => real(path.startsWith("~/") ? join(home, path.slice(2)) : path)));
  for (const tree of [...input.worktrees].sort((a, b) => a.path.localeCompare(b.path))) {
    const what = tree.branch ? tree.branch.replace(/^refs\/heads\//, "") : tree.head ? `detached at ${tree.head.slice(0, 12)}` : "no HEAD";
    if (tree.prunable) { red.push(`worktree ${tree.path} (${what}): its folder is gone; \`git worktree prune\` forgets it`); continue; }
    if (real(tree.path) === shared || poolWorktree(tree.path, input.cache) || named.has(real(tree.path))) continue;
    red.push(`worktree ${tree.path} (${what}): outside the pool (~/.cache/nts-pool/<n>), and docs/plan.md does not name it`);
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
 *   runs     a service's folder: its runs/ is a folder of logs;
 *   logs     a folder of runs' logs no service prunes, each kept three days, then swept;
 *   pins     pin.ts's tree, target and lock, and the pins of main and verified;
 *   scratch  a tool's scratch root: what a run leaves for a day (or `days`) is a leftover;
 *   folders  each folder in it kept by a rule of its own.
 * `writer` is the file that writes the folder; a writer that no longer names
 * it makes its entry red, so the list cannot outlive the tools it describes.
 */
export type Keep =
  | { kind: "kept" | "pool" | "pins"; why: string; writer?: string }
  | { kind: "runs" | "logs"; who: string; why: string; writer?: string }
  | { kind: "scratch"; writer: string; days?: number }
  | { kind: "folders"; why: string; folders: Record<string, Keep> };

export const KEEP_FILE = fileURLToPath(new URL("keep.json", import.meta.url));

export function readKeep(file = KEEP_FILE): Record<string, Keep> {
  const value = JSON.parse(readFileSync(file, "utf8")) as Record<string, Keep>;
  const check = (name: string, keep: Keep) => {
    if (!["kept", "pool", "pins", "runs", "logs", "scratch", "folders"].includes(keep.kind)) throw new Error(`${file}: ${name} has an unknown kind ${String(keep.kind)}`);
    if (keep.kind === "scratch" && !keep.writer) throw new Error(`${file}: the scratch root ${name} names no writer`);
    if (keep.kind !== "scratch" && !keep.why) throw new Error(`${file}: ${name} does not say why it is kept`);
    if (keep.kind === "folders") for (const [child, inner] of Object.entries(keep.folders)) check(`${name}/${child}`, inner);
  };
  for (const [name, keep] of Object.entries(value)) check(name, keep);
  return value;
}

export type Context = { cache: string; main: string | null; verified: string | null; held: readonly string[]; now: number; root: string; plan: string };
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

/**
 * Nothing under `path` changed after `since` (its own folder's time aside): no
 * run still writes it. Walked by bytes, as removable() walks: a name that is
 * not UTF-8 would name nothing, and a fresh file under it would go unseen.
 */
function settled(path: string, since: number): boolean {
  const root = Buffer.from(path), slash = Buffer.from("/");
  for (const name of readdirSync(root, { recursive: true, encoding: "buffer" })) {
    try { if (lstatSync(Buffer.concat([root, slash, name])).mtimeMs > since) return false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return true;
}

/** A pin the full check built (records.ts's runPin), by its provenance. */
function fullCheckPin(path: string): boolean {
  try { return (JSON.parse(readFileSync(join(path, "provenance.json"), "utf8")) as { built_by?: string }).built_by === "full-check"; }
  catch { return false; }
}

function judgeFolder(entry: Entry, keep: Keep, context: Context, removable: Removable[]): string[] {
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
    case "runs":
    case "logs": {
      const logs = keep.kind === "runs" ? join(entry.path, "runs") : entry.path;
      const old = folders(logs).filter(run => run.name !== "latest" && context.now - run.mtimeMs > 3 * DAY);
      if (old.length) lines.push(`${display(logs, context)}: ${aged(old, context)} of ${keep.who}; logs are kept three days`);
      // A service prunes its own runs. Logs no service prunes go once nothing
      // inside them changed for those three days: a run may still be writing.
      if (keep.kind === "logs") {
        for (const run of old) {
          if (settled(run.path, context.now - 3 * DAY)) removable.push({ path: run.path, why: `logs of ${keep.who}, ${days(context.now - run.mtimeMs)} days old; logs are kept three days` });
        }
      }
      break;
    }
    case "pins": {
      // A records unit records with its run's pin for hours, while main and
      // verified move past that run: the pin is in use until the unit ends.
      const used = new Set(["tree", "target", "build.lock", ...[context.main, context.verified].flatMap(sha => sha ? [sha.slice(0, 12)] : []), ...context.held]);
      for (const child of children) {
        if (used.has(child.name) || (child.name.includes(".partial-") && context.now - child.mtimeMs < DAY)) continue;
        lines.push(`${display(child.path, context)}: a pin main does not use (it uses the pins of main${context.verified ? " and verified" : ""})`);
        // Only the full check's own, a day old, and named by no task: an
        // agent's pin is a peer's evidence and stays a line.
        if (fullCheckPin(child.path) && context.now - child.mtimeMs > DAY && !context.plan.includes(child.name)) {
          removable.push({ path: child.path, why: `the full check's pin of ${child.name}, neither main's nor verified's` });
        }
      }
      break;
    }
    case "scratch": {
      const age = (keep.days ?? 1) * DAY, left = children.filter(child => context.now - child.mtimeMs > age);
      if (left.length) lines.push(`${display(entry.path, context)}: ${aged(left, context)} left by ${keep.writer}; a run removes its own folder`);
      for (const child of left) {
        if (settled(child.path, context.now - age)) removable.push({ path: child.path, why: `left by ${keep.writer} ${days(context.now - child.mtimeMs)} days ago` });
      }
      break;
    }
    case "folders":
      for (const child of children) {
        const inner = keep.folders[child.name];
        if (!inner) lines.push(`${display(child.path, context)}: kept by no entry of keep.json under ${entry.name}/`);
        else lines.push(...judgeFolder(child, inner, context, removable));
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

function cacheLines(input: CountInput, keep: Record<string, Keep>, red: string[], removable: Removable[]): void {
  const context: Context = { cache: input.cache, main: input.main, verified: input.verified, held: input.held ?? [], now: input.now, root: input.root, plan: input.plan };
  for (const entry of folders(input.cache).filter(entry => /^nts(?:[-_.]|$)/.test(entry.name))) {
    const rule = keep[entry.name];
    if (!rule) red.push(`${display(entry.path, context)}: an nts folder no rule keeps`);
    else red.push(...judgeFolder(entry, rule, context, removable));
  }
  red.push(...nodeTestRoots(input, context));
}

/** The count's own interval: a slice younger than this may be a live run's, not a leftover. */
const HOUR_MS = 3_600_000;

/**
 * An empty nts slice bound to no active unit is a run's leftover (#633): a
 * slice a tool started transiently (a gate step's, a census's), holding no
 * process, whose binding -- the unit it stops with -- is gone or never
 * existed. A populated slice is a run's, a slice bound to an active unit
 * stops with it, and a structural parent (`nts.slice`, not transient) is
 * systemd's hierarchy, not a run's. Each leftover is named, and the sweep
 * stops it by name.
 *
 * Only a slice active longer than the count's own interval (one hour) is
 * stopped: a run on code from before slices were bound (a pin, the full
 * check's verified tree) creates its slice unbound, and it is empty for a
 * moment before its first scope starts. A younger one -- or one whose age
 * is unread -- is a note, kept until a later count can prove it old. Age
 * never runs backwards, so the sweep needs no second age reading: it
 * re-reads only what can change, populated and bound.
 */
function sliceLines(input: CountInput, red: string[], notes: string[], stoppable: Stoppable[]): void {
  if (unavailable(input.slices)) { notes.push(`not counted: the user manager's slices (${input.slices.error})`); return; }
  const active = new Set(input.activeUnits);
  for (const slice of [...input.slices].sort((a, b) => a.unit.localeCompare(b.unit))) {
    if (!slice.unit.startsWith("nts") || !slice.unit.endsWith(".slice") || !slice.transient || !slice.active || slice.populated) continue;
    if (slice.bindsTo.some(unit => active.has(unit))) continue;
    if (slice.ageMs === null || slice.ageMs <= HOUR_MS) {
      notes.push(slice.ageMs === null
        ? `slice ${slice.unit}: empty and bound to no active unit, its age unread; kept until a count can prove it old`
        : `slice ${slice.unit}: empty and bound to no active unit, but only ${Math.floor(slice.ageMs / 60_000)} min old; a run may still start in it`);
      continue;
    }
    red.push(`slice ${slice.unit}: empty and bound to no active unit; the run that started it is gone`);
    stoppable.push({ unit: slice.unit, why: "empty and bound to no active unit" });
  }
}

export function count(input: CountInput, keep: Record<string, Keep> = readKeep()): CountResult {
  const red: string[] = [], notes: string[] = [], removable: Removable[] = [], stoppable: Stoppable[] = [];
  branchLines(input, red, notes);
  worktreeLines(input, red);
  cacheLines(input, keep, red, removable);
  sliceLines(input, red, notes, stoppable);
  return { verdict: red.length ? "FAIL" : notes.length ? "INSTRUMENT" : "PASS", red, notes, removable, stoppable };
}

/**
 * Remove what the count found removable, one folder at a time: a path must
 * sit inside `cache` and be a real folder, not a link; its folders are made
 * writable first (a run can leave read-only captured inputs), by the walk the
 * gate's own temporary folders are removed with. Returns a line
 * per folder, removed or kept with the reason.
 */
export function sweep(removable: readonly Removable[], cache: string): string[] {
  return removable.map(({ path, why }) => {
    const shown = `~/.cache/${relative(cache, path)}`, part = relative(cache, path);
    try {
      if (!part || part.startsWith("..") || isAbsolute(part)) throw new Error("outside ~/.cache");
      const info = lstatSync(path);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("not a real folder");
      makeRemovable(path);
      rmSync(path, { recursive: true });
      return `swept ${shown}: ${why}`;
    } catch (error) {
      return `kept ${shown}: ${error instanceof Error ? error.message : String(error)}`;
    }
  });
}

const CGROUP = "/sys/fs/cgroup";
/** Whether a cgroup holds a process, the kernel's own answer; a group already gone holds none. */
function populated(group: string): boolean {
  try {
    const value = /^populated ([01])$/m.exec(readFileSync(join(CGROUP, group, "cgroup.events"), "utf8"))?.[1];
    if (value === undefined) throw new Error(`slice cgroup ${group} has no populated answer`);
    return value === "1";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

type Shown = { loaded: boolean; transient: boolean; active: boolean; bindsTo: string[]; group: string; enteredMonotonicUs: number | null };
/** `systemctl show` for slices, by unit: one call, its blocks parsed. A unit the manager does not hold reads LoadState other than loaded. */
function showSlices(units: string[]): Map<string, Shown> {
  const shown = new Map<string, Shown>();
  if (!units.length) return shown;
  const result = spawnSync("systemctl", ["--user", "show", ...units, "--property=Id,LoadState,ActiveState,Transient,BindsTo,ControlGroup,ActiveEnterTimestampMonotonic"], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (result.error || result.status !== 0) throw new Error(`systemctl show: ${result.error?.message ?? result.stderr.trim() ?? `exit ${result.status}`}`);
  for (const block of result.stdout.split("\n\n")) {
    const fields = new Map(block.split("\n").filter(Boolean).map(line => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)] as const; }));
    const id = fields.get("Id");
    if (!id) continue;
    const entered = Number(fields.get("ActiveEnterTimestampMonotonic"));
    shown.set(id, {
      loaded: fields.get("LoadState") === "loaded",
      transient: fields.get("Transient") === "yes",
      active: fields.get("ActiveState") === "active",
      bindsTo: (fields.get("BindsTo") ?? "").split(" ").filter(Boolean),
      group: fields.get("ControlGroup") ?? "",
      enteredMonotonicUs: Number.isSafeInteger(entered) && entered > 0 ? entered : null,
    });
  }
  return shown;
}

const isActive = (unit: string) => spawnSync("systemctl", ["--user", "is-active", unit], { encoding: "utf8" }).stdout?.trim() === "active";

/**
 * Stop the slices the count found stoppable, by name and nothing else:
 * each is read again first -- a slice populated since the count, or bound
 * to a unit active now, is a live run's and is kept. Returns a line per
 * slice, stopped or kept with the reason.
 */
export function stopSlices(stoppable: readonly Stoppable[]): string[] {
  return stoppable.map(({ unit, why }) => {
    try {
      if (!/^nts[a-zA-Z0-9_.:@-]*\.slice$/.test(unit)) throw new Error("not an nts slice the count names");
      const shown = showSlices([unit]).get(unit);
      if (!shown?.loaded) return `stopped ${unit}: ${why}; already gone`;
      // Inactive first: a slice collected since the count reads loaded and
      // not transient under `show`, which loads it by name to answer.
      if (!shown.active) return `stopped ${unit}: ${why}; already inactive`;
      if (!shown.transient) return `kept ${unit}: not a transient slice a tool started`;
      if (populated(shown.group)) return `kept ${unit}: holds a process again`;
      const bound = shown.bindsTo.find(target => isActive(target));
      if (bound) return `kept ${unit}: bound to ${bound}, which is active`;
      const stopped = spawnSync("systemctl", ["--user", "stop", unit], { encoding: "utf8", timeout: 120_000 });
      if (stopped.error || stopped.status !== 0) throw new Error(`systemctl stop: ${stopped.error?.message ?? stopped.stderr.trim() ?? `exit ${stopped.status}`}`);
      return `stopped ${unit}: ${why}`;
    } catch (error) {
      return `kept ${unit}: ${error instanceof Error ? error.message : String(error)}`;
    }
  });
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

/** The user manager's slices and its active units' names, or why they could not be read. */
function readSlices(repo: string): { slices: Slice[]; activeUnits: string[] } | Unavailable {
  try {
    const listed = read("systemctl", ["--user", "list-units", "--all", "--type=slice", "--output=json"], repo);
    if (!listed.ok) return { error: listed.error };
    const units = read("systemctl", ["--user", "list-units", "--all", "--output=json"], repo);
    if (!units.ok) return { error: units.error };
    const activeUnits = (JSON.parse(units.out) as { unit: string; active: string }[]).filter(unit => unit.active === "active").map(unit => unit.unit);
    const candidates = (JSON.parse(listed.out) as { unit: string }[]).map(slice => slice.unit).filter(unit => unit.startsWith("nts"));
    const shown = showSlices(candidates);
    // systemd's monotonic timestamps are CLOCK_MONOTONIC microseconds;
    // /proc/uptime is the same clock, in seconds.
    const uptimeMs = Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]) * 1000;
    const slices: Slice[] = candidates.flatMap(unit => {
      const slice = shown.get(unit);
      const ageMs = slice?.enteredMonotonicUs ? uptimeMs - slice.enteredMonotonicUs / 1000 : null;
      return slice?.loaded ? [{ unit, transient: slice.transient, active: slice.active, populated: slice.group ? populated(slice.group) : false, bindsTo: slice.bindsTo, ageMs: ageMs !== null && Number.isFinite(ageMs) && ageMs >= 0 ? ageMs : null }] : [];
    });
    return { slices, activeUnits };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function gather(repo: string, cache = join(homedir(), ".cache"), now = Date.now()): CountInput {
  const git = (args: string[]) => {
    const r = read("git", args, repo);
    if (!r.ok) throw new Error(`git ${args.join(" ")}: ${r.error}`);
    return r.out;
  };
  const sha = (rev: string) => { const r = read("git", ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], repo); return r.ok ? r.out.trim() : null; };
  const remote = read("git", ["ls-remote", "--heads", "origin"], repo);
  const pulls = read("gh", ["pr", "list", "--state", "open", "--limit", "1000", "--json", "number,headRefName,baseRefName,isCrossRepository"], repo);
  const issues = read("gh", ["issue", "list", "--state", "open", "--limit", "5000", "--json", "number"], repo);
  const slices = readSlices(repo);
  return {
    plan: git(["show", "main:docs/plan.md"]),
    local: git(["for-each-ref", "--format=%(refname)", "refs/heads/"]).split("\n").filter(Boolean).map(ref => ref.slice("refs/heads/".length)),
    remote: remote.ok ? remote.out.split("\n").filter(Boolean).map(line => line.split("\t")[1]!.slice("refs/heads/".length)) : { error: remote.error },
    pulls: pulls.ok ? JSON.parse(pulls.out) as Pull[] : { error: pulls.error },
    issues: issues.ok ? (JSON.parse(issues.out) as { number: number }[]).map(issue => issue.number) : { error: issues.error },
    worktrees: parseWorktrees(git(["worktree", "list", "--porcelain"])),
    shared: dirname(git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim()),
    cache,
    root: git(["rev-parse", "--show-toplevel"]).trim(),
    main: sha("main"),
    verified: sha("verified"),
    slices: unavailable(slices) ? slices : slices.slices,
    activeUnits: unavailable(slices) ? [] : slices.activeUnits,
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
