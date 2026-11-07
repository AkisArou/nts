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
// the memory it needs, whether it starts frontends, and what it needs or must
// follow. The budget is a pool of NTS_GATE_SLOTS tokens (see "Tokens"). Most
// steps are *elastic*: started with their whole pool of workers, each of which
// takes a token around the process it runs, so a step's share of the machine
// follows its work while it runs. The rest -- cargo, nts-suite, the test
// binaries, parallel inside one process -- hold a fixed grant of slots from
// start to end. Steps start longest first: their CPU seconds over the slots
// they can use (`workEstimate`); short fixed steps ride beside the budget so
// the first verdicts arrive in the first minutes.
//
// Environment:
//   NTS_GATE_STEPS        steps to run, space separated (default: all)
//   NTS_GATE_SLOTS        CPU slots for the run (default: NTS_JOBS, else 3/4 of
//                         the cores)
//   NTS_GATE_MEM_GB       memory budget in GB (default 20)
//   NTS_GATE_FRONTENDS    concurrent frontend-using workers (default CPU slots)
//   NTS_GATE_FAIL_FAST=1  stop at the first FAIL (inner loop; never landing)
//   NTS_GATE_ACCEPT_SKIP  step names whose SKIPPED does not make the run red
//   NTS_GATE_RUN_DIR      where logs and the summary go
//                         (default <target>/gate-runs/<time>-<pid>)
//   NTS_GATE_TIME_STRICT=1  a step much slower than its baseline is a FAIL
//   NTS_GATE_RECORD_TIMES=1 write this run's times to tooling/gate/times.tsv
//   NTS_GATE_STEP_CEILING_S the most any step may run (the landing check's
//                         ceiling; see step-bound.ts)
//
// Set by this file for each step (a step reads them; nobody sets them by hand):
//   NTS_GATE_JOBS         the workers it may run
//   NTS_GATE_TOKENS       127.0.0.1:<port> of the token pool (elastic steps)
//   NTS_GATE_TOKEN_HELD=1 a fixed step: its tools must not ask for tokens
//   NTS_GATE_STEP         the step's name, sent with each token request

