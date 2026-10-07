#!/usr/bin/env node
// The gate's runner: every requested step of tooling/gate/all.sh, at once where
// they can be, under one CPU, memory and frontend budget, with a verdict per
// step and a summary that is printed however the run ends.
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
// start to end. Steps start longest first (cpu seconds in times.tsv); short
// fixed steps ride beside the budget so the first verdicts arrive in the
// first minutes.
//
// Environment:
//   NTS_GATE_STEPS        steps to run, space separated (default: all)
//   NTS_GATE_SLOTS        CPU slots for the run (default: NTS_JOBS, else 3/4 of
//                         the cores)
//   NTS_GATE_MEM_GB       memory budget in GB (default 20)
//   NTS_GATE_FRONTENDS    concurrent frontend-using workers (default 20)
//   NTS_GATE_FAIL_FAST=1  stop at the first FAIL (inner loop; never landing)
//   NTS_GATE_ACCEPT_SKIP  step names whose SKIPPED does not make the run red
//   NTS_GATE_RUN_DIR      where logs and the summary go
//                         (default <target>/gate-runs/<time>-<pid>)
//   NTS_GATE_TIME_STRICT=1  a step much slower than its baseline is a FAIL
//   NTS_GATE_RECORD_TIMES=1 write this run's times to tooling/gate/times.tsv
//
// Set by this file for each step (a step reads them; nobody sets them by hand):
//   NTS_GATE_JOBS         the workers it may run
//   NTS_GATE_TOKENS       127.0.0.1:<port> of the token pool (elastic steps)
//   NTS_GATE_TOKEN_HELD=1 a fixed step: its tools must not ask for tokens
//   NTS_GATE_STEP         the step's name, sent with each token request

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync,
  readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { cpus, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTokenPool } from "./tokenpool.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
process.chdir(ROOT);

