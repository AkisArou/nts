// The full check after landing (docs/workflow.md, "After landing: the full
// check"): one service, run by the systemd user unit nts-full-check (unit.ts),
// at low priority in its own tree and target under ~/.cache/nts-full-check.
//
//   node tooling/full-check/service.ts                     the loop the unit runs
//   node tooling/full-check/service.ts --once              one cycle, then exit
//   node tooling/full-check/service.ts --status            what it last did, and the task lines
//   options: --wide-at=10:00,16:00,22:00 --nightly-at=03:00   (local time; schedule.ts)
//            --bench-wait=240   minutes the nightly benchmarks wait for a quiet machine
//
// Each cycle does the first of these that is due:
//   1. the wide steps (owed.mjs's WIDE) on the newest `verified`, at a slot of
//      the schedule, if verified moved since their last run; at the nightly
//      slot the benchmarks follow on the same commit (bench.ts), if nts-bench
//      has not measured it yet;
//   2. the core (every other step of all.sh) on the newest `main`, if main
//      moved since the core's last run;
//   3. the count step (count.ts), once an hour, after the pool's upkeep
//      (tooling/landing/pool.ts's prune: free trees idle past its limit go).
//
// What follows a run:
//   - green core: refs/heads/verified moves to that commit and is pushed;
//   - red: culprit.ts finds the first red commit since that part's last green
//     run, and the service submits `git revert` of it to the landing queue,
//     first, and prints the task line for docs/plan.md (it never edits it);
//   - green, with pending or improved cases listed: records.ts writes them on
//     that commit's pin and submits the records commit;
//   - a benchmark run: nts-bench's results-only commit is submitted the same
//     way, and the rows full.md marks slower than their own best are a task;
//   - held (a step that could not finish): nothing moves; it runs again when
//     main moves, or after half an hour.
import { spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { memAvailableGB, RESUME_AT_GB } from "../gate/admission.ts";
import { gateEnvironment } from "../gate/canonical-environment.ts";
import { finishRunTemporary } from "../gate/run-temporary.ts";
import { sharedCheckout } from "../landing/git.ts";
import { linkInputs, Pool, POOL_HOME, pruneLines, type Inputs } from "../landing/pool.ts";
import { pruneNodeCompileCache, type NodeCacheRetention } from "./node-cache-retention.ts";
import { count as countMachine, countLines, gather, sweep as sweepLeftovers, type CountResult, type Removable } from "./count.ts";
import { search, type Measure, type Probe } from "./culprit.ts";
import { composeReverts, firstParents, Git, revertedBy, revertsIn } from "./git.ts";
import { pinnedGate, type Gate } from "./measure.ts";
import { landingQueue, submitTo, type LandingQueue } from "./queue.ts";
import { listedRecords, recordAt, recordsMessage, runPin, type Recorder } from "./records.ts";
import { makeRevert, taskLine, type Finding } from "./revert.ts";
import { benchWithLock, DEFAULT_QUIET_WAIT_MINUTES, FULL_MD, resultsCommit, slowerRows, type Bench } from "./bench.ts";
import { DEFAULT_SCHEDULE, dueSlot, parseTimes, type Schedule } from "./schedule.ts";
import { layout as defaultLayout, probeKey, readState, writeState, type Layout, type Part, type RunRecord, type State } from "./state.ts";

const HOUR = 3_600_000, DAY = 24 * HOUR;
/** Logs are evidence for three days (docs/workflow.md, The machine). */
export const KEEP_RUNS_MS = 3 * DAY;
const HELD_RETRY_MS = HOUR / 2;
const COUNT_EVERY_MS = HOUR;

export type Effects = {
  layout: Layout;
  /** Git in a tree of the repository: refs are shared by every worktree. */
  git: Git;
  gate: Gate;
  /** The landing check's queue (queue.ts). */
  queue: LandingQueue;
  recorder: Recorder;
  /** nts-bench on the tree, through the measurement lock (bench.ts). */
  bench: Bench;
  /** Where pins live (pin.ts's PINS). */
  pins: string;
  count: () => CountResult;
  /** Remove the leftovers the count found removable (count.ts's sweep), a line each. */
  sweep: (removable: readonly Removable[]) => string[];
  /** The pool's upkeep (pool.ts's prune), and the lines that say what it removed. */
  prunePool: () => string[];
  /** Recomputable cache upkeep, report-only, on the hourly count cycle. */
  pruneNodeCache: () => NodeCacheRetention;
  /** Push a commit to the remote's `verified`. */
  push: (commit: string) => { ok: boolean; line: string };
  /** Return once a heavy phase may start (AGENTS.md: 14 GB available). */
  admit: () => void;
  now: () => Date;
  log: (line: string) => void;
  schedule: Schedule;
};

const short = (sha: string) => sha.slice(0, 12);

/** One cycle: the first due piece of work, or nothing. */
export async function cycle(fx: Effects): Promise<Part | "benchmarks" | "count" | "idle"> {
  const state = readState(fx.layout.state);
  housekeeping(fx, state);
  const now = fx.now();
  const verified = fx.git.commit("refs/heads/verified");
  const slot = dueSlot(fx.schedule, state.wide.slot ? new Date(state.wide.slot) : undefined, now);
  if (slot) {
    state.wide.slot = now.toISOString();
    let did: "wide" | "benchmarks" | null = null;
    if (verified && verified !== state.wide.last_run?.commit) {
      fx.log(`wide steps due (${slot.nightly ? "the nightly run" : `the ${slot.at.toTimeString().slice(0, 5)} slot`}) on verified ${short(verified)}`);
      await runPart(fx, state, "wide", verified);
      did = "wide";
    } else fx.log(verified ? `wide steps due, but verified ${short(verified)} is where they last ran` : "wide steps due, but nothing is verified yet");
    if (slot.nightly && verified) {
      if (state.bench?.measured && state.bench.commit === verified) fx.log(`benchmarks: nts-bench already measured verified ${short(verified)}`);
      else { await runBenchmarks(fx, state, verified); did ??= "benchmarks"; }
    }
    writeState(fx.layout.state, state);
    if (did) return did;
  }
  const main = fx.git.commit("refs/heads/main");
  if (!main) throw new Error("no main");
  const last = state.core.last_run;
  if (main !== last?.commit || (last.verdict === "held" && now.getTime() - Date.parse(last.at) >= HELD_RETRY_MS)) {
    await runPart(fx, state, "core", main);
    return "core";
  }
  // A search that could not finish is taken up again; what it measured is kept.
  for (const part of ["core", "wide"] as const) {
    const red = state[part].last_run;
    if (red?.verdict === "red" && red.search?.result.startsWith("held") && now.getTime() - Date.parse(red.search.at) >= HELD_RETRY_MS) {
      await findCulprit(fx, state, part, red);
      writeState(fx.layout.state, state);
      return part;
    }
  }
  if (!state.count || now.getTime() - Date.parse(state.count.at) >= COUNT_EVERY_MS) {
    upkeepPool(fx);
    runCount(fx, state);
    return "count";
  }
  return "idle";
}

/** The steps a part runs at a commit, from that commit's own all.sh and owed.mjs. */
export function partSteps(part: Part, lists: { all: string[]; wide: string[] }): string[] {
  const wide = new Set(lists.wide);
  return part === "core" ? lists.all.filter(step => !wide.has(step)) : lists.all.filter(step => wide.has(step));
}

async function runPart(fx: Effects, state: State, part: Part, commit: string): Promise<void> {
  const at = fx.now().toISOString();
  let lists: { all: string[]; wide: string[] };
  try { lists = fx.gate.steps(commit); }
  catch (error) {
    held(fx, state, part, { commit, run: "", verdict: "held", at, failed: [], reason: `no step list: ${error instanceof Error ? error.message : String(error)}` });
    return;
  }
  const steps = partSteps(part, lists);
  // NTS_GATE_STEPS empty is every step: never let an empty list ask for that.
  if (!steps.length) {
    held(fx, state, part, { commit, run: "", verdict: "held", at, failed: [], reason: `${commit.slice(0, 12)} lists no ${part} steps` });
    return;
  }
  fx.admit();
  fx.log(`${part}: ${steps.length} step(s) at ${short(commit)} (${fx.git.subject(commit)})`);
  const m = fx.gate.run(commit, steps, part);
  const failed = steps.filter(step => m.steps[step] === "FAIL");
  const record: RunRecord = { commit, run: m.run, verdict: m.verdict, at, failed };
  if (m.verdict === "held") {
    record.reason = steps.filter(step => m.steps[step] === "HELD").map(step => `${step}: ${m.reasons[step]}`).join("; ");
    held(fx, state, part, record);
    return;
  }
  state[part].last_run = record;
  writeState(fx.layout.state, state);
  if (m.verdict === "green") {
    state[part].last_green = record;
    fx.log(`${part} green at ${short(commit)}; logs ${m.run}`);
    clearCulprits(fx, state, part, commit);
    if (part === "core") moveVerified(fx, state, commit);
    writeState(fx.layout.state, state);
    await writeRecords(fx, state, part, commit, m.run);
    return;
  }
  fx.log(`${part} RED at ${short(commit)}: ${failed.join(", ")}; logs ${m.run}`);
  await findCulprit(fx, state, part, record);
  writeState(fx.layout.state, state);
}

function held(fx: Effects, state: State, part: Part, record: RunRecord): void {
  state[part].last_run = record;
  writeState(fx.layout.state, state);
  fx.log(`${part} held at ${short(record.commit)}: ${record.reason}; nothing moves, and it runs again when main moves or in half an hour`);
}

function moveVerified(fx: Effects, state: State, commit: string): void {
  const old = fx.git.commit("refs/heads/verified");
  if (old !== commit) {
    if (old && !fx.git.isAncestor(old, commit)) {
      fx.log(`verified stays at ${short(old)}: ${short(commit)} does not descend from it`);
      return;
    }
    fx.git.run(["update-ref", "-m", "full check: the core is green", "refs/heads/verified", commit, old ?? "0".repeat(40)]);
    fx.log(`verified -> ${short(commit)}`);
  }
  pushVerified(fx, state);
}

function pushVerified(fx: Effects, state: State): void {
  const verified = fx.git.commit("refs/heads/verified");
  if (!verified || state.pushed === verified) return;
  if (state.push_failed_at && fx.now().getTime() - Date.parse(state.push_failed_at) < 10 * 60_000) return;
  const pushed = fx.push(verified);
  fx.log(pushed.line);
  if (pushed.ok) { state.pushed = verified; delete state.push_failed_at; }
  else state.push_failed_at = fx.now().toISOString();
}

function task(fx: Effects, state: State, line: string): void {
  state.tasks.push({ at: fx.now().toISOString(), line });
  state.tasks = state.tasks.slice(-50);
  fx.log(`TASK for docs/plan.md: ${line}`);
}

/** The red's culprit, its revert submitted first, and the task line. */
async function findCulprit(fx: Effects, state: State, part: Part, red: RunRecord): Promise<void> {
  red.search = { result: await searchAndRevert(fx, state, part, red), at: fx.now().toISOString() };
}

/** The search and what follows it; returns what it made of the red. */
async function searchAndRevert(fx: Effects, state: State, part: Part, red: RunRecord): Promise<string> {
  const good = state[part].last_green?.commit;
  if (!good) {
    task(fx, state, `- The full check's ${part} run is red at ${short(red.commit)} in ${red.failed.join(", ")} (${red.run}), and it has no green run to search from: fix it on main.`);
    return "no green run";
  }
  if (!fx.git.isAncestor(good, red.commit)) {
    fx.log(`no culprit search: the last green ${part} commit ${short(good)} is not an ancestor of ${short(red.commit)}`);
    return "no search: the last green run is not an ancestor";
  }
  const candidates = firstParents(fx.git, good, red.commit);
  const reverted = revertsIn(fx.git, candidates);
  const landed = landedReverts(fx.git, red.commit, state);
  // Every culprit found and not yet reverted on main, a revert that could not
  // be made included: taken out where it applies, so it hides no other.
  const pending = state.culprits.filter(c => !landed.has(c.commit)).map(c => c.commit);
  fx.log(`culprit search over ${candidates.length} commit(s) since ${short(good)} for ${red.failed.join(", ")}${pending.length ? `, taking out the pending reverts of ${pending.map(short).join(", ")}` : ""}`);
  const result = search({ good, candidates, steps: red.failed, pending, reverted }, probe(fx, state, part));
  const runs = result.probes.map(p => p.run).filter(Boolean);
  switch (result.kind) {
    case "flaky":
      task(fx, state, `- ${red.failed.join(", ")} went red once in the full check's ${part} run at ${short(red.commit)} (${red.run}) and green when measured again: a flaky step.`);
      return "flaky";
    case "explained":
      fx.log(`the red at ${short(red.commit)} is explained: it is green with the pending reverts taken out`);
      return "explained by pending reverts";
    case "held":
      fx.log(`culprit search held: ${result.reason}; it is taken up again in half an hour`);
      return `held: ${result.reason}`;
    case "ambiguous":
      task(fx, state, `- One of ${result.commits.map(short).join(", ")} turned ${result.failed.join(", ")} red in the full check's ${part} run (${red.run}); the search could not measure between them: find and revert it by hand.`);
      return `ambiguous: ${result.commits.map(short).join(" ")}`;
    case "culprit": {
      const finding: Finding = {
        part, culprit: result.commit, subject: fx.git.subject(result.commit), steps: result.failed, run: red.run,
        tip: red.commit, good, candidates: candidates.length, probes: runs,
      };
      if (result.flaky.length) fx.log(`also red at ${short(red.commit)} once, green when measured again: ${result.flaky.join(", ")}`);
      await revertCulprit(fx, state, finding);
      return `culprit ${short(result.commit)}`;
    }
  }
}

async function revertCulprit(fx: Effects, state: State, finding: Finding): Promise<void> {
  if (state.culprits.some(c => c.commit === finding.culprit)) {
    fx.log(`${short(finding.culprit)} was already found; its revert is on the way`);
    return;
  }
  const main = fx.git.commit("refs/heads/main")!;
  const made = makeRevert(fx.git, main, finding);
  if ("conflict" in made) {
    state.culprits.push({ commit: finding.culprit, part: finding.part, steps: finding.steps, run: finding.run, found_at: fx.now().toISOString(), revert: null, reason: made.conflict });
    task(fx, state, taskLine(finding, null, made.conflict));
    return;
  }
  // Reachable until it lands: the queue holds a commit, not a branch.
  fx.git.run(["update-ref", `refs/full-check/reverts/${short(finding.culprit)}`, made.commit]);
  const submitted = await submitTo(fx.queue, made.commit, { first: true });
  fx.log(`revert ${short(made.commit)} of ${short(finding.culprit)}: ${submitted.line}`);
  state.culprits.push({ commit: finding.culprit, part: finding.part, steps: finding.steps, run: finding.run, found_at: fx.now().toISOString(), revert: made.commit, ...(submitted.submitted ? {} : { reason: submitted.line }) });
  task(fx, state, taskLine(finding, made.commit));
}

/** The probe the search measures with: a composition, its steps, cached per step. */
function probe(fx: Effects, state: State, part: Part): Measure {
  return (base, reverts, steps, fresh) => {
    const key = probeKey(base, reverts);
    if (!fresh) {
      const cached = steps.map(step => state.probes.find(p => p.key === key && p.step === step));
      if (cached.every(Boolean)) {
        const failed = steps.filter((_, k) => cached[k]!.verdict === "red");
        return { base, reverts, steps, verdict: failed.length ? "red" : "green", failed, run: cached[0]!.run };
      }
    }
    const result = (verdict: Probe["verdict"], run: string, failed: string[] = [], reason?: string): Probe =>
      ({ base, reverts, steps, verdict, failed, run, ...(reason ? { reason } : {}) });
    // Each pending revert is taken out where it applies. One that does not
    // apply here stays in, and is said so: it cannot hide another culprit it
    // cannot be taken out from, and holding the search for it would hold
    // every later search too.
    let commit = base, applying = [...reverts];
    while (applying.length) {
      const composed = composeReverts(fx.git, base, applying, culprit => `full check: ${short(base)} without ${short(culprit)}\n\nThis reverts commit ${culprit}.\n`);
      if (!("conflict" in composed)) { commit = composed.commit; break; }
      fx.log(`measuring ${short(base)} with ${short(composed.culprit)} in: ${composed.conflict}`);
      applying = applying.filter(culprit => culprit !== composed.culprit);
    }
    let all: string[];
    try { all = fx.gate.steps(commit).all; }
    catch (error) { return result("skip", "", [], error instanceof Error ? error.message : String(error)); }
    // A step the commit does not have is not red there: a step added red is
    // found at the commit that added it.
    const present = steps.filter(step => all.includes(step));
    if (!present.length) return result("green", "", []);
    fx.admit();
    const m = fx.gate.run(commit, present, `${part}-probe`);
    const at = fx.now().toISOString();
    for (const step of present) {
      const verdict = m.steps[step] === "PASS" ? "green" : m.steps[step] === "FAIL" ? "red" : null;
      if (!verdict) continue;
      state.probes = state.probes.filter(p => !(p.key === key && p.step === step));
      state.probes.push({ key, step, verdict, run: m.run, at });
    }
    writeState(fx.layout.state, state);
    const failed = present.filter(step => m.steps[step] === "FAIL");
    if (failed.length) return result("red", m.run, failed);
    if (present.every(step => m.steps[step] === "PASS")) return result("green", m.run);
    return result("skip", m.run, [], present.filter(step => m.steps[step] === "HELD").map(step => `${step}: ${m.reasons[step]}`).join("; "));
  };
}

/** Culprits whose revert is on `tip`'s first-parent history since the culprit. */
function landedReverts(git: Git, tip: string, state: State): Set<string> {
  const landed = new Set<string>();
  for (const culprit of new Set(state.culprits.map(c => c.commit))) {
    if (!git.isAncestor(culprit, tip)) continue;
    const messages = git.run(["log", "--first-parent", "--format=%B", `${culprit}..${tip}`]);
    if (revertedBy(messages).includes(culprit)) landed.add(culprit);
  }
  return landed;
}

async function writeRecords(fx: Effects, state: State, part: Part, commit: string, run: string): Promise<void> {
  if (state.records?.commit === commit) return;
  const listed = listedRecords(run);
  if (!listed.pending.length && !listed.improved.length) return;
  fx.log(`records: ${listed.pending.length} pending and ${listed.improved.length} improved case(s) listed at ${short(commit)}`);
  const at = fx.now().toISOString();
  try {
    fx.admit();
    const pin = runPin(fx.pins, commit, fx.git.subject(commit), join(fx.layout.target, "release/nts"), run);
    const tree = new Git(fx.layout.tree, fx.git.env);
    const recorded = recordAt(tree, commit, (dir) => fx.recorder(dir, pin, run), recordsMessage(commit, part, run, pin, listed));
    if (recorded.status !== 0) fx.log(`record-pending exited ${recorded.status}; see ${join(run, RECORDER_LOG)}`);
    if (recorded.kind !== "committed") {
      state.records = { commit, at, submitted: null, result: recorded.kind === "refused" ? `wrote only outside the records: ${recorded.refused.join(", ")}` : "recorded nothing" };
      fx.log(`records: ${state.records.result}`);
      if (recorded.kind === "refused" || recorded.status !== 0) task(fx, state, `- record-pending.ts at ${short(commit)} ${recorded.kind === "refused" ? `wrote outside the records (${recorded.refused.join(", ")})` : `exited ${recorded.status}`}; see ${run}.`);
      return;
    }
    fx.git.run(["update-ref", `refs/full-check/records/${short(commit)}`, recorded.commit]);
    const submitted = await submitTo(fx.queue, recorded.commit, { first: false });
    fx.log(`records ${short(recorded.commit)} (${recorded.files.length} file(s)): ${submitted.line}`);
    if (recorded.refused.length) task(fx, state, `- record-pending.ts at ${short(commit)} also wrote outside the records (${recorded.refused.join(", ")}); see ${run}.`);
    state.records = { commit, at, submitted: submitted.submitted ? recorded.commit : null, result: submitted.line };
  } catch (error) {
    state.records = { commit, at, submitted: null, result: `failed: ${error instanceof Error ? error.message : String(error)}` };
    fx.log(`records: ${state.records.result}`);
  } finally {
    writeState(fx.layout.state, state);
  }
}

/**
 * nts-bench on `verified`, built by pinned.sh in the full check's tree (its
 * `build` step: nts-bench links the compiler crates, so it is built from the
 * commit it measures), and its results-only commit submitted.
 */
async function runBenchmarks(fx: Effects, state: State, verified: string): Promise<void> {
  const at = fx.now().toISOString();
  const attempt = (run: string, result: string, measured: boolean, submitted: string | null = null) => {
    state.bench = { commit: verified, at, run, result, submitted, measured };
    fx.log(`benchmarks at ${short(verified)}: ${result}`);
    writeState(fx.layout.state, state);
  };
  fx.admit();
  const built = fx.gate.run(verified, ["build"], "bench-build");
  if (built.verdict !== "green") return attempt(built.run, `not run: the build at verified is ${built.verdict}`, false);
  const run = join(fx.layout.runs, `bench-${short(verified)}-${Date.parse(at)}`);
  mkdirSync(run, { recursive: true });
  fx.log(`benchmarks: nts-bench on verified ${short(verified)}, once the machine is quiet; logs ${run}`);
  const measured = fx.bench(fx.layout.tree, run);
  if (!measured.quiet) return attempt(run, "not run: the machine was not quiet in time; the next nightly slot tries again", false);
  const tree = new Git(fx.layout.tree, fx.git.env);
  const found = resultsCommit(tree, verified);
  if ("none" in found) {
    attempt(run, `nts-bench exited ${measured.status}: ${found.none}`, true);
    task(fx, state, `- The nightly benchmark run at ${short(verified)} kept no run record (nts-bench exited ${measured.status}: ${found.none}); see ${run}.`);
    return;
  }
  fx.git.run(["update-ref", `refs/full-check/benchmarks/${short(verified)}`, found.commit]);
  const submitted = await submitTo(fx.queue, found.commit, { first: false });
  attempt(run, `run record ${short(found.commit)}${measured.status ? ` (nts-bench exited ${measured.status})` : ""}: ${submitted.line}`, true, submitted.submitted ? found.commit : null);
  const slower = slowerRows(tree.run(["show", `${found.commit}:${FULL_MD}`]));
  if (slower.length) task(fx, state, `- ${slower.length} benchmark row(s) slower than their own best in the nightly run at ${short(verified)}: ${slower.join(", ")} (${FULL_MD}); measure each before calling it a regression.`);
}

function runCount(fx: Effects, state: State): void {
  try {
    const cache = fx.pruneNodeCache();
    fx.log(`Node compile cache: ${cache.state}, removed ${cache.removed} entries / ${cache.removedBytes} bytes, kept ${cache.keptBytes} bytes`);
    for (const error of cache.errors) fx.log(`Node compile cache warning: ${error}`);
  } catch (error) { fx.log(`Node compile cache warning: ${String(error)}`); }
  let result: CountResult;
  try {
    result = fx.count();
    // The three kinds of leftover the full check removes itself; what is left is
    // counted again, so the count says what remains.
    if (result.removable.length) {
      for (const line of fx.sweep(result.removable)) fx.log(line);
      result = fx.count();
    }
  }
  catch (error) { result = { verdict: "INSTRUMENT", red: [], notes: [`not counted: ${error instanceof Error ? error.message : String(error)}`], removable: [] }; }
  state.count = { at: fx.now().toISOString(), verdict: result.verdict, lines: [...result.red, ...result.notes] };
  for (const line of countLines(result)) fx.log(line);
  writeState(fx.layout.state, state);
}

/** The pool's hourly upkeep, before the count reads the machine; a failure is a line, never a stopped cycle. */
function upkeepPool(fx: Effects): void {
  let lines: string[];
  try { lines = fx.prunePool(); }
  catch (error) { lines = [`pool: upkeep failed: ${error instanceof Error ? error.message : String(error)}`]; }
  for (const line of lines) fx.log(line);
}

/**
 * The refs that keep a submitted revert or records commit reachable go once
 * main holds it -- the landing check rebases a commit, so it is found by its
 * subject after its parent -- or after a week, when the queue let it go.
 */
function dropLandedRefs(fx: Effects, main: string, now: number): void {
  const refs = fx.git.run(["for-each-ref", "--format=%(refname) %(objectname) %(committerdate:unix)", "refs/full-check/"]).split("\n").filter(Boolean);
  for (const line of refs) {
    const [ref, sha, when] = line.split(" ") as [string, string, string];
    const parent = fx.git.commit(`${sha}^`);
    const landed = !!parent && fx.git.isAncestor(parent, main)
      && fx.git.run(["log", "--first-parent", "--format=%s", `${parent}..${main}`]).split("\n").includes(fx.git.subject(sha));
    const stale = now - Number(when) * 1000 > 7 * DAY;
    if (!landed && !stale) continue;
    fx.git.run(["update-ref", "-d", ref, sha]);
    fx.log(`${ref} ${landed ? "landed" : "did not land in a week"}; its ref is gone`);
  }
}

/**
 * A culprit its own part is green after is no culprit: the steps it broke
 * pass with it in. It is in no later search, and its revert, if it still
 * waits to land, is withdrawn at once, since landing it would take out a
 * commit this run just showed is good. The other part's runs do not keep it:
 * a part that never goes green (the wide steps had no green run on
 * 2026-11-08) held a false culprit, and its revert in the queue, overnight. If
 * the commit breaks the other part's steps too, that part's own search finds it.
 */
function clearCulprits(fx: Effects, state: State, part: Part, green: string): void {
  state.culprits = state.culprits.filter(culprit => {
    if (culprit.part !== part || !fx.git.isAncestor(culprit.commit, green)) return true;
    const withdrawn = culprit.revert ? fx.queue.withdraw(culprit.revert) : "unknown";
    fx.log(`${short(culprit.commit)} is no culprit: ${culprit.part} was green after it at ${short(green)}${
      withdrawn === "unknown" ? "" : `; its revert ${short(culprit.revert!)} is ${withdrawn === "withdrawn" ? "withdrawn" : "withdrawn when its check ends"}`}`);
    return false;
  });
}

/** Old runs and probes go; landed reverts lose the ref that kept them; verified is pushed. */
function housekeeping(fx: Effects, state: State): void {
  const now = fx.now().getTime();
  const kept = new Set([state.core.last_run?.run, state.wide.last_run?.run, state.core.last_green?.run, state.wide.last_green?.run]);
  if (existsSync(fx.layout.runs)) {
    // run.mjs points runs/latest at its newest run; a link is judged by its own age.
    for (const name of readdirSync(fx.layout.runs)) {
      const path = join(fx.layout.runs, name);
      if (!kept.has(path) && now - lstatSync(path).mtimeMs > KEEP_RUNS_MS) rmSync(path, { recursive: true, force: true });
    }
  }
  state.probes = state.probes.filter(p => now - Date.parse(p.at) <= 7 * DAY);
  const main = fx.git.commit("refs/heads/main");
  if (main) {
    dropLandedRefs(fx, main, now);
  }
  pushVerified(fx, state);
  writeState(fx.layout.state, state);
}

// ---------------------------------------------------------------------------
// The production effects, the loop and the command line.
// ---------------------------------------------------------------------------
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function stamp(line: string): void {
  process.stdout.write(`${new Date().toISOString()} ${line}\n`);
}

/** The last `bytes` of a file, without reading the rest. */
function tail(file: string, bytes = 1 << 16): string {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size, length = Math.min(size, bytes), buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    return buffer.toString("utf8");
  } finally { closeSync(fd); }
}

