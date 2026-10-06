#!/usr/bin/env node
/** Standalone C/LLVM embedding check with Chromium's pinned toolchain. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const fixture = import.meta.dirname;
const lane = resolve(fixture, "../..");
const source = resolve(root, "third_party/chromium/src");
// NTS_CHROMIUM_NATIVE_OUT keeps an experimental compiler's archives away from
// the ones probe.ts stages into Chromium.
const output = resolve(root, process.env.NTS_CHROMIUM_NATIVE_OUT ?? "target/chromium/native-bootstrap");
const nts = resolve(root, process.env.NTS_BIN ?? "target/release/nts");
const clang = resolve(source, "third_party/llvm-build/Release+Asserts/bin/clang");
const archiver = resolve(source, "third_party/llvm-build/Release+Asserts/bin/llvm-ar");
const sysroot = resolve(source, "build/linux/debian_bullseye_amd64-sysroot");
const hash = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
const gitRevision = (path: string): string => execFileSync("git", ["-C", path, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const lock = JSON.parse(readFileSync(resolve(root, "third_party/chromium/upstream.lock.json"), "utf8")) as { chromium: { revision: string } };
if (gitRevision(source) !== lock.chromium.revision) throw new Error("Chromium checkout differs from its source lock");
mkdirSync(output, { recursive: true });
const compilerSha256 = hash(nts);
const compilerMtime = statSync(nts).mtime.toISOString();

execFileSync(nts, ["build", resolve(fixture, "tsconfig.json"), "--out", output, "--rc"], {
  cwd: root, stdio: "inherit", env: { ...process.env, NTS_NO_ACQUIRE: "1" },
});
const common = [`--sysroot=${sysroot}`, "-std=c11", "-O2", "-fPIC", "-ffunction-sections", "-fdata-sections", "-DNTS_PROVIDER_RC", "-D_GNU_SOURCE", "-I", resolve(lane, "dom/abi"), "-I", resolve(lane, "adapter")];
const checks = [];
for (const backend of ["c", "llvm"] as const) {
  const generated = resolve(output, backend === "c" ? "probe" : "probe-llvm", "linux-gnu-x86_64");
  const header = readFileSync(resolve(generated, "program.h"), "utf8");
  for (const name of ["ntsChromiumDomProgram", "ntsChromiumDomCounter", "ntsChromiumAwaitCounter", "ntsChromiumCounterValue", "ntsChromiumPrepareBenchmark", "ntsChromiumBenchmarkLoop"]) {
    if (!header.includes(`${name}(`)) throw new Error(`${backend}: ${name} was refused; do not claim browser acceptance`);
  }
  const program = resolve(output, `chromium-${backend}-program.o`);
  if (backend === "llvm") {
    execFileSync(clang, ["-O2", "-fPIC", "-ffunction-sections", "-fdata-sections", "-c", resolve(generated, "program.ll"), "-o", program], { cwd: root, stdio: "inherit" });
  } else {
    execFileSync(clang, [...common, "-I", generated, "-c", resolve(generated, "program.c"), "-o", program], { cwd: root, stdio: "inherit" });
  }
  const runtime = resolve(output, `chromium-${backend}-runtime.o`);
  execFileSync(clang, [...common, "-I", generated, "-c", resolve(generated, "nts_runtime.c"), "-o", runtime], { cwd: root, stdio: "inherit" });
  const shim = resolve(output, `chromium-${backend}-shim.o`);
  execFileSync(clang, [...common, "-I", generated, "-c", resolve(root, "runtime/chromium/embedder/probe.c"), "-o", shim], { cwd: root, stdio: "inherit" });
  const archive = resolve(output, `chromium-${backend}-probe.a`);
  execFileSync(archiver, ["rcs", archive, program, runtime, shim], { cwd: root, stdio: "inherit" });
  const executable = resolve(output, `chromium-${backend}-probe`);
  execFileSync(clang, [...common, "-fuse-ld=lld", "-I", generated, resolve(root, "runtime/chromium/embedder/caller.c"),
    archive, "-Wl,--gc-sections", "-lm", "-o", executable], { cwd: root, stdio: "inherit" });
  const observed = execFileSync(executable, [], { encoding: "utf8" }).trim();
  console.log(`${backend}: ${observed}`);
  checks.push({ backend, observed, archive, archiveSha256: hash(archive), shimSha256: hash(resolve(root, "runtime/chromium/embedder/probe.c")), programSha256: hash(resolve(generated, backend === "c" ? "program.c" : "program.ll")), runtimeSha256: hash(resolve(generated, "nts_runtime.c")) });
}
if (hash(nts) !== compilerSha256) throw new Error("The NTS compiler binary changed during this check; rerun with a fixed binary");
writeFileSync(resolve(output, "check-result.json"), `${JSON.stringify({
  observedAt: new Date().toISOString(), repositoryHeadAtCheck: gitRevision(root),
  compiler: { path: nts, sha256: compilerSha256, mtime: compilerMtime },
  inputs: Object.fromEntries(["embedder/program/main.ts", "embedder/program/tsconfig.json", "embedder/program/nts.config.ts", "tests/boundary.ts", "tests/dom-witness.ts", "tests/idl-vectors.ts", "benchmarks/workloads/binding.ts", "benchmarks/workloads/rows.ts", "benchmarks/workloads/kernels.ts", "dom/types/dom-testing.d.ts", "dom/types/dom-abi.d.ts", "dom/types/dom-idl.d.ts", "dom/abi/dom_testing.h", "dom/abi/dom_abi.h", "dom/abi/dom_idl.h"].map(path => [path, hash(resolve(lane, path))])),
  chromiumRevision: gitRevision(source), clangVersion: execFileSync(clang, ["--version"], { encoding: "utf8" }).trim(),
  sysroot, checks, scope: "Standalone embedding; does not establish sandboxed renderer execution.",
}, null, 2)}\n`);
