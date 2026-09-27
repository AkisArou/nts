// A compiler binary that says where it came from.
//
//   node tooling/conformance/pin.mjs <rev>                      build <rev> as committed
//   node tooling/conformance/pin.mjs <rev> --patch <file>       <rev> with a patch applied
//   node tooling/conformance/pin.mjs <rev> --worktree <dir>     <rev> with <dir>'s diff against it
//   node tooling/conformance/pin.mjs --show <binary>            print a binary's provenance
//   node tooling/conformance/pin.mjs --self-test
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
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
export const PINS = process.env.NTS_PINS ?? join(homedir(), ".cache/nts-pins");
const TREE = join(PINS, "tree");
const TARGET = join(PINS, "target");

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

/** One line for a report: the commit, what was applied, and the frontend. */
export function describe(record) {
  if (!record) return "provenance unknown: not built by pin.mjs";
  const applied = record.applied ? ` + ${record.applied.source} ${record.applied.sha256.slice(0, 12)} (${record.applied.files.length} file(s))` : "";
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
    const text = git(["diff", "--binary", sha], opts.worktree);
    return text.trim() === "" ? null : { text, source: "worktree" };
  }
  return null;
}

/** Build `rev` (plus what `opts` applies) and return the pinned binary's path. */
export function pin(rev, opts = {}) {
  const sha = git(["rev-parse", "--verify", `${rev}^{commit}`]).trim();
  const diff = appliedDiff(sha, opts);
  const applied = diff
    ? { source: diff.source, sha256: sha256(diff.text), files: [...diff.text.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]) }
    : null;
  const dir = join(PINS, keyOf(sha, applied));
  const binary = join(dir, "nts");
  if (existsSync(binary) && provenanceOf(binary)?.sha === sha) return binary;

  mkdirSync(PINS, { recursive: true });
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

  const build = spawnSync("cargo", ["build", "--release", "-q", "-p", "nts-cli"], {
    cwd: TREE,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, CARGO_TARGET_DIR: TARGET },
  });
  if (build.status !== 0) throw new Error(`cargo build failed for ${keyOf(sha, applied)}`);
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
  if (describe(null) !== "provenance unknown: not built by pin.mjs") return "an unknown binary's description";
  if (provenanceOf("/nonexistent/nts") !== null) return "a binary with no record";
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
    console.log("  self-test: keys, a pin against itself and against its patched twin, an unknown binary");
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
    console.log("  usage: pin.mjs <rev> [--patch <file> | --worktree <dir>]");
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