/**
 * The recorder's log in a run's folder. Not `records.log`: that is the core
 * run's own `records` step's log, which the recorder would overwrite.
 */
export const RECORDER_LOG = "record-pending.log";

/**
 * record-pending.ts in the tree at the run's commit, with the run's pin, in the
 * gate's canonical environment, as every step of the full check runs: the
 * recorders prepare and run oracles, which need its dependency capability
 * (NTS_ORACLE_DEPENDENCIES) and a temporary folder the run owns. Outside it the
 * outcomes recorder refused at 7cb136996c17 ("capability ... is missing").
 * Its output goes to the run's RECORDER_LOG as it comes. It used to be captured
 * whole and written after: at 2df45c6ebdb5 the recorders printed 1.7 million
 * lines, past the 256 MiB buffer, and spawnSync killed record-pending (ENOBUFS)
 * before its later kinds ran. The result's output is the log's tail.
 */
export const recordPending: Recorder = (tree, pin, run) => {
  const script = join(tree, "tooling/records/record-pending.ts");
  if (!existsSync(script)) return { status: 2, output: `no tooling/records/record-pending.ts at this commit` };
  const log = join(run, RECORDER_LOG);
  const planned = gateEnvironment(process.env, { run: join(run, "records"), owned: { NTS_BIN: pin, NTS_CHECKERS: "1" }, oracleRoot: tree });
  const out = openSync(log, "w");
  let r: ReturnType<typeof spawnSync>;
  try {
    r = spawnSync(process.execPath, [script], { cwd: tree, stdio: ["ignore", out, out], env: planned.env });
  } finally { closeSync(out); }
  if (r.error) appendFileSync(log, `\n${r.error.message}\n`);
  // Its temporary folder goes either way: a refused recording keeps its
  // evidence in the recorder's own folder, which the log names.
  finishRunTemporary(planned.temporary, homedir(), true);
  return { status: r.status ?? 1, output: tail(log) };
};

