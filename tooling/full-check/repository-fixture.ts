// A scratch repository with a local bare origin, and a stand-in gate that
// reads its verdicts from the commit it measures: a step FAILs at a commit
// whose tree has `RED/<step>` (or `RED/<step>.<anything>`), is HELD where it
// has `HELD/<step>`, and prints `LOG/<step>` into its log. Tests only; no
// network, no systemd, no real gate.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";
import type { Bench } from "./bench.ts";
import { Git } from "./git.ts";
import { verdictOf, type Gate, type Measurement, type StepResult } from "./measure.ts";
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
 * the rows the page marks slower than their own best.
 */
export function stubBench(options: { slower?: string[]; stray?: boolean } = {}): Bench & { calls: string[] } {
  const calls: string[] = [];
  const bench = (tree: string, run: string) => {
    calls.push(tree);
    writeFileSync(join(run, "bench.log"), "nts-bench\n");
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
    return { status: 0 };
  };
  return Object.assign(bench, { calls });
}

/** A landing queue that records what it was given, and what was withdrawn from it. */
export function stubQueue(): { submitted: { commit: string; first: boolean }[]; withdrawn: string[]; submit(commit: string, options?: { first?: boolean }): void; withdraw(commit: string): "withdrawn" | "unknown" } {
  const submitted: { commit: string; first: boolean }[] = [], withdrawn: string[] = [];
  return {
    submitted, withdrawn,
    submit(commit, options) { submitted.push({ commit, first: options?.first === true }); },
    withdraw(commit) {
      if (!submitted.some(entry => entry.commit === commit) || withdrawn.includes(commit)) return "unknown";
      withdrawn.push(commit); return "withdrawn";
    },
  };
}

export function assertMessage(git: Git, commit: string, ...patterns: RegExp[]): void {
  const message = git.run(["log", "-1", "--format=%B", commit]);
  for (const pattern of patterns) assert.match(message, pattern);
}
