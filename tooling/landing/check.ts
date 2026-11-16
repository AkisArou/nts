import {gitArguments} from "../gate/git-arguments/main.ts";
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
import { changedPaths, isAncestor, revParse, sharedCheckout } from "./git.ts";
import { holder } from "./lock.ts";
import { ensureService, LANDING_HOME, Queue, submit, type Result } from "./queue.ts";
import {landingStatus,reportLandingStatus} from "./status.ts";
import {POOL_HOME} from "./pool.ts";
import { ruleSelect } from "./rules.ts";
import { runLanding } from "./run.ts";
import { landingCeiling } from "../gate/step-bound.ts";
import { describeSelection, landingSteps } from "./selection.ts";
import { BUDGET, drain, KEEP_DAYS, machineConfig, prune } from "./service.ts";
import {COST_HISTORY_NAME,historyFile,snapshotCostHistory} from '../gate/step-scheduling.ts';
import {reportRustRecordDecisions} from '../gate/rust-selector-decision.ts';

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
  reportRustRecordDecisions(selected.rustRecords,say);
  say(`${note}: ${paths.length} path(s); ${selected.kind === "rust" ? "recompiles Rust" : "recompiles no Rust"}`);
  console.log(describeSelection(selected.selection));
  if (paths.some(p => p.startsWith("tooling/landing/") || p === "tooling/gate/owed.mjs" || p === "tooling/gate/step-table.mjs")) {
    console.log("note: this change edits the landing check itself; main's landing check checks it, and its own table applies once it lands");
  }
  return 0;
}

async function here(root: string, sha: string,traceRustInputs=false): Promise<number> {
  const tree = toplevel();
  if (spawnSync("git",gitArguments( ["rev-parse", "HEAD"]), { cwd: tree, encoding: "utf8" }).stdout.trim() !== sha) { say(`--here runs in a tree at ${short(sha)}; this one is not`); return 2; }
  const dirty = spawnSync("git",gitArguments( ["status", "--porcelain", "--untracked-files=no"]), { cwd: tree, encoding: "utf8" }).stdout.trim();
  if (dirty) { say(`--here checks the commit, and this tree has uncommitted changes:\n${dirty}`); return 2; }
  const { base, note } = rangeOf(root, sha);
  const selected = ruleSelect(root, join(LANDING_HOME, "costs.json"), BUDGET)(base, sha, changedPaths({ root }, base, sha));
  const steps = landingSteps(selected.selection);
  reportRustRecordDecisions(selected.rustRecords,say);
  prune(join(LANDING_HOME, "runs"), KEEP_DAYS);
  const run = join(LANDING_HOME, "runs", `here-${short(sha)}-${Date.now()}`);
  if(traceRustInputs)snapshotCostHistory(historyFile({CARGO_TARGET_DIR:join(tree,'target')},tree),join(run,'observation-costs',COST_HISTORY_NAME));
  say(`${note}: ${steps.join(" ")} in ${tree}, estimate ~${Math.round(selected.selection.estimate.seconds)} s; logs ${run}`);
  const ran = await runLanding({ tree, target: join(tree, "target"), run, commit: sha, steps, interop: selected.interop, doctests: selected.doctests,
    rustRecords:selected.rustRecords,
    // An agent's own pre-check: it yields its unused reservation to a queued landing (#672).
    priority: "agent",
    ...(traceRustInputs?{owned:{NTS_RUST_INPUT_TRACE:join(run,'rust-inputs'),NTS_GATE_COSTS_DIR:join(run,'observation-costs')}}:{}),
    ceiling: landingCeiling(selected.selection.estimate.seconds), env: process.env, hold: reason => say(`held: ${reason}`) });
  for (const s of ran.steps) console.log(`  ${s.verdict.padEnd(10)} ${s.name.padEnd(24)} ${s.wall !== undefined ? `${Math.round(s.wall)} s` : ""}${s.cpu !== undefined ? ` (cpu ${Math.round(s.cpu)} s)` : ""}${s.reason ? `  ${s.reason}` : ""}`);
  for (const line of ran.pending) console.log(`  ${line}`);
  say(`${ran.state} in ${Math.round(ran.wall_s)} s: ${ran.message}`);
  return ran.state === "green" ? 0 : ran.state === "held" ? 3 : 1;
}