// ---------------------------------------------------------------------------
// The step table. One row per `step` line in all.sh; `checkTable` fails the
// run if the two disagree in either direction.
//
//   slots  workers the step can use; it gets NTS_GATE_JOBS = what it was given
//          (an elastic step gets all of them, and they wait for tokens: its
//          `mem / slots` is what one token's process may hold)
//   min    fewest slots it may start with (default: half of slots)
//   elastic  its workers take a token per process (token.sh, tokens.mjs), so
//          it holds a share of the budget that moves with the work instead of
//          a grant fixed when it starts (see "Tokens")
//   mem    GB it may hold at peak
//   fe     true when its workers start frontends (counted against FRONTENDS)
//   nts    true when it drives the compiler: needs the binary and the frontend
//   needs  steps that must PASS first (only when they are requested too)
//   after  steps that must finish first, whatever their verdict
//   lock   an exclusive resource (cargo's build-directory lock)
//   host   what the machine must have, named when the step SKIPs
//   favoured  runs at the runner's own priority; every other step at nice +5
//   doc    what it proves, for the summary's reader
// ---------------------------------------------------------------------------
const STEPS = [
  { name: "build", slots: 8, min: 4, mem: 8, lock: "cargo", doc: "release binaries build" },
  // Its own target directory (see stepEnv), so it neither waits for nor blocks
  // `build` and `tests` on cargo's build-directory lock.
  { name: "clippy", slots: 6, min: 4, mem: 6, lock: "clippy", doc: "lint clean" },
  { name: "format", slots: 1, mem: 0.2, doc: "runtime/c is clang-formatted" },
  { name: "reformat", slots: 1, mem: 0.1, doc: "no whitespace-only diffs" },
  { name: "records", slots: 1, mem: 0.1, doc: "record numbers unique" },
  { name: "test262", slots: 1, mem: 2, after: ["build"], doc: "test262 pin, inventory, features audit" },
  { name: "test262-cases", slots: 8, min: 4, mem: 8, nts: true, fe: true, doc: "test/language rows reproduce" },
  { name: "test262-builtins-cases", slots: 4, min: 2, mem: 5, nts: true, fe: true, doc: "test/built-ins rows reproduce" },
  { name: "test262-rest-cases", slots: 4, min: 2, mem: 5, nts: true, fe: true, doc: "annexB, staging, harness rows reproduce" },
  { name: "outcomes", slots: 1, mem: 1, nts: true, fe: true, doc: "pinned defects still do what they did" },
  { name: "integrity", elastic: true, slots: 8, min: 2, mem: 4, nts: true, fe: true, doc: "listings self-consistent over examples, blockers, outcomes" },
  // Reads integrity-runtime's `hir --prepared` listings when both are in the
  // run (NTS_DEFINITIONS_FROM), rather than lowering the corpus again.
  { name: "definitions", elastic: true, slots: 4, min: 2, mem: 2, nts: true, fe: true, after: ["integrity-runtime"], doc: "no runtime module emits fewer functions" },
  { name: "integrity-runtime", elastic: true, slots: 12, min: 4, mem: 4, nts: true, fe: true, doc: "listing rules over the runtime corpus" },
  { name: "snapshot-cache", elastic: true, slots: 8, min: 2, mem: 4, nts: true, fe: true, doc: "a cached snapshot gives the same program" },
  { name: "assembles", elastic: true, slots: 8, min: 2, mem: 4, nts: true, fe: true, doc: "runtime LLVM IR assembles" },
  { name: "types", elastic: true, slots: 8, min: 2, mem: 4, nts: true, fe: true, doc: "snapshot type tables consistent" },
  { name: "jvm-verifies", elastic: true, slots: 8, min: 2, mem: 6, nts: true, fe: true, doc: "runtime and outcomes JVM output verifies" },
  { name: "primitives", slots: 1, mem: 0.1, doc: "docs/primitives.md names exist" },
  { name: "tests", slots: 8, min: 4, mem: 8, lock: "cargo", after: ["build"], doc: "cargo test --workspace" },
  { name: "corpus", slots: 8, min: 4, mem: 6, nts: true, fe: true, doc: "invalid HIR 0, uncompilable C 0, unverifiable class 0" },
  { name: "benches", slots: 1, mem: 1, nts: true, fe: true, doc: "bench cases emit and compile on C, LLVM, JVM" },
  { name: "example-refusals", elastic: true, slots: 8, min: 2, mem: 4, nts: true, fe: true, doc: "per-example refusal counts match the table" },
  { name: "config", slots: 1, mem: 1, doc: "nts.config.ts files coherent" },
  { name: "react-sources", slots: 1, mem: 0.3, doc: "vendored React sources match the manifest" },
  { name: "profile", elastic: true, slots: 8, min: 2, mem: 3, nts: true, fe: true, doc: "runtime/node emits without a panic, under the refusal ceiling" },
  { name: "sweep", slots: 1, mem: 1, nts: true, fe: true, doc: "the value-kind cross-product agrees on C" },
  { name: "llvm", elastic: true, slots: 8, min: 2, mem: 6, nts: true, fe: true, doc: "every example agrees with node on LLVM" },
  { name: "llvm-rc", elastic: true, slots: 8, min: 2, mem: 6, nts: true, fe: true, doc: "every example agrees with node on LLVM under RC" },
  { name: "jvm", elastic: true, slots: 8, min: 2, mem: 8, nts: true, fe: true, doc: "every example agrees with node on the JVM" },
  { name: "dex", elastic: true, slots: 8, min: 2, mem: 6, nts: true, fe: true, host: "an Android SDK with build-tools", doc: "d8 accepts emitted classes" },
  { name: "on-device", slots: 1, mem: 1, nts: true, fe: true, host: "an Android device on adb", doc: "bench cases agree on java and dalvikvm" },
  { name: "bench-agree", elastic: true, slots: 8, min: 2, mem: 6, nts: true, fe: true, doc: "bench cases agree with node" },
  { name: "examples", elastic: true, slots: 8, min: 2, mem: 6, nts: true, fe: true, doc: "every example agrees with node on C" },
  { name: "rc", elastic: true, slots: 8, min: 2, mem: 6, nts: true, fe: true, doc: "every example agrees under RC, no leak" },
  { name: "memory", elastic: true, slots: 8, min: 2, mem: 3, nts: true, fe: true, doc: "RC: no leak, same answer, counts at floors" },
  // After `profile` when both run: build.sh reuses its `emit-c --napi` output
  // (NTS_ADDON_EMITTED) when profile emitted the module cleanly with this binary.
  { name: "addons", elastic: true, slots: 8, min: 2, mem: 4, nts: true, fe: true, after: ["profile"], doc: "node modules build, load and publish" },
  { name: "blockers", slots: 1, mem: 1, nts: true, fe: true, doc: "blocker fixtures still refuse as they say" },
  { name: "divergence", slots: 1, mem: 1, nts: true, fe: true, after: ["addons"], doc: "node divergence instruments" },
  // Favoured: every other step runs at `nice +5` beside it. Two of its projects
  // race a timer against a callback, and contention is what makes that race
  // lose (see the comment above its step line in all.sh); it ran alone, last,
  // for that reason. Lanes inside it: apple VM, windows VM, and one local lane
  // per worker, taking projects from one queue, longest first.
  { name: "interop", elastic: true, slots: 12, min: 3, mem: 3, nts: true, fe: true, favoured: true, doc: "interop projects build and run" },
];
const BY_NAME = new Map(STEPS.map((s) => [s.name, s]));

