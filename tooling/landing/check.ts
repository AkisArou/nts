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
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertLandingEnvironment } from "../gate/canonical-environment.ts";
import { rankedScopeArgs } from "../gate/scopes/bound-slice.ts";
import { gateEnvironmentError } from "../gate/environment.ts";
import { changedPaths, isAncestor, landingReplay, revParse, sharedCheckout, treeOf } from "./git.ts";
import { holder } from "./lock.ts";
import { ensureService, LANDING_HOME, Queue, submit, type Result } from "./queue.ts";
import {landingStatus,reportLandingStatus} from "./status.ts";
import {Pool,POOL_HOME,registeredRunTrees} from "./pool.ts";
import { ruleSelect } from "./rules.ts";
import { runLanding } from "./run.ts";
import { landingCeiling } from "../gate/step-bound.ts";
import { describeSelection, landingSteps } from "./selection.ts";
import { closeSelection, holdSelection, SELECTION_RANK } from "./selection-memory.ts";
import type { Selected } from "./service.ts";
import type { Reservation } from "../gate/memory-ledger.ts";
import { BUDGET, drain, KEEP_DAYS, machineConfig, prune } from "./service.ts";
import {COST_HISTORY_NAME,historyFile,snapshotCostHistory} from '../gate/step-scheduling.ts';
import {reportRustRecordDecisions} from '../gate/rust-selector-decision.ts';
import {installationCatalogState} from '../inputs/dependency-inputs.ts';
import { registerCommandCloser } from '../differential/command-entry/main.ts';
import { GateResource } from '../gate/gate-resource.ts';
import { liveTreeRunLock, treeRunLockPath } from '../gate/tree-run-lock.ts';
import { HereCheckout } from './here-replay.ts';
import { assertNoHereRestore, hereRestore, hereRestorePath } from './here-restore-record.ts';

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
 * Run this `--here` check or `--dry-run` among every rank's work at an
 * agent's CPU rank (gate/ranks.ts): from an agent's shell or unit outside
 * `nts.slice`, become this same command in a scope there, bound to that unit
 * (scopes/bound-slice.ts's `rankedScopeArgs`). Its selection, build and
 * runner then share a contended machine at the weight a landing outranks,
 * not as one more equal in the user manager's `app.slice`. Returns only when
 * it already runs there, or with the status of a refusal.
 */
function rankAgentWork(mode: "--here" | "--dry-run"): number | undefined {
  let scope: string[] | null;
  try { scope = rankedScopeArgs(SELECTION_RANK[mode === "--here" ? "here" : "dry-run"]); } catch (error) { say((error as Error).message); return 2; }
  if (scope === null) return undefined;
  const execve = process.execve?.bind(process);
  if (execve === undefined) { say(`node ${process.version} cannot become another program (process.execve)`); return 2; }
  const systemdRun = spawnSync("sh", ["-c", "command -v systemd-run"], { encoding: "utf8" }).stdout.trim();
  if (!systemdRun) { say(`${mode} runs in a scope at an agent's rank, and systemd-run is not on PATH`); return 2; }
  execve(systemdRun, ["systemd-run", ...scope, process.execPath, ...process.execArgv, ...process.argv.slice(1)], process.env);
  return 2;
}

/** Why `--here` cannot start on `tree`'s installation catalog, or null when it is current or the tree installs nothing. */
export function catalogRefusal(root: string, tree: string): string | null {
  let state: ReturnType<typeof installationCatalogState>;
  try { state = installationCatalogState(root, tree); }
  catch (error) { return `--here cannot read this tree's installation catalog: ${(error as Error).message}`; }
  return state.state === "stale" ? `--here runs on this tree's installed packages, and ${state.message}` : null;
}

type HerePlan = { submitted: string; main: string; base: string; tip: string; historical: boolean; switchTree: boolean };

async function here(root: string, revision: string, traceRustInputs: boolean, issueBranch: string | undefined): Promise<number> {
  const ranked = rankAgentWork("--here");
  if (ranked !== undefined) return ranked;
  const tree = toplevel();
  const resource = GateResource.tryAcquire(`${tree}.lock`);
  if (!resource) { say(`--here cannot acquire the tree resource lock for ${tree}`); return 3; }
  const checkout = new HereCheckout(tree, resource);
  const abort = new AbortController();
  let finished!: () => void;
  const closed = new Promise<void>(resolve => { finished = resolve; });
  const unregister = registerCommandCloser('--here checkout', { cancel: reason => abort.abort(reason), close: () => closed });
  const runs = join(LANDING_HOME, 'runs');
  try {
    const record = hereRestore(tree);
    if (record) {
      checkout.recover(root, runs, record);
      say(`restored ${record.branch} at ${record.head} and its inputs in ${tree}`);
    }
    const sha = revParse({ root: tree }, revision);
    if (checkout.head() !== sha) { say(`--here runs in a tree at ${short(sha)}; this one is not`); return 2; }
    const dirty = checkout.dirty();
    if (dirty) { say(`--here checks the commit, and this tree has uncommitted changes:\n${dirty}`); return 2; }
    const refusal = catalogRefusal(root, tree);
    if (refusal) { say(refusal); return 2; }
    const git = { root }, main = revParse(git, 'refs/heads/main'), branch = checkout.branch();
    const replay = landingReplay(git, main, sha, issueBranch ?? (branch || null), say);
    // An explicit check of a main commit still measures that commit's own change.
    const historical = replay.state === 'already' && isAncestor(git, sha, main);
    if (replay.state !== 'check' && !historical) {
      say(replay.message);
      return replay.state === 'already' ? 0 : 1;
    }
    const tip = replay.state === 'check' ? replay.tip : sha;
    const base = historical ? revParse(git, `${sha}^`) : main;
    const switchTree = tip !== sha && treeOf(git, tip) !== treeOf(git, sha);
    if (switchTree && (!branch || branch === 'main' || !registeredRunTrees(POOL_HOME, [{ path: tree }]).length)) {
      say(`--here can replay ${sha} onto main ${main} only in a task's pool tree; current tree is ${tree}`);
      return 2;
    }
    // Selection hands its reservation to the build or the gate it chose.
    const hold = await holdSelection('here', tip, join(tree, 'target'), { report: say, signal: abort.signal });
    try { return await checkHere(root, checkout, { submitted: sha, main, base, tip, historical, switchTree }, branch, runs, hold, traceRustInputs, abort.signal); }
    finally { await closeSelection(hold); }
  } catch (error) {
    const recovery = existsSync(hereRestorePath(tree)) ? `; checkout protected by ${hereRestorePath(tree)}` : '';
    say(`--here: ${(error as Error).message}${recovery}`);
    return 2;
  } finally {
    try { resource.close(); } finally { finished(); unregister(); }
  }
}

async function checkHere(root: string, checkout: HereCheckout, plan: HerePlan, branch: string, runs: string, hold: Reservation, traceRustInputs: boolean, signal: AbortSignal): Promise<number> {
  const { tree } = checkout, { submitted, main, base, tip, historical, switchTree } = plan;
  const selected = ruleSelect(root, join(LANDING_HOME, "costs.json"), BUDGET)(base, tip, changedPaths({ root }, base, tip));
  const steps = landingSteps(selected.selection);
  reportRustRecordDecisions(selected.rustRecords,say);
  prune(runs, KEEP_DAYS);
  const run = join(runs, `here-${short(submitted)}-${Date.now()}`);
  if(traceRustInputs)snapshotCostHistory(historyFile({CARGO_TARGET_DIR:join(tree,'target')},tree),join(run,'observation-costs',COST_HISTORY_NAME));
  const context = `${submitted} as ${tip} ${historical ? `(own change from ${base}), current main` : 'on main'} ${main} in ${tree}`;
  const mainMoved = () => {
    const now = revParse({root}, 'refs/heads/main');
    if (now === main) return false;
    say(`held ${context}: main moved to ${now}; run again for that base`);
    return true;
  };
  if (mainMoved()) return 3;
  if (!steps.length) { say(`green ${context}: nothing to run`); return 0; }
  signal.throwIfAborted();
  const poolGuard = switchTree ? GateResource.tryAcquire(join(dirname(tree), '.operations.lock')) : null;
  if (switchTree && !poolGuard) { say(`held ${context}: another pool operation is running`); return 3; }
  let record;
  try {
    if (checkout.head() !== submitted || checkout.branch() !== branch || checkout.dirty()) throw Error(`the checkout changed while selecting steps in ${tree}`);
    const path = treeRunLockPath(tree), owner = liveTreeRunLock(path);
    if (owner) throw Error(`the gate runner (pid ${owner.pid}, logs ${owner.run}) owns ${path}`);
    if (switchTree) record = checkout.prepare(root, run, branch, submitted, tip);
  } finally { poolGuard?.close(); }
  const ran = await (async () => {
    try {
      if (record) checkout.mount(record);
      say(`checking ${context}: ${steps.join(' ')}, estimate ~${Math.round(selected.selection.estimate.seconds)} s; logs ${run}`);
      // The runner's evidence names the actual HEAD even when the replay only stamped the message.
      return await runLanding({ tree, target: join(tree, 'target'), run, commit: switchTree ? tip : submitted, steps, interop: selected.interop, doctests: selected.doctests,
        rustRecords: selected.rustRecords, priority: SELECTION_RANK.here, handover: hold, signal,
        ...(record ? { treeLock: checkout.resource.fd } : {}),
        ...(traceRustInputs ? { owned: { NTS_RUST_INPUT_TRACE: join(run, 'rust-inputs'), NTS_GATE_COSTS_DIR: join(run, 'observation-costs') } } : {}),
        ceiling: landingCeiling(selected.selection.estimate.seconds), env: process.env, hold: reason => say(`held: ${reason}`) });
    } finally { if (record) checkout.restore(root, record); }
  })();
  for (const s of ran.steps) console.log(`  ${s.verdict.padEnd(10)} ${s.name.padEnd(24)} ${s.wall !== undefined ? `${Math.round(s.wall)} s` : ""}${s.cpu !== undefined ? ` (cpu ${Math.round(s.cpu)} s)` : ""}${s.reason ? `  ${s.reason}` : ""}`);
  for (const line of [...ran.pending, ...ran.refresh]) console.log(`  ${line}`);
  if (mainMoved()) return 3;
  say(`${ran.state} in ${Math.round(ran.wall_s)} s: ${ran.message}; checked ${context}`);
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
  const [first, second] = argv.filter((arg, i) => !arg.startsWith("--") && !["--branch", "--note", "--costs"].includes(argv[i - 1] ?? ""));
  if(argv.includes('--trace-rust-inputs')&&(!argv.includes('--here')||argv.includes('--dry-run')||['status','serve','withdraw','retry'].includes(first??''))){
    say('--trace-rust-inputs is an observation of --here, never a queued verdict policy');return 2;
  }
  let root: string;
  try { root = sharedCheckout(); } catch (error) { say((error as Error).message); return 2; }
  if (first === "status") return reportLandingStatus(landingStatus(root,LANDING_HOME,Date.now()),argv.includes("--json")?{json:true}:{pool:new Pool(POOL_HOME,{root})});
  if (first === "serve") return serve(root);
  if (first === "withdraw" && second) { const done = new Queue(LANDING_HOME).withdraw(second); say(done === "unknown" ? `no queued, checked or held change is ${second}` : done === "requested" ? `${second}: cancellation requested; withdrawn only after its owned work drains, held if the drain cannot be proved` : done === "too-late" ? `${second}: too late to withdraw; publication has started` : `${second} withdrawn`); return done === "unknown" || done === "too-late" ? 1 : 0; }
  if (first === "retry" && second) { const entry = new Queue(LANDING_HOME).retry(second); say(`${entry.id} queued again, first; ${ensureService(root)}`); return 0; }
  if (!first || ["withdraw", "retry"].includes(first)) { console.error("usage: check.ts <commit> [--dry-run | --here [--trace-rust-inputs] | --no-wait] [--branch <name>] | status [--json] | withdraw <id|commit> | retry <id> | serve"); return 2; }
  const planning = argv.includes('--dry-run');
  try { if (!planning) assertLandingEnvironment(); } catch (error) { say((error as Error).message); return 2; }
  if (!planning && argv.includes('--here')) return here(root, first, argv.includes('--trace-rust-inputs'), option(argv, '--branch'));
  const tree = toplevel() || null;
  let sha: string;
  try {
    if (tree) assertNoHereRestore(tree);
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
