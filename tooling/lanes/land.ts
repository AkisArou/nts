// Land a commit on main: the owed gate steps, one gate at a time, then a
// fast-forward. What every lane did by hand, which is how main went red.
//
//   node tooling/lanes/land.ts <commit>            gate it and land it
//   node tooling/lanes/land.ts <commit> --dry-run  say what it owes, change nothing
//
// A gate takes half an hour, longer than an agent's command limit: run it in
// the background and read the outcome with `lane status`, or the log it names.
//
// # What it does, in order
//
// 1. Waits for the landing lock (a kernel lock, so it never goes stale), and
//    during the transition also for the old GATE-RUNNING marker, which it
//    writes and removes like any lane.
// 2. Lands on main as it is now: a commit built on an older main has its
//    commits replayed onto main (`git replay`, which touches no tree), and it
//    is the replayed commit that is gated and landed. A landing queued behind
//    another is therefore not refused because the one ahead of it landed -- the
//    Wasm lane spent three gates on that. A replay that conflicts is refused:
//    rebase by hand and land again.
// 3. Asks `owed.mjs --range main..<commit>` which steps it owes, from the gate
//    tree checked out at the commit being landed: the rules as that commit has
//    them, and the commits, never a working tree's state.
// 4. Gates exactly those, with `pinned.sh`, in the one shared gate tree.
// 5. Reads the run's summary: green, every owed step PASS (a skip only where
//    the gate accepts one), and the summary names this commit.
// 6. Fast-forwards main only if main has not moved since step 2, records the
//    run as a git note on the commit, and releases the locks.
//
// Pushing to origin is not its business: that stays a person's decision.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const HOME = homedir();
const LOCK = join(HOME, ".cache/nts-land.lock");
const STATE = join(HOME, ".cache/nts-land");
const MAINCTL = join(HOME, ".cache/nts-parallel-20261004/mainctl");
const MARKER = join(MAINCTL, "GATE-RUNNING");
const GATE_TREE = join(MAINCTL, "gate-tree");
const GATE_TARGET = join(MAINCTL, "gate-target");
const ACCEPT_SKIP = ["on-device"];

type Lane = { owns: string[]; owns_globs?: string[]; not_run?: string };
const LANES: Record<string, Lane> = JSON.parse(readFileSync(new URL("./lanes.json", import.meta.url), "utf8")).lanes;

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
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
 * The steps `owed.mjs` asks for a range, run from a tree at `sha`; `"all"` when
 * it asks for the full gate, which it says as a bare `all.sh` with no list.
 */
