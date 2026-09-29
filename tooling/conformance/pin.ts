// A compiler binary that says where it came from.
//
//   node tooling/conformance/pin.ts <rev>                      build <rev> as committed
//   node tooling/conformance/pin.ts <rev> --patch <file>       <rev> with a patch applied
//   node tooling/conformance/pin.ts <rev> --worktree <dir>     <rev> with <dir>'s diff against it
//   node tooling/conformance/pin.ts --show <binary>            print a binary's provenance
//   node tooling/conformance/pin.ts --self-test
//
// Prints the pinned binary's path as its last line. Exit 2 when it cannot
// build or cannot say what it built.
//
// # Why
//
// **A binary cannot state its own provenance**: `nts version` prints `nts
// 0.0.0`, a schema version and a tsgo version, and no commit is embedded
// anywhere. So "which compiler is this" was answered by a file name someone
// typed -- and on 2026-09-28 a census's control was believed to be capture's
// tip and was capture's parent, and its delta included capture. Nothing
// caught it but the implausibility of the result. Only whatever builds a
// binary can record where it came from, so this builds, and records:
//
//   ~/.cache/nts-pins/<key>/nts                the binary
//   ~/.cache/nts-pins/<key>/provenance.json    { sha, clean, applied, tsgo, ... }
//   ~/.cache/nts-pins/<key>/applied.diff       what was applied, when anything was
//
// `applied` is the **diff against <rev>**, not an input file: a change made by
// a patch and one made by a script splicing text are the same thing once
// applied, and the diff is what the binary was built from. Its sha256 is part
// of the key, so two pins of one rev with different changes never collide,
// and a pin asked for twice is built once.
//
// `tsgo` names the frontend the pin pairs with. A copy of `nts` outside
// `target/` does not find `target/tsgo` beside itself, falls back to a
// `tsgo` on PATH with no Node version set, and the first thing that notices
// reports a *frontend crash* -- an environment failure read as a finding.
//
// # For the tools that consume pins
//
// `provenanceOf(binary)` returns the record or null, and `between(a, b)` says
// what separates two pins: the commits from one base to the other, and
// whether their applied diffs differ. A comparison that means "this change,
// and nothing else" should refuse unless the bases are equal and only
// `applied` differs -- that refusal is the consumer's, because comparing two
// commits is also a legitimate question.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
export const PINS = process.env.NTS_PINS ?? join(homedir(), ".cache/nts-pins");
const TREE = join(PINS, "tree");
const TARGET = join(PINS, "target");
const LOCK = join(PINS, "build.lock");