// ---------------------------------------------------------------------------
// Environment and budgets.
// ---------------------------------------------------------------------------
const env = process.env;
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

Environment (see the header of tooling/gate/run.mjs for the rest):
  NTS_GATE_STEPS        steps to run, space separated (not with step arguments)
  NTS_GATE_SLOTS        CPU slots for the run (default: NTS_JOBS, else 3/4 of the cores)
  NTS_GATE_MEM_GB       memory budget in GB
  NTS_GATE_FAIL_FAST=1  stop at the first FAIL
  NTS_GATE_ACCEPT_SKIP  step names whose SKIPPED does not make the run red
  NTS_GATE_TIME_STRICT=1  a step much slower than its baseline is a FAIL
  NTS_BIN, NTS_SUITE_BIN, NTS_TSGO, CARGO_TARGET_DIR   what is gated
`;
const argSteps = [];
for (const a of process.argv.slice(2)) {
  if (a === "--help" || a === "-h") {
    process.stdout.write(USAGE);
    process.exit(0);
  } else if (a === "--steps") {
    for (const s of STEPS) process.stdout.write(`${s.name.padEnd(24)} ${s.doc ?? ""}\n`);
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
// `NTS_BIN` defaults to the build this run makes, not to `./target/release/nts`:
// with CARGO_TARGET_DIR elsewhere the old default gated whatever another session
// last built into ./target (the-gate-drives-target-release-nts).
const ntsBin = resolve(env.NTS_BIN ?? join(target, "release/nts"));
const suiteBin = resolve(env.NTS_SUITE_BIN ?? join(dirname(ntsBin), "nts-suite"));
const tsgo = resolve(env.NTS_TSGO ?? join(ROOT, "target/tsgo"));
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
const FRONTENDS = Math.floor(intEnv("NTS_GATE_FRONTENDS", 20));
const FAIL_FAST = (env.NTS_GATE_FAIL_FAST ?? "") !== "" && env.NTS_GATE_FAIL_FAST !== "0";
const ACCEPT_SKIP = new Set((env.NTS_GATE_ACCEPT_SKIP ?? "").split(/\s+/).filter(Boolean));
const TIME_STRICT = (env.NTS_GATE_TIME_STRICT ?? "") === "1";
const RECORD_TIMES = (env.NTS_GATE_RECORD_TIMES ?? "") === "1";
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
const RUN_DIR = resolve(env.NTS_GATE_RUN_DIR ?? join(target, "gate-runs", `${stamp}-${process.pid}`));
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
  for (const s of STEPS) {
    for (const d of [...(s.needs ?? []), ...(s.after ?? [])]) {
      if (!BY_NAME.has(d)) usage(`run.mjs: ${s.name} depends on ${d}, which is not a step`);
    }
  }
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
function memAvailableGB() {
  try {
    const m = /MemAvailable:\s+(\d+) kB/.exec(readFileSync("/proc/meminfo", "utf8"));
    return m ? Number(m[1]) / 2 ** 20 : Infinity;
  } catch {
    return Infinity;
  }
}

// ---------------------------------------------------------------------------
// State.
// ---------------------------------------------------------------------------
const startedAt = Date.now();
const results = new Map(); // name -> { verdict, reason, ... }
const running = new Map(); // name -> { child, slots, started, rider, elastic }
let interrupted = null;
let stopping = false;
let summaryWritten = false;
const identities = {};
let plan = [];

function stepEnv(step, slots) {
  const e = { ...env };
  // NTS_JOBS sets the run's budget here; inside a step all.sh would read it as
  // "every knob at once" and undo the slot split.
  delete e.NTS_JOBS;
  delete e.NTS_GATE_STEPS;
  e.NTS_BIN = pinned.nts ?? ntsBin;
  e.NTS_SUITE_BIN = pinned.suite ?? suiteBin;
  e.NTS_TSGO = tsgo;
  e.CARGO_TARGET_DIR = target;
  // clippy checks the same tree in a profile nothing else builds, so its
  // artefacts live apart and it runs beside the release build and `cargo test`
  // instead of queueing on their lock. What it lints is unchanged.
  if (step.name === "clippy") e.CARGO_TARGET_DIR = join(target, "clippy");
  e.NTS_GATE_RUN_DIR = RUN_DIR;
  // An elastic step's workers ask for tokens; any other step already holds
  // its slots, so whatever token-aware tool it runs must not ask again.
  delete e.NTS_GATE_TOKENS;
  delete e.NTS_GATE_TOKEN_HELD;
  e.NTS_GATE_STEP = step.name;
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
  if (step.name === "addons" && plan.includes("profile")) e.NTS_ADDON_EMITTED = join(ROOT, "target", "gate-profile");
  e.NTS_GATE_COSTS_DIR = join(target, "gate-costs");
  // The release build's own test262 protocol binary, so the test262 steps do
  // not `cargo run` a debug copy and queue on cargo's lock behind `tests`.
  // Its `select` and `inventory` output is byte-identical to the debug
  // no-default-features build's over all five directories (checked 2026-10-07).
  const protocol = pinned.protocol ?? join(dirname(ntsBin), "nts-test262-protocol");
  if (existsSync(protocol)) e.NTS_TEST262_PROTOCOL = protocol;
  for (const knob of [
    "NTS_INTEGRITY_JOBS", "NTS_DEFINITIONS_JOBS", "NTS_SNAPSHOT_CACHE_JOBS",
    "NTS_ASSEMBLES_JOBS", "NTS_TYPES_CHECK_JOBS", "NTS_JVM_VERIFIES_JOBS",
  ]) e[knob] = s;
  return e;
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
  process.stdout.write(block);
}

// ---------------------------------------------------------------------------
// Scheduling.
// ---------------------------------------------------------------------------
function used() {
  let slots = 0, mem = 0, fe = 0, riding = 0;
  const locks = new Set();
  let elastic = 0;
  for (const [name, r] of running) {
    const s = BY_NAME.get(name);
    if (s.lock) locks.add(s.lock);
    if (r.elastic) {
      // What it holds right now: a token is one process of its workers.
      const held = tok.held.get(name) ?? 0;
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
  if (!existsSync(tsgo) || !(statSync(tsgo).mode & 0o111)) {
    // The frontend is not cargo's, but it lives in cargo's directory -- so
    // `cargo clean` takes it, and every step afterwards reports a number that
    // is true and means something else. The corpus said `frontend failed 184`,
    // which reads as the compiler having lost the ability to parse anything
    // and meant that a 39MB Go binary was absent.
    return `no frontend at ${tsgo}; run tooling/bootstrap/bootstrap.sh -- \`cargo clean\` removes it`;
  }
  if (!existsSync(ntsBin)) return `no compiler at ${ntsBin}`;
  return null;
}

