// Land a commit on main: the owed gate steps, one gate at a time, then a
// fast-forward. What every lane did by hand, which is how main went red.
//
//   node tooling/lanes/land.ts <commit>            gate it and land it
//   node tooling/lanes/land.ts <commit> --dry-run  say what it owes, change nothing
//
// A gate takes half an hour, longer than an agent's command limit: run it in
// the background and read the outcome with `lane status`, or the log it names.
// The commit is resolved when it is queued: the tree is free to move on while
// it waits.
//
// # What it does, in order
//
// 1. Joins the landing queue (a file per waiting landing under
//    ~/.cache/nts-land/queue) and waits for the landing lock (a kernel lock,
//    so it never goes stale); during the transition also for the old
//    GATE-RUNNING marker, which it writes and removes like any lane.
// 2. **Lands a train.** Whoever holds the lock gates every queued landing at
//    once (up to TRAIN_MAX, oldest first), not only its own: one gate is half
//    an hour, and with a dozen landings queued one at a time a lane waited six
//    hours (2026-10-13). Each landing's commits since it left main are
//    replayed in turn onto main (`git replay`, which touches no tree), the
//    next onto the last; one that conflicts with main or with a landing ahead
//    of it is refused -- rebase by hand and land again -- and the train goes
//    on without it.
// 3. Asks `owed.mjs --range main..<tip>` which steps the train owes, from the
//    gate tree checked out at its tip: the rules as that commit has them, and
//    the commits, never a working tree's state.
// 4. Gates exactly those, with `pinned.sh`, in the one shared gate tree.
// 5. Reads the run's summary: green, every owed step PASS (a skip only where
//    the gate accepts one), and the summary names the tip.
// 6. Fast-forwards main to the tip only if main has not moved since step 2,
//    records the run as a git note on it, and answers every landing in the
//    train. A red train of more than one is halved: its first half is gated
//    next, and so on down to the landing that is red on its own, which is
//    refused; the rest stay queued. A landing whose turn comes after a train
//    answered it reports that answer and exits.
//
// `~/.cache/nts-land/trains.tsv` has one line per train gated: its size, its
// verdict and its wall time.
//
// Pushing to origin is not its business: that stays a person's decision.

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { gateCommand } from "../gate/affinity.ts";

// NTS_LAND_HOME is for land.test.ts, which drives this file against a scratch
// repository and a stand-in gate.
const HOME = process.env.NTS_LAND_HOME ?? homedir();
const LOCK = join(HOME, ".cache/nts-land.lock");
const STATE = join(HOME, ".cache/nts-land");
const QUEUE = join(STATE, "queue");
const RESULTS = join(STATE, "results");
/** The most landings one gate carries: a red train is halved, so this bounds the gates a red one costs. */
const TRAIN_MAX = Number(process.env.NTS_LAND_TRAIN_MAX ?? 6);
const MAINCTL = join(HOME, ".cache/nts-parallel-20261004/mainctl");
const MARKER = join(MAINCTL, "GATE-RUNNING");
const GATE_TREE = join(MAINCTL, "gate-tree");
const GATE_TARGET = join(MAINCTL, "gate-target");
const ACCEPT_SKIP = ["on-device"];

type Lane = { owns: string[]; owns_globs?: string[]; not_run?: string };
const LANES: Record<string, Lane> = JSON.parse(readFileSync(new URL("./lanes.json", import.meta.url), "utf8")).lanes;

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
// `--accept-unrun=apple,windows --because=<why>`: land a range that touches a
// platform whose programs did not run, once, on purpose. The user's call, never
// a lane's (2026-10-14, the corpora move: its Apple and Windows projects change
// only in path strings, and both platforms' setups were down on main itself).
// Both flags or neither; the reason goes into the land note beside the run.
const acceptUnrun = (argv.find((a) => a.startsWith("--accept-unrun="))?.slice("--accept-unrun=".length) ?? "")
  .split(",")
  .filter(Boolean);