async function wait(root: string, id: string): Promise<number> {
  const queue = new Queue(LANDING_HOME);
  let said = "";
  for (;;) {
    const result = queue.result(id);
    if (result&&!(result.state==='held'&&result.retryDisk?.length)) {
      say(`${result.state.toUpperCase()}: ${result.message}`);
      if (result.deferred?.length) say(`after landing, the full check runs: ${result.deferred.join(" ")}`);
      for (const line of result.pending ?? []) say(line);
      return exitFor(result.state);
    }
    const found = queue.find(id);
    const position = found?.where === "waiting" ? queue.waiting().findIndex(e => e.id === id) + 1 : 0;
    const s = queue.status();
    const now = found?.where === "checking" ? `${s.state}: ${s.message ?? ""}` : position ? `waiting, ${position} in the queue`
      :result?.retryDisk?.length?`held on disk: ${result.message}; automatically queued when capacity returns`:"waiting for the service";
    if (now !== said) { say(now); said = now; }
    if ((found?.where === "waiting"||found?.where==='held'&&result?.retryDisk?.length) && !holder(join(LANDING_HOME, "serve.lock"))) ensureService(root);
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
  if(drained.state==='held'){log('service held: a required service watch or observation failed; restart nts-landing-check');return 3;}
  // The code that just landed runs from here on: a fresh process loads it.
  if (drained.state === "restart") return spawnSync(process.execPath, [process.argv[1]!, "serve"], { cwd: root, stdio: "inherit" }).status ?? 1;
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [first, second] = argv.filter((arg, i) => !arg.startsWith("--") && !["--branch", "--note", "--costs"].includes(argv[i - 1] ?? ""));
  if(argv.includes('--trace-rust-inputs')&&(!argv.includes('--here')||argv.includes('--dry-run')||['status','serve','withdraw','retry'].includes(first??''))){
    say('--trace-rust-inputs is an observation of --here, never a queued verdict policy');return 2;
  }
  let root: string;
  try { root = sharedCheckout(); } catch (error) { say((error as Error).message); return 2; }
  if (first === "status") return reportLandingStatus(landingStatus(root,LANDING_HOME,POOL_HOME,Date.now()),argv.includes("--json"));
  if (first === "serve") return serve(root);
  if (first === "withdraw" && second) { const done = new Queue(LANDING_HOME).withdraw(second); say(done === "unknown" ? `no queued, checked or held change is ${second}` : done === "requested" ? `${second}: cancellation requested; withdrawn only after its owned work drains, held if the drain cannot be proved` : done === "too-late" ? `${second}: too late to withdraw; publication has started` : `${second} withdrawn`); return done === "unknown" || done === "too-late" ? 1 : 0; }
  if (first === "retry" && second) { const entry = new Queue(LANDING_HOME).retry(second); say(`${entry.id} queued again, first; ${ensureService(root)}`); return 0; }
  if (!first || ["withdraw", "retry"].includes(first)) { console.error("usage: check.ts <commit> [--dry-run | --here [--trace-rust-inputs] | --no-wait] [--branch <name>] | status [--json] | withdraw <id|commit> | retry <id> | serve"); return 2; }
  let sha: string;
  try { sha = revParse({ root: toplevel() || root }, first); } catch (error) { say((error as Error).message); return 2; }
  if (argv.includes("--dry-run")) return dryRun(root, sha, argv);
  try { assertLandingEnvironment(); } catch (error) { say((error as Error).message); return 2; }
  if (argv.includes("--here")) return here(root, sha,argv.includes('--trace-rust-inputs'));
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
