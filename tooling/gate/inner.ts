import {gitArguments} from "./git-arguments/main.ts";
import {runAsCommand} from "../differential/command-entry/main.ts";
import {hostObservations} from "./host-observations.ts";
import {clippyTarget} from "./build-targets.ts";
import {toolingSliceArgs} from "./tooling-slice.ts";
// The inner loop: what a change owes before it is queued, run as fast as this
// machine allows -- the gate's own core commands, not look-alikes.
//
//   node tooling/gate/inner.ts                  main..HEAD, plus what is not committed
//   node tooling/gate/inner.ts --base <rev>     against another base
//   node tooling/gate/inner.ts --no-agree       the Rust half only
//   node tooling/gate/inner.ts --keep-going     every step, even past a red one
//
// # Why
//
// AGENTS.md asks for the gate's commands before a landing: `cargo fmt`, clippy
// over the workspace, the shared test owner over every crate touched and
// the three backends with one checker per process, and `agree.mjs`.
// Release settings with one code generation unit and thin LTO made the tests
// alone take 30 to 45 minutes beside a gate (2026-10-22), which then built
// them again. Every route now runs the same tests in the `nts-dev` profile
// (Cargo.toml): optimized, incremental, with the gate test profile's overflow
// checks and debug assertions, so a change to one crate rebuilds
// that crate and what depends on it. It is not a gate and does not replace
// one; it is what makes the gate not the place a change is found to be red.
//
// # What it runs, in order, stopping at the first red
//
// 1. `cargo fmt --check`, and `clang-format --dry-run -Werror` on any
//    runtime C the change edited.
// 2. `cargo clippy --workspace --all-targets -- -D warnings`.
// 3. Build this tree's `nts-dev` compiler, including with `--no-agree`.
// 4. `test-profile.ts inner` (--no-fail-fast) over the touched crates
//    and the three backends, with the frontend compiled into this tree's binary.
// 5. `agree.mjs` on c, llvm and jvm, main's pinned compiler before and
//    this tree's `nts-dev` build after -- and with `NTS_RC=1` on c and llvm
//    when the change reaches the compiler or a runtime, since reference
//    counting is decided in core.
//
// Every heavy step waits its turn in the machine's memory ledger through
// admit.ts, for what its earlier runs in this tree held (`--key`), never more
// than its scope's MemoryMax, so it holds that reservation exactly as long as
// it runs and nothing between steps, and its peak sizes its next run; and it
// runs niced, off the measurement CPUs 4-5, in that capped scope.
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync, writeFileSync, chmodSync } from "node:fs";
import { availableParallelism,homedir } from "node:os";
import {gateEnvironment,sealOracleRun} from "./canonical-environment.ts";
import {finishRunTemporary} from "./run-temporary.ts";
import { join,relative } from "node:path";
import { fileURLToPath } from "node:url";
import { machineMemory, parseBytes, SYSTEM_FLOOR_BYTES } from "./memory-ledger.ts";
import { defaultSlots } from "./budget.ts";
import {assertTestLayout} from './test-layout.ts';
import {DiskCapacity} from './disk-capacity.ts';

const ROOT = realpathSync(join(fileURLToPath(import.meta.url), "../../.."));
let launchEnvironment:NodeJS.ProcessEnv=process.env;
const BACKENDS = ["nts-codegen-c", "nts-codegen-llvm", "nts-codegen-jvm"];

export type Package = { name: string; dir: string };

/**
 * The crates a set of changed paths touches: for each path, the package whose
 * directory is its longest prefix. A path in no package -- a fixture, a doc, a
 * script -- touches none.
 */
export function cratesTouched(changed: readonly string[], packages: readonly Package[]): string[] {
  const found = new Set<string>();
  for (const path of changed) {
    let best: Package | undefined;
    for (const pkg of packages) {
      const prefix = pkg.dir.endsWith("/") ? pkg.dir : `${pkg.dir}/`;
      if (path.startsWith(prefix) && (!best || pkg.dir.length > best.dir.length)) {
        best = pkg;
      }
    }
    if (best) {
      found.add(best.name);
    }
  }
  return [...found].sort();
}

/**
 * The runtime C a change edited that the gate's format step checks: the files
 * at `runtime/c`'s top level and in its `tests/`. A vendored tree below it
 * (`quickjs/`, `zmij/`) is upstream's and outside the check.
 */
export function formattedRuntimeC(changed: readonly string[]): string[] {
  return changed.filter((path) => /^runtime\/c\/(tests\/)?[^/]+\.[ch]$/.test(path));
}

/** Whether a change can move what reference counting decides. */
export function reachesCounting(changed: readonly string[]): boolean {
  return changed.some((path) => path.startsWith("compiler/") || path.startsWith("runtime/"));
}

/** Every CPU this machine has, without the two kept for measurement. */
export function cpusOffMeasurement(count: number = availableParallelism()): string {
  return Array.from({ length: count }, (_, cpu) => cpu)
    .filter((cpu) => cpu !== 4 && cpu !== 5)
    .join(",");
}