/** Wait, without spinning, until MemAvailable reaches the threshold AGENTS.md sets. */
export function admitWhenMemory(log: (line: string) => void, read = memAvailableGB): () => void {
  return () => {
    let said = false;
    const nap = new Int32Array(new SharedArrayBuffer(4));
    for (;;) {
      const gb = read();
      if (gb === null || gb >= RESUME_AT_GB) return;
      if (!said) { log(`waiting for memory: ${gb.toFixed(1)} GB available, ${RESUME_AT_GB} needed to start`); said = true; }
      Atomics.wait(nap, 0, 0, 30_000);
    }
  };
}

function production(options: { schedule: Schedule; quietWait: number }): Effects {
  const layout = defaultLayout();
  mkdirSync(layout.runs, { recursive: true });
  const git = new Git(ROOT);
  return {
    layout, git,
    gate: pinnedGate(layout, ROOT, stamp),
    queue: landingQueue(),
    recorder: recordPending,
    bench: benchWithLock(ROOT, layout.target, options.quietWait),
    pins: process.env.NTS_PINS ?? join(homedir(), ".cache/nts-pins"),
    count: () => countMachine(gather(ROOT)),
    sweep: removable => sweepLeftovers(removable, join(homedir(), ".cache")),
    prunePool: () => pruneLines(new Pool(POOL_HOME, { root: sharedCheckout(ROOT) }).prune()),
    pruneNodeCache: () => pruneNodeCompileCache(),
    push: commit => {
      const r = git.try(["push", "--quiet", "origin", `${commit}:refs/heads/verified`]);
      return r.status === 0 ? { ok: true, line: `pushed verified ${short(commit)} to origin` } : { ok: false, line: `could not push verified ${short(commit)}: ${r.stderr.trim()}; trying again next cycle` };
    },
    admit: admitWhenMemory(stamp),
    now: () => new Date(),
    log: stamp,
    schedule: options.schedule,
  };
}

