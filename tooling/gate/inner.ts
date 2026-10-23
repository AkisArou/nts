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
// over the workspace, `cargo test --no-fail-fast` over every crate touched and
// the four backends with `NTS_TSGO` set, and `agree.mjs` on all four backends.
// Run as the gate builds -- release, one code generation unit, thin LTO -- the
// tests alone took 30 to 45 minutes beside a gate (2026-10-22), and the gate
// then built them again. This runs the same tests in the `nts-dev` profile
// (Cargo.toml): optimized, but incremental, so a change to one crate rebuilds
// that crate and what depends on it. It is not a gate and does not replace
// one; it is what makes the gate not the place a change is found to be red.
//
// # What it runs, in order, stopping at the first red
//
// 1. `cargo fmt --check`, and `clang-format --dry-run -Werror` on any
//    runtime C the change edited.
// 2. `cargo clippy --workspace --all-targets -- -D warnings`.
// 3. `cargo test --profile nts-dev --no-fail-fast` over the touched crates
//    and the four backends, with `NTS_TSGO` this tree's frontend.
// 4. `agree.mjs` on c, llvm, jvm and wasm, main's pinned compiler before and
//    this tree's `nts-dev` build after -- and with `NTS_RC=1` on c and llvm
//    when the change reaches the compiler or a runtime, since reference
//    counting is decided in core.
//
// Every heavy step waits for memory (`admission.ts`, the thresholds AGENTS.md
// sets) and runs niced, off the measurement CPUs 4-5, in a capped scope.
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { memAvailableGB, RESUME_AT_GB } from "./admission.ts";

const ROOT = realpathSync(join(fileURLToPath(import.meta.url), "../../.."));
const BACKENDS = ["nts-codegen-c", "nts-codegen-llvm", "nts-codegen-jvm", "nts-codegen-wasm"];

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
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } });
  return result.status ?? 1;
}

