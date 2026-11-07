// How a benchmark case is compiled and its result classified: the project a
// case compiles as, the environment and command lines of the emit and build
// steps, and the outcome they come to. The compile key, every compile row's
// `driver` digest, covers exactly this file and the compile diagnostic
// primitives it classifies with, declared once in COMPILE_KEY_INPUTS. The
// recorder (build-records.ts), the comparators (outcomes.ts and the shared
// ratchet), the line format, runtime observation text and the node oracle are
// not compile behaviour, so editing them never asks for a re-record.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { compileActive } from "../census/worker-memory.ts";
import type { Backend } from "../census/typescript-record.ts";
import { compilerExternalStop, compilerStop, compilerStopped, stableBuildDiagnostic } from "../conformance/compile-diagnostics.ts";
import { gateEnvironment, ENVIRONMENT_CONTEXT } from "../gate/canonical-environment.ts";
import { COMPILE_CPU_BOUND_SECONDS, type ActiveResult } from "../gate/active-command.ts";
import { ToolingInstrumentError } from "../gate/step-result.ts";
import type { BenchmarkOutcome } from "./outcomes.ts";

/** The files whose bytes are the compile key, relative to the repository. */
export const COMPILE_KEY_INPUTS = ["tooling/bench/compile-producer.ts", "tooling/conformance/compile-diagnostics.ts"] as const;

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

/** The compile key of the tree at `root`: a row recorded under another key describes another producer. */
export function compileKey(root: string): string {
  return hash(JSON.stringify(COMPILE_KEY_INPUTS.map(path => [path, hash(readFileSync(join(root, path)))])));
}

type Result = ActiveResult & { memoryKilled?: boolean };
type Command = (binary: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<Result>;

export function compileEnvironment(launcher: NodeJS.ProcessEnv, scratch: string, binary: string): NodeJS.ProcessEnv {
  const run = launcher[ENVIRONMENT_CONTEXT] ? launcher.NTS_GATE_RUN_DIR : scratch;
  assert.ok(run, "benchmark canonical handoff is missing its owned run directory");
  return gateEnvironment(launcher, { run, owned: { NTS_BIN: binary, NTS_CHECKERS: "1" } }).env;
}

/** A process stop is never an expected compiler defect, including an OOM SIGKILL;
 * a compile stopped at its bound is one: it timed out. */
export function compileOutcome(result: Result, stage: "emit" | "link"): BenchmarkOutcome | null {
  if (result.timeout && !result.memoryKilled) return { kind: "timeout", stage: "compile" };
  // LLVM and C can emit arbitrary program strings on stdout. Only stderr is
  // a diagnostic channel on success; a failed command may use either channel.
  const diagnostic = result.stderr.trim() || (result.status === 0 ? "" : result.stdout.trim());
  if (result.error || result.memoryKilled || result.hung || result.runaway ||
    /toolchain did not survive|out of memory|memory limit|INSTRUMENT FAILURE|NOT MEASURED|disk quota exceeded|no space left on device|\b(?:EDQUOT|ENOSPC)\b/i.test(diagnostic)) {
    throw new ToolingInstrumentError("tooling-setup", `benchmark NOT MEASURED: ${result.error?.message ?? result.signal ?? result.hung ?? result.runaway ?? (result.out.trim() || `exit ${result.status}`)}`);
  }
  const stop = compilerStop(result.out, result.status, result.signal);
  if (stage === "emit" && compilerStopped(result.status, result.signal)) return { kind: "build-failure", stage: "compiler-crash", diagnostic: stop };
  if (compilerExternalStop(result.status, result.signal) || (stage === "link" && compilerStopped(result.status, result.signal)) || result.status === null || result.status === 126 || result.status === 127) {
    throw new ToolingInstrumentError("tooling-setup", `benchmark ${stage === "link" ? "link tool" : "compiler"} NOT MEASURED: ${stop}`);
  }
  if (stage === "emit") {
    const refusal = diagnostic.split("\n").find(line => /(?:declined:|\bNTS\d{4}\b|\bTS\d{4,}\b)/.test(line));
    if (refusal) return { kind: "refused", diagnostic: stableBuildDiagnostic(refusal) };
  }
  if (result.status === 0) return null;
  assert.ok(diagnostic, "benchmark NOT MEASURED: failed command supplied no diagnostic");
  return { kind: "build-failure", stage,
    diagnostic: stableBuildDiagnostic(diagnostic) };
}

function commandLine(value: string): [string, ...string[]] {
  // CC is a whitespace-separated command, as in benches.sh (e.g. ccache clang).
  const parts = value.trim().split(/\s+/); assert.ok(parts[0], "empty benchmark build tool");
  return parts as [string, ...string[]];
}
export function regularFiles(directory: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), `benchmark identity rejects symlink: ${path}`);
    if (entry.isDirectory()) result.push(...regularFiles(path));
    else { assert.ok(entry.isFile(), `benchmark identity requires a regular file: ${path}`); result.push(path); }
  }
  return result.sort();
}