function order(names) {
  // The most work first (cpu seconds from times.tsv, else wall x slots): the long steps decide
  // when the run ends, so they start while the most slots are free. Tiny steps
  // (see `admit`) run beside them at once whatever the budget, so a cheap check
  // still answers in its first minute.
  const work = (n) => (BASE.get(n)?.cpu > 0 ? BASE.get(n).cpu : estimate(n) * Math.min(BY_NAME.get(n).slots, SLOTS));
  return [...names].sort((a, b) => work(b) - work(a));
}
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
// it holds (times.tsv's cpu seconds minus the token-seconds it has used), plus
// the seconds its oldest worker has waited, so a short step is never starved
// by a long one; the favoured step's claim counts double. Tokens are kept back
// for the first fixed step that waits only for slots (`withhold`).
// ---------------------------------------------------------------------------
const ELASTIC_CAP = Math.max(6, Math.ceil(SLOTS * 0.75));
let withhold = 0;

function workEstimate(name) {
  const b = BASE.get(name);
  const s = BY_NAME.get(name);
  return b?.cpu > 0 ? b.cpu : estimate(name) * Math.min(s?.slots ?? 1, SLOTS);
}

const tok = createTokenPool({
  // `used()` counts the tokens held in an elastic step's share.
  free: () => (memAvailableGB() < 1 ? 0 : SLOTS - used().slots - withhold),
  claim: (step, { held, used: spent, waitedS }) => {
    const left = Math.max(10, workEstimate(step) - spent);
    const c = left / (held + 1) + waitedS;
    return BY_NAME.get(step)?.favoured ? 2 * c : c;
  },
  eligible: (step) => !BY_NAME.get(step)?.fe || used().fe < FRONTENDS,
  known: (step) => BY_NAME.has(step),
  released: () => { if (!stopping) schedule(); },
});
let tokenAddr = null;
const grant = () => { if (tokenAddr) tok.grant(); };
const account = () => tok.account();

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
        if (!step.elastic && !withhold && !(step.lock && u.locks.has(step.lock))) {
          withhold = Math.min(step.min ?? Math.max(1, Math.ceil(step.slots / 2)), step.slots, SLOTS);
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
  const log = join(RUN_DIR, `${step.name}.log`);
  const timeFile = join(RUN_DIR, `${step.name}.time`);
  const fd = openSync(log, "w");
  let cmd = ["sh", join(HERE, "all.sh"), "--call", step.name];
  if (existsSync("/usr/bin/time")) cmd = ["/usr/bin/time", "-f", "%e %U %S %M", "-o", timeFile, ...cmd];
  if (!step.favoured && FAVOURED_PLANNED()) cmd = ["nice", "-n", "5", ...cmd];
  const argv = [cmd[0], cmd.slice(1)];
  const child = spawn(argv[0], argv[1], {
    cwd: ROOT,
    env: stepEnv(step, slots),
    stdio: ["ignore", fd, fd],
    detached: true, // its own process group, so it can be stopped whole
  });
  closeSync(fd);
  const started = Date.now();
  const elastic = Boolean(step.elastic && tokenAddr);
  running.set(step.name, { child, slots, started, rider, elastic });
  process.stderr.write(elastic
    ? `-- ${step.name} started (${slots} workers on tokens; ${running.size} running)\n`
    : `-- ${step.name} started (${slots} slot${slots === 1 ? "" : "s"}; ${running.size} running)\n`);
  child.on("exit", (code, signal) => {
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
    const text = existsSync(log) ? readFileSync(log, "utf8") : "";
    account();
    const extra = { exit: code, signal, wall, cpu, user, sys, maxrss_kb: maxrss, slots, log, started_at: new Date(started).toISOString() };
    if (elastic) Object.assign(extra, { elastic: true, peak_tokens: tok.peak.get(step.name) ?? 0, token_s: Math.round(tok.used.get(step.name) ?? 0) });
    if (stopping && (signal || code !== 0)) {
      finish(step.name, "NOT RUN", interrupted ? `stopped: ${interrupted}` : "stopped by fail-fast", extra);
    } else if (code === 0) {
      finish(step.name, "PASS", "", extra);
    } else if (code === 77) {
      finish(step.name, "SKIPPED", lastLine(text) || "exited 77 without a reason", extra);
    } else {
      finish(step.name, "FAIL", signal ? `killed by ${signal}` : `exit ${code}`, extra);
    }
    report(step.name);
    if (step.name === "build" && results.get("build").verdict === "PASS") identify();
    if (results.get(step.name).verdict === "FAIL" && FAIL_FAST && !stopping) {
      stop("NTS_GATE_FAIL_FAST: a step failed");
    }
    if (!stopping) schedule();
    else if (running.size === 0) done();
  });
}

