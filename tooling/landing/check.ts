import {gitArguments} from "../gate/git-arguments.ts";
// The landing check (docs/workflow.md, "Landing: the landing check").
//
//   node tooling/landing/check.ts <commit>             queue it, and wait for its answer
//   node tooling/landing/check.ts <commit> --no-wait   queue it and return
//   node tooling/landing/check.ts <commit> --dry-run   its landing steps, deferred steps and estimate
//   node tooling/landing/check.ts <commit> --here      run its landing steps in this tree, now
//   node tooling/landing/check.ts status [--json]      the service, the queue, recent answers, the pool
//   node tooling/landing/check.ts withdraw <id|commit> it never lands
//   node tooling/landing/check.ts retry <id>           check a held change again, first
//   node tooling/landing/check.ts serve                drain the queue (the service's unit runs this)
//
// A queued change is rebased onto the newest main, checked with the landing
// steps its paths owe, and, green, lands: main fast-forwards and is pushed,
// the task's branch is deleted here and on GitHub, and its pool tree is reset
// to the new main. `--branch <name>` names the task's branch when the tree's
// checked-out branch is not it. Exit status: 0 landed, 1 refused or
// withdrawn, 3 held, 2 a usage or environment error.
import { appendFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertLandingEnvironment } from "../gate/canonical-environment.ts";
import { gateEnvironmentError } from "../gate/environment.ts";
import { issueOfBranch } from "../tasks/branch.ts";
import { changedPaths, isAncestor, revParse, sharedCheckout } from "./git.ts";
import { holder } from "./lock.ts";
import { describePool, Pool, POOL_HOME, type PoolTree } from "./pool.ts";
import { ensureService, LANDING_HOME, Queue, SERVICE_UNIT, submit, type Checking, type Entry, type Result, type Status } from "./queue.ts";
import { ruleSelect } from "./rules.ts";
import { runLanding } from "./run.ts";
import { landingCeiling } from "../gate/step-bound.ts";
import { describeSelection, landingSteps } from "./selection.ts";
import { BUDGET, drain, KEEP_DAYS, machineConfig, prune } from "./service.ts";

const say = (line: string) => console.log(`landing: ${line}`);
const short = (sha: string) => sha.slice(0, 12);
const option = (argv: string[], name: string) => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined; };
const toplevel = (cwd = process.cwd()) => spawnSync("git",gitArguments( ["rev-parse", "--show-toplevel"]), { cwd, encoding: "utf8" }).stdout.trim();
const currentBranch = (tree: string) => spawnSync("git",gitArguments( ["branch", "--show-current"]), { cwd: tree, encoding: "utf8" }).stdout.trim() || null;
const exitFor = (state: Result["state"]) => state === "landed" ? 0 : state === "held" ? 3 : 1;

/** The range a commit's dry run and `--here` select: what it adds to main, or, on main already, its own change. */
function rangeOf(root: string, sha: string): { base: string; note: string } {
  const main = revParse({ root }, "refs/heads/main");
  if (isAncestor({ root }, sha, main)) return { base: revParse({ root }, `${sha}^`), note: `${short(sha)}, on main already (its own change)` };
  const base = spawnSync("git",gitArguments( ["merge-base", main, sha]), { cwd: root, encoding: "utf8" }).stdout.trim();
  return { base, note: base === main ? `${short(sha)} on main ${short(main)}` : `${short(sha)}, replayed onto main ${short(main)} when it lands` };
}

function dryRun(root: string, sha: string, argv: string[]): number {
  const { base, note } = rangeOf(root, sha);
  const paths = changedPaths({ root }, base, sha);
  const costs = option(argv, "--costs") ? resolve(option(argv, "--costs")!) : join(LANDING_HOME, "costs.json");
  const selected = ruleSelect(root, costs, BUDGET)(base, sha, paths);
  say(`${note}: ${paths.length} path(s); ${selected.kind === "rust" ? "recompiles Rust" : "recompiles no Rust"}`);
  console.log(describeSelection(selected.selection));
  if (paths.some(p => p.startsWith("tooling/landing/") || p === "tooling/gate/owed.mjs" || p === "tooling/gate/step-table.mjs")) {
    console.log("note: this change edits the landing check itself; main's landing check checks it, and its own table applies once it lands");
  }
  return 0;
}

