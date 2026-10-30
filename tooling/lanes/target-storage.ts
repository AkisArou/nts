// Optional, read-only status observations. A slow or failed scan is unknown,
// never an empty target. Nothing here deletes output or grants admission.
import {spawn} from "node:child_process";
import {lstat, readdir} from "node:fs/promises";
import {dirname, join, relative, resolve} from "node:path";
import {StringDecoder} from "node:string_decoder";

export const LARGE_TARGET_BYTES = 40 * 1024 ** 3;
const STALE_MS = 24 * 60 * 60_000;
type ProfileStorage = {
  profile: string;
  allocatedBytes: number;
  lastSuccessfulUnit: string | null;
  stale: boolean | null;
  ageState: "known" | "unknown";
};
export type TargetStorage = {
  path: string;
  state: "known" | "absent" | "unknown" | "symlink";
  allocatedBytes: number | null;
  over40GiB: boolean | null;
  profiles: ProfileStorage[];
  otherBytes: number | null;
  reason?: string;
};
export type StorageRow = {path: string; lane: string; storage: TargetStorage};
type Sizes = Map<string, number>;
type Usage = {sizes: Sizes; profiles: Set<string>};

function sizeRow(row: string, target: string): [string, number] {
  const match = /^(\d+)\t([\s\S]+)$/.exec(row);
  if (!match) throw new Error("invalid disk-usage observation");
  const bytes = Number(match[1]), path = relative(target, resolve(match[2]));
  if (!Number.isSafeInteger(bytes) || bytes < 0 || path === ".." || path.startsWith("../")) throw new Error("invalid disk-usage size/path");
  return [path, bytes];
}

async function allocatedSizes(target: string, deadline: number, command: string): Promise<Usage> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("storage scan budget exhausted");
  return new Promise((accept, reject) => {
    // du does not follow symlinks. One invocation per target also keeps its
    // hard-link accounting local to that tree. No shell or child process tree.
    const child = spawn(command, ["--block-size=1", "--max-depth=3", "--null", "--", target], {
      stdio: ["ignore", "pipe", "pipe"], timeout: remaining, killSignal: "SIGKILL",
    });
    const decoder = new StringDecoder("utf8"), sizes: Sizes = new Map(), profiles = new Set<string>();
    let pending = "", invalid: Error | undefined;
    function consume(text: string): void {
      pending += text;
      let end: number;
      while ((end = pending.indexOf("\0")) >= 0) {
        const row = pending.slice(0, end); pending = pending.slice(end + 1);
        if (!row) continue;
        const [path, bytes] = sizeRow(row, target);
        const components = path.split("/");
        // du emits children before their parent. Cargo markers identify both
        // direct profiles and target-triple/profile directories without a
        // second traversal of the filesystem or a list of profile names.
        if (components.length >= 2 && [".fingerprint", "deps", "incremental"].includes(components.at(-1)!)) profiles.add(dirname(path));
        if (!path || profiles.has(path)) {
          if (sizes.has(path)) throw new Error("duplicate disk-usage path");
          sizes.set(path, bytes);
        }
      }
      if (pending.length > 1 << 20) throw new Error("disk-usage record exceeded 1 MiB");
    }
    child.stdout.on("data", (chunk: Buffer) => {
      if (invalid) return;
      try { consume(decoder.write(chunk)); }
      catch (error) { invalid = error instanceof Error ? error : new Error(String(error)); child.kill("SIGKILL"); }
    });
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (invalid || code !== 0 || signal) {
        reject(invalid ?? new Error(`storage scan incomplete (${signal ?? code})`));
      } else {
        try {
          consume(decoder.end());
          if (pending || !sizes.has("") || [...profiles].some(profile => !sizes.has(profile))) throw new Error("disk-usage observation omitted a total");
          accept({sizes, profiles});
        } catch (error) { reject(error); }
      }
    });
  });
}

async function successfulUnit(profile: string, deadline: number): Promise<{exists: boolean; complete: boolean; time: number | null}> {
  let time: number | null = null;
  const fingerprint = join(profile, ".fingerprint");
  let entry;
  try { entry = await lstat(fingerprint); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {exists: false, complete: false, time: null};
    throw error;
  }
  if (!entry.isDirectory()) return {exists: true, complete: false, time: null};
  const crates = await readdir(fingerprint, {withFileTypes: true});
  for (const crate of crates) {
    if (Date.now() >= deadline) return {exists: true, complete: false, time: null};
    if (!crate.isDirectory()) continue;
    const path = join(profile, ".fingerprint", crate.name);
    for (const marker of await readdir(path, {withFileTypes: true})) {
      // Cargo writes these unit fingerprints after success. invoked.timestamp,
      // dep-* and JSON metadata are not evidence of a completed unit.
      if (!marker.isFile() || !/^(?:lib|bin|test|bench|run-build-script)-/.test(marker.name) || marker.name.endsWith(".json")) continue;
      const stat = await lstat(join(path, marker.name));
      if (stat.isFile()) time = Math.max(time ?? 0, stat.mtimeMs);
    }
  }
  return {exists: true, complete: true, time};
}