const because = argv.find((a) => a.startsWith("--because="))?.slice("--because=".length) ?? "";
if (acceptUnrun.length > 0 && because.trim() === "") {
  console.error("land: --accept-unrun needs --because=<why>, which goes into the land note");
  process.exit(2);
}
const target = argv.find((a) => !a.startsWith("--"));

const git = (args: string[], cwd = process.cwd()): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** Thrown, never `process.exit`: the marker is released in a `finally`. */
class Refused extends Error {}

function fail(message: string): never {
  throw new Refused(message);
}

function say(message: string): void {
  console.log(`land: ${message}`);
}

/** The checkout every worktree shares: main lives there and only there. */
function sharedCheckout(): string {
  return dirname(git(["rev-parse", "--path-format=absolute", "--git-common-dir"]));
}

/**
 * What `owed.mjs` asks of a range, run from a tree at `sha`: its steps, or
 * `"all"` for the full gate (a bare `all.sh` with no list), and the interop
 * projects when it could narrow them (`NTS_INTEROP_PROJECTS`), else null.
 */
type Owed = { steps: string[] | "all"; interop: string | null };
function owedSteps(tree: string, range: string): Owed {
  const out = execFileSync("node", ["tooling/gate/owed.mjs", "--range", range], { cwd: tree, encoding: "utf8" });
  const line = out.match(/NTS_GATE_STEPS="([^"]*)"(?: NTS_INTEROP_PROJECTS="([^"]*)")?/);
  if (line) return { steps: line[1].split(/\s+/).filter(Boolean), interop: line[2] ?? null };
  if (/^\s*sh tooling\/gate\/all\.sh\s+# the full gate/m.test(out)) return { steps: "all", interop: null };
  fail(`owed.mjs named no steps for ${range}:\n${out}`);
}

/**
 * The owed steps that read only the tree and take seconds (`treeOnly` in
 * run.mjs's table), run now from the tree being landed, so a landing does not
 * spend a gate learning what they say.
 *
 * On 2026-10-19 two lanes lost a gate each to one missing line: a new interop
 * fixture's `nts.config.ts` not enrolled in `tests/interop/tsconfig.configs.json`.
 * `config` says so in 1.4 s; the trains it refused took half an hour each, and
 * one carried another lane's landing with it.
 */
function treeOnly(tree: string, owed: Owed, short: string): void {
  const listed = execFileSync("node", ["tooling/gate/run.mjs", "--tree-only"], { cwd: tree, encoding: "utf8" })
    .split(/\s+/)
    .filter(Boolean);
  const steps = owed.steps === "all" ? listed : listed.filter((step) => owed.steps.includes(step));
  if (steps.length === 0) return;
  const dir = join(STATE, "tree-only", `${short}-${process.pid}`);
  const run = spawnSync("sh", ["tooling/gate/all.sh"], {
    cwd: tree,
    stdio: "inherit",
    env: { ...process.env, NTS_GATE_STEPS: steps.join(" "), NTS_GATE_RUN_DIR: dir },
  });
  if (run.status !== 0) {
    // The steps that were not green, by name, from the run's own summary.
    const summary = join(dir, "summary.json");
    const red = existsSync(summary)
      ? (JSON.parse(readFileSync(summary, "utf8")).steps as { name: string; verdict: string }[])
          .filter((step) => step.verdict !== "PASS")
          .map((step) => `${step.name} ${step.verdict}`)
      : [`the run (exit ${run.status})`];
    fail(`${red.join(", ")} on ${short}: the gate would refuse it (logs in ${dir})`);
  }
  say(`${steps.join(" ")} green on ${short}`);
}

function describe(owed: Owed): string {
  const steps = owed.steps === "all" ? "the full gate" : owed.steps.join(" ");
  return owed.interop ? `${steps} (interop: ${owed.interop})` : steps;
}