async function here(root: string, sha: string): Promise<number> {
  const tree = toplevel();
  if (spawnSync("git",gitArguments( ["rev-parse", "HEAD"]), { cwd: tree, encoding: "utf8" }).stdout.trim() !== sha) { say(`--here runs in a tree at ${short(sha)}; this one is not`); return 2; }
  const dirty = spawnSync("git",gitArguments( ["status", "--porcelain", "--untracked-files=no"]), { cwd: tree, encoding: "utf8" }).stdout.trim();
  if (dirty) { say(`--here checks the commit, and this tree has uncommitted changes:\n${dirty}`); return 2; }
  const { base, note } = rangeOf(root, sha);
  const selected = ruleSelect(root, join(LANDING_HOME, "costs.json"), BUDGET)(base, sha, changedPaths({ root }, base, sha));
  const steps = landingSteps(selected.selection);
  prune(join(LANDING_HOME, "runs"), KEEP_DAYS);
  const run = join(LANDING_HOME, "runs", `here-${short(sha)}-${Date.now()}`);
  say(`${note}: ${steps.join(" ")} in ${tree}, estimate ~${Math.round(selected.selection.estimate.seconds)} s; logs ${run}`);
  const ran = await runLanding({ tree, target: join(tree, "target"), run, commit: sha, steps, interop: selected.interop, doctests: selected.doctests,
    // An agent's own pre-check: it yields its unused reservation to a queued landing (#672).
    priority: "agent",
    ceiling: landingCeiling(selected.selection.estimate.seconds), env: process.env, hold: reason => say(`held: ${reason}`) });
  for (const s of ran.steps) console.log(`  ${s.verdict.padEnd(10)} ${s.name.padEnd(24)} ${s.wall !== undefined ? `${Math.round(s.wall)} s` : ""}${s.cpu !== undefined ? ` (cpu ${Math.round(s.cpu)} s)` : ""}${s.reason ? `  ${s.reason}` : ""}`);
  for (const line of ran.pending) console.log(`  ${line}`);
  say(`${ran.state} in ${Math.round(ran.wall_s)} s: ${ran.message}`);
  return ran.state === "green" ? 0 : ran.state === "held" ? 3 : 1;
}

/** A change as the status gives it, with the issue its task's branch names. */
export type Change = { id: string; sha: string; branch: string | null; issue: number | null; by: string; first: boolean; submitted_at: string; note: string | null };
/** An answer as the status gives it: its times in seconds, as numbers. */
export type Answer = {
  id: string; sha: string; state: Result["state"]; at: string; message: string; branch: string | null; issue: number | null;
  base: string | null; tip: string | null; run: string | null; wall_s: number | null; estimate_s: number | null;
  landing: string[]; deferred: string[]; pending: number;
};
/**
 * The landing check as `status --json` prints it, version 1: the service, the
 * change being checked, the queue, the last day's answers and the recent
 * ones, main and the pool. Times are ISO strings; durations are seconds, as
 * numbers. The text `status` prints is rendered from this.
 *
 * Other tools read it (signalbox's Landing tab), so within a version fields
 * are only added; one removed, renamed or reshaped bumps `version`.
 */
export type LandingStatus = {
  version: 1; kind: "landing"; at: string;
  service: { running: boolean; pid: number | null; unit: string; state: Status["state"]; since: string; message: string | null };
  checking: (Change & { phase: Checking["phase"] | null; base: string | null; tip: string | null; run: string | null; started_at: string; seconds: number }) | null;
  waiting: Change[];
  held: (Change & { message: string })[];
  /** The answers of the last 24 hours by state, and how long the landed ones' checks took. */
  day: { landed: number; refused: number; held: number; withdrawn: number; median_wall_s: number | null; max_wall_s: number | null };
  /** The newest answers, oldest first. */
  recent: Answer[];
  /** Whether origin has main, by the remote-tracking ref the service's pushes move: the status never asks the network. */
  main: { commit: string | null; pushed: boolean | null };
  pool: { home: string; trees: (PoolTree & { issue: number | null })[] };
};

const RECENT = 50;
const DAY_MS = 86_400_000;

