import { spawnSync } from "node:child_process";
import { accessSync, constants, copyFileSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { createHash } from "node:crypto";
import { ToolingInstrumentError } from "../gate/step-result.ts";
import { elfLinkage } from "./layouts-elf.ts";
import { EXECUTABLE_SIZE_PROTOCOL, llvmVersion, type ExecutableSize, type FileSize, type SizeTool } from "./executable-size-cell.ts";

const instrument = (message: string) => new ToolingInstrumentError("tooling-setup", "executable size: " + message);
function command(program: string, args: string[], env?: NodeJS.ProcessEnv): string {
  const result = spawnSync(program, args, { encoding: "utf8", timeout: 30_000, ...(env ? { env } : {}) });
  if (result.status !== 0) throw instrument(`${program} ${args.join(" ")} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
}
function identity(path: string): SizeTool {
  return { path, sha256: fileSize(path).sha256, version: command(path, ["--version"]) };
}
/** Resolve once through the build's clang driver, never a separate strip PATH search. */
export function sizeToolchain(clang = process.env.CC ?? "clang"): { clang: SizeTool; strip: SizeTool } {
  try {
    const compiler = command(clang, ["-print-prog-name=clang"]);
    if (!isAbsolute(compiler)) throw instrument("clang did not name its installed executable");
    const installed = identity(compiler), stripPath = command(compiler, ["-print-prog-name=llvm-strip"]);
    if (!isAbsolute(stripPath) || dirname(stripPath) !== dirname(compiler)) throw instrument("clang installation has no llvm-strip beside it");
    const strip = identity(stripPath);
    if (llvmVersion(installed.version) !== llvmVersion(strip.version)) throw instrument("llvm-strip and build clang major.minor differ");
    return { clang: installed, strip };
  } catch (error) { throw instrument(String(error)); }
}
export function fileSize(path: string): FileSize {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size <= 0 || !Number.isSafeInteger(stat.size)) throw instrument(`${path} is not a nonempty regular file`);
  const bytes = readFileSync(path);
  if (stat.size !== bytes.length) throw instrument(`${path} changed while measuring`);
  return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
/** Strictly decode the ELF loader's --list output, including the loader itself. */
export function sharedLibraryPaths(output: string): string[] {
  const paths: string[] = [];
  for (const raw of output.trim().split("\n")) {
    const line = raw.trim();
    if (/^linux-vdso\.so\.\d+ \(0x[0-9a-f]+\)$/.test(line)) continue;
    const found = /^(?:\S+ => )?(\/[^\n]+?) \(0x[0-9a-f]+\)$/.exec(line);
    if (!found) throw instrument("unresolved or malformed shared library: " + line);
    paths.push(realpathSync(found[1]!));
  }
  return [...new Set(paths)].sort();
}
export type SizeObservation = Omit<ExecutableSize, "strippedLaunch">;
/** Consume the exact timed product. Only its private copy is stripped. No build occurs here. */
export function executableSize(binary: string, directory: string, tools: { clang: SizeTool; strip: SizeTool }, runtime: string): SizeObservation {
  try {
    accessSync(binary, constants.X_OK);
    const shipped = fileSize(binary), linkage = elfLinkage(readFileSync(binary));
    if (linkage.needed.length && !linkage.interpreter) throw instrument("dynamic product has no ELF interpreter");
    // The timer supplies no LD_* overrides. Observe the same loader search,
    // independent of the shell that started the benchmark controller.
    const loaderEnvironment = { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", TZ: "UTC" };
    const sharedLibraries = linkage.interpreter === null ? [] : sharedLibraryPaths(command(linkage.interpreter, ["--list", binary], loaderEnvironment)).map(fileSize);
    const strippedPath = join(directory, "stripped-product");
    copyFileSync(binary, strippedPath, constants.COPYFILE_EXCL);
    const stripArguments = ["--strip-all", strippedPath];
    command(tools.strip.path, stripArguments);
    const stripped = fileSize(strippedPath);
    if (JSON.stringify(elfLinkage(readFileSync(strippedPath))) !== JSON.stringify(linkage)) throw instrument("stripping changed ELF linkage");
    if (fileSize(binary).sha256 !== shipped.sha256) throw instrument("stripping changed the shipped executable");
    for (const tool of [tools.clang, tools.strip]) if (fileSize(tool.path).sha256 !== tool.sha256) throw instrument("size tool changed during observation");
    if (stripped.bytes > shipped.bytes) throw instrument("stripped copy is larger than shipped executable");
    return { protocol: EXECUTABLE_SIZE_PROTOCOL, shipped, stripped, ...tools, stripArguments, ...linkage, sharedLibraries,
      sharedLibraryBytes: sharedLibraries.reduce((sum, library) => sum + library.bytes, 0), runtime };
  } catch (error) { throw instrument(String(error)); }
}

/** Check again after the timer has consumed these immutable artifacts. */
export function verifySizeArtifacts(size: SizeObservation): void {
  for (const file of [size.shipped, size.stripped, ...size.sharedLibraries]) {
    const after = fileSize(file.path);
    if (after.bytes !== file.bytes || after.sha256 !== file.sha256) throw instrument(`${file.path} changed during the sitting`);
  }
}
