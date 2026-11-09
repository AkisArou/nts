// The full check after landing (docs/workflow.md, "After landing: the full
// check"): one service, run by the systemd user unit nts-full-check (unit.ts),
// at low priority in its own tree and target under ~/.cache/nts-full-check.
// What takes hours beside it runs in units of its own (background.ts): each
// part's records run, which the controller starts and adopts by name, and the
// hourly count, which its own timer starts.
//
//   node tooling/full-check/service.ts                     the loop the unit runs
//   node tooling/full-check/service.ts --once              one cycle, then exit
//   node tooling/full-check/service.ts --status [--json]   what it is doing, what it last did, and the task lines
//   node tooling/full-check/service.ts --count             the hourly count once, written to its own file (the timer's command)
//   node tooling/full-check/service.ts --record=<part> --commit=<sha> --run=<dir> --pin=<nts> --outcome=<file>
//                                                          a records unit's work, in the records tree it runs from (recordsUnit)
//   options: --wide-at=10:00,16:00,22:00 --nightly-at=03:00   (local time; schedule.ts)
//
// Each cycle does the first of these that is due:
//   0. a part's records unit that ended, what it recorded applied on the
//      newest main and submitted; or a records commit the landing check
//      refused or held, its delta applied again on the newest main and
//      submitted (seconds; followRecords). A records unit still running holds
//      nothing: the cycle goes on;
//   1. the wide steps (owed.mjs's WIDE) on the newest `verified`, at a slot of
//      the schedule, if verified moved since their last run; the nightly slot
//      also makes the benchmarks due (bench.ts), whatever wide slot came after
//      it, if nts-bench has not measured verified yet;
//   2. the core (every other step of all.sh) on the newest `main`, if main
//      moved since the core's last run;
//   3. due benchmarks on the newest `verified`, admitted by the measurement
//      lock once CPU 4 and its sibling 5 are quiet: an attempt the lock does
//      not admit keeps them due, asked again ten minutes later, until they run
//      or the next nightly slot replaces them.
//
// What follows a run:
//   - green core: refs/heads/verified moves to that commit and is pushed;
//   - red: culprit.ts finds the first red commit since that part's last green
//     run, and the service submits `git revert` of it to the landing queue,
//     first, and reopens the culprit's issue with a comment (revert.ts); a
//     culprit that names no issue gets a task line for an issue instead;
//   - green, with pending cases or accepted changes listed: the part's records
//     unit records them at that commit with its pin, the part's own kinds
//     only, in the part's records tree, while the core goes on; once it ends,
//     their delta is applied case by case on the newest main and that records
//     commit submitted; each cycle then follows it until the landing check
//     lands it, applying the delta again on the newest main after a refusal,
//     a few times at most;
//   - a benchmark run: nts-bench's results-only commit is submitted the same
//     way, and the rows full.md marks slower than their own best are a task;
//   - held (a step that could not finish): nothing moves; it runs again when
//     main moves, or after half an hour.
//
// The records unit's command line (--record and its values) and its outcome
// (RecordsOutcome) are a cross-version contract: the unit runs its records
// tree's code, the run's commit, while the controller that starts it runs
// `verified`'s, which is the same or older, and a controller restarted on
// newer code may start it once more or read what it wrote.
import { spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {candidateCommand} from '../landing/candidate-environment.ts';
import {launcherEnvironment} from '../landing/run.ts';
import {nodePin} from '../bootstrap/node.ts';
import { gateCpus, inheritedCpus } from "../gate/affinity.ts";
import { GateResource } from "../gate/gate-resource.ts";
import {nodeToolchain} from '../gate/toolchain.ts';
import { sharedCheckout } from "../landing/git.ts";
import { linkInputs, Pool, POOL_HOME, pruneLines, type Inputs } from "../landing/pool.ts";
import { prepareTree } from "../landing/service.ts";
import { look, newJob, start, startAgain, systemdUnits, writeOutcome, type Outcome, type Seen, type Units, type UnitSpec } from "./background.ts";
import { pruneNodeCompileCache, type NodeCacheRetention } from "./node-cache-retention.ts";
import { count as countMachine, countLines, gather, sweep as sweepLeftovers, type CountResult, type Removable } from "./count.ts";
import { search, type Measure, type Probe } from "./culprit.ts";
import { composeReverts, firstParents, Git, revertedBy, revertsIn } from "./git.ts";
import { pinnedGate, type Gate } from "./measure.ts";
import { landedTimes, landingQueue, submitTo, type LandingQueue } from "./queue.ts";
import { applyAt, applyRecords, recordAt, recordsMessage, runPin, type Applier, type Recorder } from "./records.ts";
import { appliedIn, countsText, DELTA_FILE, parseDelta } from "../records/delta.ts";
import { listedIn, type Listed } from "../records/pending.ts";
import { ghIn, issueComment, makeRevert, reopenIssue, taskLine, type Finding } from "./revert.ts";
import { issuesNamed } from "../tasks/links.ts";
import { benchWithLock, FULL_MD, resultsCommit, slowerRows, type Bench, type BenchAttempt } from "./bench.ts";
import { DEFAULT_SCHEDULE, dueNightly, dueSlot, nextNightly, parseTimes, type Schedule } from "./schedule.ts";
import { layout as defaultLayout, PARTS, probeKey, readCount, readState, writeCount, writeState, type BenchRun, type CountRecord, type Culprit, type Doing, type Layout, type Part, type PartState, type RecordsRun, type RunRecord, type State } from "./state.ts";
import { lowPriority, recordsUnitName } from "./unit.ts";

const HOUR = 3_600_000, DAY = 24 * HOUR;
/** Logs are evidence for three days (docs/workflow.md, The machine). */
export const KEEP_RUNS_MS = 3 * DAY;
const HELD_RETRY_MS = HOUR / 2;

export type Effects = {
  layout: Layout;
  /** Git in a tree of the repository: refs are shared by every worktree. */
  git: Git;
  gate: Gate;
  /** The landing check's queue (queue.ts). */
  queue: LandingQueue;
  /** The units the full check's background work runs in: each part's records unit (background.ts). */
  units: Units;
  /** The Node a tree's own code runs on: the one its .tool-versions pins. */
  node: (tree: string) => string;
  /** One of the full check's trees at a commit, set up as pinned.sh sets a gate tree up: checked out, cleaned, its inputs linked. */
  checkout: (tree: string, commit: string) => void;
  /** main's own record-pending.ts --apply in a part's records tree at main (records.ts). */
  applier: Applier;
  /** nts-bench on the tree, through the measurement lock (bench.ts). */
  bench: Bench;
  /** Where pins live (pin.ts's PINS). */
  pins: string;
  /** Push a commit to the remote's `verified`. */
  push: (commit: string) => { ok: boolean; line: string };
  /** Comment on GitHub issue `n` and reopen it (revert.ts's reopenIssue). */
  issue: (n: number, comment: string) => { ok: boolean; line: string };
  now: () => Date;
  log: (line: string) => void;
  schedule: Schedule;
};

const short = (sha: string) => sha.slice(0, 12);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** One cycle: the first due piece of work, or nothing. */
export async function cycle(fx: Effects): Promise<Part | "records" | "benchmarks" | "idle"> {
  const state = readState(fx.layout.state);
  housekeeping(fx, state);
  interruptedBenchmarks(fx, state);
  if (await followRecords(fx, state)) return "records";
  const now = fx.now();
  const verified = fx.git.commit("refs/heads/verified");
  // Answered on its own: a cycle that first gets to the night after a later
  // wide slot still makes it due. A state that never answered one starts
  // here, and its first night is the next slot.
  if (!state.nightly) { state.nightly = now.toISOString(); writeState(fx.layout.state, state); }
  const night = dueNightly(fx.schedule, new Date(state.nightly), now);
  if (night) answerNightly(fx, state, night, verified);
  const slot = dueSlot(fx.schedule, state.wide.slot ? new Date(state.wide.slot) : undefined, now);
  if (slot) {
    state.wide.slot = now.toISOString();
    let did: "wide" | null = null;
    if (verified && verified !== state.wide.last_run?.commit) {
      fx.log(`wide steps due (${slot.nightly ? "the nightly run" : `the ${slot.at.toTimeString().slice(0, 5)} slot`}) on verified ${short(verified)}`);
      holds(state, `the wide steps on verified ${short(verified)} go first`);
      await runPart(fx, state, "wide", verified);
      did = "wide";
    } else fx.log(verified ? `wide steps due, but verified ${short(verified)} is where they last ran` : "wide steps due, but nothing is verified yet");
    writeState(fx.layout.state, state);
    if (did) return did;
  }
  const main = fx.git.commit("refs/heads/main");
  if (!main) throw new Error("no main");
  const last = state.core.last_run;
  if (main !== last?.commit || (last.verdict === "held" && now.getTime() - Date.parse(last.at) >= HELD_RETRY_MS)) {
    holds(state, `the core on main ${short(main)} goes first`);
    await runPart(fx, state, "core", main);
    return "core";
  }
  // A search that could not finish is taken up again; what it measured is kept.
  for (const part of ["core", "wide"] as const) {
    const red = state[part].last_run;
    if (red?.verdict === "red" && red.search?.result.startsWith("held") && now.getTime() - Date.parse(red.search.at) >= HELD_RETRY_MS) {
      holds(state, `the ${part} culprit search goes first`);
      await findCulprit(fx, state, part, red);
      writeState(fx.layout.state, state);
      return part;
    }
  }
  const due = state.benchmarks_due;
  if (due && verified && !(due.asked && now.getTime() - Date.parse(due.asked) < BENCH_ASK_AGAIN_MS)
    && await runBenchmarks(fx, state, verified) === "done") return "benchmarks";
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
  const m = doing(fx, state, part, commit, () => {
    fx.log(`${part}: ${steps.length} step(s) at ${short(commit)} (${fx.git.subject(commit)})`);
    return fx.gate.run(commit, steps, part);
  }, at);
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
    // Read once: the status counts them, and the records are written from them.
    const listed = listedIn(m.run);
    record.listed = { pending: listed.pending.length, accepted: listed.accepted.length };
    state[part].last_green = record;
    fx.log(`${part} green at ${short(commit)}; logs ${m.run}`);
    clearCulprits(fx, state, part, commit);
    if (part === "core") moveVerified(fx, state, commit);
    writeState(fx.layout.state, state);
    writeRecords(fx, state, part, commit, m.run, listed);
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

/**
 * `work`, with the state saying what the controller is doing while it runs,
 * so `--status` can tell. `since` names when the piece of work began, when
 * it began before this call.
 */
function doing<T>(fx: Effects, state: State, what: Doing["doing"], commit: string, work: () => T, since = fx.now().toISOString()): T {
  state.now = { doing: what, commit, since };
  writeState(fx.layout.state, state);
  try { return work(); }
  finally {
    delete state.now;
    writeState(fx.layout.state, state);
  }
}

function task(fx: Effects, state: State, line: string): void {
  state.tasks.push({ at: fx.now().toISOString(), line });
  state.tasks = state.tasks.slice(-50);
  fx.log(`TASK for an issue: ${line}`);
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
    reopen(fx, state, finding, null, made.conflict);
    return;
  }
  // Reachable until it lands: the queue holds a commit, not a branch.
  fx.git.run(["update-ref", `refs/full-check/reverts/${short(finding.culprit)}`, made.commit]);
  const submitted = await submitTo(fx.queue, made.commit, { first: true });
  fx.log(`revert ${short(made.commit)} of ${short(finding.culprit)}: ${submitted.line}`);
  state.culprits.push({ commit: finding.culprit, part: finding.part, steps: finding.steps, run: finding.run, found_at: fx.now().toISOString(), revert: made.commit, ...(submitted.submitted ? {} : { reason: submitted.line }) });
  reopen(fx, state, finding, made.commit);
}

/**
 * The culprit's task is open again: each issue its commit names (as fixed, or
 * as "Part of") is reopened with what went red. A commit that names none, or
 * an issue that cannot be told, leaves a task line for an issue instead.
 */
function reopen(fx: Effects, state: State, finding: Finding, revert: string | null, why?: string): void {
  const issues = issuesNamed(fx.git.run(["log", "-1", "--format=%B", finding.culprit]));
  const told = issues.map(n => fx.issue(n, issueComment(finding, revert, why)));
  for (const outcome of told) fx.log(outcome.line);
  if (!told.length || told.some(outcome => !outcome.ok)) task(fx, state, taskLine(finding, revert, why));
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
    const m = doing(fx, state, "probe", commit, () => fx.gate.run(commit, present, `${part}-probe`));
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

/** How many times one run's delta is applied on main and submitted: the first time, and again after refusals. */
export const RECORDS_ATTEMPTS = 3;
/** The records unit's outcome, in the run's folder beside the recorder's log (recordJob). */
export const RECORDS_OUTCOME = "record-pending.outcome.json";
/** The records unit's own output, in the run's folder: what its command said, a crash's stack included. */
export const RECORDS_UNIT_LOG = "record-pending.unit.log";

/** What a records unit's outcome says beside the recorder's exit status: what it wrote under the record roots, and elsewhere. */
export type RecordsOutcome = { files: string[]; refused: string[] };

/** Whether a part's records unit records them now: started, and its outcome not read yet. */
const recording = (records: RecordsRun | undefined): records is RecordsRun & { job: NonNullable<RecordsRun["job"]>; run: string } =>
  !!records?.job && !!records.run && !records.job.ended && !records.settled;
/** Whether the full check still follows a part's records: their delta was applied on main, and nothing has settled them. */
const following = (records: RecordsRun | undefined): records is RecordsRun & { delta: string } => !!records?.delta && !records.settled;

/**
 * After a part's green run that listed rows to record: the run's compiler kept
 * as a pin now, before the next core run builds over it, and the part's
 * records unit started at the run's commit (startRecords). The controller goes
 * on with the core while it records, and follows it each cycle
 * (followRecording).
 */
function writeRecords(fx: Effects, state: State, part: Part, commit: string, run: string, listed: Listed): void {
  const previous = state[part].records;
  if (previous?.commit === commit) return;
  if (!listed.pending.length && !listed.accepted.length) return;
  // One delta of a part's rows in flight at a time: recorded again now, the
  // rows still being recorded or waiting to land would be measured twice,
  // hours each, and the two records commits would race for the same cases.
  if (recording(previous)) {
    fx.log(`records: the ${part} rows at ${short(previous.commit)} are still being recorded in ${previous.job.unit}; the ${part} run at ${short(commit)} records nothing until they are`);
    return;
  }
  if (following(previous)) {
    fx.log(`records: the ${part} rows recorded at ${short(previous.commit)} still wait for the landing check (${previous.result}); the ${part} run at ${short(commit)} records nothing until they land or are given up`);
    return;
  }
  fx.log(`records: ${listed.pending.length} pending case(s) and ${listed.accepted.length} accepted change(s) listed by the ${part} run at ${short(commit)}`);
  const at = fx.now().toISOString();
  const records: RecordsRun & { run: string } = { commit, at, run, submitted: null, result: "starting its records unit" };
  state[part].records = records;
  try {
    doing(fx, state, "records", commit, () => {
      records.pin = runPin(fx.pins, commit, fx.git.subject(commit), join(fx.layout.target, "release/nts"), run);
      startRecords(fx, state, part, records);
    }, at);
  } catch (error) {
    records.settled = fx.now().toISOString();
    records.result = `failed: ${message(error)}`;
    fx.log(`records: ${records.result}`);
  } finally {
    writeState(fx.layout.state, state);
  }
}

/**
 * A part's records unit: service.ts --record in the part's records tree, at
 * the run's commit, on that tree's own code and Node, which nothing else
 * changes while it records. It records with the run's pin and leaves its log,
 * delta and outcome in the run's folder.
 */
export function recordsUnit(layout: Layout, part: Part, records: { commit: string; run: string; pin: string }, node: string): UnitSpec {
  const tree = layout.records[part];
  return {
    name: recordsUnitName(part), cwd: tree, log: join(records.run, RECORDS_UNIT_LOG),
    command: [node, join(tree, "tooling/full-check/service.ts"), `--record=${part}`, `--commit=${records.commit}`, `--run=${records.run}`,
      `--pin=${records.pin}`, `--outcome=${join(records.run, RECORDS_OUTCOME)}`],
  };
}

/**
 * The part's records unit started at the run's commit, its tree set up there
 * afresh: what an earlier start that stopped wrote is gone, its delta too. The
 * job is in the state before the unit exists (background.ts's start). A start
 * that fails is a start all the same: the next cycle finds the unit gone with
 * no outcome, and starts it once more or gives it up (followRecording).
 */
function startRecords(fx: Effects, state: State, part: Part, records: RecordsRun & { run: string }, again = false): void {
  const tree = fx.layout.records[part], now = fx.now(), save = () => writeState(fx.layout.state, state);
  let spec: UnitSpec | null = null, error: string | null = null;
  try {
    if (!records.pin) throw new Error("the records have no pin to record with");
    fx.checkout(tree, records.commit);
    rmSync(join(records.run, DELTA_FILE), { force: true });
    spec = recordsUnit(fx.layout, part, { commit: records.commit, run: records.run, pin: records.pin }, fx.node(tree));
  } catch (cause) { error = `its tree could not be set up: ${message(cause)}`; }
  if (!again || !records.job) records.job = newJob(recordsUnitName(part), join(records.run, RECORDS_OUTCOME), now);
  else if (!spec) Object.assign(records.job, { starts: records.job.starts + 1, at: now.toISOString() });
  if (spec) error = again ? startAgain(fx.units, spec, records.job, now, save) : start(fx.units, spec, records.job, save);
  records.result = error ? `${records.job.unit} did not start: ${error}` : `recording in ${records.job.unit} since ${records.job.at}${again ? ", started again" : ""}`;
  fx.log(`records of the ${part} rows at ${short(records.commit)}: ${records.result}; logs ${records.run}`);
  save();
}

/**
 * A part's records unit as it is now. Running, the cycle goes on beside it.
 * Ended, what it recorded is applied on the newest main and submitted
 * (recorded). Gone without an outcome, it is started once more, and then the
 * run is given up as a task, its rows pending for the next records run.
 * Returns whether it applied a delta.
 */
async function followRecording(fx: Effects, state: State, part: Part, records: RecordsRun & { job: NonNullable<RecordsRun["job"]>; run: string }): Promise<boolean> {
  let seen: Seen<RecordsOutcome>;
  try { seen = look<RecordsOutcome>(records.job, fx.units, fx.now()); }
  catch (error) {
    fx.log(`records: whether ${records.job.unit} runs cannot be told (${message(error)}); asked again next cycle`);
    return false;
  }
  if (seen.state === "running") return false;
  if (seen.state === "lost") {
    if (seen.again) {
      fx.log(`records of the ${part} rows at ${short(records.commit)}: ${seen.why}; it is started once more`);
      startRecords(fx, state, part, records, true);
      return false;
    }
    records.settled = fx.now().toISOString();
    records.result = `${seen.why}, started ${records.job.starts} time(s); see ${join(records.run, RECORDS_UNIT_LOG)}`;
    task(fx, state, `- The full check's ${part} records at ${short(records.commit)} did not finish: ${records.result}. Their rows stay pending for the next records run.`);
    writeState(fx.layout.state, state);
    return false;
  }
  writeState(fx.layout.state, state);
  return recorded(fx, state, part, records, seen.outcome);
}

/**
 * What the records unit recorded: its delta, which is applied on the newest
 * main and submitted; or nothing to apply, and why, and the task a recorder
 * that went wrong leaves. Returns whether it applied a delta.
 */
async function recorded(fx: Effects, state: State, part: Part, records: RecordsRun & { run: string }, outcome: Outcome & RecordsOutcome): Promise<boolean> {
  const { commit, run } = records;
  try {
    if (outcome.status !== 0) fx.log(`record-pending exited ${outcome.status}; see ${join(run, RECORDER_LOG)}`);
    if (outcome.refused.length) task(fx, state, `- record-pending.ts at ${short(commit)} wrote outside the records (${outcome.refused.join(", ")}); see ${run}.`);
    // What the recorder recorded is its delta; the record files it left in the tree go when the tree is set up at main.
    const delta = join(run, DELTA_FILE), rows = existsSync(delta) ? parseDelta(readFileSync(delta, "utf8")).rows.length : null;
    if (!rows) {
      records.result = rows === null && outcome.files.length ? `wrote ${outcome.files.length} record file(s) and no delta` : "recorded nothing";
      fx.log(`records: ${records.result}`);
      if (rows === null && outcome.files.length) task(fx, state, `- record-pending.ts at ${short(commit)} wrote records and no delta (${delta}), so none of them can land; see ${run}.`);
      else if (outcome.status !== 0) task(fx, state, `- record-pending.ts at ${short(commit)} exited ${outcome.status}; see ${run}.`);
      return false;
    }
    fx.log(`records: ${rows} row(s) recorded at ${short(commit)}, in ${delta}`);
    await applyAndSubmit(fx, state, part, Object.assign(records, { delta }), fx.git.commit("refs/heads/main")!);
    return true;
  } catch (error) {
    records.result = `failed: ${message(error)}`;
    fx.log(`records: ${records.result}`);
    return false;
  } finally {
    writeState(fx.layout.state, state);
  }
}

/** The records unit's work, as its command line gives it (parseOptions's --record). */
export type RecordJob = { part: Part; commit: string; run: string; pin: string; outcome: string };

/**
 * The records unit's work, in its own tree at the run's commit: the recorder
 * (record-pending.ts --after, recordPending) with the run's pin, and then, as
 * its last act, its outcome: the recorder's exit status and what it wrote,
 * under the record roots and elsewhere. Nothing is committed: the controller
 * applies the delta on main.
 */
export function recordJob(tree: string, job: RecordJob, recorder: Recorder): void {
  const recorded = recordAt(new Git(tree), job.commit, dir => recorder(dir, job.pin, job.run, job.part));
  writeOutcome<RecordsOutcome>(job.outcome, { status: recorded.status, files: recorded.files, refused: recorded.refused });
}

/**
 * A part's delta applied on `main`, the newest, by main's own
 * record-pending.ts --apply in the part's records tree, and what applied
 * committed there and submitted. Each call is an attempt, whatever comes of
 * it; one that commits nothing because nothing is left to apply settles the
 * records.
 */
async function applyAndSubmit(fx: Effects, state: State, part: Part, records: RecordsRun & { delta: string }, main: string): Promise<void> {
  const attempt = (records.attempts ?? 0) + 1, run = dirname(records.delta), log = join(run, `record-pending.apply-${attempt}.log`);
  Object.assign(records, { attempts: attempt, base: main, submitted: null });
  delete records.answer;
  try {
    const dir = fx.layout.records[part], tree = new Git(dir, fx.git.env);
    const applied = doing(fx, state, "records", records.commit, () => applyAt(tree, main, commit => fx.checkout(dir, commit), at => fx.applier(at, records.delta, log),
      output => recordsMessage({ commit: records.commit, part, run, pin: records.pin, main, attempt, output })));
    if (applied.refused.length) task(fx, state, `- record-pending.ts --apply on main ${short(main)} wrote outside the records (${applied.refused.join(", ")}); see ${log}.`);
    const counts = appliedIn(applied.output), said = counts ? countsText(counts) : `see ${log}`;
    if (applied.kind === "failed") records.result = `record-pending.ts --apply exited ${applied.status} on main ${short(main)} (attempt ${attempt}); see ${log}`;
    else if (applied.kind === "none") {
      records.settled = fx.now().toISOString();
      records.result = `nothing left to commit on main ${short(main)}: ${said}`;
    } else {
      // Reachable until it lands: the queue holds a commit, not a branch.
      fx.git.run(["update-ref", `refs/full-check/records/${short(records.commit)}`, applied.commit]);
      const submitted = await submitTo(fx.queue, applied.commit, { first: false });
      records.submitted = submitted.submitted ? applied.commit : null;
      records.result = `${said} on main ${short(main)} (attempt ${attempt}): ${submitted.line}`;
    }
    fx.log(`records of the ${part} rows at ${short(records.commit)}: ${records.result}`);
  } catch (error) {
    records.result = `failed on main ${short(main)} (attempt ${attempt}): ${error instanceof Error ? error.message : String(error)}`;
    fx.log(`records: ${records.result}`);
  } finally {
    writeState(fx.layout.state, state);
  }
}

/**
 * Each part's records unit while it records (followRecording), and each
 * part's records commit as the landing check answers it. Landed or
 * withdrawn settles it. Refused, held, unknown to the queue, or never
 * submitted, its delta is applied again on the newest main and submitted,
 * RECORDS_ATTEMPTS times in all, and then it is a task. A refusal, or an
 * attempt that failed, waits for main to move first: the same rows on the
 * same main come to the same end. A held one, which could not be checked, and
 * one the queue lost are taken up at once; a held one is withdrawn before it
 * is replaced, so it never lands behind its replacement. Returns whether it
 * applied a delta.
 */
async function followRecords(fx: Effects, state: State): Promise<boolean> {
  let again = false;
  for (const part of PARTS) {
    const records = state[part].records;
    if (recording(records)) {
      if (await followRecording(fx, state, part, records)) again = true;
      continue;
    }
    if (!following(records)) continue;
    const answer = records.submitted ? fx.queue.answer(records.submitted) : null;
    if (answer === "waiting") continue;
    if (answer) records.answer = answer;
    if (answer?.state === "landed" || answer?.state === "withdrawn") {
      records.settled = fx.now().toISOString();
      records.result = answer.state === "landed" ? `landed as ${short(answer.tip ?? records.submitted!)}` : `withdrawn: ${answer.message}`;
      fx.log(`records ${short(records.submitted!)} of the ${part} rows at ${short(records.commit)}: ${records.result}`);
      writeState(fx.layout.state, state);
      continue;
    }
    const why = !records.submitted ? `nothing was submitted (${records.result})` : answer ? `${answer.state}: ${answer.message}` : "the landing queue has no record of it";
    const attempts = records.attempts ?? 1, kept = existsSync(records.delta), main = fx.git.commit("refs/heads/main")!;
    if (attempts >= RECORDS_ATTEMPTS || !kept) {
      if (answer?.state === "held") fx.queue.withdraw(records.submitted!);
      records.settled = fx.now().toISOString();
      records.result = `${why}; not applied again: ${kept ? `${attempts} attempt(s) made` : `its delta ${records.delta} is gone`}`;
      task(fx, state, `- The full check's ${part} records of ${short(records.commit)} did not land: ${records.result}. Their rows stay pending for the next records run; see ${dirname(records.delta)}.`);
      writeState(fx.layout.state, state);
      continue;
    }
    const atOnce = answer?.state === "held" || (records.submitted !== null && answer === null);
    if (!atOnce && main === records.base) continue;
    if (answer?.state === "held") fx.queue.withdraw(records.submitted!);
    fx.log(`records ${records.submitted ? short(records.submitted) : "(none submitted)"} of the ${part} rows at ${short(records.commit)}: ${why}; their delta is applied again on main ${short(main)}`);
    await applyAndSubmit(fx, state, part, records, main);
    again = true;
  }
  return again;
}

/**
 * How long an attempt that did not start waits to be asked again: the lock
 * may be another measurement's for an hour, and each attempt builds first.
 */
export const BENCH_ASK_AGAIN_MS = 10 * 60_000;
/** How many of a night's attempts a stopped controller may cost before the night is given up. */
export const BENCH_INTERRUPTIONS = 3;

/**
 * The nightly slot, answered: the benchmarks are due on the newest verified
 * until the next nightly slot, unless nts-bench already measured it. A night
 * still due when the next one comes is replaced, and its end says what held
 * it.
 */
function answerNightly(fx: Effects, state: State, night: Date, verified: string | null): void {
  const now = fx.now().toISOString(), left = state.benchmarks_due;
  state.nightly = now;
  if (left) {
    endNight(fx, state, { commit: verified ?? "", at: now, run: "", outcome: "not-run",
      result: `not run: ${left.waiting ?? "no cycle reached them"}; the nightly slot at ${night.toISOString()} replaced the night` });
  }
  if (verified && state.bench?.measured && state.bench.commit === verified) fx.log(`benchmarks: nts-bench already measured verified ${short(verified)}`);
  else {
    const until = nextNightly(fx.schedule, night).toISOString();
    state.benchmarks_due = { since: now, until };
    fx.log(`benchmarks due until ${until}: nts-bench measures the newest verified once the core has nothing to do and the measurement lock admits it`);
  }
  writeState(fx.layout.state, state);
}

/** What holds the due benchmarks now, for the status (`benchmarks.due.waiting`); the run that follows writes it down. */
function holds(state: State, what: string): void {
  if (state.benchmarks_due) state.benchmarks_due.waiting = what;
}

/** The night has its answer: the benchmarks are no longer due, and the status says how they ended. */
function endNight(fx: Effects, state: State, bench: Pick<BenchRun, "commit" | "at" | "run" | "result" | "outcome"> & Partial<BenchRun>): "done" {
  state.bench = { submitted: null, measured: false, ...bench };
  delete state.benchmarks_due;
  fx.log(`benchmarks at ${bench.commit ? short(bench.commit) : "nothing verified"}: ${bench.result}`);
  writeState(fx.layout.state, state);
  return "done";
}

/**
 * An attempt the state says is in flight was interrupted: a cycle runs its
 * own attempt to its end before the next begins, so only a controller that
 * stopped during one leaves it for a later cycle to find. It is tried again
 * while the night lasts, BENCH_INTERRUPTIONS lost attempts at most, and then
 * the night is given up as a task.
 */
function interruptedBenchmarks(fx: Effects, state: State): void {
  const due = state.benchmarks_due, lost = due?.measuring;
  if (!due || !lost) return;
  delete due.measuring;
  due.interrupted = (due.interrupted ?? 0) + 1;
  const result = `interrupted: the controller stopped while nts-bench measured, from ${lost.at}`;
  if (due.interrupted < BENCH_INTERRUPTIONS) {
    state.bench = { commit: lost.commit, at: lost.at, run: lost.run, result: `${result}; tried again`, submitted: null, measured: false, outcome: "interrupted" };
    due.waiting = `the attempt from ${lost.at} was interrupted, and is tried again`;
    fx.log(`benchmarks at ${short(lost.commit)}: ${state.bench.result}`);
    writeState(fx.layout.state, state);
    return;
  }
  endNight(fx, state, { commit: lost.commit, at: lost.at, run: lost.run, outcome: "interrupted",
    result: `${result}; interrupted ${due.interrupted} times this night, so the next nightly slot tries again` });
  task(fx, state, `- The nightly benchmarks at ${short(lost.commit)} were interrupted ${due.interrupted} times: the controller stopped while nts-bench measured; see ${lost.run}.`);
  writeState(fx.layout.state, state);
}

/**
 * nts-bench on `verified`, built by pinned.sh in the full check's tree (its
 * `build` step: nts-bench links the compiler crates, so it is built from the
 * commit it measures), admitted by the measurement lock (bench.ts), and its
 * results-only commit submitted. `waiting` when it did not start -- its build
 * held, or the lock not admitting it -- and nothing is kept: the benchmarks
 * stay due, asked again BENCH_ASK_AGAIN_MS later. `done` when the night has
 * its answer: a run record, a run that kept none, or a build red at
 * verified. The attempt is written down before nts-bench starts, so one a
 * stopped controller cut short is found (interruptedBenchmarks).
 */
async function runBenchmarks(fx: Effects, state: State, verified: string): Promise<"waiting" | "done"> {
  const due = state.benchmarks_due!, at = fx.now().toISOString();
  const wait = (why: string): "waiting" => {
    Object.assign(due, { waiting: why, asked: at });
    fx.log(`benchmarks at ${short(verified)}: ${why}; still due, and asked again in ${BENCH_ASK_AGAIN_MS / 60_000} min`);
    writeState(fx.layout.state, state);
    return "waiting";
  };
  const built = doing(fx, state, "benchmarks", verified, () => fx.gate.run(verified, ["build"], "bench-build"), at);
  if (built.verdict === "held") return wait(`the build at verified was held (${built.reasons.build ?? "no reason given"}); see ${built.run}`);
  if (built.verdict !== "green") return endNight(fx, state, { commit: verified, at, run: built.run, result: `not run: the build at verified is ${built.verdict}`, outcome: "not-run" });
  const run = join(fx.layout.runs, `bench-${short(verified)}-${Date.parse(at)}`);
  mkdirSync(run, { recursive: true });
  due.measuring = { commit: verified, at, run };
  fx.log(`benchmarks: nts-bench on verified ${short(verified)}, once the measurement lock admits it; logs ${run}`);
  let attempt: BenchAttempt | { failed: string };
  try { attempt = doing(fx, state, "benchmarks", verified, () => fx.bench(fx.layout.tree, run), at); }
  catch (error) { attempt = { failed: error instanceof Error ? error.message : String(error) }; }
  delete due.measuring;
  writeState(fx.layout.state, state);
  if ("failed" in attempt) return endNight(fx, state, { commit: verified, at, run, result: `nts-bench could not be run: ${attempt.failed}`, outcome: "no-record" });
  if (!attempt.admitted) {
    // It started nothing: its log holds only the refusal, said here and in the state.
    rmSync(run, { recursive: true, force: true });
    return wait(`not admitted: ${attempt.reason}`);
  }
  const tree = new Git(fx.layout.tree, fx.git.env);
  const found = resultsCommit(tree, verified);
  if ("none" in found) {
    endNight(fx, state, { commit: verified, at, run, result: `nts-bench exited ${attempt.status}: ${found.none}`, outcome: "no-record" });
    task(fx, state, `- The nightly benchmark run at ${short(verified)} kept no run record (nts-bench exited ${attempt.status}: ${found.none}); see ${run}.`);
    writeState(fx.layout.state, state);
    return "done";
  }
  fx.git.run(["update-ref", `refs/full-check/benchmarks/${short(verified)}`, found.commit]);
  const submitted = await submitTo(fx.queue, found.commit, { first: false });
  const slower = slowerRows(tree.run(["show", `${found.commit}:${FULL_MD}`]));
  endNight(fx, state, { commit: verified, at, run, outcome: "record", measured: true, slower, submitted: submitted.submitted ? found.commit : null,
    result: `run record ${short(found.commit)}${attempt.status ? ` (nts-bench exited ${attempt.status})` : ""}: ${submitted.line}` });
  if (slower.length) {
    task(fx, state, `- ${slower.length} benchmark row(s) slower than their own best in the nightly run at ${short(verified)}: ${slower.join(", ")} (${FULL_MD}); measure each before calling it a regression.`);
    writeState(fx.layout.state, state);
  }
  return "done";
}

export type CountEffects = {
  /** The machine counted (count.ts), the pins the full check's records units use now kept out of its leftovers. */
  count: () => CountResult;
  /** Remove the leftovers the count found removable (count.ts's sweep), a line each. */
  sweep: (removable: readonly Removable[]) => string[];
  /** The pool's upkeep (pool.ts's prune), and the lines that say what it removed. */
  prunePool: () => string[];
  /** Recomputable cache upkeep, report-only. */
  pruneNodeCache: () => NodeCacheRetention;
  /** The count's own file (the layout's `count`). */
  file: string;
  now: () => Date;
  log: (line: string) => void;
};

/**
 * The hourly count (`--count`, from its own timer, whatever the controller is
 * doing): the pool's upkeep and the Node compile cache's, then the count, the
 * leftovers it may remove removed and the machine counted again, so it says
 * what remains; and what it found written to the count's own file. It writes
 * nothing of the controller's: the controller is its state's only writer.
 */
export function countOnce(fx: CountEffects): CountRecord {
  upkeepPool(fx);
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
  catch (error) { result = { verdict: "INSTRUMENT", red: [], notes: [`not counted: ${message(error)}`], removable: [] }; }
  const counted = { at: fx.now().toISOString(), verdict: result.verdict, lines: [...result.red, ...result.notes] };
  for (const line of countLines(result)) fx.log(line);
  writeCount(fx.file, counted);
  return counted;
}

/** The pool's hourly upkeep, before the count reads the machine; a failure is a line, never a stopped count. */
function upkeepPool(fx: Pick<CountEffects, "prunePool" | "log">): void {
  let lines: string[];
  try { lines = fx.prunePool(); }
  catch (error) { lines = [`pool: upkeep failed: ${message(error)}`]; }
  for (const line of lines) fx.log(line);
}

/** The pins the records units record with now: the count keeps them, whatever main and verified are by then. */
export function recordingPins(state: State): string[] {
  return PARTS.flatMap(part => { const records = state[part].records; return recording(records) && records.pin ? [basename(dirname(records.pin))] : []; });
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

/** Old runs and probes go, but not the runs records still record or apply from; landed reverts lose the ref that kept them; verified is pushed. */
function housekeeping(fx: Effects, state: State): void {
  const now = fx.now().getTime();
  const kept = new Set([state.core.last_run?.run, state.wide.last_run?.run, state.core.last_green?.run, state.wide.last_green?.run]);
  for (const part of PARTS) {
    const records = state[part].records;
    if (recording(records)) kept.add(records.run);
    if (following(records)) kept.add(dirname(records.delta));
  }
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
export function recordPending(tree: string, pin: string, run: string, part: Part, options: { nodeInstallations?: string; env?: NodeJS.ProcessEnv } = {}) {
  const script = join(tree, "tooling/records/record-pending.ts");
  if (!existsSync(script)) return { status: 2, output: `no tooling/records/record-pending.ts at this commit` };
  const log = join(run, RECORDER_LOG);
  const selected = nodeToolchain(nodePin(tree), launcherEnvironment(options.env ?? process.env), options.nodeInstallations);
  const out = openSync(log, "w");
  let r: ReturnType<typeof spawnSync>;
  try {
    r = candidateCommand(selected.node, {
      // Its jobs reserve their memory in the machine's ledger at the full
      // check's priority, below a landing check's and an agent's.
      tree, run: join(run, 'records'), owned: { NTS_BIN: pin, NTS_CHECKERS: '1', NTS_MEMORY_PRIORITY: 'full-check' },
      command: [selected.node, script, "--after", part, run], discardTemporary: true,
    }, selected.env, { output: out });
  } finally { closeSync(out); }
  if (r.error) appendFileSync(log, `\n${r.error.message}\n`);
  return { status: r.status ?? 1, output: tail(log) };
}

function production(options: { schedule: Schedule }): Effects {
  const layout = defaultLayout();
  mkdirSync(layout.runs, { recursive: true });
  const git = new Git(ROOT);
  return {
    layout, git,
    gate: pinnedGate(layout, ROOT, stamp),
    queue: landingQueue(),
    // Each unit at the controller's own priority and on its own CPUs, never the measurement pair.
    units: systemdUnits(lowPriority(gateCpus(inheritedCpus()))),
    node: tree => nodeToolchain(nodePin(tree), launcherEnvironment(process.env)).node,
    checkout: (tree, commit) => prepareTree(sharedCheckout(ROOT), tree, commit),
    applier: (tree, delta, log) => applyRecords(tree, delta, log),
    bench: benchWithLock(ROOT, layout.target),
    pins: process.env.NTS_PINS ?? join(homedir(), ".cache/nts-pins"),
    push: commit => {
      const r = git.try(["push", "--quiet", "origin", `${commit}:refs/heads/verified`]);
      return r.status === 0 ? { ok: true, line: `pushed verified ${short(commit)} to origin` } : { ok: false, line: `could not push verified ${short(commit)}: ${r.stderr.trim()}; trying again next cycle` };
    },
    issue: (n, comment) => reopenIssue(ghIn(ROOT), n, comment),
    now: () => new Date(),
    log: stamp,
    schedule: options.schedule,
  };
}

/** The count's effects on this machine: it reads the controller's state, and writes only the count's own file. */
function countEffects(layout: Layout): CountEffects {
  return {
    count: () => countMachine({ ...gather(ROOT), held: recordingPins(readState(layout.state)) }),
    sweep: removable => sweepLeftovers(removable, join(homedir(), ".cache")),
    prunePool: () => pruneLines(new Pool(POOL_HOME, { root: sharedCheckout(ROOT) }).prune()),
    pruneNodeCache: () => pruneNodeCompileCache(),
    file: layout.count,
    now: () => new Date(),
    log: stamp,
  };
}

/** The process the service's lock names, and whether it still runs; null when the lock names none. */
export function lockHolder(lock: string): { pid: number; alive: boolean } | null {
  let pid = 0;
  try { pid = Number(readFileSync(join(lock, "pid"), "utf8")); } catch { return null; }
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  // Signal 0 is never delivered: it only asks whether the process exists.
  try { process.kill(pid, 0); return { pid, alive: true }; }
  catch (error) { return { pid, alive: (error as NodeJS.ErrnoException).code === "EPERM" }; }
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
      const holder = lockHolder(lock);
      if (holder?.alive) throw new Error(`the full check is already running (pid ${holder.pid}, ${lock})`);
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
 * ran, and says so once. The tree moves only while no other process reads it:
 * the hourly count holds its lock shared while it counts (unit.ts), and the
 * tree follows on a later cycle.
 */
export function followVerified(git: Git, layout: Layout, root = ROOT, inputs?: Inputs): boolean {
  if (resolve(root) !== resolve(layout.controller)) return false;
  const verified = git.commit("refs/heads/verified"), head = git.commit("HEAD");
  if (!verified || !head || verified === head || !git.isAncestor(head, verified)) return false;
  if (git.run(["status", "--porcelain", "--untracked-files=no"])) return false;
  const alone = GateResource.tryAcquire(layout.controllerLock);
  if (!alone) return false;
  try {
    const link = inputs ?? linkInputs(sharedCheckout(layout.controller));
    git.run(["checkout", "--detach", "-q", verified]);
    try { link(layout.controller); }
    catch (error) {
      git.run(["checkout", "--detach", "-q", head]);
      let back = "";
      try { link(layout.controller); } catch (again) { back = `; its own inputs could not be linked again either: ${message(again)}`; }
      if (unfollowed !== verified) stamp(`the controller stays at ${short(head)}: verified ${short(verified)}'s inputs could not be linked: ${message(error)}${back}`);
      unfollowed = verified;
      return false;
    }
  } finally { alone.close(); }
  stamp(`the controller moved to verified ${short(verified)}; restarting on its code`);
  return true;
}

/** A part's runs as the status gives them, and its records: what its last green run listed, and the last records commit. */
type PartStatus = { last_run: RunRecord | null; last_green: RunRecord | null; records: { listed: RunRecord["listed"] | null; last: RecordsRun | null } };

/**
 * The full check as `--status --json` prints it, version 2: whether its
 * controller runs and what it is doing, main and verified and how far
 * verified is behind, each part's runs and records, the culprits, the
 * benchmarks, the hourly count and the task lines. Times are ISO strings;
 * durations are seconds, as numbers. The text `--status` prints is rendered
 * from this.
 *
 * Other tools read it (signalbox's Full check tab), so within a version
 * fields are only added; one removed, renamed or reshaped bumps `version`.
 * Version 2 moved the records into each part (`core.records`,
 * `wide.records`) and counts accepted changes, not only improvements; a
 * records run's `run` and `job` (its unit) were added to it since.
 */
export type FullCheckStatus = {
  version: 2; kind: "full-check"; at: string;
  controller: { pid: number | null; running: boolean };
  now: (Doing & { seconds: number }) | null;
  main: string | null;
  verified: { commit: string | null; pushed: string | null };
  /** The commits on main that verified has not reached, and how long the oldest has waited since it landed; null with nothing verified. */
  behind: { commits: number; oldest_landed_at: string | null; delay_s: number | null } | null;
  core: PartStatus;
  wide: PartStatus & { slot: string | null };
  culprits: Culprit[];
  /** The last attempt or night and how it ended, its slower rows, the night still due and what holds it, and when the nightly slot was last answered. */
  benchmarks: { last: State["bench"] | null; slower: string[]; due: State["benchmarks_due"] | null; slot: string | null };
  /** What the hourly count last found, from the count's own file. */
  count: CountRecord | null;
  tasks: State["tasks"];
};

export type StatusInputs = {
  main: string | null; verified: string | null;
  /** main's commits that verified does not have, oldest first; null with nothing verified. */
  unverified: readonly string[] | null;
  /** When a commit landed, as an ISO time. */
  landedAt: (commit: string) => string;
  controller: { pid: number; alive: boolean } | null;
  /** The count's own file, as the last count wrote it. */
  count: CountRecord | null;
  now: Date;
};

export function fullCheckStatus(state: State, inputs: StatusInputs): FullCheckStatus {
  const now = inputs.now.getTime(), running = inputs.controller?.alive === true;
  const part = (p: PartState): PartStatus => ({
    last_run: p.last_run ?? null, last_green: p.last_green ?? null, records: { listed: p.last_green?.listed ?? null, last: p.records ?? null },
  });
  const oldest = inputs.unverified?.length ? inputs.unverified.map(inputs.landedAt).sort()[0]! : null;
  return {
    version: 2, kind: "full-check", at: inputs.now.toISOString(),
    controller: { pid: inputs.controller?.pid ?? null, running },
    // What a controller that stopped was doing is not being done.
    now: running && state.now ? { ...state.now, seconds: Math.round((now - Date.parse(state.now.since)) / 1000) } : null,
    main: inputs.main,
    verified: { commit: inputs.verified, pushed: state.pushed ?? null },
    behind: inputs.unverified === null ? null
      : { commits: inputs.unverified.length, oldest_landed_at: oldest, delay_s: oldest === null ? null : Math.round((now - Date.parse(oldest)) / 1000) },
    core: part(state.core),
    wide: { ...part(state.wide), slot: state.wide.slot ?? null },
    culprits: state.culprits,
    benchmarks: { last: state.bench ?? null, slower: state.bench?.slower ?? [], due: state.benchmarks_due ?? null, slot: state.nightly ?? null },
    count: inputs.count,
    tasks: state.tasks,
  };
}

const minutes = (seconds: number) => `${Math.round(seconds / 60)} min`;

/** The status as `--status` prints it, from the same model `--json` prints. */
export function statusText(s: FullCheckStatus): string {
  const run = (r: RunRecord | null) => r ? `${r.verdict} at ${short(r.commit)} (${r.at})${r.failed.length ? `: ${r.failed.join(", ")}` : ""}${r.reason ? `: ${r.reason}` : ""}; ${r.run}` : "none";
  const records = (r: PartStatus["records"]) => `${r.listed ? `${r.listed.pending} pending and ${r.listed.accepted} accepted listed` : "none listed"}`
    + `; last ${r.last ? `${short(r.last.commit)} ${r.last.result}` : "none"}`;
  const doing = s.now ? `${s.now.doing} at ${short(s.now.commit)} for ${minutes(s.now.seconds)}` : "between cycles";
  return [
    `controller: ${s.controller.running ? `running (pid ${s.controller.pid}); ${doing}` : "not running"}`,
    `core: last ${run(s.core.last_run)}`, `      green ${run(s.core.last_green)}`,
    `wide: last ${run(s.wide.last_run)}`, `      green ${run(s.wide.last_green)}`,
    s.verified.commit && s.behind
      ? `verified ${short(s.verified.commit)}: ${s.behind.commits} commit(s) behind main${s.behind.delay_s === null ? "" : `, the oldest landed ${minutes(s.behind.delay_s)} ago`}`
      : "verified: none yet",
    `verified pushed: ${s.verified.pushed ? short(s.verified.pushed) : "never"}`,
    `culprits: ${s.culprits.map(c => `${short(c.commit)} (${c.steps.join(", ")}) revert ${c.revert ? short(c.revert) : "none"}${c.reason ? ` -- ${c.reason}` : ""}`).join("; ") || "none"}`,
    `records: core ${records(s.core.records)}`,
    `         wide ${records(s.wide.records)}`,
    `benchmarks: ${s.benchmarks.last ? `${short(s.benchmarks.last.commit)} at ${s.benchmarks.last.at}: ${s.benchmarks.last.result}; ${s.benchmarks.last.run}` : "none"}`
      + `${s.benchmarks.slower.length ? `; ${s.benchmarks.slower.length} row(s) slower than their own best` : ""}${s.benchmarks.due ? `; due until ${s.benchmarks.due.until}${
        s.benchmarks.due.measuring ? `, measuring from ${s.benchmarks.due.measuring.at}` : s.benchmarks.due.waiting ? `, waiting: ${s.benchmarks.due.waiting}` : ""}` : ""}`,
    `count: ${s.count ? `${s.count.verdict} at ${s.count.at}, ${s.count.lines.length} line(s)` : "never"}`,
    ...s.count?.lines.map(line => `  ${line}`) ?? [],
    "tasks for an issue:", ...s.tasks.map(t => `  ${t.at} ${t.line}`),
  ].join("\n");
}

/** The status on this machine: the full check's state, its lock, the count's file, the repository and the landing check's answers. */
export function machineStatus(layout: Layout, now = new Date()): FullCheckStatus {
  const git = new Git(ROOT);
  const main = git.commit("refs/heads/main"), verified = git.commit("refs/heads/verified");
  const landed = landedTimes();
  // A commit the landing check has no answer for counts from when it was committed.
  const landedAt = (commit: string) => landed.get(commit) ?? new Date(git.run(["log", "-1", "--format=%cI", commit])).toISOString();
  return fullCheckStatus(readState(layout.state), {
    main, verified, unverified: main && verified ? firstParents(git, verified, main) : null, landedAt, controller: lockHolder(layout.lock), count: readCount(layout.count), now,
  });
}

export type Options = { once: boolean; status: boolean; json: boolean; count: boolean; record: RecordJob | null; schedule: Schedule; ignored: string[] };

export function parseOptions(argv: readonly string[]): Options {
  const schedule = { ...DEFAULT_SCHEDULE };
  let once = false, status = false, json = false, count = false;
  const ignored: string[] = [], job: Partial<RecordJob> = {};
  const value = (arg: string, name: Exclude<keyof RecordJob, "part">) => {
    const given = arg.slice(name.length + 3);
    if (name === "commit" ? !/^[0-9a-f]{40}$/.test(given) : !isAbsolute(given)) throw new Error(`--${name} takes ${name === "commit" ? "a full commit name" : "an absolute path"}, not ${JSON.stringify(given)}`);
    job[name] = given;
  };
  for (const arg of argv) {
    if (arg === "--once") once = true;
    else if (arg === "--status") status = true;
    else if (arg === "--json") json = true;
    else if (arg === "--count") count = true;
    else if (/^--record=(?:core|wide)$/.test(arg)) job.part = arg.slice(9) as Part;
    else if (/^--(?:commit|run|pin|outcome)=/.test(arg)) value(arg, arg.slice(2, arg.indexOf("=")) as Exclude<keyof RecordJob, "part">);
    // A unit written before the benchmarks stayed due until the next nightly
    // slot still passes the wait that bounded them; it starts, and says so.
    else if (/^--bench-wait=\d+$/.test(arg)) ignored.push(arg);
    else if (arg.startsWith("--wide-at=")) schedule.wide = parseTimes(arg.slice(10));
    else if (arg.startsWith("--nightly-at=")) {
      const [nightly, ...rest] = parseTimes(arg.slice(13));
      if (!nightly || rest.length) throw new Error("--nightly-at takes one time of day");
      schedule.nightly = nightly;
    } else throw new Error(`unknown argument ${arg}; usage: service.ts [--once | --status [--json] | --count | --record=<part> --commit=<sha> --run=<dir> --pin=<nts> --outcome=<file>] [--wide-at=HH:MM,...] [--nightly-at=HH:MM]`);
  }
  if (json && !status) throw new Error("--json is for --status");
  const given = Object.keys(job).length;
  if (given && (!job.part || !job.commit || !job.run || !job.pin || !job.outcome)) throw new Error("--record takes --commit, --run, --pin and --outcome, all of them");
  if ([once, status, count, given > 0].filter(Boolean).length > 1) throw new Error("--once, --status, --count and --record are each a command of its own");
  return { once, status, json, count, record: given ? job as RecordJob : null, schedule, ignored };
}

async function main(argv: readonly string[]): Promise<number> {
  const options = parseOptions(argv);
  const layout = defaultLayout();
  if (options.status) {
    const status = machineStatus(layout);
    console.log(options.json ? JSON.stringify(status, null, 2) : statusText(status));
    return 0;
  }
  // A records unit's work: this code is its records tree's, at the run's commit (recordsUnit).
  if (options.record) {
    recordJob(ROOT, options.record, recordPending);
    return 0;
  }
  // The hourly count, beside the controller: it takes no lock of the controller's.
  if (options.count) {
    countOnce(countEffects(layout));
    return 0;
  }
  mkdirSync(layout.home, { recursive: true });
  takeLock(layout.lock);
  // Nothing runs before the first cycle: what a stopped controller was doing is not being done.
  const left = readState(layout.state);
  if (left.now) { delete left.now; writeState(layout.state, left); }
  const fx = production(options);
  stamp(`full check: core on main, wide steps at ${options.schedule.wide.join(", ")} and ${options.schedule.nightly} nightly with the benchmarks (due until the next nightly slot, measured on CPU 4 with its sibling idle); tree ${layout.tree}`);
  if (options.ignored.length) stamp(`ignored ${options.ignored.join(" ")}: the benchmarks stay due until the next nightly slot; node tooling/full-check/unit.ts --install writes the unit without it`);
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