/** One service at a time: a lock directory naming its holder, taken over from a dead one. */
function takeLock(lock: string): void {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, "pid"), String(process.pid));
      process.on("exit", () => { try { if (readFileSync(join(lock, "pid"), "utf8") === String(process.pid)) rmSync(lock, { recursive: true, force: true }); } catch {} });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let holder = 0;
      try { holder = Number(readFileSync(join(lock, "pid"), "utf8")); } catch {}
      let alive = false;
      try { if (holder) { process.kill(holder, 0); alive = true; } } catch (e) { alive = (e as NodeJS.ErrnoException).code === "EPERM"; }
      if (alive) throw new Error(`the full check is already running (pid ${holder}, ${lock})`);
      rmSync(lock, { recursive: true, force: true });
    }
  }
  throw new Error(`could not take ${lock}`);
}

let unfollowed: string | undefined;
/**
 * The unit runs the service from its controller tree, at `verified`: code
 * that passed the full check runs the full check. When verified moves past it,
 * the tree follows and the service exits, so systemd starts the new code. The
 * new code gets the inputs no commit carries, linked again after the checkout
 * (inputs.sh): without them it cannot even list its steps. A commit whose
 * inputs cannot be linked is not followed; the tree goes back to the code it
 * ran, and says so once.
 */