const git = (args, cwd = ROOT, input) => execFileSync("git", args, { cwd, encoding: "utf8", input, maxBuffer: 1 << 28, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** A pin's directory name: the commit, and the applied diff's hash when there is one. */
export const keyOf = (sha, applied) => (applied ? `${sha.slice(0, 12)}+${applied.sha256.slice(0, 12)}` : sha.slice(0, 12));

/** The provenance recorded beside `binary`, or null when nothing built it here. */
export function provenanceOf(binary) {
  const file = join(dirname(resolve(binary)), "provenance.json");
  if (!existsSync(file)) return null;
  try {
    const record = JSON.parse(readFileSync(file, "utf8"));
    return record.sha && "applied" in record ? record : null;
  } catch {
    return null;
  }
}

/**
 * The frontend a tool should run `binary` with: `NTS_TSGO` when set, else the
 * one a pin recorded beside the binary, else `root`'s `target/tsgo`. And
 * whether it exists -- a tool run from a worktree resolves `target/tsgo`
 * against the worktree, which has none, and every project then prints nothing
 * and reads as "0 violations". A pin names its frontend so that cannot happen.
 *
 * **And whether that frontend is still the one the pin was built with.** A pin
 * records its frontend's path *and* hash, but a path stays true while the file
 * behind it is rebuilt: on 2026-09-30 `target/tsgo` was rebuilt for a fork
 * patch, and every earlier pin went on running the new one without a word.
 * `moved` is null when the bytes match the record (or `NTS_TSGO` names a
 * frontend on purpose), and says both hashes when they do not -- a report is
 * then about a compiler and a frontend that were never built together.
 */
export function frontendFor(binary, root) {
  const recorded = process.env.NTS_TSGO ? null : provenanceOf(binary)?.tsgo;
  const path = process.env.NTS_TSGO ?? recorded?.path ?? join(root, "target/tsgo");
  const exists = existsSync(path);
  let moved = null;
  if (exists && recorded?.sha256) {
    const now = sha256(readFileSync(path));
    if (now !== recorded.sha256) moved = `built with ${recorded.sha256.slice(0, 12)}, now ${now.slice(0, 12)}`;
  }
  return { path, exists, moved };
}

/** One line for a report: the commit, what was applied, and the frontend. */
export function describe(record) {
  if (!record) return "provenance unknown: not built by pin.ts";
  const size = (a) => (a.insertions === undefined ? "" : `, +${a.insertions} -${a.deletions}`);
  const applied = record.applied ? ` + ${record.applied.source} ${record.applied.sha256.slice(0, 12)} (${record.applied.files.length} file(s)${size(record.applied)})` : "";
  return `${record.sha.slice(0, 12)}${applied}`;
}

/**
 * What separates two pins: the commits from `a`'s base to `b`'s (either
 * direction), and whether the applied diffs differ. `sameBase` with only
 * `applied` differing is "one change and nothing else".
 */
export function between(a, b) {
  const sameBase = a.sha === b.sha;
  const commits = (from, to, ...paths) => git(["log", "--format=%h %s", `${from}..${to}`, ...(paths.length ? ["--", ...paths] : [])]).split("\n").filter(Boolean);
  return {
    sameBase,
    forward: sameBase ? [] : commits(a.sha, b.sha),
    backward: sameBase ? [] : commits(b.sha, a.sha),
    // The commits that can change the binary. "Capture's parent" on
    // 2026-09-28 was three commits back, two of them tooling -- a comparison
    // is "one change" only when the others touch none of these.
    built: sameBase ? [] : commits(a.sha, b.sha, ...BUILD_INPUTS),
    appliedDiffers: (a.applied?.sha256 ?? null) !== (b.applied?.sha256 ?? null),
  };
}

/** What a binary is built from: a commit touching none of these builds the same compiler. */
export const BUILD_INPUTS = ["compiler", "runtime", "tooling/cli", "Cargo.toml", "Cargo.lock"];

/**
 * What a report prints about its binaries: each one's provenance, and --
 * when both are pinned -- what separates them. One derivation for every tool
 * that compares two compilers, so they cannot describe the same pair
 * differently.
 */
export function armLines(before, after) {
  const a = provenanceOf(before);
  const b = provenanceOf(after);
  const lines = [`before from ${describe(a)}`, `after  from ${describe(b)}`];
  if (!a || !b) return lines;
  const d = between(a, b);
  if (d.sameBase) lines.push(d.appliedDiffers ? "between: one base, and only what is applied differs" : "between: nothing -- the same commit with the same change");
  else if (d.backward.length === 0) {
    lines.push(`between: ${d.forward.length} commit(s), ${d.built.length} of them touching what the binary is built from${d.appliedDiffers ? "; and what is applied differs" : ""}`);
    for (const c of d.built.slice(0, 6)) lines.push(`  builds  ${c}`);
    if (d.built.length > 6) lines.push(`  ... ${d.built.length - 6} more`);
  }
  else lines.push(`between: after is not a descendant of before (${d.backward.length} commit(s) only in before, ${d.forward.length} only in after)`);
  return lines;
}

/**
 * Why two binaries are not "one change and nothing else", or null when they
 * are -- the policy `--one-change` holds a comparison to. One change is
 * either one base with only what is applied differing, or two plain commits
 * with exactly one commit between them that touches what the binary is built
 * from. On 2026-09-28 a delta measured against "capture's parent" included
 * capture, and the attribution stood by luck rather than by method.
 */
export function oneChange(beforeBin, afterBin) {
  const a = provenanceOf(beforeBin);
  const b = provenanceOf(afterBin);
  if (!a || !b) return `${!a ? "before" : "after"} was not built by pin.ts, so what separates the arms is unknown`;
  const d = between(a, b);
  if (d.sameBase) return d.appliedDiffers ? null : "the arms are the same commit with the same change";
  if (d.backward.length > 0) return `after is not a descendant of before (${d.backward.length} commit(s) only in before)`;
  if (a.applied || b.applied) return "the arms differ in commit and in what is applied: two changes";
  if (d.built.length !== 1) return `${d.built.length} commit(s) between the arms touch what the binary is built from:\n${d.built.map((c) => `      ${c}`).join("\n")}`;
  return null;
}

/** The diff a pin applies, and the files it touches; null for none. */
function appliedDiff(sha, opts) {
  if (opts.patch) {
    const text = readFileSync(opts.patch, "utf8");
    return text.trim() === "" ? null : { text, source: "patch" };
  }
  if (opts.worktree) {
    // Untracked files are not in `git diff`; a change that adds one would be
    // pinned without it, silently. Refused rather than guessed.
    const untracked = git(["ls-files", "--others", "--exclude-standard"], opts.worktree).split("\n").filter(Boolean)
      .filter((p) => /^(compiler|runtime|tooling\/cli)\//.test(p));
    if (untracked.length > 0) throw new Error(`${opts.worktree} has untracked source the diff would drop: ${untracked.slice(0, 5).join(", ")}; add them with \`git add -N\``);
    // The diff is against `rev`, so a worktree whose HEAD does not descend from
    // it carries a revert of everything in between: on 2026-09-29 a worktree two
    // commits behind pinned 19 files and 517 deletions as a 3-line change, and
    // the binary built fine. Ahead of `rev` is the worktree's own commits.
    const head = git(["rev-parse", "HEAD"], opts.worktree).trim();
    const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", sha, head], { cwd: opts.worktree }).status === 0;
    if (!ancestor) {
      const reverted = git(["rev-list", "--count", `${head}..${sha}`], opts.worktree).trim();
      throw new Error(`${opts.worktree}'s HEAD ${head.slice(0, 12)} does not descend from ${sha.slice(0, 12)}: its diff against it would revert ${reverted} commit(s). Pin ${head.slice(0, 12)} with --worktree, or rebase the worktree onto ${sha.slice(0, 12)}`);
    }
    const text = git(["diff", "--binary", sha], opts.worktree);
    return text.trim() === "" ? null : { text, source: "worktree" };
  }
  return null;
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

/**
 * **One build at a time in the one pin tree.** Every pin shares `TREE` and
 * `TARGET`, and a build checks out, applies, compiles, and checks out again
 * to undo. On 2026-09-29 two pins built minutes apart: one pin's closing
 * checkout reverted the other's patch in the middle of its `cargo build`, and
 * that pin shipped a binary without its patch, beside an `applied.diff` and a
 * provenance record naming it. A provenance record is trusted, so it was the
 * worst failure this tool can have.
 *
 * The lock is a directory, because `mkdir` is atomic, holding the holder's
 * pid. A holder that no longer runs is stale, and so is a lock with no pid
 * file after a minute (a crash between the two writes). A waiter says so once
 * and polls. `lock` and `wait` are parameters for the self-test.
 */
export function withBuildLock(fn, { lock = LOCK, wait = 60 * 60 * 1000 } = {}) {
  const started = Date.now();
  let said = false;
  const nap = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, "pid"), String(process.pid));
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const pidFile = join(lock, "pid");
      const holder = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8")) : 0;
      const orphaned = holder === 0 && Date.now() - (lstatSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? 0) > 60_000;
      if ((holder !== 0 && !alive(holder)) || orphaned) {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - started >= wait) throw new Error(`the pin tree is held by pid ${holder || "(unknown)"} (${lock}); waited ${Math.round((Date.now() - started) / 1000)} s`);
      if (!said) {
        console.error(`  waiting: pin.ts pid ${holder || "(starting)"} is building in ${TREE}`);
        said = true;
      }
      Atomics.wait(nap, 0, 0, 1000);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** Build `rev` (plus what `opts` applies) and return the pinned binary's path. */
export function pin(rev, opts = {}) {
  const sha = git(["rev-parse", "--verify", `${rev}^{commit}`]).trim();
  const diff = appliedDiff(sha, opts);
  const applied = diff
    ? {
        source: diff.source,
        sha256: sha256(diff.text),
        files: [...diff.text.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]),
        // Its size, printed: a change is checkable by its shape only if the shape is shown.
        insertions: diff.text.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length,
        deletions: diff.text.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length,
      }
    : null;
  const dir = join(PINS, keyOf(sha, applied));
  const binary = join(dir, "nts");
  if (existsSync(binary) && provenanceOf(binary)?.sha === sha) return binary;
  mkdirSync(PINS, { recursive: true });
  // Re-checked inside: a waiter's key may have been built by the holder.
  return withBuildLock(() => (existsSync(binary) && provenanceOf(binary)?.sha === sha ? binary : build(sha, diff, applied, dir)));
}

/** The build itself, run only under the lock. */
function build(sha, diff, applied, dir) {
  const binary = join(dir, "nts");
  if (existsSync(join(TREE, ".git"))) git(["checkout", "--detach", "-q", "--force", sha], TREE);
  else git(["worktree", "add", "--detach", "-q", TREE, sha]);
  // A previous pin's patch or build output must not survive into this one.
  git(["clean", "-fdq", "-e", "third_party"], TREE);
  // The frontend's sources are a submodule, which a fresh worktree has as an
  // empty directory; linked to the main tree's, as `pinned.sh` does.
  const frontend = join(TREE, "third_party/typescript-go");
  if (!lstatSync(frontend, { throwIfNoEntry: false })?.isSymbolicLink()) {
    if (existsSync(frontend) && readdirSync(frontend).length === 0) rmSync(frontend, { recursive: true });
    if (!existsSync(frontend)) symlinkSync(join(ROOT, "third_party/typescript-go"), frontend);
  }
  const clean = git(["status", "--porcelain", "--untracked-files=no", "--ignore-submodules=all"], TREE).trim() === "";
  if (!clean) throw new Error(`the pin tree at ${TREE} is not clean after checkout`);
  if (diff) git(["apply", "--whitespace=nowarn", "-"], TREE, diff.text);
  // **What the tree holds, before and after the build.** The lock keeps other
  // pins out; this catches anything else that moves the tree while cargo
  // reads it. A binary is recorded only if the source it was built from is
  // still the source the record names.
  const state = () => `${git(["rev-parse", "HEAD"], TREE).trim()} ${sha256(git(["diff", "--binary", "--ignore-submodules=all", sha], TREE))}`;
  const before = state();

  const cargo = spawnSync("cargo", ["build", "--release", "-q", "-p", "nts-cli"], {
    cwd: TREE,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, CARGO_TARGET_DIR: TARGET },
  });
  if (cargo.status !== 0) throw new Error(`cargo build failed for ${keyOf(sha, applied)}`);
  const after = state();
  if (after !== before) throw new Error(`the pin tree changed during the build of ${keyOf(sha, applied)} (${before} -> ${after}); nothing was pinned`);
  // Undo the applied diff so the next pin starts from a commit.
  if (diff) git(["checkout", "--force", "-q", sha], TREE);

  const tsgo = process.env.NTS_TSGO ?? join(ROOT, "target/tsgo");
  const record = {
    sha,
    subject: git(["log", "-1", "--format=%s", sha]).trim(),
    clean,
    applied,
    tsgo: existsSync(tsgo) ? { path: tsgo, sha256: sha256(readFileSync(tsgo)) } : null,
    built_at: new Date().toISOString(),
    binary_sha256: sha256(readFileSync(join(TARGET, "release/nts"))),
  };
  // Written beside the binary in a fresh directory, then moved into place, so
  // a half-written pin is never mistaken for a whole one.
  const staging = `${dir}.partial-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  copyFileSync(join(TARGET, "release/nts"), join(staging, "nts"));
  chmodSync(join(staging, "nts"), 0o755);
  if (diff) writeFileSync(join(staging, "applied.diff"), diff.text);
  writeFileSync(join(staging, "provenance.json"), `${JSON.stringify(record, null, 2)}\n`);
  rmSync(dir, { recursive: true, force: true });
  renameSync(staging, dir);
  return binary;
}

// **Seen to decide before it is trusted.**
function selfTest() {
  const a = { sha: "a".repeat(40), applied: null };
  const withPatch = { sha: "a".repeat(40), applied: { source: "patch", sha256: "b".repeat(64), files: ["x"] } };
  if (keyOf(a.sha, null) !== "aaaaaaaaaaaa" || keyOf(a.sha, withPatch.applied) !== "aaaaaaaaaaaa+bbbbbbbbbbbb") return "a pin's key";
  if (keyOf(a.sha, withPatch.applied) === keyOf(a.sha, null)) return "a patched pin shares its base's key";
  const sameRev = between(a, a);
  if (!sameRev.sameBase || sameRev.appliedDiffers) return "a pin compared with itself";
  if (!between(a, withPatch).appliedDiffers || !between(a, withPatch).sameBase) return "a base and its patched pin";
  if (describe(null) !== "provenance unknown: not built by pin.ts") return "an unknown binary's description";
  if (provenanceOf("/nonexistent/nts") !== null) return "a binary with no record";
  if (!/was not built by pin.ts/.test(oneChange("/nonexistent/a", "/nonexistent/b") ?? "")) return "one change between two unrecorded binaries";
  // The build lock: taken from a dead holder, refused by a live one, and
  // released whether the build returns or throws.
  const locks = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "pin-lock-"));
  try {
    const lock = join(locks, "build.lock");
    mkdirSync(lock);
    writeFileSync(join(lock, "pid"), "2147483646");
    let taken = "";
    try { taken = withBuildLock(() => "built", { lock, wait: 0 }); } catch (error) { taken = error.message; }
    if (taken !== "built") return `a lock left by a dead pid was not taken: ${taken}`;
    if (existsSync(lock)) return "the lock was not released after a build returned";
    mkdirSync(lock);
    writeFileSync(join(lock, "pid"), String(process.pid));
    let refused = "";
    try { withBuildLock(() => "built", { lock, wait: 0 }); } catch (error) { refused = error.message; }
    if (!refused.includes(`held by pid ${process.pid}`)) return `a lock held by a live pid read as ${refused || "free"}`;
    rmSync(lock, { recursive: true, force: true });
    try { withBuildLock(() => { throw new Error("the build failed"); }, { lock, wait: 0 }); } catch {}
    if (existsSync(lock)) return "the lock was not released after a build threw";
  } finally {
    rmSync(locks, { recursive: true, force: true });
  }
  // A pin whose recorded frontend is not the file at that path any more.
  const fake = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "pin-selftest-"));
  try {
    const frontend = join(fake, "tsgo");
    writeFileSync(frontend, "the frontend as it is now");
    writeFileSync(join(fake, "provenance.json"), JSON.stringify({ sha: "a".repeat(40), applied: null, tsgo: { path: frontend, sha256: sha256("the frontend it was built with") } }));
    const saved = process.env.NTS_TSGO;
    delete process.env.NTS_TSGO;
    const moved = frontendFor(join(fake, "nts"), fake).moved;
    writeFileSync(frontend, "the frontend it was built with");
    const kept = frontendFor(join(fake, "nts"), fake).moved;
    if (saved !== undefined) process.env.NTS_TSGO = saved;
    if (!moved || kept !== null) return `a rebuilt frontend read as ${moved}, an unchanged one as ${kept}`;
  } finally {
    rmSync(fake, { recursive: true, force: true });
  }
  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const argv = process.argv.slice(2);
  const broken = selfTest();
  if (broken) {
    console.log(`  NOT MEASURED: self-test failed -- ${broken}`);
    process.exit(2);
  }
  if (argv.includes("--self-test")) {
    console.log("  self-test: keys, a pin against itself and against its patched twin, an unknown binary, a frontend rebuilt under a pin, and the build lock taken, refused and released");
    process.exit(0);
  }
  const flag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  if (argv.includes("--show")) {
    const record = provenanceOf(flag("--show"));
    console.log(record ? JSON.stringify(record, null, 2) : `  ${describe(null)}`);
    process.exit(record ? 0 : 2);
  }
  const rev = argv.find((a, i) => !a.startsWith("--") && !["--patch", "--worktree"].includes(argv[i - 1]));
  if (!rev) {
    console.log("  usage: pin.ts <rev> [--patch <file> | --worktree <dir>]");
    process.exit(2);
  }
  try {
    const binary = pin(rev, { patch: flag("--patch"), worktree: flag("--worktree") });
    console.log(`  ${describe(provenanceOf(binary))}`);
    console.log(binary);
  } catch (error) {
    console.log(`  NOT PINNED: ${error.message}`);
    process.exit(2);
  }
}