/** Whether a lane's entry names a path: a directory it owns, a file, or a glob. */
function owns(lane: Lane, path: string): boolean {
  const literal = (text: string) => text.replace(/[.+?^$()|[\]\\{}]/g, "\\$&");
  // `*` is one path segment's worth, and the match covers what is under it.
  const glob = (g: string) => new RegExp(`^${g.split("*").map(literal).join("[^/]*")}(/|$)`);
  return (
    lane.owns.some((own) => (own.endsWith("/") ? path.startsWith(own) : path === own)) ||
    (lane.owns_globs ?? []).some((g) => glob(g).test(path))
  );
}

/**
 * Lines in the gate's step logs saying a touched platform lane's programs
 * never ran.
 *
 * A Windows or Apple example builds on this host and runs on a VM. With the VM
 * down, or a toolchain or SDK missing, it prints a `SKIP` line and exits 0,
 * so `interop` is PASS and a change to that platform lands having never run
 * there. Each such lane says in `lanes.json` (`not_run`) which lines mean
 * that; a range that touches its paths and finds one is not landed.
 *
 * **Only paths that can change what runs there.** A lane's paths include
 * documents and the cargo tests of its emitters, and neither reaches the VM:
 * an integration test is compiled and run by `tests`, on this host. Counted,
 * a change to `compiler/codegen/c/tests/com.rs` -- a test-scratch cleanup,
 * green on every step -- was refused because no Windows was reachable
 * (2026-10-14), and with the Windows lane closed it never would be.
 */
function reachesThePlatform(path: string): boolean {
  return !path.endsWith(".md") && !/(^|\/)tests\/[^/]+\.rs$/.test(path);
}

function unrun(steps: { log?: string }[], touched: string[]): string[] {
  const found: string[] = [];
  for (const [name, lane] of Object.entries(LANES)) {
    if (!lane.not_run || !touched.some((path) => reachesThePlatform(path) && owns(lane, path))) continue;
    const pattern = new RegExp(lane.not_run);
    for (const step of steps) {
      if (!step.log || !existsSync(step.log)) continue;
      for (const line of readFileSync(step.log, "utf8").split("\n")) {
        if (pattern.test(line)) found.push(`${name}: ${line.trim()}`);
      }
    }
  }
  return found;
}

/**
 * `sha`'s commits since it left main (`base`), on top of `onto`: `sha` itself
 * when `onto` is in its history, or else those commits replayed onto it.
 * `null` when the replay conflicts. A commit whose change `onto` already has
 * is dropped, so a landing that is wholly on main answers `onto` itself.
 * `--ref-action print` writes nothing: the replayed commits exist as objects,
 * and become reachable when main moves to them.
 */
function replayOnto(root: string, base: string, onto: string, sha: string): string | null {
  if (spawnSync("git", ["merge-base", "--is-ancestor", onto, sha], { cwd: root }).status === 0) return sha;
  const from = git(["merge-base", base, sha], root);
  // **Only the commits whose change is not on main already**, as `git rebase`
  // skips them. The fixture-first workflow lands a subject on its own, as a
  // replayed copy when main has moved, and then the fix from the branch that
  // still holds the original: replaying that original again conflicted with
  // whatever main had done to its files since (CompilerHelper's bigint fix,
  // 2026-10-14). `git cherry` marks each commit `-` when `onto` has one with
  // its patch, `+` when not. A merge in the range is replayed whole, as before.
  const merges = git(["rev-list", "--merges", `${from}..${sha}`], root);
  const pending = merges
    ? [`${from}..${sha}`]
    : git(["cherry", onto, sha, from], root)
        .split("\n")
        .filter((line) => line.startsWith("+ "))
        .map((line) => `${line.slice(2)}^..${line.slice(2)}`);
  let tip = onto;
  for (const range of pending) {
    const replay = spawnSync(
      "git",
      ["replay", "--onto", tip, "--ref", "refs/land/replayed", "--ref-action", "print", range],
      { cwd: root, encoding: "utf8" },
    );
    const update = /^update \S+ ([0-9a-f]{40}) /m.exec(replay.stdout ?? "");
    if (replay.status !== 0 || !update) return null;
    tip = update[1];
  }
  return tip;
}

