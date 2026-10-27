// Reclaim obsolete Cargo test executables after a successful workspace test run.
// The caller owns the target for the whole build/replay/cleanup interval.
// Fingerprints identify *test* targets; an executable bit alone also finds
// build scripts, normal binaries and proc macros, which must stay untouched.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export const TEST_BUILD_DEBUG = "line-tables-only";
const GIB = 2 ** 30;
// Measured with all 300 test binaries on 2026-10-27: 32.44 GiB including
// Cargo state. Keep room for a new artifact set above the 40 GiB disk floor.
export const TEST_BUILD_WORKING_BYTES = 33 * GIB;
export const TEST_CACHE_MAX_BYTES = 64 * GIB;
export const TEST_DISK_FLOOR_BYTES = 40 * GIB;

/** Free disk must fund a replacement artifact set, even after a cache clean. */
export function testBuildAdmissionProblem(cacheBytes: number, availableBytes: number): string | null {
  const working = Math.max(TEST_BUILD_WORKING_BYTES, cacheBytes);
  if (availableBytes < TEST_DISK_FLOOR_BYTES + working) {
    return `only ${(availableBytes / GIB).toFixed(1)} GiB free: the test build needs ${(working / GIB).toFixed(1)} GiB working space above the 40 GiB disk floor (cache kept)`;
  }
  return null;
}

/** The caller holds the target's lock; Cargo removes the entire dev profile. */
export function cleanDevProfile(root: string, target: string): string {
  const tag = join(target, "CACHEDIR.TAG");
  if (!existsSync(tag)) {
    writeFileSync(tag, "Signature: 8a477f597d28d172789f06886806bc55\n# This file is a cache directory tag created by cargo.\n", { flag: "wx" });
  }
  return execFileSync("cargo", ["clean", "--profile", "dev", "--target-dir", target], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
}

function stat(path: string) {
  try { return lstatSync(path); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export function pruneTestArtifacts(executables: readonly string[]) {
  if (executables.length === 0) throw new Error("no current Cargo test executables");
  const keep = new Set(executables.map((p) => realpathSync(p)));
  const profiles = new Set<string>();
  for (const path of keep) {
    if (basename(dirname(path)) !== "deps") throw new Error(`unexpected Cargo test path: ${path}`);
    profiles.add(dirname(dirname(path)));
  }
  let binaries = 0;
  let bytes = 0;
  for (const profile of profiles) {
    const deps = join(profile, "deps");
    const fingerprints = join(profile, ".fingerprint");
    if (!stat(deps)?.isDirectory() || !stat(fingerprints)?.isDirectory()) {
      throw new Error(`missing Cargo artifact directories in ${profile}`);
    }
    const candidates = new Set<string>();
    for (const dir of readdirSync(fingerprints, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue; // Never follow cache symlinks.
      const hash = /-([0-9a-f]{16})$/.exec(dir.name)?.[1];
      if (!hash) continue;
      for (const file of readdirSync(join(fingerprints, dir.name), { withFileTypes: true })) {
        if (!file.isFile()) continue;
        const target = /^test-(?:lib|bin|integration-test|example)-(.+)\.json$/.exec(file.name)?.[1];
        if (!target || !/^[A-Za-z0-9_-]+$/.test(target)) continue;
        const stem = `${target.replaceAll("-", "_")}-${hash}`;
        candidates.add(join(deps, stem + (process.platform === "win32" ? ".exe" : "")));
      }
    }
    for (const path of candidates) {
      if (keep.has(path)) continue;
      const binary = stat(path);
      // Linked artifacts may also be named outside this cache. Keep them, and
      // keep symlinks, directories and anything not an executable file.
      if (!binary?.isFile() || binary.nlink !== 1 ||
          (process.platform !== "win32" && !(binary.mode & 0o111))) continue;
      unlinkSync(path);
      binaries++;
      bytes += binary.size;
      const depInfo = path.replace(/\.exe$/, "") + ".d";
      const sidecar = stat(depInfo);
      if (sidecar?.isFile() && sidecar.nlink === 1) {
        unlinkSync(depInfo);
        bytes += sidecar.size;
      }
    }
  }
  // Do not touch .fingerprint, build/*/out, libraries or incremental state.
  // Cargo sees a missing whole executable and relinks it if needed again.
  return { binaries, bytes };
}