function stop(why) {
  if (stopping) return;
  stopping = true;
  interrupted = why;
  for (const name of pending) finish(name, "NOT RUN", why);
  pending = [];
  for (const [, r] of running) {
    try { process.kill(-r.child.pid, "SIGTERM"); } catch {}
  }
  setTimeout(() => {
    for (const [, r] of running) {
      try { process.kill(-r.child.pid, "SIGKILL"); } catch {}
    }
  }, 5000).unref();
  if (running.size === 0) done();
}

// **The binaries every step runs are a copy named by their content**, made once
// the build has passed: `<cache>/nts-gate/bin/<sha256>/`. A session relinking
// `target/release/nts` halfway through a run cannot change the compiler between
// two steps (assembles, jvm-verifies, types and snapshot-cache each copied it
// to a fresh directory to protect themselves; every other step did not), and a
// stable path is what the frontend snapshot cache keys a compiler by
// (path, length, mtime), so steps -- and later runs of the same binary -- hit
// each other's snapshots instead of missing on a fresh copy every time.
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
  if (!identities.nts) identify();
  identities.tsgo = { path: tsgo, sha256: sha256(tsgo) };
  identities.node = process.version;
  for (const name of plan) if (!results.has(name)) finish(name, "NOT RUN", interrupted ?? "never scheduled");

  const slow = slower();
  if (TIME_STRICT) {
    for (const s of slow) {
      const r = results.get(s.name);
      if (r.verdict === "PASS") { r.verdict = "FAIL"; r.reason = `${s.ratio.toFixed(1)}x its baseline ${s.kind} time`; }
    }
  }
  const counts = { PASS: 0, FAIL: 0, SKIPPED: 0, "NOT RUN": 0 };
  const red = [];
  for (const name of plan) {
    const r = results.get(name);
    counts[r.verdict]++;
    if (r.verdict === "PASS") continue;
    if (r.verdict === "SKIPPED" && ACCEPT_SKIP.has(name)) { r.accepted = true; continue; }
    red.push(name);
  }
  const green = red.length === 0;
  const wall = (Date.now() - startedAt) / 1000;

  const lines = [];
  lines.push("");
  lines.push(color(1, "gate summary") + `  ${identities.commit ?? "?"}${identities.dirty ? ` +${identities.dirty} uncommitted` : ""}  nts ${identities.nts?.sha256?.slice(0, 12) ?? "missing"}  tsgo ${identities.tsgo?.sha256?.slice(0, 12) ?? "missing"}`);
  for (const name of plan) {
    const r = results.get(name);
    const tag = { PASS: color(32, "PASS    "), FAIL: color(31, "FAIL    "), SKIPPED: color(33, "SKIPPED "), "NOT RUN": color(33, "NOT RUN ") }[r.verdict];
    const t = r.wall !== undefined ? `${String(Math.round(r.wall)).padStart(6)}s` : "       ";
    const c = r.cpu !== undefined ? ` cpu ${String(Math.round(r.cpu)).padStart(6)}s` : "";
    const host = r.verdict === "SKIPPED" && BY_NAME.get(name).host ? ` (needs ${BY_NAME.get(name).host})` : "";
    const how = r.verdict === "SKIPPED" ? (r.accepted ? "  [accepted: NTS_GATE_ACCEPT_SKIP]" : `  [red; NTS_GATE_ACCEPT_SKIP=${name} accepts it]`) : "";
    const why = r.verdict === "PASS" ? "" : `  ${r.reason}${host}${how}`;
    lines.push(`  ${tag} ${name.padEnd(24)}${t}${c}${why}`);
  }
  for (const s of slow) {
    lines.push(color(31, `  SLOWER   ${s.name.padEnd(24)} ${s.kind} ${Math.round(s.now)}s, ${s.ratio.toFixed(1)}x its baseline of ${Math.round(s.was)}s (tooling/gate/times.tsv)`));
  }
  lines.push(`  ${plan.length} requested: ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.SKIPPED} SKIPPED, ${counts["NOT RUN"]} NOT RUN in ${Math.round(wall)}s  (slots ${SLOTS}, mem ${MEM}G, frontends ${FRONTENDS})`);
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
    verdict: green ? "green" : "red",
    fail_fast: FAIL_FAST,
    interrupted,
    started: new Date(startedAt).toISOString(),
    wall_s: wall,
    root: ROOT,
    identities,
    budget: { slots: SLOTS, mem_gb: MEM, frontends: FRONTENDS },
    requested: plan,
    accept_skip: [...ACCEPT_SKIP],
    steps: plan.map((name) => ({ name, ...results.get(name) })),
    slower: slow,
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
  stopping = true;
  for (const [, r] of running) { try { process.kill(-r.child.pid, "SIGKILL"); } catch {} }
  running.clear();
  try { done(); } finally { process.exit(1); }
});