export function followVerified(git: Git, layout: Layout, root = ROOT, inputs?: Inputs): boolean {
  if (resolve(root) !== resolve(layout.controller)) return false;
  const verified = git.commit("refs/heads/verified"), head = git.commit("HEAD");
  if (!verified || !head || verified === head || !git.isAncestor(head, verified)) return false;
  if (git.run(["status", "--porcelain", "--untracked-files=no"])) return false;
  const link = inputs ?? linkInputs(sharedCheckout(layout.controller));
  git.run(["checkout", "--detach", "-q", verified]);
  try { link(layout.controller); }
  catch (error) {
    git.run(["checkout", "--detach", "-q", head]);
    let back = "";
    try { link(layout.controller); } catch (again) { back = `; its own inputs could not be linked again either: ${again instanceof Error ? again.message : String(again)}`; }
    if (unfollowed !== verified) stamp(`the controller stays at ${short(head)}: verified ${short(verified)}'s inputs could not be linked: ${error instanceof Error ? error.message : String(error)}${back}`);
    unfollowed = verified;
    return false;
  }
  stamp(`the controller moved to verified ${short(verified)}; restarting on its code`);
  return true;
}

function statusLines(state: State): string[] {
  const run = (r?: RunRecord) => r ? `${r.verdict} at ${short(r.commit)} (${r.at})${r.failed.length ? `: ${r.failed.join(", ")}` : ""}${r.reason ? `: ${r.reason}` : ""}; ${r.run}` : "none";
  return [
    `core: last ${run(state.core.last_run)}`, `      green ${run(state.core.last_green)}`,
    `wide: last ${run(state.wide.last_run)}`, `      green ${run(state.wide.last_green)}`,
    `verified pushed: ${state.pushed ? short(state.pushed) : "never"}`,
    `culprits: ${state.culprits.map(c => `${short(c.commit)} (${c.steps.join(", ")}) revert ${c.revert ? short(c.revert) : "none"}${c.reason ? ` -- ${c.reason}` : ""}`).join("; ") || "none"}`,
    `records: ${state.records ? `${short(state.records.commit)} ${state.records.result}` : "none"}`,
    `benchmarks: ${state.bench ? `${short(state.bench.commit)} at ${state.bench.at}: ${state.bench.result}; ${state.bench.run}` : "none"}`,
    `count: ${state.count ? `${state.count.verdict} at ${state.count.at}, ${state.count.lines.length} line(s)` : "never"}`,
    ...state.count?.lines.map(line => `  ${line}`) ?? [],
    "tasks for docs/plan.md:", ...state.tasks.map(t => `  ${t.at} ${t.line}`),
  ];
}

