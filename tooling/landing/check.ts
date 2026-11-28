import {gitArguments} from "../gate/git-arguments/main.ts";
// The landing check (docs/workflow.md, "Landing: the landing check").
//
//   node tooling/landing/check.ts <commit>             queue it, and wait for its answer
//   node tooling/landing/check.ts <commit> --no-wait   queue it and return
//   node tooling/landing/check.ts <commit> --dry-run   its landing steps, deferred steps and estimate
//   node tooling/landing/check.ts rerun <id> --step <name> [--trace-rust-inputs]
//                                                      one step of a refused landing, again, in this tree
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
import { rankedScopeArgs } from "../gate/scopes/bound-slice.ts";
import { gateEnvironmentError } from "../gate/environment.ts";
import { changedPaths, isAncestor, revParse, sharedCheckout } from "./git.ts";
import { holder } from "./lock.ts";
import { ensureService, LANDING_HOME, Queue, submit, type Result } from "./queue.ts";
import {landingStatus,reportLandingStatus} from "./status.ts";
import {Pool,POOL_HOME,registeredRunTrees} from "./pool.ts";
import { ruleSelect } from "./rules.ts";
import { describeSelection } from "./selection.ts";
import { closeSelection, holdSelection, SELECTION_RANK } from "./selection-memory.ts";
import type { Selected } from "./service.ts";
import { BUDGET, drain, machineConfig } from "./service.ts";
import {reportRustRecordDecisions} from '../gate/rust-selector-decision.ts';
import { registerCommandCloser } from '../differential/command-entry/main.ts';
import { GateResource } from '../gate/gate-resource.ts';
import { rerunIn } from './rerun.ts';

const say = (line: string) => console.log(`landing: ${line}`);
const short = (sha: string) => sha.slice(0, 12);
const option = (argv: string[], name: string) => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined; };
const toplevel = (cwd = process.cwd()) => spawnSync("git",gitArguments( ["rev-parse", "--show-toplevel"]), { cwd, encoding: "utf8" }).stdout.trim();
const currentBranch = (tree: string) => spawnSync("git",gitArguments( ["branch", "--show-current"]), { cwd: tree, encoding: "utf8" }).stdout.trim() || null;
const exitFor = (state: Result["state"]) => state === "landed" ? 0 : state === "held" ? 3 : 1;

/** The dry-run range in the submitted history, or its own change on main. */
function rangeOf(root: string, sha: string): { base: string; note: string } {
  const main = revParse({ root }, "refs/heads/main");
  if (isAncestor({ root }, sha, main)) return { base: revParse({ root }, `${sha}^`), note: `${short(sha)}, on main already (its own change)` };
  const base = spawnSync("git",gitArguments( ["merge-base", main, sha]), { cwd: root, encoding: "utf8" }).stdout.trim();
  return { base, note: base === main ? `${short(sha)} on main ${short(main)}` : `${short(sha)} from merge base ${short(base)} (estimate before replay onto main ${short(main)})` };
}

async function dryRun(root: string, sha: string, argv: string[]): Promise<number> {
  const ranked = rankAgentWork("--dry-run");
  if (ranked !== undefined) return ranked;
  const { base, note } = rangeOf(root, sha);
  const paths = changedPaths({ root }, base, sha);
  const costs = option(argv, "--costs") ? resolve(option(argv, "--costs")!) : join(LANDING_HOME, "costs.json");
  // A planning command is heavy work too: it waits its turn at an agent's
  // rank, says what it waits for as the wait starts, and yields to a landing.
  const hold = await holdSelection("dry-run", sha, join(toplevel() || root, "target"), { report: say });
  let selected: Selected;
  try { selected = ruleSelect(root, costs, BUDGET)(base, sha, paths); }
  finally { await closeSelection(hold); }
  reportRustRecordDecisions(selected.rustRecords,say);
  say(`${note}: ${paths.length} path(s); ${selected.kind === "rust" ? "recompiles Rust" : "recompiles no Rust"}`);
  console.log(describeSelection(selected.selection));
  if (paths.some(p => p.startsWith("tooling/landing/") || p === "tooling/gate/owed.mjs" || p === "tooling/gate/step-table.mjs")) {
    console.log("note: this change edits the landing check itself; main's landing check checks it, and its own table applies once it lands");
  }
  return 0;
}

/**
 * Run this rerun or `--dry-run` among every rank's work at an
 * agent's CPU rank (gate/ranks.ts): from an agent's shell or unit outside
 * `nts.slice`, become this same command in a scope there, bound to that unit
 * (scopes/bound-slice.ts's `rankedScopeArgs`). Its selection, build and
 * runner then share a contended machine at the weight a landing outranks,
 * not as one more equal in the user manager's `app.slice`. Returns only when
 * it already runs there, or with the status of a refusal.
 */
function rankAgentWork(mode: "rerun" | "--dry-run"): number | undefined {
  let scope: string[] | null;
  try { scope = rankedScopeArgs(mode === "rerun" ? "agent" : SELECTION_RANK["dry-run"]); } catch (error) { say((error as Error).message); return 2; }
  if (scope === null) return undefined;
  const execve = process.execve?.bind(process);
  if (execve === undefined) { say(`node ${process.version} cannot become another program (process.execve)`); return 2; }
  const systemdRun = spawnSync("sh", ["-c", "command -v systemd-run"], { encoding: "utf8" }).stdout.trim();
  if (!systemdRun) { say(`${mode} runs in a scope at an agent's rank, and systemd-run is not on PATH`); return 2; }
  execve(systemdRun, ["systemd-run", ...scope, process.execPath, ...process.execArgv, ...process.argv.slice(1)], process.env);
  return 2;
}