// Each command is a case's compile, under the shared supervisor: its own CPU is
// bounded (COMPILE_CPU_BOUND_SECONDS), and past it the case timed out.
export async function observeCompile({ backend, project, output, binary, root, env, command = (binary, args, options) =>
  compileActive({ memoryCapKb: Number(process.env.NTS_GATE_STEP_MEMORY_BYTES ?? 6_000_000 * 1024) / 1024 }, binary, args,
    { ...options, maxBuffer: 128 * 1024 * 1024, ownCpuSeconds: COMPILE_CPU_BOUND_SECONDS }),
}:
  { backend: Backend; project: string; output: string; binary: string; root: string; env: NodeJS.ProcessEnv; command?: Command }): Promise<BenchmarkOutcome> {
  rmSync(output, { recursive: true, force: true }); mkdirSync(output, { recursive: true });
  const options = { cwd: root, env: { ...env, NTS_CHECKERS: "1" } };
  const emitted = await command(binary, [`emit-${backend}`, project, ...(backend === "llvm" ? ["--rc"] : ["--out", output, ...(backend === "c" ? ["--rc"] : [])])], options);
  const refusal = compileOutcome(emitted, "emit"); if (refusal) return refusal;
  if (backend === "jvm") {
    return regularFiles(output).some(path => path.endsWith(".class")) ? { kind: "pass" }
      : { kind: "build-failure", stage: "emit", diagnostic: "emit-jvm produced no class files" };
  }
  const [tool, ...prefix] = commandLine(backend === "c" ? env.CC ?? "clang" : env.NTS_LLVM_CC ?? "clang");
  const program = join(output, backend === "c" ? "program.c" : "program.ll");
  if (backend === "llvm") writeFileSync(program, emitted.stdout);
  if (!existsSync(program) || lstatSync(program).size === 0) return { kind: "build-failure", stage: "emit", diagnostic: `emit-${backend} produced no program` };
  const flags = backend === "c" ? ["-O2", "-Wall", "-Wextra", "-Werror", "-std=c11", "-DNTS_PROVIDER_RC", `-I${output}`]
    : ["-x", "ir", "-w", "-O2"];
  const built = await command(tool, [...prefix, ...flags, "-c", "-o", "/dev/null", program], options);
  return compileOutcome(built, "link") ?? { kind: "pass" };
}

/** The project a case compiles as: its own tsconfig, or the whole case directory. */
export function projectFor(root: string, path: string, scratch: string): string {
  const own = join(root, path, "tsconfig.json"); if (existsSync(own)) return own;
  const config = join(scratch, `${basename(path)}.tsconfig.json`);
  // Keep the compile gate's whole-directory roots. The scalar consumer's
  // case.ts-only project is a distinct scope and cannot narrow this one.
  writeFileSync(config, JSON.stringify({ extends: join(root, "tsconfig.fixtures.json"), include: [join(root, path) + "/"] }));
  return config;
}