async function targetStorage(tree: string, deadline: number, now: number, command: string): Promise<TargetStorage> {
  const path = join(tree, "target");
  const unknown = (reason: string): TargetStorage => ({path, state: "unknown", allocatedBytes: null, over40GiB: null, profiles: [], otherBytes: null, reason});
  try {
    const target = await lstat(path);
    if (target.isSymbolicLink()) return {...unknown("target is a symlink; external storage is not scanned"), state: "symlink"};
    if (!target.isDirectory()) return unknown("target is not a directory");
    const {sizes, profiles: paths} = await allocatedSizes(path, deadline, command);
    const total = sizes.get("")!;
    const profiles: ProfileStorage[] = [];
    for (const profile of [...paths].sort()) {
      let lastSuccessfulUnit: string | null = null, stale: boolean | null = null, ageState: "known" | "unknown" = "unknown";
      try {
        const latest = await successfulUnit(join(path, profile), deadline);
        if (!latest.exists) continue;
        if (latest.complete && latest.time !== null && latest.time <= now) {
          lastSuccessfulUnit = new Date(latest.time).toISOString();
          stale = now - latest.time >= STALE_MS;
          ageState = "known";
        }
      } catch { /* concurrent cleanup or unreadable fingerprints: age unknown */ }
      profiles.push({profile, allocatedBytes: sizes.get(profile)!, lastSuccessfulUnit, stale, ageState});
    }
    return {path, state: "known", allocatedBytes: total, over40GiB: total > LARGE_TARGET_BYTES, profiles,
      otherBytes: Math.max(0, total - profiles.reduce((sum, profile) => sum + profile.allocatedBytes, 0))};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // Only absence of target itself means no output. A directory removed
      // during du/profile discovery makes the scan incomplete instead.
      try { await lstat(path); } catch (missing) {
        if ((missing as NodeJS.ErrnoException).code === "ENOENT") return {path, state: "absent", allocatedBytes: 0, over40GiB: false, profiles: [], otherBytes: 0};
      }
    }
    return unknown(error instanceof Error ? error.message : String(error));
  }
}

export async function collectTargetStorage(trees: readonly {path: string}[], options: {budgetMs?: number; now?: number; command?: string} = {}): Promise<TargetStorage[]> {
  const now = options.now ?? Date.now(), deadline = Date.now() + (options.budgetMs ?? 5_000);
  const rows: TargetStorage[] = new Array(trees.length);
  let next = 0;
  await Promise.all(Array.from({length: Math.min(4, trees.length)}, async () => {
    for (;;) {
      const index = next++;
      if (index >= trees.length) return;
      rows[index] = await targetStorage(trees[index].path, deadline, now, options.command ?? "du");
    }
  }));
  return rows;
}

export function flaggedStorage(row: StorageRow): boolean {
  return row.storage.over40GiB === true || row.storage.profiles.some(profile => profile.stale || profile.ageState === "unknown") || ["unknown", "symlink"].includes(row.storage.state);
}

export function sortStorage(rows: StorageRow[]): StorageRow[] {
  return rows.sort((a, b) => Number(flaggedStorage(b)) - Number(flaggedStorage(a)) ||
    (b.storage.allocatedBytes ?? 0) - (a.storage.allocatedBytes ?? 0) || a.path.localeCompare(b.path));
}

export function storageSummary(rows: readonly StorageRow[]) {
  return {
    trees: rows.length,
    targets: rows.filter(row => row.storage.state === "known").length,
    absent: rows.filter(row => row.storage.state === "absent").length,
    unknown: rows.filter(row => ["unknown", "symlink"].includes(row.storage.state)).length,
    unknownAges: rows.reduce((sum, row) => sum + row.storage.profiles.filter(profile => profile.ageState === "unknown").length, 0),
    flagged: rows.filter(flaggedStorage).length,
    profiles: rows.reduce((sum, row) => sum + row.storage.profiles.length, 0),
    knownAllocatedBytes: rows.reduce((sum, row) => sum + (row.storage.allocatedBytes ?? 0), 0),
  };
}

export function storageLines(rows: readonly StorageRow[]): string[] {
  const size = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  const lines = ["target storage (allocated; hard links counted once per tree; read-only)",
    "  Age uses the last successful Cargo unit, not a complete-build receipt. Scans are bounded; storage --deep allows longer. Owners manage their own output."];
  for (const row of rows) {
    const s = row.storage;
    if (s.state === "absent") { lines.push(`  ${row.lane} ${row.path}/target: absent`); continue; }
    if (s.state !== "known") { lines.push(`  ${row.lane} ${row.path}/target: ${s.state} (${s.reason})`); continue; }
    lines.push(`  ${row.lane} ${row.path}/target: ${size(s.allocatedBytes!)}${s.over40GiB ? " [OVER 40 GiB]" : ""}`);
    for (const profile of s.profiles) lines.push(`    ${profile.profile}: ${size(profile.allocatedBytes)}; last successful unit ${profile.lastSuccessfulUnit ?? "unknown"}${profile.stale ? " [NO BUILD IN 24h]" : ""}`);
    if (s.otherBytes) lines.push(`    other: ${size(s.otherBytes)}`);
  }
  const total = storageSummary(rows);
  lines.push(`total: ${total.trees} trees; ${total.targets} targets; ${total.profiles} profiles; ${size(total.knownAllocatedBytes)} known allocated; ${total.absent} absent; ${total.unknown} unknown targets; ${total.unknownAges} unknown ages; ${total.flagged} flagged`);
  return lines;
}
