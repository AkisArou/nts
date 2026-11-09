// Records written by the full check (docs/workflow.md, Records): after a green
// run whose checks listed a pending case or an accepted change
// (tooling/records/pending.ts's listedIn), record-pending.ts writes those rows
// with the run's pin, in the full check's tree at the run's commit, recording
// only the kinds that part checks and that have something to record, and
// leaves the delta of what it recorded in the run's folder
// (tooling/records/delta.ts). Main has moved on by the time the rows land, and
// a commit made at the run's commit and rebased as text was refused for a
// neighbouring row another commit deleted. So the rows land by case: the tree
// is set up at main's tip, main's own record-pending.ts --apply merges the
// delta there, and the service commits exactly what it wrote, on main, and
// submits that commit to the landing queue. Nobody records by hand.
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { nodePin } from "../bootstrap/node.ts";
import { isRecordedBinary, keyOf, publishPin, withBuildLock } from "../conformance/pin.ts";
import { nodeToolchain } from "../gate/toolchain.ts";
import { candidateCommand } from "../landing/candidate-environment.ts";
import { launcherEnvironment } from "../landing/run.ts";
import { appliedIn, countsText } from "../records/delta.ts";
import type { Git } from "./git.ts";
import type { Part } from "./state.ts";

/**
 * The run's compiler as a pin (tooling/conformance/pin.ts): a recorded pin of
 * the commit if one exists, else the binary the run measured, published with
 * its provenance. Under the pin builder's lock, so a pin.ts build of the same
 * commit and this never write one directory at once.
 */
export function runPin(pins: string, commit: string, subject: string, binary: string, run: string): string {
  const dir = join(pins, keyOf(commit, null)), pinned = join(dir, "nts");
  mkdirSync(pins, { recursive: true });
  return withBuildLock(
    () => isRecordedBinary(pinned, commit) ? pinned : publishPin(binary, dir, {
      sha: commit, subject, clean: true, applied: null, built_at: new Date().toISOString(), built_by: "full-check", run,
    }),
    { lock: join(pins, "build.lock") },
  );
}

/** Record files live under these; a recorder writing anywhere else is refused. */
export const RECORD_ROOTS = ["results/", "tests/"];