/**
 * `rerun <id> --step <name>`: one step of a refused or held landing, run again
 * in this pool tree at its HEAD, as the landing ran it (rerun.ts). It answers
 * the caller only: nothing is queued, answered or landed.
 */
async function rerun(root: string, id: string, step: string, traceRustInputs: boolean): Promise<number> {
  const tree = toplevel();
  if (!tree || !registeredRunTrees(POOL_HOME, [{ path: tree }]).length) { say(`rerun runs in a task's pool tree; ${tree || process.cwd()} is not one`); return 2; }
  const ranked = rankAgentWork("rerun");
  if (ranked !== undefined) return ranked;
  const resource = GateResource.tryAcquire(`${tree}.lock`);
  if (!resource) { say(`rerun cannot acquire the tree resource lock for ${tree}`); return 3; }
  const abort = new AbortController();
  let finished!: () => void;
  const closed = new Promise<void>(resolve => { finished = resolve; });
  const unregister = registerCommandCloser('rerun', { cancel: reason => abort.abort(reason), close: () => closed });
  try {
    return await rerunIn(root, tree, id, step, traceRustInputs, abort.signal);
  } catch (error) {
    say(`rerun: ${(error as Error).message}`);
    return 2;
  } finally {
    try { resource.close(); } finally { finished(); unregister(); }
  }
}

async function wait(root: string, id: string): Promise<number> {
  const queue = new Queue(LANDING_HOME);
  let said = "";
  for (;;) {
    const result = queue.result(id);
    if (result&&!(result.state==='held'&&result.retryDisk?.length)) {
      say(`${result.state.toUpperCase()}: ${result.message}`);
      if (result.deferred?.length) say(`after landing, the full check runs: ${result.deferred.join(" ")}`);
      for (const line of [...result.pending ?? [], ...result.refresh ?? []]) say(line);
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
  const [first, second] = argv.filter((arg, i) => !arg.startsWith("--") && !["--branch", "--note", "--costs", "--step"].includes(argv[i - 1] ?? ""));
  if(argv.includes('--trace-rust-inputs')&&first!=='rerun'){
    say('--trace-rust-inputs is an observation of rerun, never a queued verdict policy');return 2;
  }
  let root: string;
  try { root = sharedCheckout(); } catch (error) { say((error as Error).message); return 2; }
  if (first === "status") return reportLandingStatus(landingStatus(root,LANDING_HOME,Date.now()),argv.includes("--json")?{json:true}:{pool:new Pool(POOL_HOME,{root})});
  if (first === "serve") return serve(root);
  if (first === "withdraw" && second) { const done = new Queue(LANDING_HOME).withdraw(second); say(done === "unknown" ? `no queued, checked or held change is ${second}` : done === "requested" ? `${second}: cancellation requested; withdrawn only after its owned work drains, held if the drain cannot be proved` : done === "too-late" ? `${second}: too late to withdraw; publication has started` : `${second} withdrawn`); return done === "unknown" || done === "too-late" ? 1 : 0; }
  if (first === "retry" && second) { const entry = new Queue(LANDING_HOME).retry(second); say(`${entry.id} queued again, first; ${ensureService(root)}`); return 0; }
  if (first === "rerun" && second && option(argv, "--step")) {
    try { assertLandingEnvironment(); } catch (error) { say((error as Error).message); return 2; }
    return rerun(root, second, option(argv, "--step")!, argv.includes("--trace-rust-inputs"));
  }
  if (argv.includes("--here")) { say("--here is gone: queue the change (`check.ts <commit>`), and diagnose a refused one with `check.ts rerun <id> --step <name>`"); return 2; }
  if (!first || ["withdraw", "retry", "rerun"].includes(first)) { console.error("usage: check.ts <commit> [--dry-run | --no-wait] [--branch <name>] | rerun <id> --step <name> [--trace-rust-inputs] | status [--json] | withdraw <id|commit> | retry <id> | serve"); return 2; }
  const planning = argv.includes('--dry-run');
  try { if (!planning) assertLandingEnvironment(); } catch (error) { say((error as Error).message); return 2; }
  const tree = toplevel() || null;
  let sha: string;
  try {
    sha = revParse({ root: tree ?? root }, first);
  } catch (error) { say((error as Error).message); return 2; }
  if (planning) return dryRun(root, sha, argv);
  // The steps every change with Rust in reach owes need the JVM and the SDK: say so before queueing.
  const missing = gateEnvironmentError(root, ["tests", "tooling"], null);
  if (missing) { say(missing); return 2; }
  const branch = option(argv, "--branch") ?? (tree && revParse({ root: tree }, "HEAD") === sha ? currentBranch(tree) : null);
  const entry = submit(sha, { branch, tree, by: "agent", note: option(argv, "--note"), root });
  say(`queued ${entry.id}${branch ? ` (task ${branch})` : ""}: \`check.ts status\` shows the queue; \`check.ts withdraw ${entry.id}\` takes it out`);
  return argv.includes("--no-wait") ? 0 : wait(root, entry.id);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2));