export function landingStatus(root: string, home = LANDING_HOME, pool = POOL_HOME, now = Date.now()): LandingStatus {
  const queue = new Queue(home), s = queue.status(), pid = holder(join(home, "serve.lock"));
  const issue = (branch: string | null) => branch === null ? null : issueOfBranch(branch);
  const change = (e: Entry): Change => ({ id: e.id, sha: e.sha, branch: e.branch, issue: issue(e.branch), by: e.by, first: e.first, submitted_at: e.submitted_at, note: e.note ?? null });
  const checking = queue.checking(), results = queue.results();
  const day = results.filter(r => now - Date.parse(r.at) < DAY_MS);
  const walls = day.flatMap(r => r.state === "landed" && typeof r.wall_s === "number" ? [r.wall_s] : []).sort((a, b) => a - b);
  const count = (state: Result["state"]) => day.filter(r => r.state === state).length;
  const ref = (name: string) => { try { return revParse({ root }, name); } catch { return null; } };
  const main = ref("refs/heads/main"), remote = ref("refs/remotes/origin/main");
  return {
    version: 1, kind: "landing", at: new Date(now).toISOString(),
    service: { running: pid !== null, pid, unit: SERVICE_UNIT, state: s.state, since: s.since ?? s.at, message: s.message ?? null },
    checking: checking && { ...change(checking), phase: checking.phase ?? null, base: checking.base ?? null, tip: checking.tip ?? null, run: checking.run ?? null,
      started_at: checking.started_at, seconds: Math.round((now - Date.parse(checking.started_at)) / 1000) },
    waiting: queue.waiting().map(change),
    held: queue.held().map(e => ({ ...change(e), message: queue.result(e.id)?.message ?? "" })),
    day: { landed: count("landed"), refused: count("refused"), held: count("held"), withdrawn: count("withdrawn"),
      median_wall_s: walls.length ? walls[Math.floor((walls.length - 1) / 2)]! : null, max_wall_s: walls.at(-1) ?? null },
    recent: results.slice(-RECENT).map(r => ({
      id: r.id, sha: r.sha, state: r.state, at: r.at, message: r.message, branch: r.task ?? null, issue: issue(r.task ?? null),
      base: r.base ?? null, tip: r.tip ?? null, run: r.run ?? null, wall_s: r.wall_s ?? null, estimate_s: r.estimate_s ?? null,
      landing: r.landing ?? [], deferred: r.deferred ?? [], pending: r.pending?.length ?? 0,
    })),
    main: { commit: main, pushed: main === null || remote === null ? null : main === remote },
    pool: { home: pool, trees: new Pool(pool, { root }).trees().map(tree => ({ ...tree, issue: issue(tree.branch) })) },
  };
}

const minutes = (seconds: number) => `${(seconds / 60).toFixed(1)} min`;

/** The status as `status` prints it, from the same model `--json` prints. */
export function statusText(m: LandingStatus): string {
  const lines = [`service: ${m.service.running ? `draining (process ${m.service.pid}, unit ${m.service.unit})` : "not running"}; ${m.service.state} since ${m.service.since}${m.service.message ? `: ${m.service.message}` : ""}`];
  const c = m.checking;
  if (c) lines.push(`checking: ${c.id} ${c.branch ?? "(no branch)"} ${c.phase ?? ""}${c.tip ? ` as ${short(c.tip)}` : ""}${c.run ? `, logs ${c.run}` : ""}`);
  lines.push(`waiting (${m.waiting.length}):${m.waiting.length ? "" : " none"}`);
  m.waiting.forEach((e, i) => lines.push(`  ${i + 1}. ${e.id} ${e.branch ?? "(no branch)"} by ${e.by}${e.first ? ", first" : ""}${e.note ? ` -- ${e.note}` : ""}`));
  if (m.held.length) { lines.push(`held (${m.held.length}): retry with \`check.ts retry <id>\` or withdraw`); for (const e of m.held) lines.push(`  ${e.id} ${e.branch ?? ""}: ${e.message}`); }
  const recent = m.recent.slice(-8);
  lines.push(`recent (${recent.length}):`);
  for (const r of recent) lines.push(`  ${r.at.slice(0, 16).replace("T", " ")} ${r.state.padEnd(9)} ${short(r.sha)} ${r.message}`);
  const d = m.day;
  lines.push(`last day: ${d.landed} landed${d.median_wall_s !== null && d.max_wall_s !== null ? ` (median ${minutes(d.median_wall_s)}, longest ${minutes(d.max_wall_s)})` : ""}, ${d.refused} refused, ${d.held} held, ${d.withdrawn} withdrawn`);
  if (m.main.commit && m.main.pushed !== null) lines.push(`main ${short(m.main.commit)}: ${m.main.pushed ? "on origin" : "NOT on origin yet"}`);
  lines.push(`pool ${m.pool.home}:\n${describePool(m.pool.trees)}`);
  return lines.join("\n");
}

