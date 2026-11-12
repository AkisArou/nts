#!/usr/bin/env node
// The gate's runner: every requested step of tooling/gate/all.sh, at once where
// they can be, under one CPU, memory and frontend budget, with a verdict per
// step and a summary that is printed however the run ends.
// summary.json.case_costs records per-check phases and token waits; raw events
// live under this run's costs/ directory. Missing metrics never alter verdicts.
//
//   tooling/gate/all.sh                       (hands over to this file)
//   NTS_GATE_STEPS="clippy rc" tooling/gate/all.sh
//
// **Why it exists.** all.sh ran its steps through `step()`, which exited on the
// first failure: every later step, the concurrent group and `interop` never ran,
// and nothing said so. A log that ended at `FAILED: definitions` was read as
// "only definitions failed" on 2026-10-06, and `rc`, `llvm-rc` and fourteen
// other steps that had never run on that commit went red on main the next run.
// A misspelt step name was reported only after every other step had passed. A
// step that could not run (no checkout, no SDK) returned 0 and read as passed.
// And the box sat mostly idle: the steps before the group ran one after another
// although they share nothing but the binary.
//
// **What it guarantees.**
//
//   - Every requested name is checked against `all.sh --list` before anything
//     runs, and a name this file has no row for (or a row all.sh has no step
//     for) is an error, so the two lists cannot drift apart silently.
//   - Every requested step ends as exactly one of
//       PASS     it ran and exited 0
//       INSTRUMENT  the measuring command failed; no program verdict
//       FAIL     it ran and exited non-zero (other than 77)
//       SKIPPED  it exited 77: it could not run here (its last line says why)
//       NOT RUN  it never started: a step it needs failed, the run was
//                interrupted, or NTS_GATE_FAIL_FAST stopped it
//   - A failing step never stops an unrelated one. Only a step that *needs*
//     another (every step that drives `nts` needs `build`, when `build` is
//     requested) is NOT RUN when that one fails.
//   - The summary is printed and `summary.json`/`summary.tsv` written on every
//     exit: green, red, Ctrl-C, SIGTERM, or this file throwing.
//   - `green` only when every requested step PASSed. SKIPPED is red unless the
//     step is named in NTS_GATE_ACCEPT_SKIP, and the summary says it was
//     accepted. A step that did nothing is never counted as one that passed.
//
// **Scheduling.** Each step has a row below: the slots (workers) it can use,
// whether it starts frontends, and what it needs or must follow. The budget is
// a pool of NTS_GATE_SLOTS tokens (see "Tokens"). Most steps are *elastic*:
// started with their whole pool of workers, each of which takes a token
// around the process it runs, so a step's share of the machine follows its
// work while it runs. The rest -- cargo, nts-suite, the test binaries,
// parallel inside one process -- hold a fixed grant of slots from start to
// end. Steps start longest first: their CPU seconds over the slots they can
// use (`workEstimate`); short fixed steps ride beside the budget so the first
// verdicts arrive in the first minutes. Memory comes from the machine's memory
// ledger: the run holds one reservation, which grows as its steps and tokens
// need it -- each by what its history measured -- and shrinks as they end (see
// "Memory").
//
// Environment:
//   NTS_GATE_STEPS        steps to run, space separated (default: all)
//   NTS_GATE_SLOTS        CPU slots for the run (default: NTS_JOBS, else 3/4 of
//                         the cores)
//   NTS_GATE_FRONTENDS    concurrent frontend-using workers (default CPU slots)
//   NTS_GATE_FAIL_FAST=1  stop at the first FAIL (inner loop; never landing)
//   NTS_GATE_ACCEPT_SKIP  step names whose SKIPPED does not make the run red
//   NTS_GATE_RUN_DIR      where logs and the summary go
//                         (outside the source tree; default
//                          ~/.cache/nts-gate/runs/<time>-<pid>)
//   NTS_GATE_TIME_STRICT=1  a step much slower than its baseline is a FAIL
//   NTS_GATE_RECORD_TIMES=1 write this run's times to tooling/gate/times.tsv
//   NTS_GATE_STEP_CEILING_S the most any step may run (the landing check's
//                         ceiling; see step-bound.ts)
//   NTS_MEMORY_PRIORITY   the run's place in the machine's memory queue
//                         (landing, agent, full-check; default agent), given
//                         by the launcher's code: a shell's is discarded
//   NTS_MEMORY_HANDOVER   a reservation the run takes over as its own is
//                         admitted: the landing build's, given by the landing
//                         check's code, so nothing is admitted between them.
//                         The run consumes it: no step is handed it
//   NTS_MEMORY_RESERVATION the reservation the run was started inside (an
//                         admit.ts job's, an outer gate step's): the run holds
//                         its own, and draws on that one's unused part first
//
// Set by this file for each step (a step reads them; nobody sets them by hand):
//   NTS_GATE_JOBS         the workers it may run
//   NTS_GATE_TOKENS       127.0.0.1:<port> of the token pool (elastic steps)
//   NTS_GATE_TOKEN_HELD=1 a fixed step: its tools must not ask for tokens
//   NTS_GATE_STEP         the step's name, sent with each token request
//   NTS_MEMORY_RESERVATION the run's reservation: a tool in the step that
//                         reserves memory runs inside it and asks for nothing
//   NTS_GATE_STEP_MEMORY_BYTES what its tools size their workers by: its grant
//                         at its full width and the hard bound above it, never
//                         below one census worker's own cap; the step's slice
//                         holds it to its live grant
//   NTS_GATE_COSTS_DIR    the run's history and cost files (<target>/gate-costs,
//                         unless the launcher's code owns another, as a test does)