import {CaseBudgetError, ToolingInstrumentError, instrumentPolicy, readStepInstrument} from "./step-result.ts";
import {definiteFailure} from "./train/red-stop.ts";
import {GateScopes} from "./train/step-scope.ts";
import {inheritedStepWork, orderStepStarts, readPreviousStepCpu, readStepCpuHistory, usableWidth, writeStepCpuHistory} from "./step-scheduling.ts";
import {STEP_SUCCESSORS} from "./step-successors.ts";
import {stepBound, stepBoundReason} from "./step-bound.ts";
import {spawn, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {
  appendFileSync, chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync,
  readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import {cpus, homedir, totalmem} from "node:os";
import {dirname, join, resolve, relative, isAbsolute, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {createTokenPool} from "./tokenpool.mjs";
import {CaseCosts} from "./case-costs.ts";
import {ownerEmissionCalls} from "./owner-emission-calls.ts";
import {Admission, memAvailableGB as readMemAvailable} from "./admission.ts";
import {TEST_BUILD_DEBUG, TEST_BUILD_OPT_LEVEL} from "./test-artifacts.ts";
import {frontendBudget} from "./budget.ts";
import {fixedReservation} from "./reservation.ts";
import {STEPS, stepTableProblem} from "./step-table.mjs";
import {finishRunTemporary} from "./run-temporary.ts";
import {gateEnvironment, sealOracleRun, oracleStepEnvironment, reportEnvironment, nodeHeapOomReason, ENVIRONMENT_CONTEXT} from "./canonical-environment.ts";
import {typeScriptOracleDirectory} from '../census/typescript-oracle-capture.ts';
import {typeScriptOracleHandoff} from '../census/typescript-oracle-results.ts';
import {programOracleHandoff} from '../differential/oracle-results.ts';
import {programOracleDirectory} from '../differential/oracle-result-scope.ts';

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
  NTS_GATE_MEM_GB       memory budget in GB
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
let normalized = gateEnvironment(argSteps.length && !env[ENVIRONMENT_CONTEXT] ? {...env,NTS_GATE_STEPS:argSteps.join(" ")} : env, { run: RUN_DIR, standalone: !env[ENVIRONMENT_CONTEXT], oracleAdmissionContext: "gate" });
env = normalized.env;
reportEnvironment(normalized.report);
// `NTS_BIN` defaults to the build this run makes, not to `./target/release/nts`:
// with CARGO_TARGET_DIR elsewhere the old default gated whatever another session
// last built into ./target (the-gate-drives-target-release-nts).
const ntsBin = resolve(env.NTS_BIN ?? join(target, "release/nts"));
const suiteBin = resolve(env.NTS_SUITE_BIN ?? join(dirname(ntsBin), "nts-suite"));
const cores = cpus().length;
const intEnv = (name, fallback) => {
  const v = env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) usage(`${name}=${v} is not a positive number`);
  return n;
};
const SLOTS = Math.floor(intEnv("NTS_GATE_SLOTS", intEnv("NTS_JOBS", Math.max(1, Math.floor((cores * 3) / 4)))));
const MEM = intEnv("NTS_GATE_MEM_GB", Math.min(20, Math.floor(totalmem() / 2 ** 30 * 0.7)));
const FRONTENDS = (() => {
  try { return frontendBudget(env, SLOTS); }
  catch (error) { usage(error.message); }
})();
const FAIL_FAST = (env.NTS_GATE_FAIL_FAST ?? "") !== "" && env.NTS_GATE_FAIL_FAST !== "0";
const TRAIN_MEMBERS = Number(env.NTS_GATE_TRAIN_MEMBERS ?? "0");
if (!Number.isSafeInteger(TRAIN_MEMBERS) || TRAIN_MEMBERS < 0) throw new Error("invalid owned train member count");
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
  const times = new Map();
  if (!existsSync(TIMES_FILE)) return times;
  for (const line of readFileSync(TIMES_FILE, "utf8").split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    const [name, wall, cpu, slots] = line.split("\t");
    times.set(name, { wall: Number(wall), cpu: Number(cpu), slots: Number(slots) });
  }
  return times;
}
const BASE = readTimes();
const estimate = (name) => BASE.get(name)?.wall ?? 60;
// The CPU seconds each step's checks took when they last passed, retained
// across runs; separate from the committed timing-verdict baseline.
const CPU_HISTORY_FILE = join(target, "gate-costs", "steps.json");
const CPU_HISTORY = new Map([...readPreviousStepCpu(join(dirname(RUN_DIR), "latest", "summary.json")), ...readStepCpuHistory(CPU_HISTORY_FILE)]);
const INHERITED_WORK = inheritedStepWork(CPU_HISTORY, (name) => BASE.get(name)?.cpu, STEP_SUCCESSORS);

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
// A machine that does not say counts as unbounded here, as it always has.
const memAvailableGB = () => readMemAvailable() ?? Infinity;

// ---------------------------------------------------------------------------
// State.
// ---------------------------------------------------------------------------
const startedAt = Date.now();
const results = new Map(); // name -> { verdict, reason, ... }
const running = new Map(); // name -> { child, slots, started, rider, elastic }
let interrupted = null;
let stopping = false;
const startupAbort = new AbortController();
let preparingCapture = true;
let trainRedStop = null;
let scopes;
let scopeCleanup = { state: "complete" };
let summaryWritten = false;
let caseCosts = null;
let typeScriptOracleReference;
let programOracleReference;
const identities = {};
let plan = [];

function stepEnv(step, slots, scope) {
  const owned={NTS_TOOLING_SLICE:scope.slice};
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
  // Match tests.mjs and the lander, including Cargo calls in frontend-tsrs.
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
  // Resident worker scopes are siblings of the land unit, so their run slice
  // needs this step's own reserved budget as an enforced aggregate ceiling.
  e.NTS_GATE_STEP_MEMORY_BYTES = String(Math.floor(step.mem * 2 ** 30));
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
  e.NTS_GATE_COSTS_DIR = join(target, "gate-costs");
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
  if (r.wall !== undefined) block += `  ${Math.round(r.wall)}s${r.cpu !== undefined ? ` (cpu ${Math.round(r.cpu)}s, ${how})` : ""}\n`;
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
function used(includeElastic = true) {
  let slots = 0, mem = 0, fe = 0, riding = 0;
  const locks = new Set();
  let elastic = 0;
  for (const [name, r] of running) {
    const s = BY_NAME.get(name);
    if (s.lock) locks.add(s.lock);
    if (r.elastic) {
      if (!includeElastic) continue;
      // What it holds right now: a token is one process of its workers.
      const held = r.draining ? r.slots : tok.held.get(name) ?? 0;
      elastic += 1;
      slots += held;
      mem += (s.mem / s.slots) * held;
      if (s.fe) fe += held;
      continue;
    }
    if (r.rider) riding += r.slots;
    else slots += r.slots;
    mem += s.mem;
    if (s.fe) fe += r.slots;
  }
  return { slots, mem, fe, locks, riding, elastic };
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

function admit(step, u) {
  const free = SLOTS - u.slots;
  const want = Math.min(step.slots, SLOTS);
  const least = Math.min(step.min ?? Math.max(1, Math.ceil(step.slots / 2)), want);
  if (step.lock && u.locks.has(step.lock)) return 0;
  if (step.elastic && tokenAddr) {
    // Started with its whole pool of workers; they wait for tokens, so
    // starting it takes no slot. A cap on how many wait at once keeps the
    // idle workers (a shell or node each) to a few hundred megabytes.
    if (u.elastic >= ELASTIC_CAP) return 0;
    if (running.size > 0 && memAvailableGB() < 2) return 0;
    return step.slots;
  }
  if (running.size === 0) return want; // always make progress
  if (u.mem + step.mem > MEM) return 0;
  if (memAvailableGB() < step.mem + 1) return 0;
  const feFree = step.fe ? FRONTENDS - u.fe : Infinity;
  if (free >= least && feFree >= least) return Math.min(want, free, feFree);
  // Riders: a step of a minute or so that finds the budget full starts anyway
  // at its minimum, on a quarter of the budget kept for them and counted
  // apart, so the run's first verdicts arrive in its first minutes and a long
  // step waiting for its slots is not squeezed out by them (integrity-runtime
  // waited 814 s behind riders counted in the budget).
  if (tiny(step)) {
    const ride = Math.max(1, Math.min(step.min ?? 1, want));
    if (u.riding + ride <= Math.max(1, Math.ceil(SLOTS * 0.25))) return -ride;
  }
  return 0;
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
// by a long one; the favoured step's claim counts double. Tokens are kept back
// for the first fixed step that waits only for slots (`withhold`).
// ---------------------------------------------------------------------------
const ELASTIC_CAP = Math.max(6, Math.ceil(SLOTS * 0.75));
let withhold = 0;

// A step's work in CPU seconds: its own last passing run, else its share of a
// predecessor's (step-successors.ts), else the committed baseline.
function workEstimate(name) {
  const own = CPU_HISTORY.get(name) ?? INHERITED_WORK.get(name) ?? BASE.get(name)?.cpu;
  if (own > 0) return own;
  return estimate(name) * width(name);
}

// How long a step may run before it is stopped and held (step-bound.ts): its
// row's stated bound, else three times its work and the run's over their slots,
// and never above a landing check's ceiling.
function boundOf(step) {
  return stepBound(step, workEstimate(step.name), width(step.name), { cost: plan.reduce((sum, name) => sum + workEstimate(name), 0), slots: SLOTS }, STEP_CEILING);
}

// A token is a case starting, so the pool is where the run stops starting
// cases when memory runs low: none below 12 GB, again from 14, and the cases
// already running are never stopped (`./admission.ts`). The recheck below
// reconsiders a held pool every few seconds.
const caseAdmission = new Admission({ report: (message) => process.stdout.write(`  ${message}\n`) });
let observedAdmissionOpen = null;
const tok = createTokenPool({
  // `used()` counts the tokens held in an elastic step's share.
  free: () => {
    if (stopping) return 0;
    observedAdmissionOpen = caseAdmission.open();
    return observedAdmissionOpen ? SLOTS - used().slots - withhold : 0;
  },
  claim: (step, { held, used: spent, waitedS }) => {
    const left = Math.max(10, workEstimate(step) - spent);
    const c = left / (held + 1) + waitedS;
    return BY_NAME.get(step)?.favoured ? 2 * c : c;
  },
  eligible: (step) => !BY_NAME.get(step)?.fe || used().fe < FRONTENDS,
  known: (step) => BY_NAME.has(step),
  observe: (event) => caseCosts?.record({ ...event, compiler_sha: identities.nts?.sha256, memory_allowed: observedAdmissionOpen,
    used: { slots: used().slots, fe: used().fe }, slots: SLOTS, frontends: FRONTENDS, withhold }),
  released: () => { if (!stopping) schedule(); },
});
let tokenAddr = null;
const grant = () => { if (tokenAddr) tok.grant(); };
const account = () => tok.account();
// Sampling is independent of the five-second policy recheck: it never calls
// schedule(), grant(), admission.open(), or any other policy decision.
const costClock = setInterval(() => caseCosts?.record({ event: "pool.state", memory_allowed: observedAdmissionOpen,
  used: { slots: used().slots, fe: used().fe }, slots: SLOTS, frontends: FRONTENDS, withhold,
  held: Object.fromEntries(tok.held), waiting: tok.waiting.map(w => ({ request:w.id, step:w.step, pid:w.pid })),
  running: [...running.keys()],
  fixed_grants: Object.fromEntries([...running].filter(([,r]) => !r.elastic).map(([name,r]) => [name,{ slots:r.slots, rider:r.rider }])),
  runner_cpu: process.resourceUsage(), memory_gb: readMemAvailable() }), 500);
costClock.unref();

// Only lower the others when a favoured step is in this run at all.
const FAVOURED_PLANNED = () => plan.some((n) => BY_NAME.get(n).favoured);

let pending = [];
// Memory is also used by whatever else runs on this box, so a step held back
// for it is reconsidered every few seconds, not only when one of ours ends.
const recheck = setInterval(() => { if (!stopping && (pending.length || tok.waiting.length)) schedule(); }, 5000);
recheck.unref();

function schedule() {
  if (stopping) return;
  let progressed = true;
  withhold = 0;
  while (progressed) {
    progressed = false;
    withhold = 0;
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
      const u = used();
      const granted = admit(step, u);
      if (granted === 0) {
        // The first step in order that waits only for slots has tokens kept
        // for it as elastic workers give them back, or elastic steps -- which
        // ask again every few seconds -- would take each one as it frees and
        // a fixed step would wait for a gap that never comes.
        // Returning elastic grants cannot free resources held by fixed steps.
        // Reserve only if those returns could make the candidate fit.
        if (!step.elastic && !withhold && !(step.lock && u.locks.has(step.lock))) {
          withhold = fixedReservation(step, used(false), { slots: SLOTS, mem: MEM, fe: FRONTENDS });
        }
        continue;
      }
      pending = pending.filter((n) => n !== name);
      start(step, Math.abs(granted), granted < 0);
      progressed = true;
      break;
    }
  }
  grant();
  if (pending.length === 0 && running.size === 0) done();
}

function start(step, slots, rider = false) {
  const bound = boundOf(step);
  let scope;
  try { scopes ??= new GateScopes(env, join(ROOT, "target/gate-scope-owner.json")); scope = scopes.step(); }
  catch (error) {
    finish(step.name, "INSTRUMENT", `step scope setup failed: ${error.message}`, { instrument: { kind: "tooling-setup", verdict: "INSTRUMENT" } });
    report(step.name); stop(`step scope setup failed: ${error.message}`); return;
  }
  const log = join(RUN_DIR, `${step.name}.log`);
  const timeFile = join(RUN_DIR, `${step.name}.time`);
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
  const elastic = Boolean(step.elastic && tokenAddr);
  const owned = { child, slots, started, rider, elastic, scope, draining: false, overBound: false };
  running.set(step.name, owned);
  // **Past its bound the step is stopped through its own scope** and held: its
  // log stays, and it is neither a pass nor a red verdict about the change.
  // Killed again until it exits: a kill reaches only what its scope holds.
  let boundTimer;
  const stopAtBound = () => {
    if (!stopping) owned.overBound = true;
    try { scope.kill(); }
    catch (error) { stop(`cannot stop ${step.name} at its bound: ${error.message}`); return; }
    boundTimer = setTimeout(stopAtBound, 5000);
    boundTimer.unref();
  };
  boundTimer = setTimeout(stopAtBound, bound.seconds * 1000);
  boundTimer.unref();
  process.stderr.write(elastic
    ? `-- ${step.name} started (${slots} workers on tokens; ${running.size} running; bound ${bound.seconds} s)\n`
    : `-- ${step.name} started (${slots} slot${slots === 1 ? "" : "s"}; ${running.size} running; bound ${bound.seconds} s)\n`);
  let completed = false;
  const complete = async (code, signal, spawnError) => {
    if (completed) return;
    completed = true;
    clearTimeout(boundTimer);
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
    let cpu, user, sys, maxrss;
    try {
      const t = readFileSync(timeFile, "utf8").trim().split("\n").pop().split(" ").map(Number);
      if (t.length === 4 && t.every(Number.isFinite)) {
        [, user, sys, maxrss] = t;
        cpu = user + sys;
      }
    } catch {}
    // After the drain, so no process of the step can still write over it.
    if (owned.overBound) writeFileSync(log, `\n${stepBoundReason(bound.seconds)}: stopped through its scope\n`, { flag: "a" });
    let oracleCapture, captureProblem;
    try { oracleCapture = captureCost(step.name, log); } catch (error) { captureProblem = error.message; }
    const text = existsSync(log) ? readFileSync(log, "utf8") : "";
    account();
    const extra = { exit: code, signal, wall, cpu, user, sys, maxrss_kb: maxrss, slots, log, started_at: new Date(started).toISOString(), scope: drained, scope_entry: entered,
      bound_s: bound.seconds, bound_basis: bound.basis };
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
      const reason = stepBoundReason(bound.seconds);
      finish(step.name, "INSTRUMENT", reason, { ...extra, instrument: { kind: "step-bound", verdict: "INSTRUMENT", reason } });
    } else if (trainRedStop && ["SIGTERM", "SIGKILL"].includes(signal) && !instrument) {
      finish(step.name, "NOT RUN", `cancelled after ${trainRedStop.trigger} failed`, { ...extra, cancelled_by: trainRedStop.trigger });
    } else if (stopping && !trainRedStop && (signal || code !== 0)) {
      finish(step.name, "NOT RUN", interrupted ? `stopped: ${interrupted}` : "stopped by fail-fast", extra);
    } else if (entryError) {
      finish(step.name, "INSTRUMENT", entryError, { ...extra, instrument: { kind: "tooling-setup", verdict: "INSTRUMENT", reason: entryError } });
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
    report(step.name);
    if (step.name === "build" && results.get("build").verdict === "PASS") identify();
    if (TRAIN_MEMBERS > 1 && definiteFailure({ name: step.name, ...results.get(step.name) }) && !stopping) {
      trainRedStop = { version: 1, commit: git("rev-parse", "HEAD"), members: TRAIN_MEMBERS,
        trigger: step.name, decided_at: new Date().toISOString() };
      stop(`cancelled after ${step.name} failed`);
    }
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
  if (!trainRedStop) interrupted = why;
  for (const name of pending) finish(name, "NOT RUN", why, trainRedStop ? { cancelled_by: trainRedStop.trigger } : {});
  pending = [];
  for (const [, r] of running) {
    try { r.scope.kill(); }
    catch (error) { scopeCleanup = { state: "error", reason: `cannot cancel ${r.scope.slice}: ${error.message}` }; }
  }
  if (running.size === 0 && !preparingCapture) done();
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
    const kind = r.cpu !== undefined && b.cpu > 0 ? "cpu" : "wall";
    const now = kind === "cpu" ? r.cpu : r.wall;
    const was = kind === "cpu" ? b.cpu : b.wall;
    if (now >= 2 * was && now - was >= 60) out.push({ name, kind, now, was, ratio: now / was });
  }
  return out;
}

function done() {
  if (summaryWritten) return;
  summaryWritten = true;
  try { scopes?.close(); }
  catch (error) { scopeCleanup = { state: "error", reason: `cannot close run scopes: ${error.message}` }; }
  clearInterval(costClock);
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
  const temporary = !running.size ? finishRunTemporary(normalized.temporary,env.HOME,green && !interrupted)
    : {path:env.TMPDIR,state:"kept: rows still running"};
  process.stderr.write(`gate tmp: ${temporary.state}: ${temporary.path}${temporary.error ? `; ${temporary.error}` : ""}\n`);
  const wall = (Date.now() - startedAt) / 1000;
  const costsSummary = caseCosts?.summary(plan.map(name => ({ name, ...results.get(name), mem_gb: BY_NAME.get(name).mem }))) ?? { version: 1, status: "unavailable" };

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
    const warning = costsSummary.steps?.[name]?.aggregate_memory?.warning;
    if (warning) lines.push(color(33, `  WARNING  ${name.padEnd(24)} ${warning}`));
  }
  for (const s of slow) {
    lines.push(color(31, `  SLOWER   ${s.name.padEnd(24)} ${s.kind} ${Math.round(s.now)}s, ${s.ratio.toFixed(1)}x its baseline of ${Math.round(s.was)}s (tooling/gate/times.tsv)`));
  }
  lines.push(`  ${plan.length} requested: ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.INSTRUMENT} INSTRUMENT, ${counts.SKIPPED} SKIPPED, ${counts["NOT RUN"]} NOT RUN in ${Math.round(wall)}s  (slots ${SLOTS}, mem ${MEM}G, frontends ${FRONTENDS})`);
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
    environment: normalized.report,
    temporary,
    oracle_setup: oracleSetup,
    verdict: green ? "green" : "red",
    fail_fast: FAIL_FAST,
    interrupted,
    scope_execution: true,
    scope_cleanup: scopeCleanup,
    scope_root: scopes ? { slice: scopes.slice, group: scopes.group } : null,
    ...(trainRedStop ? { train_red_stop: { ...trainRedStop,
      cancelled: plan.filter(name => results.get(name).cancelled_by !== undefined).sort(), drained_at: new Date().toISOString() } } : {}),
    started: new Date(startedAt).toISOString(),
    wall_s: wall,
    root: ROOT,
    identities,
    budget: { slots: SLOTS, mem_gb: MEM, frontends: FRONTENDS },
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
    const warning = writeStepCpuHistory(CPU_HISTORY_FILE, plan.map(name => ({ name, ...results.get(name) })), CPU_HISTORY);
    if (warning) process.stderr.write(`scheduling history unavailable: ${warning}\n`);
  }
  process.exitCode = interrupted && interrupted.startsWith("signal") ? 130 : green ? 0 : 1;
}

function recordTimes() {
  const merged = new Map(BASE);
  for (const name of plan) {
    const r = results.get(name);
    if (r.verdict !== "PASS" || r.wall === undefined) continue;
    merged.set(name, { wall: r.wall, cpu: r.cpu ?? 0, slots: r.slots });
  }
  const head = [
    "# Per-step cost on a healthy run: step, wall s, cpu s (user+sys of the step's",
    "# process tree), slots it ran with. run.mjs orders steps by wall and warns when",
    "# a step's cpu is 2x this and a minute more. Rewrite with NTS_GATE_RECORD_TIMES=1",
    `# on a run you have checked is healthy. Last written at ${identities.commit ?? "?"}.`,
  ];
  const rows = STEPS.filter((s) => merged.has(s.name)).map((s) => {
    const t = merged.get(s.name);
    return [s.name, t.wall.toFixed(1), (t.cpu ?? 0).toFixed(1), t.slots ?? ""].join("\t");
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
process.on("uncaughtException", (e) => {
  process.stderr.write(`run.mjs: ${e.stack ?? e}\n`);
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
  const m = memAvailableGB();
  return `  machine: ${cores} cores, ${(totalmem() / 2 ** 30).toFixed(1)}G total, ${m.toFixed(1)}G available, load ${readFileSync("/proc/loadavg", "utf8").split(" ").slice(0, 3).join(" ")}\n` +
    cgroup + `  environment:\n${lines.join("\n")}\n`;
}
let dependencySealFailure;
try { normalized = await sealOracleRun(normalized,startupAbort.signal); env = normalized.env; }
catch (error) { dependencySealFailure = error; }
finally { preparingCapture = false; }
process.stdout.write(
  `gate: ${plan.length} step(s), ${SLOTS} slots, ${MEM}G, ${FRONTENDS} frontends; logs in ${RUN_DIR}\n` +
    `  nts ${ntsBin}${pinned.nts ? ` (run as ${pinned.nts})` : ""}\n` + settings() +
    `  steps: ${plan.join(" ")}\n`,
);
if (stopping) {
  done();
} else if (dependencySealFailure) {
  const kind = dependencySealFailure instanceof CaseBudgetError ? "case-budget"
    : dependencySealFailure instanceof ToolingInstrumentError ? dependencySealFailure.kind : "tooling-setup";
  const reason = String(dependencySealFailure), disposition = instrumentPolicy(kind);
  for (const name of plan) finish(name,disposition.verdict,reason,{instrument:{kind,reason}});
  done();
} else {
  tokenAddr = await tok.start();
  if (!tokenAddr) process.stderr.write("run.mjs: no token server; elastic steps run at fixed slot counts\n");
  pending = order(plan);
  schedule();
}