function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv = {}): number {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit", env: { ...launchEnvironment, ...env } });
  return result.status ?? 1;
}

function text(command: string, args: readonly string[]): string {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

const ADMIT = fileURLToPath(new URL("./admit.ts", import.meta.url));
const TEST_OWNER = fileURLToPath(new URL("./test-profile.ts", import.meta.url));
const CLIPPY_OWNER = fileURLToPath(new URL("./clippy.ts", import.meta.url));

/** A heavy phase: its key in the tree's history, what it is, its scope's MemoryMax, and the workers it runs. */
type Phase = { key: string; what: string; memoryMax: string; workers: number };

/** The workers a cargo phase runs: the gate's slots on this machine. */
const CARGO_WORKERS = defaultSlots(hostObservations().availableWidth());

/**
 * A heavy command: admitted by the memory ledger for what this phase held
 * before in this tree, never more than its scope's MemoryMax or what the
 * machine could hold; niced, off CPUs 4-5, in that capped scope.
 */
function heavy(phase: Phase, command: string, args: readonly string[], env: NodeJS.ProcessEnv = {}): number {
  const most = Math.min(parseBytes(phase.memoryMax), machineMemory().totalBytes - SYSTEM_FLOOR_BYTES);
  const bounded = ["nice", "-n", "19", "taskset", "-c", cpusOffMeasurement(), command, ...args];
  const scoped = spawnSync("systemd-run", ["--version"], { stdio: "ignore" }).status === 0
    ? ["systemd-run", "--user", "--scope", "--collect", ...toolingSliceArgs(), "-q", "-p", `MemoryMax=${phase.memoryMax}`, "-p", "MemorySwapMax=0", ...bounded]
    : bounded;
  return run(process.execPath, [ADMIT, "--key", phase.key, "--workers", String(phase.workers), "--at-most", String(most),
    "--what", `inner loop: ${phase.what}`, "--", ...scoped], env);
}

function changedPaths(base: string): string[] {
  const committed = text("git",gitArguments( ["diff", "--name-only", `${base}...HEAD`]));
  const working = text("git",gitArguments( ["diff", "--name-only", "HEAD"]));
  const untracked = text("git",gitArguments( ["ls-files", "--others", "--exclude-standard"]));
  return [...new Set(`${committed}\n${working}\n${untracked}`.split("\n").filter(Boolean))].sort();
}

function packages(): Package[] {
  const metadata = JSON.parse(text("cargo", ["metadata", "--no-deps", "--format-version", "1"]));
  assertTestLayout(ROOT,metadata.packages);
  return metadata.packages.map((pkg: { name: string; manifest_path: string }) => ({
    name: pkg.name,
    dir: pkg.manifest_path.slice(ROOT.length + 1).replace(/\/Cargo\.toml$/, ""),
  }));
}

type Step = { name: string; status: number; seconds: number };

const USAGE = `node tooling/gate/inner.ts [--base <rev>] [--no-agree] [--keep-going]

The gate's core commands, fast, before a change is queued: fmt, clippy, the
tests over the touched crates and the three backends in the nts-dev profile,
and agree.mjs on four backends against <rev>'s pinned compiler (main).`;

function main(argv: readonly string[],capacity:DiskCapacity): number {
  const known = new Set(["--base", "--no-agree", "--keep-going", "--help"]);
  const unknown = argv.filter((arg, at) => arg.startsWith("-") && !known.has(arg) && argv[at - 1] !== "--base");
  if (argv.includes("--help") || unknown.length > 0) {
    if (unknown.length > 0) {
      console.log(`unknown: ${unknown.join(" ")}\n`);
    }
    console.log(USAGE);
    return unknown.length > 0 ? 2 : 0;
  }
  const at = argv.indexOf("--base");
  const asked = at >= 0 ? argv[at + 1] : "main";
  const base = text("git",gitArguments( ["rev-parse", "--verify", `${asked}^{commit}`])).trim();
  const agree = !argv.includes("--no-agree");
  const keepGoing = argv.includes("--keep-going");
  const changed = changedPaths(base);
  const crates = [...new Set([...cratesTouched(changed, packages()), ...BACKENDS])].sort();
  console.log(`inner loop over ${base}..HEAD: ${changed.length} path(s), crates ${crates.join(" ")}`);

  const steps: Step[] = [];
  const step = (name: string, body: () => number): boolean => {
    const began = Date.now();
    console.log(`\n== ${name}`);
    const status = body();
    steps.push({ name, status, seconds: Math.round((Date.now() - began) / 1000) });
    return status === 0 || keepGoing;
  };
  const tests = [TEST_OWNER, "inner", ...crates.flatMap((name) => ["-p", name])];
  const runtimeC = formattedRuntimeC(changed).filter((path) => existsSync(join(ROOT, path)));
  const nativeFrontend = changed.some((path) => /^(compiler\/frontend-ts(?:rs)?|compiler\/semantic-schema|third_party\/tsrs)\//.test(path) || /^(Cargo\.(toml|lock)|rust-toolchain\.toml)$/.test(path));
  const after = join(ROOT, "target/nts-dev/nts");
  const host = /^host: (.+)$/m.exec(text("rustc", ["-vV"]))?.[1];
  if (!host) throw new Error("rustc names no host triple for the test runner");
  const runnerVar = `CARGO_TARGET_${host.toUpperCase().replace(/[-.]/g, "_")}_RUNNER`;
  if (launchEnvironment[runnerVar]) throw new Error(`${runnerVar} is already set`);
  const runner = join(launchEnvironment.TMPDIR!, "rust-test-runner.sh");
  const quote = (value:string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  writeFileSync(runner, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(ROOT,"tooling/gate/rust-test-runner.ts"))} "$@"\n`);
  chmodSync(runner, 0o755);
  let compilerReady = false;
  const going =
    step("fmt", () => run("cargo", ["fmt", "--check"])) &&
    (runtimeC.length === 0 ||
      step("clang-format", () => run("clang-format", ["--style=file", "--dry-run", "-Werror", ...runtimeC]))) &&
    step("clippy", () => heavy({ key: "inner-clippy", what: "clippy", memoryMax: "14G", workers: CARGO_WORKERS }, process.execPath, [CLIPPY_OWNER,"--cache"],{CARGO_TARGET_DIR:clippyTarget(launchEnvironment.CARGO_TARGET_DIR??join(ROOT,"target"))})) &&
    step("build", () => {
      const release=capacity.beginBuild({root:ROOT,target:launchEnvironment.CARGO_TARGET_DIR??join(ROOT,'target'),outputs:['nts-dev']});
      try{
      const status = heavy({ key: "inner-build", what: "the compiler", memoryMax: "14G", workers: CARGO_WORKERS }, "cargo", ["build", "--profile", "nts-dev", "-p", "nts-cli"]);
      compilerReady = status === 0;
      return status;
      }finally{release();}
    }) &&
    // Even --keep-going cannot authorize tests against a failed build's stale binary.
    compilerReady &&
    step("tests", () => heavy({ key: "inner-tests", what: "the tests", memoryMax: "16G", workers: CARGO_WORKERS }, process.execPath, tests, { NTS_CHECKERS: "1", NTS_BIN: after, [runnerVar]: runner })) &&
    // Native vendor integrity and complete reachable graphs over the corpus.
    (!nativeFrontend || step("frontend-tsrs", () => heavy({ key: "inner-frontend-tsrs", what: "native frontend checks", memoryMax: "16G", workers: 4 },
      "sh", ["tooling/gate/all.sh", "--call", "frontend-tsrs"], { NTS_CHECKERS: "1" })));

  if (going && agree) {
    const before = text("node", ["tooling/conformance/pin.ts", base]).trim().split("\n").at(-1) ?? "";
    const runs: [string, string][] = [["c", "0"], ["llvm", "0"], ["jvm", "0"]];
    if (reachesCounting(changed)) {
      runs.push(["c", "1"], ["llvm", "1"]);
    }
    let fine = true;
    for (const [backend, rc] of runs) {
      if (!fine) {
        break;
      }
      fine = step(`agree ${backend}${rc === "1" ? " rc" : ""}`, () =>
        heavy({ key: "inner-agree", what: "agree", memoryMax: "12G", workers: 4 }, "node", [relative(ROOT,fileURLToPath(new URL('../differential/agree.mjs',import.meta.url))), before, after, `--base=${base}`], {
          NTS_BACKEND: backend,
          NTS_RC: rc,
          NTS_AGREE_JOBS: "4",
          NTS_CHECKERS: "1",
        }),
      );
    }
  }

  console.log("\ninner loop summary");
  for (const { name, status, seconds } of steps) {
    console.log(`  ${status === 0 ? "PASS" : "FAIL"}  ${name.padEnd(12)} ${String(seconds).padStart(5)}s`);
  }
  const red = steps.some((it) => it.status !== 0);
  console.log(red ? "red: fix it before queueing" : "green: queue it with node tooling/landing/check.ts <commit>");
  return red ? 1 : 0;
}

runAsCommand(import.meta.url,async()=>{
  const planned=gateEnvironment(process.env,{run:join(homedir(),'.cache/nts-inner',String(Date.now())+'-'+process.pid),standalone:!process.env.NTS_GATE_ENV_CONTEXT,oracleAdmissionContext:'gate'});
  let status=1;
  try{const sealed=await sealOracleRun(planned);launchEnvironment=sealed.env;status=main(process.argv.slice(2),new DiskCapacity({env:sealed.env}));}
  finally{finishRunTemporary(planned.temporary,planned.env.HOME!,status===0);}
  process.exitCode=status;
},{realpath:true});
