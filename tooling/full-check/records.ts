// Records written by the full check (docs/workflow.md, Records): after a green
// run whose checks listed a pending or an improved case, record-pending.ts
// writes those rows with the run's pin, in the full check's tree at the run's
// commit, and the service commits exactly what it wrote and submits the commit
// to the landing queue. Nobody records by hand.
//
// The two lines a check prints are tooling/records/pending.ts's pendingLine and
// improvedLine; they are matched here by their text, which is the interface.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecordedBinary, keyOf, publishPin, withBuildLock } from "../conformance/pin.ts";
import type { Git } from "./git.ts";

const PENDING = /\bpending: (\S.*?) is not recorded in (\S+) yet\b/;
const IMPROVED = /\bimproved, record pending: (\S.*)$/;

/** The pending and improved cases a run's step logs list. */
export function listedRecords(run: string): { pending: string[]; improved: string[] } {
  const pending = new Set<string>(), improved = new Set<string>();
  if (!existsSync(run)) return { pending: [], improved: [] };
  for (const name of readdirSync(run).filter(name => name.endsWith(".log")).sort()) {
    for (const line of readFileSync(join(run, name), "utf8").split("\n")) {
      const p = PENDING.exec(line);
      if (p) pending.add(`${p[1]} (${p[2]})`);
      const i = IMPROVED.exec(line);
      if (i) improved.add(i[1]!.trim());
    }
  }
  return { pending: [...pending].sort(), improved: [...improved].sort() };
}

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
  const entries = git.run(["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0").filter(Boolean);
  for (let k = 0; k < entries.length; k++) {
    const entry = entries[k]!;
    const path = entry.slice(3);
    if (entry[0] === "R" || entry[0] === "C") k++; // the source path follows
    const file = join(git.cwd, path);
    out.set(path, existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : "deleted");
  }
  return out;
}

/** Runs the recorder in `tree` with the pin as NTS_BIN, keeping its output in `run`. */
export type Recorder = (tree: string, pin: string, run: string) => { status: number; output: string };

export type Recorded =
  | { kind: "none"; output: string; status: number }
  | { kind: "committed"; commit: string; files: string[]; refused: string[]; output: string; status: number }
  | { kind: "refused"; refused: string[]; output: string; status: number };

/**
 * Run the recorder in `git`'s tree, which must be at `commit`, and commit what
 * it wrote under the record roots. What it wrote elsewhere is not committed
 * and is named.
 */
export function recordAt(git: Git, commit: string, recorder: (tree: string) => { status: number; output: string }, message: string): Recorded {
  const head = git.run(["rev-parse", "HEAD"]);
  if (head !== commit) throw new Error(`the full check's tree is at ${head.slice(0, 12)}, not the run's ${commit.slice(0, 12)}`);
  const before = dirty(git);
  const { status, output } = recorder(git.cwd);
  const after = dirty(git);
  const changed = [...after].filter(([path, hash]) => before.get(path) !== hash).map(([path]) => path).sort();
  const files = changed.filter(path => RECORD_ROOTS.some(root => path.startsWith(root)));
  const refused = changed.filter(path => !files.includes(path));
  if (!files.length) return refused.length ? { kind: "refused", refused, output, status } : { kind: "none", output, status };
  git.run(["add", "--", ...files]);
  git.run(["commit", "-q", "--no-verify", "-F", "-"], message);
  return { kind: "committed", commit: git.run(["rev-parse", "HEAD"]), files, refused, output, status };
}

export function recordsMessage(commit: string, part: string, run: string, pin: string, listed: { pending: string[]; improved: string[] }): string {
  return [
    `records: the pending and improved rows at ${commit.slice(0, 12)}`,
    "",
    `tooling/records/record-pending.ts wrote them with the run's pin (${pin})`,
    `after the full check's green ${part} run listed ${listed.pending.length} pending and`,
    `${listed.improved.length} improved case(s).`,
    "",
    `Full-check-run: ${run}`,
    "",
  ].join("\n");
}