import {hostObservations,HostObservationError} from "./host-observations.ts";
import {CaseBudgetError, ToolingInstrumentError, instrumentPolicy, readStepInstrument} from "./step-result.ts";
import {GateScopes} from "./scopes/step-scope.ts";
import {RESERVATION_PER_PEAK, elasticHeldBytes, inheritedStepWork, machineShare, orderStepStarts, readCostHistory, readPreviousStepCpu, stepCpu, unitReservation, unmeasuredLimit, usableWidth, writeCostHistory} from "./step-scheduling.ts";
import {STEP_SUCCESSORS} from "./step-successors.ts";
import {StepBoundClock, stepBound, stepBoundReason, stepBoundWait} from "./step-bound.ts";
import {spawn, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {
  appendFileSync, chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync,
  readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import {homedir} from "node:os";
import {dirname, join, resolve, relative, isAbsolute, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {createTokenPool} from "./tokenpool.mjs";
import {CaseCosts} from "./case-costs.ts";
import {CaseMemoryBroker} from './case-memory-broker.ts';
import {ownerEmissionCalls} from "./owner-emission-calls.ts";
import {STEP_CPU_MEASURE,parseGnuTime,measuredStepTime,readStepBaseline,currentStepCpu} from './step-time.ts';
import {gib, machineMemory, priorityOf, reservationPriority, rankForOom, reserve, RESERVATION_ENV, SYSTEM_FLOOR_BYTES} from "./memory-ledger.ts";
import {workerCapBytes} from "../census/worker-memory.ts";
import {TEST_BUILD_DEBUG, TEST_BUILD_OPT_LEVEL} from "./test-artifacts.ts";
import {defaultSlots, frontendBudget} from "./budget.ts";
import {fixedReservation} from "./reservation.ts";
import {STEPS, stepTableProblem} from "./step-table.mjs";
import {finishRunTemporary} from "./run-temporary.ts";
import {gateEnvironment, sealOracleRun, oracleStepEnvironment, reportEnvironment, nodeHeapOomReason, ENVIRONMENT_CONTEXT} from "./canonical-environment.ts";
import {typeScriptOracleDirectory} from '../census/typescript-oracle-capture.ts';
import {typeScriptOracleHandoff} from '../census/typescript-oracle-results.ts';
import {programOracleHandoff} from '../differential/oracle-results.ts';
import {programOracleDirectory} from '../differential/oracle-result-scope.ts';
import {outsideSource} from './source-containment.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
process.chdir(ROOT);

// ---------------------------------------------------------------------------
// The step table (step-table.mjs). One row per `step` line in all.sh;
// `checkTable` fails the run if the two disagree in either direction.
// ---------------------------------------------------------------------------
const BY_NAME = new Map(STEPS.map((s) => [s.name, s]));

// ---------------------------------------------------------------------------
// Environment and budgets.
// ---------------------------------------------------------------------------
let env = process.env;
// The reservation the run was started inside (an admit.ts job's -- which may
// have become this very process -- or an outer gate step's), as it was
// handed: the canonical environment below does not pass a launcher's on.
const LAUNCHER_RESERVATION = process.env[RESERVATION_ENV] || undefined;
const color = (code, text) => `\x1b[${code}m${text}\x1b[0m`;

// ---------------------------------------------------------------------------
// Arguments. `--help` used to start a full run: nothing here read argv, so any
// argument meant "the whole gate". Now a flag this file does not know is an
// error before anything runs, and a bare word is a step name.
// ---------------------------------------------------------------------------
const USAGE = `usage: tooling/gate/all.sh [step ...]        (or: node tooling/gate/run.mjs [step ...])
       tooling/gate/all.sh --help | --steps

Runs the named steps (default: NTS_GATE_STEPS, else every step) at once where
they can be, and prints PASS, FAIL, SKIPPED or NOT RUN for each. Exits 0 only
when every requested step passed.

  --help, -h   this text
  --steps      the step names, one per line, with what each checks
  --tree-only  the steps that read only the tree and take seconds, one per line
  --capabilities  JSON environment capabilities declared by each step

Environment (see the header of tooling/gate/run.mjs for the rest):
  NTS_GATE_STEPS        steps to run, space separated (not with step arguments)
  NTS_GATE_SLOTS        CPU slots for the run (default: NTS_JOBS, else 3/4 of the cores)
  NTS_GATE_FAIL_FAST=1  stop at the first FAIL
  NTS_GATE_ACCEPT_SKIP  step names whose SKIPPED does not make the run red
  NTS_GATE_TIME_STRICT=1  a step much slower than its baseline is a FAIL
  NTS_BIN, NTS_SUITE_BIN, NTS_CHECKERS, CARGO_TARGET_DIR   what is gated
`;
const argSteps = [];
for (const a of process.argv.slice(2)) {
  if (a === "--help" || a === "-h") {
    process.stdout.write(USAGE);
    process.exit(0);
  } else if (a === "--steps") {
    for (const s of STEPS) process.stdout.write(`${s.name.padEnd(24)} ${s.doc ?? ""}\n`);
    process.exit(0);
  } else if (a === "--capabilities") {
    process.stdout.write(JSON.stringify(Object.fromEntries(STEPS.map(s => [s.name, s.capabilities ?? []]))) + "\n");
    process.exit(0);
  } else if (a === "--tree-only") {
    for (const s of STEPS.filter((s) => s.treeOnly)) process.stdout.write(`${s.name}\n`);
    process.exit(0);
  } else if (a.startsWith("-")) {
    process.stderr.write(`run.mjs: unknown option ${a}; nothing ran\n\n${USAGE}`);
    process.exit(2);
  } else {
    argSteps.push(a);
  }
}
if (argSteps.length && (env.NTS_GATE_STEPS ?? "").trim() !== "") {
  process.stderr.write(
    `run.mjs: steps given both as arguments (${argSteps.join(" ")}) and in NTS_GATE_STEPS; nothing ran\n` +
      (argSteps.some((a) => /^[0-9a-f]{7,40}$/.test(a))
        ? "  an argument looks like a commit: a pinned.sh from before 2026-10-07 passed its commit on to all.sh;\n" +
          "  update the checkout that pinned.sh runs from (`git pull`), or drop the argument\n"
        : ""),
  );
  process.exit(2);
}
const target = resolve(env.CARGO_TARGET_DIR ?? join(ROOT, "target"));
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
const RUN_DIR = resolve(env.NTS_GATE_RUN_DIR ?? join(homedir(), ".cache/nts-gate/runs", `${stamp}-${process.pid}`));
try {outsideSource(ROOT,RUN_DIR,"NTS_GATE_RUN_DIR");}
catch(error){usage(error instanceof Error?error.message:String(error));}
let normalized = gateEnvironment(argSteps.length && !env[ENVIRONMENT_CONTEXT] ? {...env,NTS_GATE_STEPS:argSteps.join(" ")} : env, { run: RUN_DIR, standalone: !env[ENVIRONMENT_CONTEXT], oracleAdmissionContext: "gate", oracleRoot: ROOT });
env = normalized.env;
// In-process provisioning resolves tools through the run's canonical PATH too.
if (env.PATH === undefined) delete process.env.PATH;
else process.env.PATH = env.PATH;
// What the run's own process reserves before its steps -- the oracle
// dependency capture -- runs inside the reservation the run was started
// inside, which counts this process; the run's own reservation draws on it
// (reserveMemory), and each step runs inside the run's.
if (LAUNCHER_RESERVATION) env[RESERVATION_ENV] = LAUNCHER_RESERVATION;
reportEnvironment(normalized.report);
// `NTS_BIN` defaults to the build this run makes, not to `./target/release/nts`:
// with CARGO_TARGET_DIR elsewhere the old default gated whatever another session
// last built into ./target (the-gate-drives-target-release-nts).
const ntsBin = resolve(env.NTS_BIN ?? join(target, "release/nts"));
const suiteBin = resolve(env.NTS_SUITE_BIN ?? join(dirname(ntsBin), "nts-suite"));
const host = hostObservations(env);
const cores = host.machineWidth();
const intEnv = (name, fallback) => {
  const v = env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) usage(`${name}=${v} is not a positive number`);
  return n;
};
const SLOTS = Math.floor(intEnv("NTS_GATE_SLOTS", intEnv("NTS_JOBS", defaultSlots(cores))));
// The run's place in the machine's memory queue: the launcher's code says
// (the landing check, the full check), and a shell's own value never reaches
// here (canonical-environment.ts).
const PRIORITY = (() => {
  try { return reservationPriority(priorityOf(env), env, LAUNCHER_RESERVATION); }
  catch (error) { usage(error.message); }
})();
// Its steps inherit its OOM score: a machine that runs out kills the lowest
// priority's work first (memory-ledger.ts's OOM_SCORE).
rankForOom(PRIORITY, (line) => process.stderr.write(`run.mjs: ${line}\n`));
const FRONTENDS = (() => {
  try { return frontendBudget(env, SLOTS); }
  catch (error) { usage(error.message); }
})();
const FAIL_FAST = (env.NTS_GATE_FAIL_FAST ?? "") !== "" && env.NTS_GATE_FAIL_FAST !== "0";
const ACCEPT_SKIP = new Set((env.NTS_GATE_ACCEPT_SKIP ?? "").split(/\s+/).filter(Boolean));
const TIME_STRICT = (env.NTS_GATE_TIME_STRICT ?? "") === "1";
const RECORD_TIMES = (env.NTS_GATE_RECORD_TIMES ?? "") === "1";
// The landing check's ceiling on every step's bound (step-bound.ts); unset in the full check.
const STEP_CEILING = intEnv("NTS_GATE_STEP_CEILING_S", undefined);
const TIMES_FILE = join(HERE, "times.tsv");

function usage(message) {
  process.stderr.write(`${color(31, "FAILED")}: ${message}\n`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// The table against all.sh, and the request against the table, before any
// work: a name that matches nothing used to select nothing and print `green`.
// ---------------------------------------------------------------------------
function checkTable() {
  const listed = spawnSync("sh", [join(HERE, "all.sh"), "--list"], { encoding: "utf8" });
  if (listed.status !== 0) usage(`all.sh --list exited ${listed.status}:\n${listed.stderr}`);
  const names = listed.stdout.split("\n").filter(Boolean);
  const inShell = new Set(names);
  const missingRow = names.filter((n) => !BY_NAME.has(n));
  const missingStep = STEPS.map((s) => s.name).filter((n) => !inShell.has(n));
  if (missingRow.length || missingStep.length) {
    usage(
      "all.sh and run.mjs disagree about the steps:\n" +
        (missingRow.length ? `  in all.sh, no row in run.mjs: ${missingRow.join(" ")}\n` : "") +
        (missingStep.length ? `  in run.mjs, no step in all.sh: ${missingStep.join(" ")}\n` : "") +
        "  add the row (or the step) so every step is scheduled and reported",
    );
  }
  // A dependency on no step, or steps that wait for one another, which would wait for ever.
  const problem = stepTableProblem(STEPS);
  if (problem) usage(`run.mjs: ${problem}`);
}

function requested() {
  const raw = argSteps.length ? argSteps.join(" ") : env.NTS_GATE_STEPS;
  if (raw === undefined || raw.trim() === "") return STEPS.map((s) => s.name);
  const want = raw.split(/\s+/).filter(Boolean);
  const unknown = want.filter((n) => !BY_NAME.has(n));
  if (unknown.length) {
    usage(
      `${argSteps.length ? "the arguments name" : "NTS_GATE_STEPS names"} no such step: ${unknown.join(" ")}\n` +
        (argSteps.length && unknown.some((a) => /^[0-9a-f]{7,40}$/.test(a))
          ? "  that looks like a commit: a pinned.sh from before 2026-10-07 passed its commit on to all.sh; update its checkout\n"
          : "") +
        "  nothing ran; the steps are:\n" + STEPS.map((s) => `    ${s.name}`).join("\n"),
    );
  }
  const set = new Set(want);
  if(want.some(name=>['examples','rc','llvm','llvm-rc','jvm','outcomes','bench-agree'].includes(name)))set.add('program-oracles');
  if(want.some(name=>['typescript-c','typescript-llvm','typescript-jvm'].includes(name)))set.add('typescript-oracles');
  return STEPS.map((s) => s.name).filter((n) => set.has(n));
}

// ---------------------------------------------------------------------------
// Baseline times: what each step cost on a healthy run, in CPU seconds (which
// does not move with the slots a step was given or the load around it, unlike
// wall time). A compiler that got 7x slower made five steps 7x slower and
// nothing noticed for two days; this is what notices.
// ---------------------------------------------------------------------------
function readTimes() {
  return existsSync(TIMES_FILE)?readStepBaseline(readFileSync(TIMES_FILE,'utf8')):new Map();
}
const BASE = readTimes();
const estimate = (name) => BASE.get(name)?.wall ?? 60;
// What each step cost in this target when it last ran (step-scheduling.ts):
// the CPU seconds its checks took when they last passed, separate from the
// committed timing-verdict baseline, and the peaks that size its memory.
const COSTS_DIR = resolve(env.NTS_GATE_COSTS_DIR ?? join(target, "gate-costs"));
const HISTORY_FILE = join(COSTS_DIR, "steps.json");
const HISTORY = readCostHistory(HISTORY_FILE);
const CPU_HISTORY = new Map([...readPreviousStepCpu(join(dirname(RUN_DIR), "latest", "summary.json")), ...stepCpu(HISTORY)]);
const INHERITED_WORK = inheritedStepWork(CPU_HISTORY, (name) => currentStepCpu(BASE.get(name)), STEP_SUCCESSORS);

// ---------------------------------------------------------------------------
// Identities, so a summary says which binary and which tree it is about.
// ---------------------------------------------------------------------------
function sha256(path) {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}
function git(...args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

// ---------------------------------------------------------------------------
// State.
// ---------------------------------------------------------------------------
const startedAt = Date.now();
const results = new Map(); // name -> { verdict, reason, ... }
const running = new Map(); // name -> { child, slots, started, rider, elastic }
let interrupted = null;
let stopping = false;
const startupAbort = new AbortController();
let preparing = true; // the run's scopes, its memory and its capture, before any step
let scopes;
/** @type {{state:"complete"}|{state:"error",reason:string}} */
let scopeCleanup = { state: "complete" };
let summaryWritten = false;
let caseCosts = null;
let typeScriptOracleReference;
let programOracleReference;
const identities = {};
let plan = [];

function stepEnv(step, slots, scope) {
  // The step runs inside the run's slice and the run's memory reservation: a
  // tool in it that reserves memory joins this one instead of queueing again.
  const owned={NTS_TOOLING_SLICE:scope.slice,...reservation.env};
  if(['typescript-c','typescript-llvm','typescript-jvm'].includes(step.name)){
    // Only the successful prerequisite's run-owned root may issue this
    // handoff. A caller's shell variable is never a reference authority.
    if(results.get('typescript-oracles')?.verdict!=='PASS'||!typeScriptOracleReference)throw new ToolingInstrumentError('tooling-setup','TypeScript oracle reference prerequisite did not pass');
    owned.NTS_TYPESCRIPT_ORACLE=JSON.stringify(typeScriptOracleReference);
  }
  if(['examples','rc','llvm','llvm-rc','jvm','outcomes','bench-agree'].includes(step.name)){
    if(results.get('program-oracles')?.verdict!=='PASS'||!programOracleReference)throw new ToolingInstrumentError('tooling-setup','program oracle reference prerequisite did not pass');
    owned.NTS_PROGRAM_ORACLE=JSON.stringify(programOracleReference);
  }
  const e = gateEnvironment(env, { run: RUN_DIR, owned }).env;
  // NTS_JOBS sets the run's budget here; inside a step all.sh would read it as
  // "every knob at once" and undo the slot split.
  delete e.NTS_JOBS;
  delete e.NTS_GATE_STEPS;
  e.NTS_BIN = pinned.nts ?? ntsBin;
  e.NTS_SUITE_BIN = pinned.suite ?? suiteBin;
  e.NTS_CHECKERS = "1";
  e.CARGO_TARGET_DIR = target;
  // Match tests.mjs and the landing check, including Cargo calls in frontend-tsrs.
  e.CARGO_INCREMENTAL ??= "0";
  e.CARGO_PROFILE_DEV_DEBUG ??= TEST_BUILD_DEBUG;
  e.CARGO_PROFILE_DEV_OPT_LEVEL ??= TEST_BUILD_OPT_LEVEL;
  // clippy checks the same tree in a profile nothing else builds, so its
  // artefacts live apart and it runs beside the release build and `cargo test`
  // instead of queueing on their lock. What it lints is unchanged.
  if (step.name === "clippy") e.CARGO_TARGET_DIR = join(target, "clippy");
  e.NTS_GATE_RUN_DIR = RUN_DIR;
  delete e.NTS_GATE_CASE_COSTS_DIR;
  if (caseCosts?.available) e.NTS_GATE_CASE_COSTS_DIR = caseCosts.root;
  if (caseCosts?.available && ["assembles", "jvm-verifies", "dex", "bench-agree", "examples", "rc", "llvm", "llvm-rc", "jvm"].includes(step.name)) {
    e.NTS_GATE_SHADOW_DIR ??= join(homedir(), ".cache/nts-gate/artifact-shadow/v1");
    e.NTS_GATE_SHADOW_HELPER = join(HERE, "artifact-shadow.ts");
  } else delete e.NTS_GATE_SHADOW_DIR;
  e.NTS_GATE_CASE_BINARY_SHA = identities.nts?.sha256;
  // An elastic step's workers ask for tokens; any other step already holds
  // its slots, so whatever token-aware tool it runs must not ask again.
  delete e.NTS_GATE_TOKENS;
  delete e.NTS_GATE_TOKEN_HELD;
  e.NTS_GATE_STEP = step.name;
  e.NTS_GATE_STEP_ATTEMPT = RUN_DIR;
  e.NTS_GATE_STEP_RESULT = join(RUN_DIR, `${step.name}.instrument.json`);
  // What its tools size their workers by. Separately capped supervisor and
  // worker subtrees share the step's retained accounting root.
  e.NTS_GATE_STEP_MEMORY_BYTES = String(stepBudget(step));
  if (step.elastic && tokenAddr) e.NTS_GATE_TOKENS = tokenAddr;
  else e.NTS_GATE_TOKEN_HELD = "1";
  const s = String(slots);
  e.NTS_GATE_JOBS = s;
  e.CARGO_BUILD_JOBS = s;
  e.NTS_SUITE_JOBS = s;
  e.NTS_AGREE_JOBS = s;
  // One lowering of the runtime corpus for two steps: integrity-runtime keeps
  // its `hir --prepared` listings in this run's directory and definitions
  // reads them (both check the binary's sha256; see definitions.ts).
  const shared = join(RUN_DIR, "share", "hir-prepared");
  if (step.name === "integrity-runtime") e.NTS_INTEGRITY_KEEP = shared;
  if (step.name === "definitions" && plan.includes("integrity-runtime")) e.NTS_DEFINITIONS_FROM = shared;
  if (step.name === "compile-time" && plan.includes("integrity-runtime")) e.NTS_COMPILE_TIMES_FROM = shared;
  if (step.name === "addons" && plan.includes("profile")) e.NTS_ADDON_EMITTED = join(ROOT, "target", "gate-profile");
  if (step.name === "c-compiles" && plan.includes("profile")) e.NTS_ADDON_EMITTED = join(ROOT, "target", "gate-profile");
  e.NTS_GATE_COSTS_DIR = COSTS_DIR;
  // The release build's own test262 protocol binary, so the test262 steps do
  // not `cargo run` a debug copy and queue on cargo's lock behind `tests`.
  // Its `select` and `inventory` output is byte-identical to the debug
  // no-default-features build's over all five directories (checked 2026-10-07).
  const protocol = pinned.protocol ?? join(dirname(ntsBin), "nts-test262-protocol");
  if (existsSync(protocol)) e.NTS_TEST262_PROTOCOL = protocol;
  for (const knob of [
    "NTS_INTEGRITY_JOBS", "NTS_DEFINITIONS_JOBS",
    "NTS_ASSEMBLES_JOBS", "NTS_TYPES_CHECK_JOBS", "NTS_JVM_VERIFIES_JOBS",
  ]) e[knob] = s;
  return oracleStepEnvironment(e,step.name);
}

function finish(name, verdict, reason, extra = {}) {
  results.set(name, { verdict, reason, ...extra });
}

function lastLine(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : "";
}

function report(name) {
  const r = results.get(name);
  const log = r.log && existsSync(r.log) ? readFileSync(r.log, "utf8") : "";
  let block = `\n${color(1, name)}\n`;
  if (log) block += log.endsWith("\n") ? log : `${log}\n`;
  const how = r.elastic ? `up to ${r.peak_tokens} token${r.peak_tokens === 1 ? "" : "s"}` : `${r.slots} slot${r.slots === 1 ? "" : "s"}`;
  const held = r.memory?.peak_bytes != null ? `, held ${gib(r.memory.peak_bytes)} of ${gib(r.memory.reserved_bytes)}` : "";
  if (r.wall !== undefined) block += `  ${Math.round(r.wall)}s${r.cpu !== undefined ? ` (cpu ${Math.round(r.cpu)}s, ${how}${held})` : ""}\n`;
  if (r.memory?.over) block += `${color(33, "  memory")}: ${name} held ${gib(r.memory.peak_bytes)}, past its ${gib(r.memory.reserved_bytes)} reservation; its next run reserves by what it held\n`;
  if (r.memory?.grown_bytes || r.memory?.killed) {
    block += `  memory: ${name} was counted for ${gib(r.memory.grant_bytes)} at its end, grown by ${gib(r.memory.grown_bytes)} while it ran; `
      + `${r.memory.killed ?? 0} process(es) killed at its runaway bound of ${gib(r.memory.bound_bytes)}\n`;
  }
  if (r.verdict === "FAIL") block += `${color(31, "FAILED")}: ${name}\n`;
  else if (r.verdict === "SKIPPED") block += `${color(33, "SKIPPED")}: ${name} -- ${r.reason}\n`;
  else if (r.verdict === "INSTRUMENT") block += `${color(33, "INSTRUMENT")}: ${name} -- ${r.reason}\n`;
  process.stdout.write(block);
}

// A test can capture its child's setup stderr on success. The recorded builder
// still belongs to exactly one step; publish its cost after that owner exits,
// without attributing the same build to later cached users.
function dependencyCalls(step = undefined, drained = false) {
  const capability = env.NTS_ORACLE_DEPENDENCIES && JSON.parse(env.NTS_ORACLE_DEPENDENCIES);
  const counts = { cold: 0, hits: 0, held: 0, wallMsSum: 0, pnpmSelectionCommands: 0, byNode: {} };
  if (capability?.admission?.kind !== "gate") return counts;
  const ledger = join(capability.admission.temporary.parent, "oracle-dependency-calls.jsonl");
  if (!existsSync(ledger)) return counts;
  const text = readFileSync(ledger, "utf8"), lines = text.split("\n");
  const trailing = lines.pop();
  // Other active steps may still be appending. The final drained read is strict.
  if (drained && trailing) throw new Error("incomplete oracle capture call record: " + ledger);
  for (const line of lines) {
    const row = JSON.parse(line), part = typeof row.directory === "string" ? relative(capability.admission.temporary.path, row.directory) : "..";
    if (row.version !== 1 || (row.step !== null && typeof row.step !== "string") ||
        typeof row.nodeVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(row.nodeVersion) ||
        !["cold", "hit", "held"].includes(row.mode) || !Number.isFinite(row.wallMs) || row.wallMs < 0 || !Number.isSafeInteger(row.pnpmSelectionCommands) || row.pnpmSelectionCommands < 0 ||
        isAbsolute(part) || part === ".." || part.startsWith(".." + sep) || !row.directory.endsWith(sep + "node-" + row.nodeVersion))
      throw new Error("invalid oracle capture call record: " + ledger);
    if (step !== undefined && row.step !== step) continue;
    const key = row.mode === "hit" ? "hits" : row.mode;
    counts[key]++; counts.wallMsSum += row.wallMs; counts.pnpmSelectionCommands += row.pnpmSelectionCommands;
    const node = counts.byNode[row.nodeVersion] ??= { cold: 0, hits: 0, held: 0, wallMsSum: 0, pnpmSelectionCommands: 0 };
    node[key]++; node.wallMsSum += row.wallMs; node.pnpmSelectionCommands += row.pnpmSelectionCommands;
  }
  return counts;
}
function ownerCalls(step = undefined, drained = false) {
  try {
    const capability = env.NTS_ORACLE_DEPENDENCIES && JSON.parse(env.NTS_ORACLE_DEPENDENCIES);
    return ownerEmissionCalls(capability, { step, drained });
  } catch (error) { return { status: "unreadable", reason: error.message }; }
}

function captureCost(name, log) {
  const capability = env.NTS_ORACLE_DEPENDENCIES && JSON.parse(env.NTS_ORACLE_DEPENDENCIES);
  if (capability?.admission?.kind !== "gate") return null;
  const images = [], calls = dependencyCalls(name), owners = ownerCalls(name), lines = [];
  for (const item of existsSync(capability.directory) ? readdirSync(capability.directory, {withFileTypes:true}) : []) {
    if (!item.isDirectory() || !/^node-\d+\.\d+\.\d+$/.test(item.name)) continue;
    const nodeVersion = item.name.slice(5), record = join(capability.directory, item.name, "ready.json");
    if (!existsSync(record)) continue;
    const bytes = readFileSync(record);
    if (capability.seal?.nodeVersion===nodeVersion && sha256(record)!==capability.seal.readySha256) throw new Error("oracle dependency seal changed: "+record);
    const image = JSON.parse(bytes.toString("utf8"));
    if (image.ownerStep !== name) continue;
    if (image.version !== 1 || image.sourceRevision !== capability.sourceRevision || image.lockfileSha256 !== capability.lockfileSha256 ||
        image.inputSet?.identity?.node !== nodeVersion || !Number.isFinite(image.cost?.wallMs) || image.cost.wallMs <= 0 ||
        !Number.isSafeInteger(image.cost?.peakBytes) || image.cost.peakBytes <= 0)
      throw new Error("invalid oracle dependency capture cost: " + record);
    images.push({record,nodeVersion,cost:image.cost});
    lines.push("oracle dependency capture: " + JSON.stringify({context:"gate",nodeVersion,...image.cost}));
  }
  if (!images.length && !calls.cold && !calls.hits && !calls.held) return null;
  lines.push("oracle dependency calls: " + JSON.stringify(calls));
  lines.push("oracle owner emissions: " + JSON.stringify({ status: owners.status, emits: owners.emits, hits: owners.hits, ownerCount: owners.owners?.length, ledger: owners.ledger }));
  let text = readFileSync(log, "utf8");
  for (const line of lines) if (!text.split("\n").includes(line)) {
    appendFileSync(log, (text && !text.endsWith("\n") ? "\n" : "") + line + "\n");
    text += "\n" + line + "\n";
  }
  return {ownerStep:name,images,calls,owners};
}

// ---------------------------------------------------------------------------
// Scheduling.
// ---------------------------------------------------------------------------
// What the running steps hold: slots, frontends, and the bytes of the run's
// memory reservation they are counted for -- a fixed step its reservation, an
// elastic step its held tokens', each its own size or its step's unit (see
// "Memory").
function used(includeElastic = true) {
  let slots = 0, bytes = 0, fe = 0, riding = 0;
  const locks = new Set();
  let elastic = 0;
  for (const [name, r] of running) {
    const s = BY_NAME.get(name);
    if (s.lock) locks.add(s.lock);
    if (r.elastic) {
      if (!includeElastic) continue;
      // What it holds right now: a token is one process of its workers.
      const held = tokensOf(name, r);
      elastic += 1;
      slots += held;
      bytes += grantOf(name, r);
      if (s.fe) fe += held;
      continue;
    }
    if (r.rider) riding += r.slots;
    else slots += r.slots;
    bytes += grantOf(name, r);
    if (s.fe) fe += r.slots;
  }
  return { slots, bytes, fe, locks, riding, elastic };
}

function blockedBy(step) {
  // A dependency that is requested and failed makes this NOT RUN; one that is
  // requested and unfinished makes it wait.
  for (const d of step.needs ?? []) {
    if (!plan.includes(d)) continue;
    const r = results.get(d);
    if (r === undefined) return { wait: true };
    if (r.verdict !== "PASS") return { notRun: `needs ${d}, which is ${r.verdict}` };
  }
  for (const d of step.after ?? []) {
    if (plan.includes(d) && !results.has(d)) return { wait: true };
  }
  if (step.nts && plan.includes("build")) {
    const r = results.get("build");
    if (r === undefined) return { wait: true };
    if (r.verdict !== "PASS") return { notRun: `needs build, which is ${r.verdict}` };
  }
  return null;
}

function preflight(step) {
  if (!step.nts) return null;
  if (!existsSync(ntsBin)) return `no compiler at ${ntsBin}`;
  return null;
}

function order(names) {
  // Start the longest uncontended steps first: a step's work over the slots it
  // can use, the same work estimate that weighs its claims on tokens.
  return orderStepStarts(names, (name) => workEstimate(name) / width(name));
}
const width = (name) => usableWidth(BY_NAME.get(name) ?? {}, { slots: SLOTS, frontends: FRONTENDS });
// A step that takes a minute or so rides free beside the budget (up to a
// quarter over it), at its minimum slots: the run's first verdicts arrive in
// its first minutes, and the long steps are not cut down to a sliver of the
// budget at t=0 by checks that would have finished almost at once.
const tiny = (step) => estimate(step.name) <= 90 && !BY_NAME.get(step.name).favoured;

// What a step may start with now: `slots` (a rider's are counted apart), or
// none while it waits. `short` is what the run's reservation lacks for a step
// that waits only for memory.
function admit(step, u) {
  const free = SLOTS - u.slots;
  const want = Math.min(step.slots, SLOTS);
  const least = Math.min(step.min ?? Math.max(1, Math.ceil(step.slots / 2)), want);
  if (step.lock && u.locks.has(step.lock)) return { slots: 0 };
  if (step.elastic && tokenAddr) {
    // Started with its whole pool of workers; they wait for tokens, so
    // starting it takes no slot, and no memory: each token is granted its
    // share. A cap on how many wait at once keeps the idle workers (a shell
    // or node each) to a few hundred megabytes.
    return { slots: u.elastic >= ELASTIC_CAP ? 0 : step.slots };
  }
  let slots = 0, rider = false;
  if (running.size === 0) slots = want; // always make progress
  else {
    const feFree = step.fe ? FRONTENDS - u.fe : Infinity;
    if (free >= least && feFree >= least) slots = Math.min(want, free, feFree);
    // Riders: a step of a minute or so that finds the budget full starts anyway
    // at its minimum, on a quarter of the budget kept for them and counted
    // apart, so the run's first verdicts arrive in its first minutes and a long
    // step waiting for its slots is not squeezed out by them (integrity-runtime
    // waited 814 s behind riders counted in the budget).
    else if (tiny(step)) {
      const ride = Math.max(1, Math.min(step.min ?? 1, want));
      if (u.riding + ride <= Math.max(1, Math.ceil(SLOTS * 0.25))) { slots = ride; rider = true; }
    }
  }
  if (slots === 0) return { slots: 0 };
  // Memory is granted before slots are used, rider or not: the step's whole
  // reservation within the run's.
  const bytes = stepBytes(step, slots), short = u.bytes + bytes - reserved();
  return short > 0 ? { slots: 0, short, bytes } : { slots, rider };
}

// ---------------------------------------------------------------------------
// Tokens.
//
// **The budget is a pool of SLOTS tokens, one per running process of work.**
// A fixed step (cargo, nts-suite, the test binaries: parallel inside one
// process) holds the slots it was started with until it ends. An elastic
// step's workers each take a token around the process they run -- token.sh in
// shell loops, tokens.mjs in node pools -- and give it back when it exits. So
// a step's share follows its work: `profile` ran its whole life on the two
// slots it was granted at second 125 while slots freed elsewhere stood idle,
// and a fixed grant cannot see that.
//
// A token is a TCP connection to this process: the client sends one line,
// `want <step> <pid>`, gets `go` when granted, and holds the token until the
// connection closes -- which the kernel does however the holder ends, so a
// token cannot leak. Waiting costs nothing: a worker blocks on a read.
//
// Who gets a freed token: the step with the most estimated work left per token
// it holds (`workEstimate` minus the token-seconds it has used), plus
// the seconds its oldest worker has waited, so a short step is never starved
// by a long one; the favoured step's claim counts double. A token is granted
// only with its size in the run's reservation: the size its request names --
// what its case was measured to hold -- or else one token's reservation of
// its step (`tokenBytes`). A step's first request that fits goes first, so a
// small case is not held behind a large one of its step that waits for
// memory; requests of its unit are as before, its oldest first. A sized
// token's step has its limits raised to hold it before it is answered.
// Tokens, and the memory they would take, are kept back for the first fixed
// step that waits (`withhold`, `withholdBytes`).
// ---------------------------------------------------------------------------
const ELASTIC_CAP = Math.max(6, Math.ceil(SLOTS * 0.75));
let withhold = 0;

// A step's work in CPU seconds: its own last passing run, else its share of a
// predecessor's (step-successors.ts), else the committed baseline.
function workEstimate(name) {
  const own = CPU_HISTORY.get(name) ?? INHERITED_WORK.get(name) ?? currentStepCpu(BASE.get(name));
  if (typeof own === "number" && own > 0) return own;
  return estimate(name) * width(name);
}

// How long a step may run before it is stopped and held (step-bound.ts): its
// row's stated bound, else three times its work and the run's over their slots,
// and never above a landing check's ceiling.
function boundOf(step) {
  return stepBound(step, workEstimate(step.name), width(step.name), { cost: plan.reduce((sum, name) => sum + workEstimate(name), 0), slots: SLOTS }, STEP_CEILING);
}

const caseMemory=new CaseMemoryBroker({root:ROOT,env,host,
  boundary:name=>{
    const owned=running.get(name);if(!owned)throw Error(`case memory: ${name} has no running step`);
    return {group:owned.scope.workerGroup,raise:bytes=>owned.scope.caseLimit(Math.max(bytes,Math.ceil((owned.charge??0)*1.25)))};
  },report:message=>process.stderr.write(message+'\n')});
const tok = createTokenPool({
  now:()=>host.now(),
  prepare:request=>caseMemory.prepare(request),
  attach:(request,scope)=>caseMemory.attach(request,scope),
  retire:(request,group)=>caseMemory.retire(request,group),
  completed:request=>caseMemory.completed(request),
  failed:error=>stop(`case memory: final observation failed: ${String(error)}`),
  // `used()` counts the tokens held in an elastic step's share.
  free: () => stopping ? 0 : SLOTS - used().slots - withhold,
  claim: (step, { held, used: spent, waitedS }) => {
    const left = Math.max(10, workEstimate(step) - spent);
    const c = left / (held + 1) + waitedS;
    return BY_NAME.get(step)?.favoured ? 2 * c : c;
  },
  // A token is a case starting, so it needs its size -- its request's, else its
  // step's token reservation -- in the run's reservation, beside what a waiting
  // fixed step has withheld; when it does not fit, the run may ask the ledger
  // for more.
  eligible: (step, bytes) => {
    if (outranked()) return false;
    const row = BY_NAME.get(step);
    if (!row) return true;
    const u = used();
    if (row.fe && u.fe >= FRONTENDS) return false;
    if (u.bytes + withholdBytes + (bytes ?? tokenBytes(row)) <= reserved()) return true;
    wantMemory();
    return false;
  },
  // A sized token is answered once its step's slice can hold it: when its
  // grant, now with this token, takes the runaway bound past the slice's
  // MemoryMax, the bound is raised before its case starts.
  answering: (step) => {
    const r = running.get(step);
    if (!r?.elastic || r.draining) return null;
    const max = runawayBound(limitOf(step, r));
    if (max <= r.scope.limits.max) return null;
    return r.scope.limit({ max })
      .catch(error => process.stderr.write(`run.mjs: ${step}'s runaway bound stays at ${gib(r.scope.limits.max)}: ${error.message}\n`));
  },
  known: (step) => BY_NAME.has(step),
  observe: (event) => {
    caseCosts?.record({ ...event, compiler_sha: identities.nts?.sha256, memory: memoryState(),
      used: { slots: used().slots, fe: used().fe }, slots: SLOTS, frontends: FRONTENDS, withhold });
    // Observe actual token transitions too: a case can start and finish
    // between clock polls, and all of its execution must spend the budget.
    if (event.event === "pool.change") observeStepBounds();
    // Cancellation is traced before its request leaves the waiting list.
    if (event.event === "token.cancel") queueMicrotask(observeStepBounds);
  },
  released: () => { if (!stopping) schedule(); },
});
let tokenAddr = null;
const grant = () => { if (tokenAddr) tok.grant(); };
const account = () => tok.account();
// Sampling never calls schedule(), grant(), or any other policy decision.
const costClock = setInterval(() => caseCosts?.record({ event: "pool.state", memory: memoryState(),
  used: { slots: used().slots, fe: used().fe }, slots: SLOTS, frontends: FRONTENDS, withhold,
  held: Object.fromEntries(tok.held), ...(tok.sized.size ? { sized: Object.fromEntries(tok.sized) } : {}),
  waiting: tok.waiting.map(w => ({ request:w.id, step:w.step, pid:w.pid, bytes:w.bytes })),
  running: [...running.keys()],
  fixed_grants: Object.fromEntries([...running].filter(([,r]) => !r.elastic).map(([name,r]) => [name,{ slots:r.slots, rider:r.rider }])),
  runner_cpu: process.resourceUsage() }), 500);
costClock.unref();

// Only lower the others when a favoured step is in this run at all.
const FAVOURED_PLANNED = () => plan.some((n) => BY_NAME.get(n).favoured);

let pending = [];

// ---------------------------------------------------------------------------
// Memory.
//
// **The run holds one reservation in the machine's memory ledger**
// (memory-ledger.ts), at the priority its launcher gave it, and the ledger
// is the only thing that decides whether there is memory for it: no step and
// no token reads the host's free memory. The reservation is measured as the
// run's own slice cgroup, which holds every step's slice, so the ledger sees
// the whole run as one job. A running step is counted for its grant: a fixed
// step its reservation, an elastic step its held tokens' -- each its own size
// when its request named one, else one token's share -- each with what it
// grew by while it ran (`used()`).
//
// **A step's sibling boundaries bound runaways** (`runawayBound`). The
// supervisor and workers have separate MemoryMax limits under one accounting
// root, so worker pressure leaves the supervisor able to record it. Each is
// twice what the step was measured to hold, and never below its grant and
// a block or a quarter of it more, with no swap and no MemoryHigh: nothing
// throttles a step to its grant, since anonymous memory held at MemoryHigh
// without swap does not slow but stops, and a stopped step's wall clock runs
// on. A step killed at its bound is memory pressure -- held as an INSTRUMENT
// (a census requeues the case), never a FAIL. The grant is the ledger's
// accounting, and the machine's own OOM killer takes the lowest priority's
// work first (`OOM_SCORE`).
//
// **A step reserves what it was measured to hold** (step-scheduling.ts): per
// unit -- the step, or one token -- 1.25 times the largest of the peaks its
// last few runs left in this target's history; never measured here, the
// largest a unit of its kind reserves here, or with none its share of the
// machine, and either way no more than the widest step's share
// (`planMemory`). The run samples each running step's slice every
// SAMPLE_MS on the ledger's own basis (cgroupCharge), and its peak goes to the
// step's summary row -- `over` when it passed what the step was counted for,
// and the ledger's entry says so -- and to the history, for its next run.
// Unmeasured steps are named in the run's entry from the start.
//
// **A grant grows while its step runs** (`watchMemory`), for the ledger's
// accounting. A step whose charge nears its grant (within an eighth), or
// passed it, wants what it is over by and a quarter of its grant more, at
// least 64 MiB: the reservation's slack gives it at once, else the run's
// growth does, and its runaway bound rises with it. The charge leaves out
// page cache. Nothing waits for a growth: the step runs on while the run asks.
// An elastic step's bound follows its tokens, lowered only once its charge is
// clear of it.
//
// **It grows by what waits.** When a step that has its slots, or a token that
// has a free slot, does not fit beside what runs, the run asks the ledger for
// the shortfall, rounded up to a whole BLOCK, one growth at a time, and only
// when the whole shortfall fits within what the machine could ever give it
// (`capacity`); once it is admitted, scheduling and token grants run again. A
// growth no longer needed while it waits is withdrawn, so it never holds the
// ledger's queue for nothing.
//
// **It gives back what it does not use.** Whatever the reservation holds
// beyond two blocks above what runs and what a waiting step has claimed goes
// back to the ledger at once, as steps end and tokens return. That holds
// while a growth waits, too: a run that sat on memory it is not using while
// it waited for more could hold another job's request, which could hold this
// run's growth behind it for ever. The two blocks of slack keep a run whose
// steps start and end from asking and giving back around every one of them.
//
// **A fixed step that waits is not starved by tokens.** The first fixed step
// that waits, and could start once tokens return, has its slots withheld from
// token grants (`withhold`), and its memory too when the reservation already
// holds it beside the fixed steps running (`withholdBytes`): elastic workers,
// which ask again the moment a case ends, cannot take each byte as it comes
// back. A step the reservation cannot hold yet claims nothing: its memory
// comes from the growth, and tokens keep the reservation busy meanwhile.
//
// **It yields to a request that outranks it.** While a request of higher
// priority than the run's waits in the ledger (`outranked`, read on every
// scheduling and grant decision, at most once a second), the run starts no
// step, grants no token, grows by nothing, and gives back at once everything
// beyond what runs: the request ahead of it waits only for the cases running
// now to end, never for the rest of the run. Nothing running is stopped.
// Once no such request waits, the run goes on as before. Without it, a
// landing check could wait behind a full check's whole reservation until
// the full check had finished.
// ---------------------------------------------------------------------------
const GiB = 2 ** 30;
// One gibibyte: steps reserve a few hundred megabytes to a few gibibytes
// each, so a run grows from one block to its peak in a few dozen growths,
// each one ledger decision, and is never more than a block above what it
// asked for.
const BLOCK = GiB;
const SAMPLE_MS = 250;
let reservation = null;
// What the machine could ever give this run: MemTotal less the floor the
// ledger keeps for the system. No step reserves more: one that needs it all
// runs alone.
let capacity = 0, totalBytes = 0;
// What each step reserves per unit, and why: name -> { unit, bytes, basis }.
const MEMORY = new Map();
// What each step that ran to its own end held at most, per unit, for the history: name -> { unit, peak }.
const observations = new Map();
// A step's share of what the ledger can ever give the run: a run whose every
// slot is busy with unmeasured steps fits in it.
const shareOf = (step, units = width(step.name)) => machineShare(capacity, units, SLOTS);
function sizing(step) {
  let sized = MEMORY.get(step.name);
  if (!sized) {
    const unit = step.elastic ? "token" : "step";
    const { bytes, basis } = unitReservation(HISTORY, { step: step.name }, unit, shareOf(step, step.elastic ? 1 : width(step.name)));
    // Unmeasured, the whole step reserves at most the widest step's share.
    const most = basis === "measured" ? capacity : Math.floor(unmeasuredLimit(capacity) / (step.elastic ? width(step.name) : 1));
    sized = { unit, bytes: Math.max(1, Math.min(bytes, most)), basis };
    MEMORY.set(step.name, sized);
  }
  return sized;
}
/** Every planned step's reservation, once the machine's size is known. */
const planMemory = () => { for (const name of plan) sizing(BY_NAME.get(name)); };
const tokenBytes = (step) => sizing(step).bytes;
// A fixed step's reservation; an elastic step's for `slots` tokens, as it is
// counted while it runs without a token server, and while it drains.
const stepBytes = (step, slots = width(step.name)) => Math.min(capacity, step.elastic ? sizing(step).bytes * slots : sizing(step).bytes);
// What a step's tools size their workers by (NTS_GATE_STEP_MEMORY_BYTES): its
// grant at its full width and a margin above it, never below one census
// worker's own cap.
const stepBudget = (step) => Math.max(withMargin(stepBytes(step)), workerCapBytes(env));
const PAGE = 4096;
const pages = (bytes) => Math.ceil(bytes / PAGE) * PAGE;
// A grant and a block or a quarter of it more, whichever is more.
const withMargin = (grant) => pages(grant + Math.max(BLOCK, grant / 4));
// A step's MemoryMax: twice what it was measured to hold (a grant is
// RESERVATION_PER_PEAK times that), never below its grant and a margin, and
// never past what the machine could ever give the run. Only a runaway
// reaches it.
const runawayBound = (grant) => Math.min(pages(capacity), Math.max(withMargin(grant), pages(2 * grant / RESERVATION_PER_PEAK)));
// How near its grant a running step's charge comes before the run grows it:
// within an eighth of it.
const nearGrant = (grant) => grant / 8;
const MIB = 2 ** 20;
// What a step grows by beyond what it is over by: a quarter of its grant, at
// least 64 MiB -- a block for a 4 GiB step, never a block of the run's memory
// for one whose processes merely start near a small reservation.
const growthOf = (grant) => Math.max(grant / 4, 64 * MIB);
// The tokens an elastic step holds now; while it drains, its whole width.
const tokensOf = (name, r) => r.draining ? r.slots : tok.held.get(name) ?? 0;
// What an elastic step's tokens are counted for: each sized one at its size,
// each other at its step's unit; while it drains, its whole width of units.
const heldBytes = (name, r) => elasticHeldBytes(tokensOf(name, r), r.draining ? undefined : tok.sized.get(name), tokenBytes(BY_NAME.get(name)));
// What a running step is granted: a fixed step its reservation; an elastic
// step its held tokens'; each with what it grew by while it ran.
function grantOf(name, r) {
  const step = BY_NAME.get(name);
  return (r.elastic ? heldBytes(name, r) : stepBytes(step, r.slots)) + r.extra;
}
// What its runaway bound is reckoned from: its grant, and for an elastic step
// holding less than one token's share, one token's share all the same, for
// its idle workers, which the run does not count (starting it takes no
// memory, as above).
function limitOf(name, r) {
  const step = BY_NAME.get(name);
  return r.elastic ? Math.max(heldBytes(name, r), tokenBytes(step)) + r.extra : grantOf(name, r);
}
let growth = null; // { bytes, controller, withdrawn } while a growth waits
// What the run must hold for the first step that waits only for memory to
// start beside what runs (schedule); 0 when none waits.
let memoryWanted = 0;
let withholdBytes = 0;
let memoryCheck = null;
const memoryRecord = { peak_bytes: 0, waited_s: 0, growths: 0, withdrawn: 0, shrinks: 0, outranked: 0, outranked_s: 0,
  steps_grown: 0, steps_killed: 0 };
// The ledger's last answer to `outranked`, when it was read, and since when it has been yes.
let outrankedNow = false, outrankedRead = 0, outrankedSince = 0, outrankedLook = null;
const reserved = () => reservation?.bytes ?? 0;

// What a waiting token lacks in the reservation, beside what runs and what a
// waiting step has claimed: the most among the steps whose workers wait while
// a slot is free for them, each for its oldest request -- its size, else its
// step's token share.
function tokenShort(u) {
  if (!tokenAddr || SLOTS - u.slots - withhold <= 0) return 0;
  let short = 0;
  const oldest = new Map();
  for (const w of tok.waiting) if (!oldest.has(w.step)) oldest.set(w.step, w);
  for (const [step, w] of oldest) {
    const row = BY_NAME.get(step);
    if (!row || (row.fe && u.fe >= FRONTENDS)) continue;
    short = Math.max(short, u.bytes + withholdBytes + (w.bytes ?? tokenBytes(row)) - reserved());
  }
  return short;
}

// The run's memory as the case costs record it: a token waits for memory
// while `token_short_bytes` is above zero.
const memoryState = () => {
  const u = used();
  return { reserved_bytes: reserved(), used_bytes: u.bytes, withheld_bytes: withholdBytes, wanted_bytes: memoryWanted,
    token_short_bytes: Math.max(0, tokenShort(u)), growing_bytes: growth?.bytes ?? 0 };
};

// A token the pool could not grant for memory: look again once the grant is
// over, outside the pool's own loop.
function wantMemory() {
  memoryCheck ??= setImmediate(() => { memoryCheck = null; adjustMemory(); });
}

// What a step's slice holds now, on the ledger's own basis.
function chargeOf(scope) {
  return host.cgroupCharge(scope.group);
}
function sampleStep(r) {
  try { r.charge = chargeOf(r.scope); r.peakCharge = Math.max(r.peakCharge ?? 0, r.charge); }
  catch(error) { if(error instanceof HostObservationError)throw error; /* the slice went as it was read */ }
}
// Every SAMPLE_MS: each running step's charge; a step whose charge nears its
// grant, or passed it, wants more -- a quarter of its grant, at least 64 MiB,
// beyond what it is over by -- which the reservation's slack gives at once,
// or else the run's growth; and each slice's runaway bound follows its grant.
// The charge leaves out file pages and reclaimable slab, as the ledger's
// does. Outranked, the run grows no step's grant; nothing holds the step.
const memoryClock = setInterval(watchMemory, SAMPLE_MS);
memoryClock.unref();
function watchMemory() {
  if (stopping || summaryWritten) return;
  if (reservation && !reservation.active()) {
    stop(`memory: gate run reservation ${reservation.id} ended while the run was active`);
    return;
  }
  account();
  const yielding = reservation !== null && outranked();
  for (const [name, r] of running) {
    if (r.draining) continue;
    sampleStep(r);
    const grant = limitOf(name, r);
    if (yielding || stopping) { r.want = 0; continue; }
    if (r.charge >= grant - nearGrant(grant)) r.want = Math.max(r.want, Math.ceil((Math.max(0, r.charge - grant) + growthOf(grant)) / MIB) * MIB);
  }
  feedSteps();
  for (const [name, r] of running) if (!r.draining) applyBound(name, r);
  if (!yielding && [...running.values()].some(r => r.want > 0)) adjustMemory();
}
// What running steps want beyond their grants, from the reservation's slack.
function feedSteps() {
  for (const [name, r] of running) {
    if (r.draining || r.want <= 0) continue;
    const free = reserved() - used().bytes - withholdBytes;
    if (free <= 0) continue;
    const give = Math.min(r.want, free);
    r.extra += give;
    r.want -= give;
    r.grown += give;
    process.stderr.write(`-- ${name}: memory grown by ${gib(give)} to ${gib(limitOf(name, r))} (charge ${gib(r.charge)})\n`);
  }
}
// Moves a step's slice's MemoryMax to the runaway bound of its grant. Lowered
// -- an elastic step's tokens given back -- only once its charge is clear of
// the lower bound, so no running step is killed for what it already holds.
function applyBound(name, r) {
  const held = r.scope.limits.max;
  let max = runawayBound(limitOf(name, r));
  if (max < held && r.charge + nearGrant(max) > max) max = held;
  void r.scope.caseLimit(Math.max(caseMemory.caps(name),Math.ceil((r.charge??0)*1.25)))
    .catch(error=>stop(`case memory: ${name} worker cap failed: ${error.message}`));
  if (max === held) return;
  r.scope.limit({ max })
    .catch(error => process.stderr.write(`run.mjs: ${name}'s runaway bound stays at ${gib(r.scope.limits.max)}: ${error.message}\n`));
}

const noteSize = () => { memoryRecord.peak_bytes = Math.max(memoryRecord.peak_bytes, reserved()); };

// Whether a request of higher priority than the run's waits in the ledger (see "Memory").
function outranked() {
  if (!reservation) return false;
  const now = Date.now();
  if (now - outrankedRead < 1000) return outrankedNow;
  outrankedRead = now;
  let answer = false;
  try { answer = reservation.outranked(); }
  catch (error) { process.stderr.write(`run.mjs: cannot read the memory ledger's queue: ${error.message}\n`); }
  if (answer && !outrankedNow) {
    outrankedSince = now;
    memoryRecord.outranked++;
    process.stdout.write("  memory: a request of higher priority than the run's waits in the ledger: the run starts nothing new and gives back what it does not use\n");
  } else if (!answer && outrankedNow) {
    memoryRecord.outranked_s += (now - outrankedSince) / 1000;
    process.stdout.write(`  memory: no request of higher priority waits any more: the run goes on after ${Math.round((now - outrankedSince) / 1000)} s\n`);
  }
  outrankedNow = answer;
  // A token can discover the higher priority waiter before any case starts.
  // Then no case completion is available to schedule the run again.
  if (answer && !stopping && !summaryWritten) lookAgain();
  return answer;
}

// Outranked, the run may have nothing left that would schedule it again, so
// it looks at the ledger again every second until it goes on.
function lookAgain() {
  outrankedLook ??= setTimeout(() => { outrankedLook = null; schedule(); }, 1000);
}

function observeStepBounds() {
  const u = used(), now = host.now();
  for (const r of running.values()) r.observeBound?.(now, u);
}

/** The steps this run sizes without a measurement of their own in this target's history. */
const unmeasured = () => plan.filter(name => MEMORY.get(name)?.basis !== "measured");

/**
 * The run's reservation, before anything of it starts: one block, at its
 * priority, with each planned step's own sized from the history.
 */
async function reserveMemory() {
  ({ totalBytes } = machineMemory(env));
  capacity = totalBytes - SYSTEM_FLOOR_BYTES;
  planMemory();
  // The reservation the launcher hands over (the landing build's) ends as
  // this one is admitted. It is the run's to take once: nothing the run
  // starts carries it, and no re-entry of the gate's environment revives it
  // (canonical-environment.ts).
  const replaces = env.NTS_MEMORY_HANDOVER || undefined;
  delete env.NTS_MEMORY_HANDOVER;
  // A run always holds its own: its size moves with its steps, which only its
  // holder can do. One handed down by its launcher stays the launcher's, and
  // the run draws on what that one has unused first, so a launcher that
  // waits for its run never holds the run's memory from it.
  const own = { ...env };
  delete own[RESERVATION_ENV];
  const asked = Date.now();
  reservation = await reserve({ bytes: BLOCK, what: `gate run ${RUN_DIR}`, priority: PRIORITY, owner: { cgroup: scopes.group }, unmeasured: unmeasured(), replaces,
    drawsOn: LAUNCHER_RESERVATION },
    { env: own, signal: startupAbort.signal, report: (line) => process.stdout.write(`  ${line}\n`) });
  memoryRecord.waited_s += (Date.now() - asked) / 1000;
  noteSize();
}

// After every scheduling pass: grow by what waits, withdraw a growth nothing
// needs any more, give back slack beyond two blocks -- or, outranked, give
// back everything beyond what runs and grow by nothing.
function adjustMemory() {
  if (stopping || summaryWritten || !reservation) return;
  const u = used(), yielding = outranked();
  const back = yielding ? reserved() - Math.max(1, u.bytes)
    : Math.floor((reserved() - u.bytes - withholdBytes - 2 * BLOCK) / BLOCK) * BLOCK;
  if (back > 0) {
    memoryRecord.shrinks++;
    reservation.shrink(back).catch(error => process.stderr.write(`run.mjs: the memory ledger kept the ${gib(back)} the run gave back: ${error.message}\n`));
  }
  let need = Math.max(memoryWanted - reserved(), tokenShort(u),u.bytes+withholdBytes-reserved());
  // Past what the machine could ever give, what waits fits only once running
  // work ends: a growth toward it would be slack the next pass gives back, and
  // asking again would spin.
  if (need > capacity - reserved()) need = 0;
  // What running steps want beyond their grants: as much as the machine
  // could give.
  const wanted = [...running.values()].reduce((sum, r) => sum + (r.draining ? 0 : r.want), 0);
  if (wanted) need = Math.max(need, Math.min(u.bytes + withholdBytes + wanted - reserved(), capacity - reserved()));
  // A growth that waits stays queued while the run yields: the request that
  // outranks the run is ahead of it, so it cannot be admitted before that one.
  if (growth) {
    if (need <= 0 && !growth.withdrawn) { growth.withdrawn = true; growth.controller.abort(); }
    return;
  }
  if (need <= 0 || yielding) return;
  const bytes = Math.min(Math.ceil(need / BLOCK) * BLOCK, capacity - reserved());
  const controller = new AbortController(), asked = Date.now();
  growth = { bytes, controller, withdrawn: false };
  reservation.grow(bytes, { signal: controller.signal }).then(() => {
    memoryRecord.growths++;
    noteSize();
  }, error => {
    if (controller.signal.aborted) { memoryRecord.withdrawn++; return; }
    // The ledger failed under the run: no step can be given memory now.
    stop(`memory: ${error.message}`);
  }).finally(() => {
    memoryRecord.waited_s += (Date.now() - asked) / 1000;
    growth = null;
    schedule();
  });
}

function schedule() {
  // A priority recheck can fire while the oracle seal is being captured.
  // The empty queue during startup does not mean that every step has drained.
  if (preparing || stopping || summaryWritten) return;
  const yielding = outranked();
  let progressed = true;
  while (progressed) {
    progressed = false;
    withhold = 0;
    withholdBytes = 0;
    memoryWanted = 0;
    for (const name of pending) {
      const step = BY_NAME.get(name);
      const b = blockedBy(step);
      if (b?.notRun) {
        finish(name, "NOT RUN", b.notRun);
        pending = pending.filter((n) => n !== name);
        process.stdout.write(`\n${color(1, name)}\n  ${color(33, "NOT RUN")}: ${b.notRun}\n`);
        progressed = true;
        break;
      }
      if (b?.wait) continue;
      const pre = preflight(step);
      if (pre) {
        finish(name, "NOT RUN", pre);
        pending = pending.filter((n) => n !== name);
        process.stdout.write(`\n${color(1, name)}\n  ${color(33, "NOT RUN")}: ${pre}\n`);
        progressed = true;
        break;
      }
      if (yielding) continue;
      const u = used();
      const granted = admit(step, u);
      if (granted.slots === 0) {
        if (granted.short > 0 && !memoryWanted) memoryWanted = u.bytes + granted.bytes;
        // The first step in order that waits for slots or memory has tokens
        // kept for it as elastic workers give them back, or elastic steps --
        // which ask again the moment a case ends -- would take each one as it
        // frees and a fixed step would wait for a gap that never comes. Its
        // memory is kept too once the reservation holds it beside the fixed
        // steps; until then it comes from a growth (see "Memory").
        // Returning elastic grants cannot free resources held by fixed steps.
        // Reserve only if those returns could make the candidate fit.
        if (!step.elastic && !withhold && !(step.lock && u.locks.has(step.lock))) {
          const fixed = used(false), bytes = stepBytes(step);
          withhold = fixedReservation(step, bytes, fixed, { slots: SLOTS, bytes: capacity, fe: FRONTENDS });
          withholdBytes = withhold && fixed.bytes + bytes <= reserved() ? bytes : 0;
        }
        continue;
      }
      pending = pending.filter((n) => n !== name);
      start(step, granted.slots, granted.rider);
      progressed = true;
      break;
    }
  }
  grant();
  adjustMemory();
  if (pending.length === 0 && running.size === 0) done();
  else if (outrankedNow && !summaryWritten) lookAgain();
}

function start(step, slots, rider = false) {
  const bound = boundOf(step);
  let scope;
  // Its slice bounds a runaway from the start (see "Memory").
  const elastic = Boolean(step.elastic && tokenAddr), grant = elastic ? tokenBytes(step) : stepBytes(step, slots);
  try { scope = scopes.step({ max: runawayBound(grant) }); }
  catch (error) {
    finish(step.name, "INSTRUMENT", `step scope setup failed: ${error.message}`, { instrument: { kind: "tooling-setup", verdict: "INSTRUMENT" } });
    report(step.name); stop(`step scope setup failed: ${error.message}`); return;
  }
  const log = join(RUN_DIR, `${step.name}.log`);
  const timeFile = join(RUN_DIR, `${step.name}.gnu-time`);
  rmSync(join(RUN_DIR, `${step.name}.instrument.json`), { force: true });
  const fd = openSync(log, "w");
  let cmd = ["sh", join(HERE, "all.sh"), "--call", step.name];
  if (existsSync("/usr/bin/time")) cmd = ["/usr/bin/time", "-f", "%e %U %S %M", "-o", timeFile, ...cmd];
  if (!step.favoured && FAVOURED_PLANNED()) cmd = ["nice", "-n", "5", ...cmd];
  const launch = scope.command(cmd[0], cmd.slice(1));
  const child = spawn(launch.command, launch.args, {
    cwd: ROOT,
    env: stepEnv(step, slots, scope),
    stdio: ["ignore", fd, fd],
    detached: true,
  });
  closeSync(fd);
  const started = Date.now();
  // `extra`: what it grew by while it ran; `want`: what it waits to grow by;
  // `grown`: what it grew by in all.
  const owned = { child, slots, started, rider, elastic, scope, draining: false, overBound: false, peakCharge: undefined,
    charge: 0, extra: 0, want: 0, grown: 0 };
  running.set(step.name, owned);
  // **Past its bound the step is stopped through its own scope** and held: its
  // log stays, and it is neither a pass nor a red verdict about the change.
  // Killed again until it exits: a kill reaches only what its scope holds.
  let boundTimer;
  const boundStarted = host.now(), boundClock = new StepBoundClock(bound.seconds, boundStarted, STEP_CEILING);
  let boundState = boundClock.observe(boundStarted), boundFailure;
  owned.observeBound = (now, u) => {
    const waiting = stepBoundWait({ elastic, held: tokensOf(step.name, owned), outranked: outrankedNow,
      requests: tok.waiting.filter(request => request.step === step.name).map(request => request.bytes ?? tokenBytes(step)),
      freeSlots: SLOTS - u.slots - withhold, freeFrontends: step.fe ? FRONTENDS - u.fe : Infinity,
      freeBytes: reserved() - u.bytes - withholdBytes });
    boundState = boundClock.observe(now, waiting);
  };
  const stopAtBound = () => {
    if (!stopping) owned.overBound = true;
    try { scope.kill(); }
    catch (error) { stop(`cannot stop ${step.name} at its bound: ${error.message}`); return; }
    boundTimer = setTimeout(stopAtBound, 5000);
    boundTimer.unref();
  };
  const checkBound = () => {
    outranked();
    owned.observeBound(host.now(), used());
    if (boundState.expired) {
      boundFailure = boundState.used_s < bound.seconds && STEP_CEILING !== undefined
        ? `step exceeded the landing wall ceiling of ${STEP_CEILING} s` : stepBoundReason(bound.seconds);
      stopAtBound();
    } else {
      boundTimer = setTimeout(checkBound, 500);
      boundTimer.unref();
    }
  };
  boundTimer = setTimeout(checkBound, Math.min(500, bound.seconds * 1000));
  boundTimer.unref();
  process.stderr.write(elastic
    ? `-- ${step.name} started (${slots} workers on tokens; ${running.size} running; execution bound ${bound.seconds} s; admission waits excluded${STEP_CEILING === undefined ? "" : `; wall ceiling ${STEP_CEILING} s`})\n`
    : `-- ${step.name} started (${slots} slot${slots === 1 ? "" : "s"}; ${running.size} running; bound ${bound.seconds} s)\n`);
  let completed = false;
  const complete = async (code, signal, spawnError) => {
    if (completed) return;
    completed = true;
    clearTimeout(boundTimer);
    delete owned.observeBound;
    boundState = boundClock.observe(host.now());
    // A last sample, of whatever of the step still runs: a step shorter than
    // the sampling interval is measured by it.
    sampleStep(owned);
    owned.draining = true;
    let drained, cleanupError, entered, entryError;
    try { entered = scope.entry(); } catch (error) { entryError = `step scope entry was not proved: ${error.message}`; }
    try { drained = await scope.drain(); }
    catch (error) {
      cleanupError = `step scope cleanup failed: ${error.message}`;
      scopeCleanup = { state: "error", reason: cleanupError };
      stop(cleanupError);
    }
    running.delete(step.name);
    const wall = (Date.now() - started) / 1000;
    let gnuTime,measurement;
    try { gnuTime=parseGnuTime(readFileSync(timeFile,'utf8')); } catch {}
    if(drained){
      try{
        measurement=measuredStepTime(drained.cpu,wall,gnuTime);
        writeFileSync(join(RUN_DIR,`${step.name}.time`),JSON.stringify(measurement)+'\n');
      }catch(error){
        cleanupError=`step CPU record failed: ${String(error)}`;
        scopeCleanup={state:'error',reason:cleanupError};stop(cleanupError);
      }
    }
    const {cpu,user,sys,maxrss_kb:maxrss}=measurement??{};
    // After the drain, so no process of the step can still write over it.
    if (elastic) writeFileSync(log, `\nstep budget: ${boundState.used_s.toFixed(3)} s execution; admission waits ${JSON.stringify(boundState.waited_s)}\n`, { flag: "a" });
    if (owned.overBound) writeFileSync(log, `\n${boundFailure}: stopped through its scope\n`, { flag: "a" });
    let oracleCapture, captureProblem;
    try { oracleCapture = captureCost(step.name, log); } catch (error) { captureProblem = error.message; }
    const text = existsSync(log) ? readFileSync(log, "utf8") : "";
    account();
    // What the step held at most, sampled on the ledger's basis, against the
    // most the run counted it for: its reservation, or one token's for each
    // of the most tokens it held at once. `memory_peak_bytes`, the slice's own
    // memory.peak read once its last process had exited, is the exact bound,
    // page cache included.
    const units = step.elastic ? Math.max(1, elastic ? tok.peak.get(step.name) ?? 0 : slots) : 1;
    const sized = sizing(step), peak = owned.peakCharge ?? null, reservedBytes = sized.bytes * units;
    // What it was counted for at its end, what it grew by, its runaway
    // bound, and the processes the kernel killed there (`memory.events`, read
    // as its slice emptied).
    let events = null;
    try { events = scope.memoryEvents(); } catch { /* the slice was never read */ }
    const memory = { peak_bytes: peak, reserved_bytes: reservedBytes, over: peak !== null && peak > reservedBytes, basis: sized.basis,
      grant_bytes: limitOf(step.name, owned), grown_bytes: owned.grown, bound_bytes: scope.workerLimit,supervisor_bound_bytes:scope.limits.max,
      killed: events === null ? null : events.own_oom > 0 ? events.oom_kill : 0 };
    if (owned.grown > 0) memoryRecord.steps_grown++;
    if (memory.killed > 0) memoryRecord.steps_killed++;
    const extra = { exit: code, signal, wall, cpu, user, sys, cpu_measure:measurement?.cpu_measure,gnu_time:gnuTime,maxrss_kb: maxrss, slots, log, started_at: new Date(started).toISOString(), scope: drained, scope_entry: entered,
      memory, memory_peak_bytes: scope.memoryPeakBytes, bound_s: bound.seconds, bound_basis: bound.basis,
      bound_clock: { execution_s: boundState.used_s, admission_wait_s: boundState.waited_s, ...(STEP_CEILING === undefined ? {} : { wall_ceiling_s: STEP_CEILING }) } };
    caseMemory.flush(step.name);
    if (oracleCapture) extra.oracle_capture = oracleCapture;
    if (elastic) Object.assign(extra, { elastic: true, peak_tokens: tok.peak.get(step.name) ?? 0, token_s: Math.round(tok.used.get(step.name) ?? 0) });
    let instrument;
    try { instrument = readStepInstrument(join(RUN_DIR, `${step.name}.instrument.json`), step.name, RUN_DIR); }
    catch (error) { instrument = { kind: "invalid-instrument", reason: error.message }; }
    if (!instrument && captureProblem) instrument = { kind: "tooling-setup", reason: captureProblem };
    if(!instrument&&step.name==='typescript-oracles'&&code===0&&!signal){
      try{
        typeScriptOracleReference=typeScriptOracleHandoff(join(typeScriptOracleDirectory(env),'results'));
        extra.oracle_reference=typeScriptOracleReference;
      }catch(error){instrument={kind:'tooling-setup',reason:'TypeScript oracle reference publication failed: '+error.message};}
    }
    if(!instrument&&step.name==='program-oracles'&&code===0&&!signal){
      try{programOracleReference=programOracleHandoff(join(programOracleDirectory(env),'results'));extra.oracle_reference=programOracleReference;}
      catch(error){instrument={kind:'tooling-setup',reason:'program oracle reference publication failed: '+error.message};}
    }
    if (cleanupError || spawnError) {
      const reason = cleanupError ?? `step scope launch failed: ${spawnError.message}`;
      finish(step.name, "INSTRUMENT", reason, { ...extra, instrument: { kind: "tooling-cleanup", verdict: "INSTRUMENT", reason } });
    } else if (owned.overBound) {
      const reason = boundFailure;
      finish(step.name, "INSTRUMENT", reason, { ...extra, instrument: { kind: "step-bound", verdict: "INSTRUMENT", reason } });
    } else if (stopping && !instrument && (signal || code !== 0)) {
      // A step stopped with the rest is not run, unless its own instrument
      // (a capture seal that changed, say) says more than the stop does.
      finish(step.name, "NOT RUN", interrupted ? `stopped: ${interrupted}` : "stopped by fail-fast", extra);
    } else if (entryError) {
      finish(step.name, "INSTRUMENT", entryError, { ...extra, instrument: { kind: "tooling-setup", verdict: "INSTRUMENT", reason: entryError } });
    } else if (memory.killed > 0 && (signal || code !== 0) && !instrument) {
      // Killed at its runaway bound: memory, never a verdict about the change.
      const reason = `memory: the kernel killed ${memory.killed} process(es) of the step at its runaway bound of ${gib(memory.bound_bytes)} (counted for ${gib(memory.grant_bytes)}); ${signal ? `killed by ${signal}` : `exit ${code}`}`;
      finish(step.name, "INSTRUMENT", reason, { ...extra, instrument: { kind: "memory-pressure", verdict: "INSTRUMENT", reason } });
    } else {
      const status = signal ? `killed by ${signal}` : `exit ${code}`;
      const heap = nodeHeapOomReason(text);
      const disposition=instrument&&instrumentPolicy(instrument.kind,instrument.completedFailures);
      if(instrument)finish(step.name,disposition?.verdict??"INSTRUMENT",instrument.reason,{...extra,instrument});
      else if(signal || code >= 128)finish(step.name,"INSTRUMENT",`${status}; top-level termination is not a completed verdict`,{...extra,instrument:{kind:"tooling-setup",verdict:"INSTRUMENT"}});
      else if(code===0)finish(step.name,"PASS","",extra);
      else if(code===77)finish(step.name,"SKIPPED",lastLine(text)||"exited 77 without a reason",extra);
      else finish(step.name,"FAIL",heap?`${heap}; ${status}`:status,extra);
    }
    // A step that ran to its own end, whatever its verdict, measured what it
    // holds; one stopped at its bound or with the run measured only a part.
    if (peak > 0 && !owned.overBound && !cleanupError && !spawnError && results.get(step.name).verdict !== "NOT RUN") {
      observations.set(step.name, { unit: sized.unit, peak: Math.ceil(peak / units) });
    }
    if (memory.over) reservation?.noteOver(step.name).catch(error => process.stderr.write(`run.mjs: the memory ledger's entry does not say ${step.name} is over: ${error.message}\n`));
    report(step.name);
    if (step.name === "build" && results.get("build").verdict === "PASS") identify();
    if (results.get(step.name).verdict === "FAIL" && FAIL_FAST && !stopping) {
      stop("NTS_GATE_FAIL_FAST: a step failed");
    }
    if (!stopping) schedule();
    else if (running.size === 0) done();
  };
  child.on("exit", (code, signal) => { void complete(code, signal); });
  child.on("error", error => { void complete(null, null, error); });
}

function stop(why) {
  if (stopping) { if (why.startsWith("signal")) interrupted = why; return; }
  stopping = true;
  startupAbort.abort(new Error(why));
  // A growth that waits is withdrawn: nothing will start to use it.
  growth?.controller.abort();
  interrupted = why;
  for (const name of pending) finish(name, "NOT RUN", why);
  pending = [];
  for (const [, r] of running) {
    try { r.scope.kill(); }
    catch (error) { scopeCleanup = { state: "error", reason: `cannot cancel ${r.scope.slice}: ${error.message}` }; }
  }
  if (running.size === 0 && !preparing) done();
}

// **The binaries every step runs are a copy named by their content**, made once
// the build has passed: `<cache>/nts-gate/bin/<sha256>/`. A session relinking
// `target/release/nts` halfway through a run cannot change the compiler between
// two steps. Every step and later run of the same binary therefore uses the
// same immutable executable identity, even when a worktree rebuilds its output.
const pinned = {};
const PIN_ROOT = join(env.XDG_CACHE_HOME ?? join(env.HOME ?? "/tmp", ".cache"), "nts-gate", "bin");
function pinBinaries() {
  const hash = identities.nts?.sha256;
  if (!hash) return;
  const dir = join(PIN_ROOT, hash);
  try {
    mkdirSync(dir, { recursive: true });
    const put = (from, name) => {
      if (!existsSync(from)) return undefined;
      const to = join(dir, name);
      if (!existsSync(to) || sha256(to) !== sha256(from)) {
        const tmp = `${to}.${process.pid}`;
        copyFileSync(from, tmp);
        chmodSync(tmp, 0o555);
        renameSync(tmp, to);
      }
      return to;
    };
    pinned.nts = put(ntsBin, "nts");
    pinned.suite = put(suiteBin, "nts-suite");
    pinned.protocol = put(join(dirname(ntsBin), "nts-test262-protocol"), "nts-test262-protocol");
    pinned.planner = put(join(dirname(ntsBin), "oracle-plan"), "oracle-plan");
    identities.nts.pinned = pinned.nts;
    // Keep the ten most recent pins; each is ~40 MB.
    const all = readdirSync(PIN_ROOT).map((n) => ({ n, t: statSync(join(PIN_ROOT, n)).mtimeMs })).sort((a, b) => b.t - a.t);
    utimesSync(dir, new Date(), new Date());
    for (const old of all.slice(10)) if (old.n !== hash) rmSync(join(PIN_ROOT, old.n), { recursive: true, force: true });
  } catch (e) {
    // Unpinned is how every run before this one worked; say so and go on.
    process.stderr.write(`run.mjs: could not pin the binaries (${e.message}); steps run ${ntsBin} in place\n`);
    for (const k of Object.keys(pinned)) delete pinned[k];
  }
}

function identify() {
  identities.nts = { path: ntsBin, sha256: sha256(ntsBin) };
  identities.nts_suite = { path: suiteBin, sha256: sha256(suiteBin) };
  pinBinaries();
}

// ---------------------------------------------------------------------------
// The summary: printed on every exit, and written as JSON and TSV.
// ---------------------------------------------------------------------------
function slower() {
  const out = [];
  for (const name of plan) {
    const r = results.get(name);
    const b = BASE.get(name);
    if (!r || !b || r.verdict === "NOT RUN") continue;
    // CPU when both sides have it, wall otherwise. Twice the baseline and a
    // minute more is the warning; a step that took 3 s instead of 1 s is not.
    const kind = r.cpu_measure===b.cpu_measure && r.cpu !== undefined && b.cpu > 0 ? "cpu" : "wall";
    const now = kind === "cpu" ? r.cpu : r.wall;
    const was = kind === "cpu" ? b.cpu : b.wall;
    if (now >= 2 * was && now - was >= 60) out.push({ name, kind, now, was, ratio: now / was });
  }
  return out;
}

function done() {
  if (summaryWritten) return;
  summaryWritten = true;
  // Every step has drained, so the run's memory goes back to the ledger now.
  growth?.controller.abort();
  reservation?.release();
  tok.close();
  clearTimeout(outrankedLook);
  if (outrankedNow) memoryRecord.outranked_s += (Date.now() - outrankedSince) / 1000;
  try { scopes?.close(); }
  catch (error) { scopeCleanup = { state: "error", reason: `cannot close run scopes: ${error.message}` }; }
  clearInterval(costClock);
  clearInterval(memoryClock);
  if (!identities.nts) identify();
  identities.node = process.version;
  for (const name of plan) if (!results.has(name)) finish(name, "NOT RUN", interrupted ?? "never scheduled");

  const slow = slower();
  if (TIME_STRICT) {
    for (const s of slow) {
      const r = results.get(s.name);
      if (r.verdict === "PASS") { r.verdict = "FAIL"; r.reason = `${s.ratio.toFixed(1)}x its baseline ${s.kind} time`; }
    }
  }
  const counts = { PASS: 0, FAIL: 0, INSTRUMENT: 0, SKIPPED: 0, "NOT RUN": 0 };
  const red = [];
  for (const name of plan) {
    const r = results.get(name);
    counts[r.verdict]++;
    if (r.verdict === "PASS") continue;
    if (r.verdict === "SKIPPED" && ACCEPT_SKIP.has(name)) { r.accepted = true; continue; }
    red.push(name);
  }
  const green = red.length === 0 && scopeCleanup.state === "complete";
  let oracleSetup;
  const setupLog=join(RUN_DIR,"oracle-setup.log");
  try { if(!existsSync(setupLog))writeFileSync(setupLog,"");oracleSetup=captureCost(null,setupLog); }
  catch(error){oracleSetup={ownerStep:null,instrument:{kind:"tooling-setup",reason:String(error)}};}
  const temporary = !running.size ? finishRunTemporary(normalized.temporary,env.HOME,green && !interrupted,{host})
    : {path:env.TMPDIR,state:"kept: rows still running"};
  process.stderr.write(`gate tmp: ${temporary.state}: ${temporary.path}${temporary.error ? `; ${temporary.error}` : ""}\n`);
  const wall = (Date.now() - startedAt) / 1000;
  const costsSummary = caseCosts?.summary(plan.map(name => ({ name, ...results.get(name) }))) ?? { version: 1, status: "unavailable" };

  const lines = [];
  lines.push("");
  lines.push(color(1, "gate summary") + `  ${identities.commit ?? "?"}${identities.dirty ? ` +${identities.dirty} uncommitted` : ""}  nts ${identities.nts?.sha256?.slice(0, 12) ?? "missing"}`);
  for (const name of plan) {
    const r = results.get(name);
    const tag = { PASS: color(32, "PASS    "), FAIL: color(31, "FAIL    "), INSTRUMENT: color(33, "INSTRUMENT"), SKIPPED: color(33, "SKIPPED "), "NOT RUN": color(33, "NOT RUN ") }[r.verdict];
    const t = r.wall !== undefined ? `${String(Math.round(r.wall)).padStart(6)}s` : "       ";
    const c = r.cpu !== undefined ? ` cpu ${String(Math.round(r.cpu)).padStart(6)}s` : "";
    const host = r.verdict === "SKIPPED" && BY_NAME.get(name).host ? ` (needs ${BY_NAME.get(name).host})` : "";
    const how = r.verdict === "SKIPPED" ? (r.accepted ? "  [accepted: NTS_GATE_ACCEPT_SKIP]" : `  [red; NTS_GATE_ACCEPT_SKIP=${name} accepts it]`) : "";
    const why = r.verdict === "PASS" ? "" : `  ${r.reason}${host}${how}`;
    lines.push(`  ${tag} ${name.padEnd(24)}${t}${c}${why}`);
    if (r.memory?.over) lines.push(color(33, `  OVER     ${name.padEnd(24)} held ${gib(r.memory.peak_bytes)}, past its ${gib(r.memory.reserved_bytes)} reservation`));
  }
  for (const s of slow) {
    lines.push(color(31, `  SLOWER   ${s.name.padEnd(24)} ${s.kind} ${Math.round(s.now)}s, ${s.ratio.toFixed(1)}x its baseline of ${Math.round(s.was)}s (tooling/gate/times.tsv)`));
  }
  if (memoryRecord.steps_grown || memoryRecord.steps_killed) {
    lines.push(`  memory: ${memoryRecord.steps_grown} step(s) grown while they ran, ${memoryRecord.steps_killed} killed at their runaway bounds`);
  }
  lines.push(`  ${plan.length} requested: ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.INSTRUMENT} INSTRUMENT, ${counts.SKIPPED} SKIPPED, ${counts["NOT RUN"]} NOT RUN in ${Math.round(wall)}s  (slots ${SLOTS}, memory ${gib(memoryRecord.peak_bytes)} at most at ${PRIORITY} priority, ${Math.round(memoryRecord.waited_s)}s waited, frontends ${FRONTENDS})`);
  if (FAIL_FAST) lines.push(color(33, "  NTS_GATE_FAIL_FAST: an inner-loop run, not landing evidence"));
  lines.push(`  logs: ${RUN_DIR}`);
  for (const name of red) {
    const r = results.get(name);
    if (r.verdict === "FAIL") lines.push(`${color(31, "FAILED")}: ${name}`);
    else lines.push(`${color(31, r.verdict)}: ${name} -- ${r.reason}`);
  }
  lines.push(green ? `\n${color(32, "green")}` : `\n${color(31, "red")}`);
  process.stdout.write(lines.join("\n") + "\n");

  const summary = {
    schema: 1,
    cpu_measure:STEP_CPU_MEASURE,
    environment: normalized.report,
    temporary,
    oracle_setup: oracleSetup,
    verdict: green ? "green" : "red",
    fail_fast: FAIL_FAST,
    interrupted,
    scope_execution: true,
    scope_cleanup: scopeCleanup,
    scope_root: scopes ? { slice: scopes.slice, group: scopes.group } : null,
    started: new Date(startedAt).toISOString(),
    wall_s: wall,
    root: ROOT,
    identities,
    budget: { slots: SLOTS, frontends: FRONTENDS },
    // The run's reservation in the machine's memory ledger: its largest size,
    // and how long its requests waited in the ledger's queue, all told.
    // The steps it sized without a measurement of their own, and those that
    // held more than they reserved (each step's row says by how much).
    memory: { priority: PRIORITY, reservation: reservation?.id ?? null, capacity_bytes: capacity, ...memoryRecord,
      history: HISTORY_FILE, unmeasured: unmeasured(), over: plan.filter(name => results.get(name)?.memory?.over) },
    requested: plan,
    accept_skip: [...ACCEPT_SKIP],
    steps: plan.map((name) => ({ name, ...results.get(name) })),
    slower: slow,
    case_costs: costsSummary,
    oracle_calls: dependencyCalls(null, running.size === 0 && results.size === plan.length),
    oracle_owners: ownerCalls(undefined, running.size === 0 && results.size === plan.length),
  };
  try {
    writeFileSync(join(RUN_DIR, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    writeFileSync(
      join(RUN_DIR, "summary.tsv"),
      ["step\tverdict\twall_s\tcpu_s\tslots\treason"]
        .concat(plan.map((n) => { const r = results.get(n); return [n, r.verdict, r.wall?.toFixed(1) ?? "", r.cpu?.toFixed(1) ?? "", r.slots ?? "", r.reason ?? ""].join("\t"); }))
        .join("\n") + "\n",
    );
    const latest = join(dirname(RUN_DIR), "latest");
    rmSync(latest, { force: true });
    symlinkSync(RUN_DIR, latest);
  } catch (e) {
    process.stderr.write(`could not write the summary files: ${e.message}\n`);
  }
  if (RECORD_TIMES) recordTimes();
  if (normalized.report.canonical) {
    const warning = writeCostHistory(HISTORY_FILE, { steps: plan.map(name => {
      const r = results.get(name);
      return { name, verdict: r.verdict, cpu: r.cpu, cpu_measure:r.cpu_measure,memory: observations.get(name) };
    }) }, CPU_HISTORY);
    if (warning) process.stderr.write(`scheduling history unavailable: ${warning}\n`);
  }
  process.exitCode = interrupted && interrupted.startsWith("signal") ? 130 : green ? 0 : 1;
}

function recordTimes() {
  const merged = new Map(BASE);
  for (const name of plan) {
    const r = results.get(name);
    if (r.verdict !== "PASS" || r.wall === undefined) continue;
    merged.set(name, { wall: r.wall, cpu: r.cpu ?? 0, slots: r.slots,cpu_measure:r.cpu_measure });
  }
  const head = [
    "# Per-step cost on a healthy run: step, wall s, cpu s, slots, CPU measure.",
    "# CPU trends compare only matching measures. run.mjs orders steps by wall and warns when",
    "# a step's cpu is 2x this and a minute more. Rewrite with NTS_GATE_RECORD_TIMES=1",
    `# on a run you have checked is healthy. Last written at ${identities.commit ?? "?"}.`,
  ];
  const rows = STEPS.filter((s) => merged.has(s.name)).map((s) => {
    const t = merged.get(s.name);
    return [s.name, t.wall.toFixed(1), (t.cpu ?? 0).toFixed(1), t.slots ?? "",t.cpu_measure].join("\t");
  });
  writeFileSync(TIMES_FILE, head.concat(rows).join("\n") + "\n");
  process.stdout.write(`  times written to ${TIMES_FILE}\n`);
}

// **One gate per tree.** Steps write fixed paths under the tree's `target/`
// (`gate-profile`, `node`, `memory`, `sweep-jvm`, `suite-report.txt`, the
// interop outputs), so two runs in one tree overwrite each other's evidence --
// `addons` rebuilding `target/node/*.node` under another run's `divergence`.
// The lock names the run holding it; a lock whose process is gone is stale and
// taken over.
const LOCK = join(ROOT, "target", ".gate-run.lock");
function takeTreeLock() {
  mkdirSync(dirname(LOCK), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(LOCK, `${process.pid} ${RUN_DIR}\n`, { flag: "wx" });
      process.on("exit", () => {
        try { if (readFileSync(LOCK, "utf8").startsWith(`${process.pid} `)) rmSync(LOCK, { force: true }); } catch {}
      });
      return;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const [pid, dir] = readFileSync(LOCK, "utf8").trim().split(" ");
      let alive = false;
      try { process.kill(Number(pid), 0); alive = true; } catch (k) { alive = k.code === "EPERM"; }
      if (alive) usage(`another gate (pid ${pid}, logs ${dir}) is running in this tree; its steps write the same target/ paths`);
      rmSync(LOCK, { force: true });
    }
  }
  usage(`could not take ${LOCK}`);
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => stop(`signal ${sig}`));
}
// **A run whose output nobody reads any more stops**, as SIGPIPE stops a
// pipeline's writer: whoever started it has gone. Its writes then fail
// (EPIPE), and an error left to the handler below would be reported to the
// same dead stderr, fail again, and be reported again: a run spinning on its
// own errors, holding a core for good and never reaching its SIGTERM handler.
// The run's own files, its logs and summary, are still written.
let outputGone = false;
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error) => {
    if (outputGone) return;
    outputGone = true;
    stop(error.code === "EPIPE" ? "its output has no reader" : `its output cannot be written: ${error.code ?? error.message}`);
  });
}
process.on("uncaughtException", (e) => {
  if (!outputGone) process.stderr.write(`run.mjs: ${e.stack ?? e}\n`);
  interrupted = `runner crashed: ${e.message}`;
  stop(interrupted);
});

checkTable();
plan = requested();
takeTreeLock();
mkdirSync(RUN_DIR, { recursive: true });
caseCosts = new CaseCosts(RUN_DIR);
identities.commit = git("rev-parse", "HEAD");
const dirty = git("status", "--porcelain", "--untracked-files=no");
identities.dirty = dirty === null ? null : dirty.split("\n").filter(Boolean).length;
if (!plan.includes("build")) identify();
// **Every setting that changes how hard a step runs, at the top of the log.**
// On 2026-10-06 a wrapper exported NTS_JOBS=1-2 and RUST_TEST_THREADS=1-2 and
// the logs never said so: `tests` took 690 s instead of 450 and `test262-cases`
// 776 s instead of 363, and the difference read as the compiler.
function settings() {
  // Report only classified values, never arbitrary discarded launcher data.
  const context = JSON.parse(env[ENVIRONMENT_CONTEXT]);
  const values = {...normalized.report.host,...normalized.report.ambient,...context.owned};
  const lines = Object.keys(values).sort().map(k => `    ${k}=${values[k] ?? "<unset>"}`);
  let cgroup = "";
  try {
    const path = readFileSync("/proc/self/cgroup", "utf8").trim().split("\n").pop().split("::").pop();
    const read = (f) => { try { return readFileSync(join("/sys/fs/cgroup", path, f), "utf8").trim(); } catch { return "?"; } };
    cgroup = `  cgroup ${path}: memory.max ${read("memory.max")}, memory.high ${read("memory.high")}, cpu.max ${read("cpu.max")}\n`;
  } catch {}
  // The reading the memory ledger decides by.
  let memory = "memory unread";
  try { const m = machineMemory(env); memory = `${(m.totalBytes / GiB).toFixed(1)}G total, ${(m.availableBytes / GiB).toFixed(1)}G available`; } catch {}
  return `  machine: ${cores} cores, ${memory}, load ${readFileSync("/proc/loadavg", "utf8").split(" ").slice(0, 3).join(" ")}\n` +
    cgroup + `  environment:\n${lines.join("\n")}\n`;
}
// The run's scopes and its memory come before anything of it runs: every
// step's slice is under the run's own, the run's reservation in the memory
// ledger is measured as that slice, and the capture below runs inside the
// reservation. Without either, no step can run.
let setupFailure, dependencySealFailure;
try { scopes = new GateScopes(env, join(ROOT, "target/gate-scope-owner.json")); }
catch (error) { setupFailure = `step scope setup failed: ${error.message}`; }
if (!setupFailure) {
  try { await reserveMemory(); }
  catch (error) { if (!stopping) setupFailure = error.message; }
}
if (!setupFailure && !stopping) {
  try { normalized = await sealOracleRun(normalized,startupAbort.signal); env = normalized.env; }
  catch (error) { dependencySealFailure = error; }
}
if (!stopping && !setupFailure && !dependencySealFailure) {
  tokenAddr = await tok.start();
  if (!tokenAddr) process.stderr.write("run.mjs: no token server; elastic steps run at fixed slot counts\n");
  pending = order(plan);
}
preparing = false;
process.stdout.write(
  `gate: ${plan.length} step(s), ${SLOTS} slots, memory from the ledger at ${PRIORITY} priority, ${FRONTENDS} frontends; logs in ${RUN_DIR}\n` +
    `  nts ${ntsBin}${pinned.nts ? ` (run as ${pinned.nts})` : ""}\n` + settings() +
    `  steps: ${plan.join(" ")}\n` +
    `  memory sized by ${HISTORY_FILE}` + (MEMORY.size && unmeasured().length
      ? `; unmeasured there, sized by the largest of their kind or their share of the machine: ${unmeasured().join(" ")}\n` : "\n"),
);
if (stopping) {
  done();
} else if (setupFailure) {
  for (const name of plan) finish(name, "INSTRUMENT", setupFailure, { instrument: { kind: "tooling-setup", verdict: "INSTRUMENT", reason: setupFailure } });
  done();
} else if (dependencySealFailure) {
  const kind = dependencySealFailure instanceof CaseBudgetError ? "case-budget"
    : dependencySealFailure instanceof ToolingInstrumentError ? dependencySealFailure.kind : "tooling-setup";
  const reason = String(dependencySealFailure), disposition = instrumentPolicy(kind);
  for (const name of plan) finish(name,disposition.verdict,reason,{instrument:{kind,reason}});
  done();
} else {
  schedule();
}