function status(root: string, json: boolean): number {
  const model = landingStatus(root);
  console.log(json ? JSON.stringify(model, null, 2) : statusText(model));
  return 0;
}

async function wait(root: string, id: string): Promise<number> {
  const queue = new Queue(LANDING_HOME);
  let said = "";
  for (;;) {
    const result = queue.result(id);
    if (result) {
      say(`${result.state.toUpperCase()}: ${result.message}`);
      if (result.deferred?.length) say(`after landing, the full check runs: ${result.deferred.join(" ")}`);
      for (const line of result.pending ?? []) say(line);
      return exitFor(result.state);
    }
    const found = queue.find(id);
    const position = found?.where === "waiting" ? queue.waiting().findIndex(e => e.id === id) + 1 : 0;
    const s = queue.status();
    const now = found?.where === "checking" ? `${s.state}: ${s.message ?? ""}` : position ? `waiting, ${position} in the queue` : "waiting for the service";
    if (now !== said) { say(now); said = now; }
    if (found?.where === "waiting" && !holder(join(LANDING_HOME, "serve.lock"))) ensureService(root);
    await new Promise(done => setTimeout(done, 2000));
  }
}

async function serve(root: string): Promise<number> {
  if (resolve(process.cwd()) !== resolve(root)) { say(`the service runs from the shared checkout ${root}, so it runs main's code`); return 2; }
  const logDir = join(LANDING_HOME, "runs");
  mkdirSync(logDir, { recursive: true });
  const log = (line: string) => {
    const stamped = `${new Date().toISOString()} ${line}`;
    console.log(stamped);
    try { appendFileSync(join(logDir, `service-${stamped.slice(0, 10)}.log`), `${stamped}\n`); } catch { /* the journal has it */ }
  };
  const drained = await drain(machineConfig(root, ruleSelect(root, join(LANDING_HOME, "costs.json"), BUDGET), log));
  if (drained.state === "busy") { log("another service is draining the queue"); return 0; }
  // The code that just landed runs from here on: a fresh process loads it.
  if (drained.state === "restart") return spawnSync(process.execPath, [process.argv[1]!, "serve"], { cwd: root, stdio: "inherit" }).status ?? 1;
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [first, second] = argv.filter((arg, i) => !arg.startsWith("--") && !["--branch", "--note", "--costs"].includes(argv[i - 1] ?? ""));
  let root: string;
  try { root = sharedCheckout(); } catch (error) { say((error as Error).message); return 2; }
  if (first === "status") return status(root, argv.includes("--json"));
  if (first === "serve") return serve(root);
  if (first === "withdraw" && second) { const done = new Queue(LANDING_HOME).withdraw(second); say(done === "unknown" ? `no queued, checked or held change is ${second}` : done === "requested" ? `${second} is being checked: it will be answered withdrawn when its check ends, and never land` : `${second} withdrawn`); return done === "unknown" ? 1 : 0; }
  if (first === "retry" && second) { const entry = new Queue(LANDING_HOME).retry(second); say(`${entry.id} queued again, first; ${ensureService(root)}`); return 0; }
  if (!first || ["withdraw", "retry"].includes(first)) { console.error("usage: check.ts <commit> [--dry-run | --here | --no-wait] [--branch <name>] | status [--json] | withdraw <id|commit> | retry <id> | serve"); return 2; }
  let sha: string;
  try { sha = revParse({ root: toplevel() || root }, first); } catch (error) { say((error as Error).message); return 2; }
  if (argv.includes("--dry-run")) return dryRun(root, sha, argv);
  try { assertLandingEnvironment(); } catch (error) { say((error as Error).message); return 2; }
  if (argv.includes("--here")) return here(root, sha);
  // The steps every change with Rust in reach owes need the JVM and the SDK: say so before queueing.
  const missing = gateEnvironmentError(root, ["tests", "tooling"], null);
  if (missing) { say(missing); return 2; }
  const tree = toplevel() || null;
  const branch = option(argv, "--branch") ?? (tree && revParse({ root: tree }, "HEAD") === sha ? currentBranch(tree) : null);
  const entry = submit(sha, { branch, tree, by: "agent", note: option(argv, "--note"), root });
  say(`queued ${entry.id}${branch ? ` (task ${branch})` : ""}: \`check.ts status\` shows the queue; \`check.ts withdraw ${entry.id}\` takes it out`);
  return argv.includes("--no-wait") ? 0 : wait(root, entry.id);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2));