/** A landing waiting for the lock: one file in QUEUE, named by its id. */
type Entry = { id: string; sha: string; tree: string; pid: number; at: number };
/** What became of a landing, written by whichever process gated it. */
type Result = { state: "landed" | "red" | "conflict" | "unrun"; message: string; landing?: string; main?: string; run?: string };

function enqueue(sha: string, tree: string): string {
  mkdirSync(QUEUE, { recursive: true });
  const at = Date.now();
  const id = `${at}-${process.pid}`;
  writeFileSync(join(QUEUE, `${id}.json`), JSON.stringify({ id, sha, tree, pid: process.pid, at }));
  return id;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resultOf(id: string): Result | null {
  const path = join(RESULTS, `${id}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

function answer(entry: Entry, result: Result): void {
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, `${entry.id}.json`), JSON.stringify(result));
}

/**
 * The landings still waiting, oldest first. One whose process has gone (its
 * lane stopped it, or the machine restarted) is dropped from the queue: no one
 * is left to read its answer.
 */
function waiting(): Entry[] {
  // Answers are read within moments of being written; a week-old one was
  // read long ago, or by no one.
  if (existsSync(RESULTS)) {
    for (const name of readdirSync(RESULTS)) {
      const path = join(RESULTS, name);
      if (Date.now() - statSync(path).mtimeMs > 7 * 86400_000) rmSync(path, { force: true });
    }
  }
  if (!existsSync(QUEUE)) return [];
  const entries: Entry[] = [];
  for (const name of readdirSync(QUEUE)) {
    if (!name.endsWith(".json")) continue;
    const path = join(QUEUE, name);
    let entry: Entry;
    try {
      entry = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue; // being written
    }
    if (!alive(entry.pid)) rmSync(path, { force: true });
    else if (!resultOf(entry.id)) entries.push(entry);
  }
  return entries.sort((a, b) => a.at - b.at);
}

/** Hold the landing lock for the rest of this process: re-run under flock. */
/**
 * The process holding the landing lock, from the kernel's own table: a
 * `FLOCK` line in `/proc/locks` on the lock file's inode (a waiter's line
 * starts with `->`, and is not the holder).
 */
function lockHolder(): number | null {
  if (!existsSync(LOCK) || !existsSync("/proc/locks")) return null;
  const inode = statSync(LOCK).ino;
  for (const line of readFileSync("/proc/locks", "utf8").split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f[1] !== "FLOCK" || f[1] === "->") continue;
    if (Number(f[5]?.split(":")[2]) === inode) return Number(f[4]);
  }
  return null;
}

/** Whether `pid` is this process or one of its ancestors. */
function isAncestor(pid: number): boolean {
  for (let at = process.pid; at > 1; ) {
    if (at === pid) return true;
    const stat = readFileSync(`/proc/${at}/stat`, "utf8");
    at = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
  }
  return false;
}

/**
 * Join the queue and hold the landing lock for the rest of this process:
 * re-run under flock, telling the locked process which queue entry is its.
 */
function underTheLock(sha: string, tree: string): void {
  if (process.env.NTS_LAND_LOCKED === "1") return;
  // **Run bare.** A wrapper that takes this lock and then runs land.ts holds
  // it while land.ts waits for it: every lane's landing stopped for most of
  // an hour on one on 2026-10-13. land.ts takes the lock itself.
  const holder = lockHolder();
  if (holder !== null && isAncestor(holder)) {
    fail(`process ${holder}, which started this one, holds the landing lock: run land.ts bare, it takes the lock itself`);
  }
  mkdirSync(dirname(LOCK), { recursive: true });
  const id = enqueue(sha, tree);
  const held = spawnSync("flock", ["-n", LOCK, "true"]);
  if (held.status !== 0) say("another landing holds the lock; waiting (whoever holds it next gates every landing queued)");
  // The commit resolved now, not the argument again: `HEAD` re-read under the
  // lock, hours later, is whatever the lane has committed since -- so a lane
  // could not work in its tree while its landing waited.
  const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
  const r = spawnSync("flock", [LOCK, process.execPath, process.argv[1], sha, ...flags], {
    stdio: "inherit",
    env: { ...process.env, NTS_LAND_LOCKED: "1", NTS_LAND_ENTRY: id },
  });
  rmSync(join(QUEUE, `${id}.json`), { force: true });
  process.exit(r.status ?? 1);
}

/**
 * The old marker, which lanes not yet using this tool still read.
 *
 * **A `land` marker found here is a dead landing's.** Only the landing that
 * holds the landing lock writes one, and this process holds it now -- the lock
 * is released when its holder exits, however it exits, while the marker is
 * removed only by a `finally` that a killed process never reaches. On
 * 2026-10-21 a landing whose session was killed left its marker twice, and the
 * next landing waited on it forever while every lane queued behind; both times
 * someone removed it by hand. A marker another tool wrote (a gate run by hand)
 * is still waited for.
 */
function claimMarker(sha: string): void {
  let waiting = false;
  for (;;) {
    try {
      writeFileSync(MARKER, `land ${sha} ${new Date().toISOString()} pid ${process.pid}\n`, { flag: "wx" });
      return;
    } catch {
      const held = existsSync(MARKER) ? readFileSync(MARKER, "utf8").trim() : "";
      if (held.startsWith("land ")) {
        say(`removing a dead landing's marker (this landing holds the lock it was written under): ${held}`);
        rmSync(MARKER, { force: true });
        continue;
      }
      if (!waiting) say(`waiting for ${MARKER}: ${held || "(empty)"}`);
      waiting = true;
      spawnSync("sleep", ["30"]);
    }
  }
}