function text(command: string, args: readonly string[]): string {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/** Wait until the machine has the memory AGENTS.md asks of a heavy phase. */
function admitted(what: string): void {
  let said = false;
  for (;;) {
    const free = memAvailableGB();
    if (free === null || free >= RESUME_AT_GB) {
      return;
    }
    if (!said) {
      console.log(`  waiting for ${RESUME_AT_GB} GB before ${what} (${free.toFixed(1)} GB free)`);
      said = true;
    }
    spawnSync("sleep", ["30"]);
  }
}

/** A heavy command: admitted, niced, off CPUs 4-5, in a capped scope. */
function heavy(what: string, memoryMax: string, command: string, args: readonly string[], env: NodeJS.ProcessEnv = {}): number {
  admitted(what);
  const bounded = ["nice", "-n", "19", "taskset", "-c", cpusOffMeasurement(), command, ...args];
  const scoped = spawnSync("systemd-run", ["--version"], { stdio: "ignore" }).status === 0
    ? ["systemd-run", "--user", "--scope", "-q", "-p", `MemoryMax=${memoryMax}`, "-p", "MemorySwapMax=0", ...bounded]
    : bounded;
  const [program, ...rest] = scoped;
  return run(program, rest, env);
}

function changedPaths(base: string): string[] {
  const committed = text("git", ["diff", "--name-only", `${base}...HEAD`]);
  const working = text("git", ["diff", "--name-only", "HEAD"]);
  const untracked = text("git", ["ls-files", "--others", "--exclude-standard"]);
  return [...new Set(`${committed}\n${working}\n${untracked}`.split("\n").filter(Boolean))].sort();
}

function packages(): Package[] {
  const metadata = JSON.parse(text("cargo", ["metadata", "--no-deps", "--format-version", "1"]));
  return metadata.packages.map((pkg: { name: string; manifest_path: string }) => ({
    name: pkg.name,
    dir: pkg.manifest_path.slice(ROOT.length + 1).replace(/\/Cargo\.toml$/, ""),
  }));
}

type Step = { name: string; status: number; seconds: number };

const USAGE = `node tooling/gate/inner.ts [--base <rev>] [--no-agree] [--keep-going]

The gate's core commands, fast, before a change is queued: fmt, clippy, the
tests over the touched crates and the four backends in the nts-dev profile,
and agree.mjs on four backends against <rev>'s pinned compiler (main).`;

function main(argv: readonly string[]): number {
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
  const base = at >= 0 ? argv[at + 1] : "main";
  const agree = !argv.includes("--no-agree");
  const keepGoing = argv.includes("--keep-going");
  const changed = changedPaths(base);
  const crates = [...new Set([...cratesTouched(changed, packages()), ...BACKENDS])].sort();
  const tsgo = join(ROOT, "target/tsgo");
  if (!existsSync(tsgo)) {
    console.log("  no target/tsgo in this tree: run tooling/lanes/inputs.sh first");
    return 2;
  }
  console.log(`inner loop over ${base}..HEAD: ${changed.length} path(s), crates ${crates.join(" ")}`);

  const steps: Step[] = [];
  const step = (name: string, body: () => number): boolean => {
    const began = Date.now();
    console.log(`\n== ${name}`);
    const status = body();
    steps.push({ name, status, seconds: Math.round((Date.now() - began) / 1000) });
    return status === 0 || keepGoing;
  };
  const tests = ["test", "--profile", "nts-dev", "--no-fail-fast", ...crates.flatMap((name) => ["-p", name])];
  const runtimeC = formattedRuntimeC(changed).filter((path) => existsSync(join(ROOT, path)));
  const nativeFrontend = changed.some((path) => /^(compiler\/frontend-tsrs|third_party\/tsrs)\//.test(path) || /^(Cargo\.(toml|lock)|rust-toolchain\.toml)$/.test(path));
  const going =
    step("fmt", () => run("cargo", ["fmt", "--check"])) &&
    (runtimeC.length === 0 ||
      step("clang-format", () => run("clang-format", ["--style=file", "--dry-run", "-Werror", ...runtimeC]))) &&
    step("clippy", () => heavy("clippy", "14G", "cargo", ["clippy", "--workspace", "--all-targets", "--", "-D", "warnings"])) &&
    step("tests", () => heavy("the tests", "16G", "cargo", tests, { NTS_TSGO: tsgo })) &&
    // Transitional: delete this branch with the feature at the native switch.
    (!nativeFrontend || step("frontend-tsrs", () => heavy("native frontend checks", "16G", "sh", ["tooling/gate/all.sh", "--call", "frontend-tsrs"], { NTS_TSGO: tsgo })));

  if (going && agree) {
    const before = text("node", ["tooling/conformance/pin.ts", base]).trim().split("\n").at(-1) ?? "";
    const after = join(ROOT, "target/nts-dev/nts");
    const built = step("build", () => heavy("the compiler", "14G", "cargo", ["build", "--profile", "nts-dev", "-p", "nts-cli"]));
    const runs: [string, string][] = [["c", "0"], ["llvm", "0"], ["jvm", "0"], ["wasm", "0"]];
    if (reachesCounting(changed)) {
      runs.push(["c", "1"], ["llvm", "1"]);
    }
    let fine = built;
    for (const [backend, rc] of runs) {
      if (!fine) {
        break;
      }
      fine = step(`agree ${backend}${rc === "1" ? " rc" : ""}`, () =>
        heavy("agree", "12G", "node", ["tooling/differential/agree.mjs", before, after], {
          NTS_BACKEND: backend,
          NTS_RC: rc,
          NTS_AGREE_JOBS: "4",
          NTS_TSGO: tsgo,
        }),
      );
    }
  }

  console.log("\ninner loop summary");
  for (const { name, status, seconds } of steps) {
    console.log(`  ${status === 0 ? "PASS" : "FAIL"}  ${name.padEnd(12)} ${String(seconds).padStart(5)}s`);
  }
  const red = steps.some((it) => it.status !== 0);
  console.log(red ? "red: fix it before queueing" : "green: queue it with land.ts");
  return red ? 1 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