/** Every changed or untracked path of a tree, with a hash of its bytes. */
function dirty(git: Git): Map<string, string> {
  const out = new Map<string, string>();
  // Untrimmed: an entry's first column is a space when nothing is staged, and
  // trimming took it from the first entry, cutting a letter off its path
  // ("esults/benchmarks/c/outcomes.tsv"), which then read as outside the records.
  const entries = git.output(["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0").filter(Boolean);
  for (let k = 0; k < entries.length; k++) {
    const entry = entries[k]!;
    const path = entry.slice(3);
    if (entry[0] === "R" || entry[0] === "C") k++; // the source path follows
    const file = join(git.cwd, path);
    out.set(path, existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : "deleted");
  }
  return out;
}

/** What changed in the tree since `before`: the paths under the record roots, and the rest, which is not committed. */
function changedSince(git: Git, before: ReadonlyMap<string, string>): { files: string[]; refused: string[] } {
  const changed = [...dirty(git)].filter(([path, hash]) => before.get(path) !== hash).map(([path]) => path).sort();
  const files = changed.filter(path => RECORD_ROOTS.some(root => path.startsWith(root)));
  return { files, refused: changed.filter(path => !files.includes(path)) };
}

/** record-pending.ts in `tree`, after `part`'s green run in `run`, with `pin`. */
export type Recorder = (tree: string, pin: string, run: string, part: Part) => { status: number; output: string };
/** main's own record-pending.ts --apply `delta` in `tree`, which is at main; its output goes to `log`. */
export type Applier = (tree: string, delta: string, log: string) => { status: number; output: string };

/** What the recorder wrote: under the record roots, and elsewhere. */
export type Recorded = { status: number; output: string; files: string[]; refused: string[] };

/**
 * Run the recorder in `git`'s tree, which must be at `commit`, and say what it
 * wrote. Nothing is committed here: what it recorded is in its delta, which is
 * applied on main (applyAt).
 */
export function recordAt(git: Git, commit: string, recorder: (tree: string) => { status: number; output: string }): Recorded {
  const head = git.run(["rev-parse", "HEAD"]);
  if (head !== commit) throw new Error(`the full check's tree is at ${head.slice(0, 12)}, not the run's ${commit.slice(0, 12)}`);
  const before = dirty(git);
  const { status, output } = recorder(git.cwd);
  return { status, output, ...changedSince(git, before) };
}

export type Applied =
  | { kind: "none"; refused: string[]; output: string; status: number }
  | { kind: "failed"; refused: string[]; output: string; status: number }
  | { kind: "committed"; commit: string; files: string[]; refused: string[]; output: string; status: number };

/**
 * A delta applied on `main`: `git`'s tree set up there by `checkout`, which
 * discards what the recorder wrote at the run's commit (its delta holds it),
 * `apply` run in it, and what that wrote under the record roots committed on
 * main. What it wrote elsewhere is not committed and is named; an apply that
 * fails commits nothing.
 */
export function applyAt(git: Git, main: string, checkout: (commit: string) => void, apply: (tree: string) => { status: number; output: string }, message: (output: string) => string): Applied {
  checkout(main);
  const head = git.run(["rev-parse", "HEAD"]);
  if (head !== main) throw new Error(`the full check's tree is at ${head.slice(0, 12)}, not main's ${main.slice(0, 12)}`);
  const before = dirty(git);
  const { status, output } = apply(git.cwd);
  const { files, refused } = changedSince(git, before);
  if (status !== 0) return { kind: "failed", refused, output, status };
  if (!files.length) return { kind: "none", refused, output, status };
  git.run(["add", "--", ...files]);
  git.run(["commit", "-q", "--no-verify", "-F", "-"], message(output));
  return { kind: "committed", commit: git.run(["rev-parse", "HEAD"]), files, refused, output, status };
}

/**
 * main's own record-pending.ts --apply <delta>, in `tree` once it is at main,
 * in the gate's canonical environment with main's own Node, as the recorder
 * runs (service.ts's recordPending). Its output goes to `log`, whose folder
 * also holds its run's temporary folder while it runs.
 */
export function applyRecords(tree: string, delta: string, log: string, options: { nodeInstallations?: string; env?: NodeJS.ProcessEnv } = {}): { status: number; output: string } {
  const script = join(tree, "tooling/records/record-pending.ts");
  if (!existsSync(script)) return { status: 2, output: "no tooling/records/record-pending.ts at main" };
  const selected = nodeToolchain(nodePin(tree), launcherEnvironment(options.env ?? process.env), options.nodeInstallations);
  const out = openSync(log, "w");
  let r: ReturnType<typeof candidateCommand>;
  try {
    r = candidateCommand(selected.node, {
      tree, run: join(dirname(log), "records-apply"), owned: {}, command: [selected.node, script, "--apply", delta], discardTemporary: true,
    }, selected.env, { output: out });
  } finally { closeSync(out); }
  if (r.error) appendFileSync(log, `\n${r.error.message}\n`);
  return { status: r.status ?? 1, output: readFileSync(log, "utf8") };
}

/**
 * The records commit's message. Its subject is the same for every attempt at
 * one run's rows: a landed records commit is known by its subject on main
 * (service.ts's dropLandedRefs).
 */
export function recordsMessage(records: { commit: string; part: Part; run: string; pin?: string; main: string; attempt: number; output: string }): string {
  const counts = appliedIn(records.output);
  return [
    `records: the pending and accepted rows at ${records.commit.slice(0, 12)}`,
    "",
    `tooling/records/record-pending.ts recorded them at ${records.commit.slice(0, 12)}${records.pin ? ` with the run's pin (${records.pin})` : ""}`,
    `after the full check's green ${records.part} run, and main's own record-pending.ts --apply`,
    `merged their delta case by case on main ${records.main.slice(0, 12)}${records.attempt > 1 ? ` (attempt ${records.attempt})` : ""}:`,
    `${counts ? countsText(counts) : "its log says what applied"}.`,
    "",
    `Full-check-run: ${records.run}`,
    "",
  ].join("\n");
}