function status(fields: Record<string, unknown>): void {
  mkdirSync(STATE, { recursive: true });
  writeFileSync(join(STATE, "status.json"), `${JSON.stringify({ at: new Date().toISOString(), ...fields }, null, 2)}\n`);
}

/** How a gate of one commit ended: green, or why not. */
type Gated = { ok: true; run: string; note: string } | { ok: false; run: string; state: "red" | "unrun"; message: string };

/**
 * The gate's debug build gains the artifacts of every compiler version gated,
 * and cargo never deletes one: 69 GB on 2026-10-14, with the disk at 99%.
 * Nothing but a landing uses it and this one holds the lock, so past
 * DEBUG_TARGET_MAX_GB it is started over. Its cold build is minutes of the
 * `tests` step, beside an `interop` step that takes the whole gate.
 */
const DEBUG_TARGET_MAX_GB = 40;
function trimGateTarget(): void {
  const debug = join(GATE_TARGET, "debug");
  if (!existsSync(debug)) return;
  const kb = Number(execFileSync("du", ["-xsk", debug], { encoding: "utf8" }).split("\t")[0]);
  if (kb > DEBUG_TARGET_MAX_GB * 1024 * 1024) {
    say(`the gate's debug build is ${Math.round(kb / 1048576)} GB, over ${DEBUG_TARGET_MAX_GB}: starting it over`);
    rmSync(debug, { recursive: true, force: true });
  }
}

