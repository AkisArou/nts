// A scratch repository with a local bare origin, and a stand-in gate that
// reads its verdicts from the commit it measures: a step FAILs at a commit
// whose tree has `RED/<step>` (or `RED/<step>.<anything>`), is HELD where it
// has `HELD/<step>`, and prints `LOG/<step>` into its log; and stand-ins for
// the records' recorder and main's own --apply. Tests only; no network, no
// systemd, no real gate.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";
import { appliedLine, DELTA_FILE, parseDelta, serializeDelta } from "../records/delta.ts";
import type { Bench, BenchAttempt } from "./bench.ts";
import { Git } from "./git.ts";
import { verdictOf, type Gate, type Measurement, type StepResult } from "./measure.ts";
import type { LandingAnswer } from "./queue.ts";
import type { Applier, Recorder } from "./records.ts";
import { layout, type Layout } from "./state.ts";

export type Repository = {
  root: string;
  dir: string;
  origin: string;
  git: Git;
  layout: Layout;
  /** Write (or, with null, delete) files and commit them on main. */
  commit(files: Record<string, string | null>, subject: string): string;
};

export const ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "full-check-test", GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "full-check-test", GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
};

export function repository(t: TestContext): Repository {
  const root = mkdtempSync(join(tmpdir(), "full-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "repo"), origin = join(root, "origin.git");
  mkdirSync(dir);
  const git = new Git(dir, ENV);
  git.run(["init", "-q", "-b", "main"]);
  new Git(root, ENV).run(["init", "-q", "--bare", origin]);
  git.run(["remote", "add", "origin", origin]);
  const commit = (files: Record<string, string | null>, subject: string) => {
    for (const [path, text] of Object.entries(files)) {
      if (text === null) git.run(["rm", "-q", "--", path]);
      else {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), text);
        git.run(["add", "--", path]);
      }
    }
    git.run(["commit", "-q", "--allow-empty", "-m", subject]);
    return git.run(["rev-parse", "HEAD"]);
  };
  return { root, dir, origin, git, layout: layout(join(root, "cache")), commit };
}

export type FakeGate = Gate & { measured: { commit: string; steps: string[]; label: string }[] };

/**
 * The stand-in gate. Like pinned.sh it checks the measured commit out in the
 * full check's tree and leaves a compiler at target/release/nts. `flaky`
 * names steps that FAIL only the first time they are measured.
 */
export function fakeGate(repo: Repository, options: { all?: string[]; wide?: string[]; flaky?: string[] } = {}): FakeGate {
  const all = options.all ?? ["build", "tests", "typescript-c", "integrity"];
  const wide = options.wide ?? ["integrity"];
  const flaky = new Set(options.flaky ?? []);
  const measured: FakeGate["measured"] = [];
  const files = (commit: string, under: string) => repo.git.run(["ls-tree", "-r", "--name-only", commit, "--", `${under}/`]).split("\n").filter(Boolean);
  let runs = 0;
  return {
    measured,
    steps: () => ({ all, wide }),
    run(commit, steps, label): Measurement {
      measured.push({ commit, steps: [...steps], label });
      const tree = repo.layout.tree;
      if (repo.git.ok(["-C", tree, "rev-parse", "--git-dir"])) new Git(tree, ENV).run(["checkout", "--detach", "-q", "--force", commit]);
      else repo.git.run(["worktree", "add", "--detach", "-q", tree, commit]);
      mkdirSync(join(repo.layout.target, "release"), { recursive: true });
      writeFileSync(join(repo.layout.target, "release/nts"), `compiler at ${commit}\n`);
      const run = join(repo.layout.runs, `${label}-${commit.slice(0, 12)}-${++runs}`);
      mkdirSync(run, { recursive: true });
      const red = files(commit, "RED"), heldAt = files(commit, "HELD");
      const results: Record<string, StepResult> = {}, reasons: Record<string, string> = {};
      for (const step of steps) {
        const failing = red.some(path => path === `RED/${step}` || path.startsWith(`RED/${step}.`)) || flaky.delete(step);
        results[step] = heldAt.includes(`HELD/${step}`) ? "HELD" : failing ? "FAIL" : "PASS";
        if (results[step] !== "PASS") reasons[step] = results[step] === "HELD" ? "INSTRUMENT: held" : "exit 1";
        const log = repo.git.try(["show", `${commit}:LOG/${step}`]);
        writeFileSync(join(run, `${step}.log`), log.status === 0 ? log.stdout : `${step}\n`);
      }
      return { commit, run, steps: results, reasons, verdict: verdictOf(results) };
    },
  };
}

/**
 * A stand-in nts-bench: like the real one it keeps one run record and the
 * rendered page as a results-only commit on the tree's HEAD. `slower` names
 * the rows the page marks slower than their own best; `refuse` gives the
 * reasons the measurement lock does not admit the first attempts for, one
 * each; `noRecord` runs and keeps nothing; `during` is called while it
 * measures, when the controller's state is as a stop then would leave it.
 */
