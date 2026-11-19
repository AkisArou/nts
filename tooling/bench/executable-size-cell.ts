// Whole-file bytes, never section totals or allocated disk blocks. The dynamic
// closure is disclosed separately and is not added to any column's headline.
import { dirname, isAbsolute } from "node:path";
import type { Cell } from "./run-record.ts";
import { checkLaunchCell, readLaunch, type Launch } from "./launch-cell.ts";

export const EXECUTABLE_SIZE_KIND = "executable-size";
export const EXECUTABLE_SIZE_PROTOCOL = "executable-file-bytes-v1";
export type FileSize = { path: string; bytes: number; sha256: string };
export type SizeTool = { path: string; version: string; sha256: string };
export type ExecutableSize = {
  protocol: typeof EXECUTABLE_SIZE_PROTOCOL;
  shipped: FileSize;
  stripped: FileSize;
  strip: SizeTool;
  stripArguments: string[];
  clang: SizeTool;
  interpreter: string | null;
  needed: string[];
  sharedLibraries: FileSize[];
  sharedLibraryBytes: number;
  runtime: string;
  strippedLaunch: Launch;
};
const fail = (at: string, message: string): never => { throw new Error(`${at}: ${message}`); };
function object(value: unknown, keys: string[], at: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail(at, "missing size measurement object");
  const o = value as Record<string, unknown>;
  if (Object.keys(o).sort().join(",") !== keys.sort().join(",")) fail(at, "missing or unknown size measurement field");
  return o;
}
function text(value: unknown, at: string): string {
  if (typeof value !== "string" || value.length === 0) return fail(at, "expected nonempty text");
  return value;
}
function digest(value: unknown, at: string): string {
  const result = text(value, at);
  if (!/^[a-f0-9]{64}$/.test(result)) fail(at, "invalid size artifact digest");
  return result;
}
function file(value: unknown, at: string): FileSize {
  const o = object(value, ["path", "bytes", "sha256"], at);
  if (typeof o.bytes !== "number" || !Number.isSafeInteger(o.bytes) || o.bytes <= 0) fail(at, "file size must be positive whole bytes");
  const path = text(o.path, at);
  if (!isAbsolute(path)) fail(at, "size file path is not absolute");
  return { path, bytes: o.bytes as number, sha256: digest(o.sha256, at) };
}
function tool(value: unknown, at: string): SizeTool {
  const o = object(value, ["path", "version", "sha256"], at);
  return { path: text(o.path, at), version: text(o.version, at), sha256: digest(o.sha256, at) };
}
export function llvmVersion(version: string): string {
  const found = /(?:clang|LLVM) version (\d+\.\d+)(?:\.\d+)?/.exec(version);
  if (!found) throw new Error("size tool has no LLVM major.minor version");
  return found[1]!;
}
export function readExecutableSize(value: unknown, at: string): ExecutableSize {
  const o = object(value, ["protocol", "shipped", "stripped", "strip", "stripArguments", "clang", "interpreter", "needed", "sharedLibraries", "sharedLibraryBytes", "runtime", "strippedLaunch"], at);
  if (o.protocol !== EXECUTABLE_SIZE_PROTOCOL) fail(at, "unknown executable size protocol");
  const shipped = file(o.shipped, at + ".shipped"), stripped = file(o.stripped, at + ".stripped");
  if (shipped.path === stripped.path || stripped.bytes > shipped.bytes) fail(at, "strip must use a separate, no larger copy");
  const strip = tool(o.strip, at + ".strip"), clang = tool(o.clang, at + ".clang");
  if (dirname(strip.path) !== dirname(clang.path)) fail(at, "strip is outside the build clang installation");
  if (llvmVersion(strip.version) !== llvmVersion(clang.version)) fail(at, "llvm-strip and clang major.minor differ");
  if (!Array.isArray(o.stripArguments) || JSON.stringify(o.stripArguments) !== JSON.stringify(["--strip-all", stripped.path])) fail(at, "unexpected strip arguments");
  if (!Array.isArray(o.needed) || !o.needed.every(x => typeof x === "string" && x.length > 0) || new Set(o.needed).size !== o.needed.length) fail(at, "invalid ELF needed libraries");
  if (!Array.isArray(o.sharedLibraries)) fail(at, "missing dynamic closure");
  const sharedLibraries = (o.sharedLibraries as unknown[]).map((f, i) => file(f, `${at}.sharedLibraries[${i}]`));
  if (new Set(sharedLibraries.map(f => f.path)).size !== sharedLibraries.length) fail(at, "duplicate dynamic library");
  const sharedLibraryBytes = sharedLibraries.reduce((sum, f) => sum + f.bytes, 0);
  if (!Number.isSafeInteger(sharedLibraryBytes) || o.sharedLibraryBytes !== sharedLibraryBytes) fail(at, "dynamic closure byte total disagrees");
  const interpreter = o.interpreter === null ? null : text(o.interpreter, at);
  if ((interpreter !== null || (o.needed as unknown[]).length > 0) && sharedLibraries.length === 0) fail(at, "dynamic ELF has no resolved closure");
  const strippedLaunch = readLaunch(o.strippedLaunch, at + ".strippedLaunch");
  if (strippedLaunch.status !== 0 || strippedLaunch.timedOut) fail(at, "stripped executable did not complete");
  return { protocol: EXECUTABLE_SIZE_PROTOCOL, shipped, stripped, strip, stripArguments: o.stripArguments as string[], clang,
    interpreter, needed: o.needed as string[], sharedLibraries, sharedLibraryBytes, runtime: text(o.runtime, at), strippedLaunch };
}
export function checkExecutableSizeCell(cell: Cell, at: string): void {
  if (!Object.hasOwn(cell, "executableSize")) fail(at, "missing executableSize");
  if (cell.status !== "OK") {
    if (cell.executableSize !== null) fail(at, "absent cell carries an executable size");
    return;
  }
  checkLaunchCell(cell, at);
  const size = readExecutableSize(cell.executableSize, at);
  if (size.strippedLaunch.stdoutSha256.slice(0, 16) !== cell.checksum) fail(at, "stripped executable output differs");
  const details = cell.details as Record<string, unknown>;
  const recipe = details.recipe as Record<string, unknown> | undefined;
  const artifact = recipe?.artifactSha256 ?? details.artifactSha256;
  if (artifact !== size.shipped.sha256) fail(at, "size artifact differs from the timed build");
  const argv = details.argv;
  if (!Array.isArray(argv) || argv[0] !== size.shipped.path) fail(at, "size artifact is not the timed executable");
  sizeRecipeIdentity(cell);
}

/** Effective build arguments, independent of compiler/output paths and the
 * untimed build's CPU mask. Flags and app.cli's product/backend stay exact. */
export function sizeRecipeIdentity(cell: Cell): string | null {
  if (cell.status !== "OK") return null;
  const details = cell.details as Record<string, unknown>;
  const recipe = details.recipe as Record<string, unknown> | undefined;
  const build = recipe ?? details.build as Record<string, unknown> | undefined;
  if (!build) return fail("size recipe", "missing build command");
  if (!Array.isArray(build.command) || !build.command.every(value => typeof value === "string")) fail("size recipe", "missing build command");
  let command = build.command as string[];
  if (command[0] === "taskset" && command[1] === "-c") command = command.slice(3);
  if (command.length === 0) fail("size recipe", "empty build command");
  return JSON.stringify([recipe?.tool ?? "external", recipe?.product ?? null, recipe?.backend ?? null,
    command.map((argument, index) => index === 0 ? "$compiler" : isAbsolute(argument) ? "$path" : argument)]);
}

/** Stripped histories compare only under the same strip implementation. */
export function stripIdentity(cell: Cell): string | null {
  const strip = cell.executableSize?.strip;
  return strip ? JSON.stringify([strip.version, strip.sha256]) : null;
}