/** Gate `landing`, which is `base` plus the train, in the shared gate tree. */
function gate(root: string, base: string, landing: string, members: string[]): Gated {
  const short = landing.slice(0, 12);
  trimGateTarget();
  // The gate tree is this landing's while the lock is held: check it out at
  // the commit being landed, and ask its rules what the range owes.
  const setup = spawnSync("sh", [join(root, "tooling/gate/pinned.sh"), landing], {
    cwd: root,
    env: { ...process.env, NTS_GATE_TREE: GATE_TREE, NTS_GATE_TARGET: GATE_TARGET, NTS_GATE_SETUP_ONLY: "1" },
    encoding: "utf8",
  });
  if (setup.status !== 0) fail(`could not check out ${short} in the gate tree:\n${setup.stdout}${setup.stderr}`);
  const owed = owedSteps(GATE_TREE, `${base}..${landing}`);
  say(`${short} on ${base.slice(0, 12)} owes: ${describe(owed)}`);

  claimMarker(short);
  const run = join(STATE, "runs", `${short}-${Date.now()}`);
  mkdirSync(run, { recursive: true });
  status({ state: "gating", commit: landing, base, owed, run, train: members });
  try {
    const env: Record<string, string | undefined> = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith("NTS_GATE_") || k === "NTS_INTEROP_PROJECTS") delete env[k];
    if (owed.steps !== "all") env.NTS_GATE_STEPS = owed.steps.join(" ");
    if (owed.interop) env.NTS_INTEROP_PROJECTS = owed.interop;
    Object.assign(env, {
      NTS_GATE_TREE: GATE_TREE,
      NTS_GATE_TARGET: GATE_TARGET,
      NTS_GATE_ACCEPT_SKIP: ACCEPT_SKIP.join(","),
      NTS_GATE_RUN_DIR: run,
      NTS_TSGO: join(root, "target/tsgo"),
      CARGO_INCREMENTAL: "0",
    });
    const launch = gateCommand("sh", [join(root, "tooling/gate/pinned.sh"), landing]);
    const affinity = launch.cpus === null ? launch.mechanism : `CPUs ${launch.cpus}; measurement CPUs 4-5 excluded; ${launch.mechanism}`;
    say(`gate affinity: ${affinity}`);
    say(`gating; log ${join(run, "gate.log")}`);
    const gated = spawnSync(launch.command, launch.args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 30 });
    writeFileSync(join(run, "gate.log"), `land: gate affinity: ${affinity}\n${gated.stdout ?? ""}${gated.stderr ?? ""}`);

    const summaryPath = join(run, "summary.json");
    if (!existsSync(summaryPath)) return { ok: false, run, state: "red", message: `the gate wrote no summary (exit ${gated.status}); see ${join(run, "gate.log")}` };
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    const byName = new Map<string, string>((summary.steps ?? []).map((s: { name: string; verdict: string }) => [s.name, s.verdict]));
    // The full gate is whatever the run requested: every step all.sh defines.
    const steps: string[] = owed.steps === "all" ? (summary.requested ?? []) : owed.steps;
    if (steps.length === 0) return { ok: false, run, state: "red", message: `the summary requested no steps; see ${run}` };
    const wrong = steps.filter((s) => {
      const v = byName.get(s);
      return !(v === "PASS" || (v === "SKIPPED" && ACCEPT_SKIP.includes(s)));
    });
    if (summary.verdict !== "green" || wrong.length > 0) {
      return { ok: false, run, state: "red", message: `gate not green: ${wrong.map((s) => `${s}=${byName.get(s) ?? "NOT RUN"}`).join(" ") || summary.verdict}; see ${run}` };
    }
    const touched = git(["diff", "--name-only", base, landing], root).split("\n").filter(Boolean);
    const notRun = unrun(summary.steps ?? [], touched).filter(
      (line) => !acceptUnrun.includes(line.slice(0, line.indexOf(":"))),
    );
    if (notRun.length > 0) {
      return {
        ok: false,
        run,
        state: "unrun",
        message: `green, but a platform this range touches never ran it:\n  ${notRun.slice(0, 5).join("\n  ")}\nbring its VM or toolchain up (the lane's vm.md) and land again`,
      };
    }
    const named = String(summary.identities?.commit ?? "");
    if (named.length < 7 || !landing.startsWith(named)) return { ok: false, run, state: "red", message: `the summary names ${named || "no commit"}, not ${short}` };
    const accepted = acceptUnrun.length > 0 ? `; accepted unrun: ${acceptUnrun.join(", ")} -- ${because}` : "";
    return { ok: true, run, note: `gate ${summary.verdict} ${summary.started} ${Math.round(summary.wall_s)}s steps: ${steps.join(" ")}${accepted}` };
  } finally {
    if (existsSync(MARKER) && readFileSync(MARKER, "utf8").startsWith(`land ${short} `)) rmSync(MARKER);
  }
}