checkTable();
plan = requested();
takeTreeLock();
mkdirSync(RUN_DIR, { recursive: true });
identities.commit = git("rev-parse", "--short=12", "HEAD");
const dirty = git("status", "--porcelain", "--untracked-files=no");
identities.dirty = dirty === null ? null : dirty.split("\n").filter(Boolean).length;
if (!plan.includes("build")) identify();
// **Every setting that changes how hard a step runs, at the top of the log.**
// On 2026-10-06 a wrapper exported NTS_JOBS=1-2 and RUST_TEST_THREADS=1-2 and
// the logs never said so: `tests` took 690 s instead of 450 and `test262-cases`
// 776 s instead of 363, and the difference read as the compiler.
function settings() {
  const names = Object.keys(env).filter((k) =>
    /^(NTS_|RUST_TEST_THREADS$|RUSTFLAGS$|CARGO_|TMPDIR$|XDG_CACHE_HOME$|JAVA_HOME$|ANDROID_HOME$)/.test(k)).sort();
  const lines = names.map((k) => `    ${k}=${env[k]}`);
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
process.stdout.write(
  `gate: ${plan.length} step(s), ${SLOTS} slots, ${MEM}G, ${FRONTENDS} frontends; logs in ${RUN_DIR}\n` +
    `  nts ${ntsBin}${pinned.nts ? ` (run as ${pinned.nts})` : ""}\n  tsgo ${tsgo}\n` + settings() +
    `  steps: ${plan.join(" ")}\n`,
);
tokenAddr = await tok.start();
if (!tokenAddr) process.stderr.write("run.mjs: no token server; elastic steps run at fixed slot counts\n");
pending = order(plan);
schedule();