export function stubBench(options: { slower?: string[]; stray?: boolean; refuse?: string[]; noRecord?: boolean; during?: () => void } = {}): Bench & { calls: string[] } {
  const calls: string[] = [], refusals = [...options.refuse ?? []];
  const bench = (tree: string, run: string): BenchAttempt => {
    calls.push(tree);
    const refusal = refusals.shift();
    if (refusal !== undefined) {
      writeFileSync(join(run, "bench.log"), `${refusal}\n`);
      return { admitted: false, reason: refusal };
    }
    options.during?.();
    writeFileSync(join(run, "bench.log"), "nts-bench\n");
    if (options.noRecord) return { admitted: true, status: 1 };
    const git = new Git(tree, ENV);
    const id = `2026-11-07-${git.run(["rev-parse", "--short=12", "HEAD"])}-${calls.length}`;
    mkdirSync(join(tree, "results/benchmarks/runs"), { recursive: true });
    writeFileSync(join(tree, "results/benchmarks/runs", `${id}.json`), "{}\n");
    writeFileSync(join(tree, "results/benchmarks/full.md"), ["# Benchmark results", "", "| Case | nts C | nts C own best |", "|---|---|---|",
      "|fast|1 ns|1 ns|", ...(options.slower ?? []).map(name => `|${name}|2 ns|1 ns **SLOWER THAN BEST**|`), ""].join("\n"));
    const paths = [`results/benchmarks/runs/${id}.json`, "results/benchmarks/full.md"];
    if (options.stray) { writeFileSync(join(tree, "stray.txt"), "x\n"); paths.push("stray.txt"); }
    git.run(["add", "--", ...paths]);
    git.run(["commit", "-q", "-m", `results: retain benchmark run ${id}`, "--", ...paths]);
    return { admitted: true, status: 0 };
  };
  return Object.assign(bench, { calls });
}

export type StubQueue = {
  submitted: { commit: string; first: boolean }[]; withdrawn: string[];
  /** The landing check's answers, by commit, as a test gives them; a submitted commit with none waits. */
  answers: Map<string, LandingAnswer>;
  submit(commit: string, options?: { first?: boolean }): void;
  withdraw(commit: string): "withdrawn" | "unknown";
  answer(commit: string): LandingAnswer | "waiting" | null;
};

/** A landing queue that records what it was given and what was withdrawn from it, and answers as a test says. */
export function stubQueue(): StubQueue {
  const submitted: { commit: string; first: boolean }[] = [], withdrawn: string[] = [], answers = new Map<string, LandingAnswer>();
  return {
    submitted, withdrawn, answers,
    submit(commit, options) { submitted.push({ commit, first: options?.first === true }); },
    withdraw(commit) {
      if (!submitted.some(entry => entry.commit === commit) || withdrawn.includes(commit)) return "unknown";
      withdrawn.push(commit); return "withdrawn";
    },
    answer(commit) {
      if (answers.has(commit)) return answers.get(commit)!;
      return submitted.some(entry => entry.commit === commit) && !withdrawn.includes(commit) ? "waiting" : null;
    },
  };
}

/** The full check's tree at a commit, as pinned.sh leaves one: checked out and cleaned, with no inputs to link here. */
export function checkoutIn(repo: Repository): (commit: string) => void {
  return commit => {
    const tree = new Git(repo.layout.tree, ENV);
    tree.run(["checkout", "--detach", "-q", "--force", commit]);
    tree.run(["clean", "-fdq"]);
  };
}

/**
 * A stand-in for main's own record-pending.ts --apply in which every row of
 * the delta applies, as its whole file (record-pending.test.ts holds the real
 * one to its rule); its log ends as the real one's does.
 */
export const applyEveryRow: Applier = (tree, delta, log) => {
  const rows = parseDelta(readFileSync(delta, "utf8")).rows;
  for (const row of rows) {
    mkdirSync(dirname(join(tree, row.record)), { recursive: true });
    writeFileSync(join(tree, row.record), row.after);
  }
  const output = `${appliedLine({ applied: rows.length, already: 0, skipped: 0 })}\n`;
  writeFileSync(log, output);
  return { status: 0, output };
};

/** A recorder that writes these record files, and their delta where the full check's call leaves it; `then` runs after. */
export function recording(files: Record<string, string>, then: Recorder = () => ({ status: 0, output: "" })): Recorder {
  return (tree, pin, run, part) => {
    const rows = Object.entries(files).map(([record, after]) => {
      mkdirSync(dirname(join(tree, record)), { recursive: true });
      writeFileSync(join(tree, record), after);
      return { kind: "outcomes", record, case: dirname(record), key: dirname(record), before: null, after, sources: "0".repeat(64) };
    });
    writeFileSync(join(run, DELTA_FILE), serializeDelta({ version: 1, commit: null, headers: {}, rows }));
    return then(tree, pin, run, part);
  };
}

export function assertMessage(git: Git, commit: string, ...patterns: RegExp[]): void {
  const message = git.run(["log", "-1", "--format=%B", commit]);
  for (const pattern of patterns) assert.match(message, pattern);
}