/**
 * Gate the landings in `train` as one, and answer each. `"halve"` when a train
 * of more than one was red: the culprit is found by gating its first half
 * next, and nothing is answered yet.
 */
function runTrain(root: string, train: Entry[]): "done" | "halve" {
  const base = git(["rev-parse", "main"], root);
  let tip = base;
  const members: { entry: Entry; landing: string }[] = [];
  for (const entry of train) {
    const landing = replayOnto(root, base, tip, entry.sha);
    const short = entry.sha.slice(0, 12);
    if (!landing) {
      const behind = members.length > 0 ? ` or the ${members.length} landing(s) ahead of it in this train` : "";
      answer(entry, { state: "conflict", message: `${short} does not replay onto main (${base.slice(0, 12)})${behind} without a conflict: rebase onto main by hand, then land` });
      continue;
    }
    if (landing === tip && tip === base) {
      answer(entry, { state: "landed", message: `${short}'s changes are on main already`, landing: tip, main: base });
      continue;
    }
    // A landing whose changes a landing ahead of it in this train already
    // makes adds nothing, and lands or not with the train: it is answered
    // after the gate, never before.
    if (landing !== entry.sha) say(`${short} replayed onto ${tip.slice(0, 12)} as ${landing.slice(0, 12)}`);
    members.push({ entry, landing });
    tip = landing;
  }
  if (members.length === 0) return "done";
  const shas = members.map((m) => m.entry.sha.slice(0, 12));
  if (members.length > 1) say(`a train of ${members.length}: ${shas.join(" ")}`);

  const started = Date.now();
  const gated = gate(root, base, tip, shas);
  const record = (verdict: string) => {
    mkdirSync(STATE, { recursive: true });
    appendFileSync(join(STATE, "trains.tsv"), `${new Date(started).toISOString()}\t${members.length}\t${verdict}\t${Math.round((Date.now() - started) / 1000)}\t${tip.slice(0, 12)}\t${shas.join(",")}\n`);
  };
  if (!gated.ok) {
    record(gated.state);
    status({ state: gated.state, commit: tip, base, run: gated.run, train: shas });
    if (members.length > 1) {
      say(`a train of ${members.length} was ${gated.state}: gating its first half on its own next`);
      return "halve";
    }
    answer(members[0].entry, { state: gated.state, message: gated.message, run: gated.run });
    return "done";
  }
  if (git(["rev-parse", "main"], root) !== base) {
    // Every landing takes this lock, so this is a hand-made move of main.
    fail("main moved while the gate ran, under the landing lock: someone moved it by hand");
  }
  execFileSync("git", ["merge", "--ff-only", "-q", tip], { cwd: root, env: { ...process.env, NTS_LAND: "1" } });
  // Every member's own commit carries the note, not only the tip: a lane asks
  // `git notes --ref=land show` of the commit it landed, and a member before
  // the tip was gated as part of the tip.
  const note = members.length > 1 ? `${gated.note}\ntrain: ${shas.join(" ")}` : gated.note;
  for (const { landing } of members) {
    const own = landing === tip ? note : `${note}\ngated as part of: ${tip}`;
    spawnSync("git", ["notes", "--ref=land", "add", "-f", "-m", own, landing], { cwd: root });
  }
  record("landed");
  status({ state: "landed", commit: tip, base, run: gated.run, train: shas });
  const refreshed = refreshPackages(root, base, tip);
  for (const { entry, landing } of members) {
    const train = members.length > 1 ? ` in a train of ${members.length}` : "";
    answer(entry, { state: "landed", message: `LANDED ${entry.sha.slice(0, 12)}${train} as ${landing.slice(0, 12)}: main is ${tip.slice(0, 12)}${refreshed}`, landing, main: tip, run: gated.run });
  }
  return "done";
}