function owedSteps(tree: string, range: string): string[] | "all" {
  const out = execFileSync("node", ["tooling/gate/owed.mjs", "--range", range], { cwd: tree, encoding: "utf8" });
  const line = out.match(/NTS_GATE_STEPS="([^"]*)"/);
  if (line) return line[1].split(/\s+/).filter(Boolean);
  if (/^\s*sh tooling\/gate\/all\.sh\s+# the full gate/m.test(out)) return "all";
  fail(`owed.mjs named no steps for ${range}:\n${out}`);
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
 */
function unrun(steps: { log?: string }[], touched: string[]): string[] {
  const found: string[] = [];
  for (const [name, lane] of Object.entries(LANES)) {
    if (!lane.not_run || !touched.some((path) => owns(lane, path))) continue;
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
 * The commit to land: `sha` itself when main is in its history, or else its
 * commits since it left main replayed onto main. `null` when that replay
 * conflicts. `--ref-action print` writes nothing: the replayed commits exist
 * as objects, and become reachable when main moves to them.
 */
function onMain(root: string, base: string, sha: string): string | null {
  if (spawnSync("git", ["merge-base", "--is-ancestor", base, sha], { cwd: root }).status === 0) return sha;
  const from = git(["merge-base", base, sha], root);
  const replay = spawnSync(
    "git",
    ["replay", "--onto", base, "--ref", "refs/land/replayed", "--ref-action", "print", `${from}..${sha}`],
    { cwd: root, encoding: "utf8" },
  );
  const update = /^update \S+ ([0-9a-f]{40}) /m.exec(replay.stdout ?? "");
  return replay.status === 0 && update ? update[1] : null;
}

/** Hold the landing lock for the rest of this process: re-run under flock. */
function underTheLock(): void {
  if (process.env.NTS_LAND_LOCKED === "1") return;
  mkdirSync(dirname(LOCK), { recursive: true });
  const held = spawnSync("flock", ["-n", LOCK, "true"]);
  if (held.status !== 0) say("another landing holds the lock; waiting");
  const r = spawnSync("flock", [LOCK, process.execPath, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, NTS_LAND_LOCKED: "1" },
  });
  process.exit(r.status ?? 1);
}

/** The old marker, which lanes not yet using this tool still read. */
function claimMarker(sha: string): void {
  let waiting = false;
  for (;;) {
    try {
      writeFileSync(MARKER, `land ${sha} ${new Date().toISOString()}\n`, { flag: "wx" });
      return;
    } catch {
      if (!waiting) say(`waiting for ${MARKER}: ${readFileSync(MARKER, "utf8").trim() || "(empty)"}`);
      waiting = true;
      spawnSync("sleep", ["30"]);
    }
  }
}

function status(fields: Record<string, unknown>): void {
  mkdirSync(STATE, { recursive: true });
  writeFileSync(join(STATE, "status.json"), `${JSON.stringify({ at: new Date().toISOString(), ...fields }, null, 2)}\n`);
}

function main(): void {
  if (!target) fail("which commit? `node tooling/lanes/land.ts <commit> [--dry-run]`");
  const root = sharedCheckout();
  const sha = git(["rev-parse", "--verify", `${target}^{commit}`]);
  const short = sha.slice(0, 12);
  const tree = process.cwd();
  if (git(["rev-parse", "HEAD"], tree) !== sha) {
    fail(`run from a tree whose HEAD is ${short}: owed.mjs answers with the rules as that commit has them`);
  }

  if (!dryRun) underTheLock();

  const base = git(["rev-parse", "main"], root);
  if (base === sha) fail(`${short} is main already`);
  if (dryRun) {
    // Without the lock the gate tree is someone else's: the rules are this
    // tree's, over the commits since it left main.
    const from = git(["merge-base", base, sha], root);
    const owed = owedSteps(tree, `${from}..${sha}`);
    const where = from === base ? `on ${base.slice(0, 12)}` : `(replayed onto ${base.slice(0, 12)} when it lands)`;
    say(`${short} ${where} owes: ${owed === "all" ? "the full gate" : owed.join(" ")}`);
    return;
  }
  const landing = onMain(root, base, sha);
  if (!landing) {
    fail(`${short} does not replay onto main (${base.slice(0, 12)}) without a conflict: rebase by hand, then land`);
  }
  const short_ = landing.slice(0, 12);
  if (landing !== sha) say(`${short} replayed onto main ${base.slice(0, 12)} as ${short_}`);
  // The gate tree is this landing's while the lock is held: check it out at
  // the commit being landed, and ask its rules what the range owes.
  const setup = spawnSync("sh", [join(root, "tooling/gate/pinned.sh"), landing], {
    cwd: root,
    env: { ...process.env, NTS_GATE_TREE: GATE_TREE, NTS_GATE_TARGET: GATE_TARGET, NTS_GATE_SETUP_ONLY: "1" },
    encoding: "utf8",
  });
  if (setup.status !== 0) fail(`could not check out ${short_} in the gate tree:\n${setup.stdout}${setup.stderr}`);
  const owed = owedSteps(GATE_TREE, `${base}..${landing}`);
  say(`${short_} on ${base.slice(0, 12)} owes: ${owed === "all" ? "the full gate" : owed.join(" ")}`);

  claimMarker(short_);
  const run = join(STATE, "runs", `${short_}-${Date.now()}`);
  mkdirSync(run, { recursive: true });
  status({ state: "gating", commit: landing, base, owed, run });
  try {
    const env: Record<string, string | undefined> = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith("NTS_GATE_")) delete env[k];
    if (owed !== "all") env.NTS_GATE_STEPS = owed.join(" ");
    Object.assign(env, {
      NTS_GATE_TREE: GATE_TREE,
      NTS_GATE_TARGET: GATE_TARGET,
      NTS_GATE_ACCEPT_SKIP: ACCEPT_SKIP.join(","),
      NTS_GATE_RUN_DIR: run,
      NTS_TSGO: join(root, "target/tsgo"),
      CARGO_INCREMENTAL: "0",
    });
    say(`gating; log ${join(run, "gate.log")}`);
    const gate = spawnSync("sh", [join(root, "tooling/gate/pinned.sh"), landing], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 30 });
    writeFileSync(join(run, "gate.log"), `${gate.stdout ?? ""}${gate.stderr ?? ""}`);

    const summaryPath = join(run, "summary.json");
    if (!existsSync(summaryPath)) fail(`the gate wrote no summary (exit ${gate.status}); see ${join(run, "gate.log")}`);
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    const byName = new Map<string, string>((summary.steps ?? []).map((s: { name: string; verdict: string }) => [s.name, s.verdict]));
    // The full gate is whatever the run requested: every step all.sh defines.
    const steps: string[] = owed === "all" ? (summary.requested ?? []) : owed;
    if (steps.length === 0) fail(`the summary requested no steps; see ${run}`);
    const wrong = steps.filter((s) => {
      const v = byName.get(s);
      return !(v === "PASS" || (v === "SKIPPED" && ACCEPT_SKIP.includes(s)));
    });
    if (summary.verdict !== "green" || wrong.length > 0) {
      status({ state: "red", commit: landing, base, owed, run, wrong });
      fail(`gate not green: ${wrong.map((s) => `${s}=${byName.get(s) ?? "NOT RUN"}`).join(" ") || summary.verdict}; see ${run}`);
    }
    const touched = git(["diff", "--name-only", base, landing], root).split("\n").filter(Boolean);
    const notRun = unrun(summary.steps ?? [], touched);
    if (notRun.length > 0) {
      status({ state: "unrun", commit: landing, base, owed, run, notRun });
      fail(`green, but a platform this range touches never ran it:\n  ${notRun.slice(0, 5).join("\n  ")}\nbring its VM or toolchain up (the lane's vm.md) and land again`);
    }
    const named = String(summary.identities?.commit ?? "");
    if (named.length < 7 || !landing.startsWith(named)) fail(`the summary names ${named || "no commit"}, not ${short_}`);

    if (git(["rev-parse", "main"], root) !== base) {
      status({ state: "stale", commit: landing, base, owed, run });
      fail("main moved while the gate ran: rebase onto it and land again");
    }
    execFileSync("git", ["merge", "--ff-only", "-q", landing], { cwd: root, env: { ...process.env, NTS_LAND: "1" } });
    const note = `gate ${summary.verdict} ${summary.started} ${Math.round(summary.wall_s)}s steps: ${steps.join(" ")}`;
    spawnSync("git", ["notes", "--ref=land", "add", "-f", "-m", note, landing], { cwd: root });
    status({ state: "landed", commit: landing, base, owed, run });
    say(`LANDED ${short_}: main is ${short_}`);
    if (landing !== sha) say("the branch it came from: `git rebase main` drops the commits that landed");
  } finally {
    if (existsSync(MARKER) && readFileSync(MARKER, "utf8").startsWith(`land ${short_} `)) rmSync(MARKER);
  }
}

try {
  main();
} catch (e) {
  if (!(e instanceof Refused)) throw e;
  console.error(`land: ${e.message}`);
  process.exitCode = 1;
}
