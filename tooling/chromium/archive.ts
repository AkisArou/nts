/**
 * A compiled program as the static archive a Chromium target links: the
 * program (C, or LLVM IR), its runtime, and the C sources that host it, each
 * built by Chromium's own pinned clang against its sysroot, so the archive
 * links into the renderer exactly as Chromium's objects do. One recipe for
 * the test probe (runtime/chromium/embedder/program/check.ts) and for apps
 * (app.ts).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

export interface Toolchain {
  clang: string;
  archiver: string;
  sysroot: string;
}

export function chromiumToolchain(root: string): Toolchain {
  const source = resolve(root, "third_party/chromium/src");
  return {
    clang: resolve(source, "third_party/llvm-build/Release+Asserts/bin/clang"),
    archiver: resolve(source, "third_party/llvm-build/Release+Asserts/bin/llvm-ar"),
    sysroot: resolve(source, "build/linux/debian_bullseye_amd64-sysroot"),
  };
}

/** C flags for the runtime and host sources: the runtime's RC provider, and
 *  the lane's ABI, adapter and host headers. */
export function hostFlags(root: string, toolchain: Toolchain, includes: string[] = []): string[] {
  const lane = resolve(root, "runtime/chromium");
  return [`--sysroot=${toolchain.sysroot}`, "-std=c11", "-O2", "-fPIC", "-ffunction-sections", "-fdata-sections",
    "-DNTS_PROVIDER_RC", "-D_GNU_SOURCE", "-I", resolve(lane, "dom/abi"), "-I", resolve(lane, "adapter"),
    "-I", resolve(lane, "host"), ...includes.flatMap(include => ["-I", include])];
}

export interface ArchiveRequest {
  root: string;
  toolchain: Toolchain;
  backend: "c" | "llvm";
  /** Where `nts build` wrote program.c or program.ll, program.h and the runtime. */
  generated: string;
  /** The host's C sources, compiled with the generated headers in reach. */
  sources: string[];
  /** Further include directories (an app's app_entry.h). */
  includes?: string[];
  /** The archive to write; its objects go beside it. */
  archive: string;
}

export function archiveProgram(request: ArchiveRequest): void {
  const { root, toolchain, backend, generated, archive } = request;
  const directory = dirname(archive);
  mkdirSync(directory, { recursive: true });
  const stem = basename(archive, ".a");
  const flags = hostFlags(root, toolchain, [generated, ...(request.includes ?? [])]);
  const compile = (input: string, object: string, cFlags: string[]): string => {
    const output = resolve(directory, `${stem}-${object}.o`);
    execFileSync(toolchain.clang, [...cFlags, "-c", input, "-o", output], { cwd: root, stdio: "inherit" });
    return output;
  };
  const objects = [
    backend === "llvm"
      ? compile(resolve(generated, "program.ll"), "program", ["-O2", "-fPIC", "-ffunction-sections", "-fdata-sections"])
      : compile(resolve(generated, "program.c"), "program", flags),
    compile(resolve(generated, "nts_runtime.c"), "runtime", flags),
    ...request.sources.map(source => compile(source, basename(source, ".c"), flags)),
  ];
  execFileSync(toolchain.archiver, ["rcs", archive, ...objects], { cwd: root, stdio: "inherit" });
}