export function parseOptions(argv: readonly string[]): { once: boolean; status: boolean; schedule: Schedule; quietWait: number } {
  const schedule = { ...DEFAULT_SCHEDULE };
  let once = false, status = false, quietWait = DEFAULT_QUIET_WAIT_MINUTES;
  for (const arg of argv) {
    if (arg === "--once") once = true;
    else if (arg === "--status") status = true;
    else if (/^--bench-wait=\d+$/.test(arg)) quietWait = Number(arg.slice(13));
    else if (arg.startsWith("--wide-at=")) schedule.wide = parseTimes(arg.slice(10));
    else if (arg.startsWith("--nightly-at=")) {
      const [nightly, ...rest] = parseTimes(arg.slice(13));
      if (!nightly || rest.length) throw new Error("--nightly-at takes one time of day");
      schedule.nightly = nightly;
    } else throw new Error(`unknown argument ${arg}; usage: service.ts [--once | --status] [--wide-at=HH:MM,...] [--nightly-at=HH:MM] [--bench-wait=<minutes>]`);
  }
  return { once, status, schedule, quietWait };
}

async function main(argv: readonly string[]): Promise<number> {
  const options = parseOptions(argv);
  const layout = defaultLayout();
  if (options.status) {
    console.log(statusLines(readState(layout.state)).join("\n"));
    return 0;
  }
  mkdirSync(layout.home, { recursive: true });
  takeLock(layout.lock);
  const fx = production(options);
  stamp(`full check: core on main, wide steps at ${options.schedule.wide.join(", ")} and ${options.schedule.nightly} nightly with the benchmarks (waiting up to ${options.quietWait} min for quiet); tree ${layout.tree}`);
  const nap = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    if (followVerified(fx.git, layout)) return 0;
    let did: Awaited<ReturnType<typeof cycle>>;
    try { did = await cycle(fx); }
    catch (error) {
      // A cycle that cannot run says why and waits, rather than restarting in a loop.
      stamp(`cycle failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      if (options.once) return 1;
      Atomics.wait(nap, 0, 0, 5 * 60_000);
      continue;
    }
    if (options.once) return 0;
    if (did === "idle") Atomics.wait(nap, 0, 0, 60_000);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
    stamp(`full check stopped: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