/**
 * **The shared checkout's packages follow its lockfile**, so a landing that
 * changes the lockfile installs. Every tree's inputs are copied from the
 * checkout's `node_modules` (`inputs.sh`), so a package a landing added -- the
 * AssemblyScript column's compiler, 2026-10-15 -- reached no tree until
 * someone remembered to install it by hand. After the fast-forward, so a
 * failure here cannot unland anything: it is said in the landing's message
 * instead, for the person to run.
 */
function refreshPackages(root: string, base: string, tip: string): string {
  const touched = git(["diff", "--name-only", `${base}..${tip}`, "--", "pnpm-lock.yaml", "pnpm-workspace.yaml"], root);
  if (touched === "") return "";
  const install = spawnSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], {
    cwd: root,
    encoding: "utf8",
    timeout: 600_000,
    env: { ...process.env, NTS_LAND: "1" },
  });
  if (install.status === 0) return "; packages installed for the new lockfile";
  const why = (install.stderr || install.stdout || String(install.error ?? "")).trim().split("\n").pop();
  return `; the lockfile changed and \`pnpm install --frozen-lockfile\` failed in ${root} (${why}): run it there`;
}

function main(): void {
  if (!target) fail("which commit? `node tooling/lanes/land.ts <commit> [--dry-run]`");
  const root = sharedCheckout();
  const sha = git(["rev-parse", "--verify", `${target}^{commit}`]);
  const short = sha.slice(0, 12);
  const tree = process.cwd();
  // Asked when the landing is queued; under the lock the tree may have moved on.
  if (process.env.NTS_LAND_LOCKED !== "1" && git(["rev-parse", "HEAD"], tree) !== sha) {
    fail(`run from a tree whose HEAD is ${short}: owed.mjs answers with the rules as that commit has them`);
  }

  if (dryRun) {
    const base = git(["rev-parse", "main"], root);
    if (base === sha) fail(`${short} is main already`);
    // Without the lock the gate tree is someone else's: the rules are this
    // tree's, over the commits since it left main.
    const from = git(["merge-base", base, sha], root);
    const owed = owedSteps(tree, `${from}..${sha}`);
    const where = from === base ? `on ${base.slice(0, 12)}` : `(replayed onto ${base.slice(0, 12)} when it lands)`;
    say(`${short} ${where} owes: ${describe(owed)}`);
    treeOnly(tree, owed, short);
    return;
  }

  underTheLock(sha, tree);
  // Under the lock. A process started with the lock already held has no entry
  // yet: it queues itself here, with this process as the one to answer.
  const id = process.env.NTS_LAND_ENTRY ?? enqueue(sha, tree);
  if (git(["rev-parse", "main"], root) === sha && !resultOf(id)) fail(`${short} is main already`);
  for (let limit = TRAIN_MAX; ; ) {
    const result = resultOf(id);
    if (result) {
      if (result.state !== "landed") fail(result.message);
      say(result.message);
      if (result.landing !== sha) say("the branch it came from: `git rebase main` drops the commits that landed");
      return;
    }
    const train = waiting().slice(0, limit);
    if (train.length === 0) fail(`this landing (${id}) is in no queue: run land.ts again`);
    limit = runTrain(root, train) === "halve" ? Math.max(1, Math.floor(train.length / 2)) : TRAIN_MAX;
  }
}

try {
  main();
} catch (e) {
  if (!(e instanceof Refused)) throw e;
  console.error(`land: ${e.message}`);
  process.exitCode = 1;
}
