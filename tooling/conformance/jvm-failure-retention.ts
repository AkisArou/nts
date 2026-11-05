// Failed verifier artifacts have their own lifetime; run-* scratch is untouched.
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OWNER = "owner.json";
const WEEK = 7 * 24 * 60 * 60 * 1000;
type Owner = { pid: number; start: string; boot: string };
type Entry = { path: string; run: string; pair: string; modified: number; keep: boolean; live: boolean; dev: number; ino: number };
export type Retention = { removed: number; bytes: number; kept: number; marked: number };

function absent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function present(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error) { if (absent(error)) return false; throw error; }
}

function processStart(pid: number): string | null {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
    if (!/^\d+$/.test(fields[19])) throw new Error(`invalid process identity: ${pid}`);
    return fields[0] === "Z" || fields[0] === "X" ? null : fields[19];
  } catch (error) { if (absent(error)) return null; throw error; }
}

function owner(): Owner {
  const start = processStart(process.pid);
  if (start === null) throw new Error("verifier process identity is unavailable");
  return { pid: process.pid, start, boot: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() };
}

function ownerIsLive(value: unknown): boolean {
  const record = value as Partial<Owner> | null;
  if (!record || !Number.isSafeInteger(record.pid) || record.pid! <= 0 || !/^\d+$/.test(record.start ?? "")
    || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(record.boot ?? "")) {
    throw new Error("unrecognized failure-evidence owner");
  }
  return record.boot === readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()
    && processStart(record.pid!) === record.start;
}

// Publish the owner and directory together, so a concurrent collector never
// mistakes the gap between mkdir and owner creation for a completed old run.
export function createFailureRun(base: string, fingerprint: string): string {
  if (!/^[a-f0-9]{16}$/.test(fingerprint)) throw new Error("invalid verifier fingerprint");
  const staging = mkdtempSync(join(base, "run-retain-"));
  try {
    writeFileSync(join(staging, OWNER), JSON.stringify(owner()) + "\n", { flag: "wx" });
    const destination = join(base, `failed-${fingerprint}-${staging.slice(staging.lastIndexOf("-") + 1)}`);
    renameSync(staging, destination);
    return destination;
  } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error; }
}

// Legacy folders have no receipt. If an older verifier is still running, its
// folder cannot be identified, so leave every legacy folder alone for this run.
function legacyVerifierIsLive(caller: number): boolean {
  for (const pid of readdirSync("/proc").filter(name => /^\d+$/.test(name))) {
    if (Number(pid) === caller || Number(pid) === process.pid) continue;
    try {
      if (lstatSync(`/proc/${pid}`).uid !== process.getuid!()) continue;
      const argv = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
      if (argv.some(arg => /(?:^|\/)jvm-verifies\.ts$/.test(arg))) return true;
    } catch (error) { if (!absent(error) && (error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  }
  return false;
}

function bytesAt(path: string): number {
  const stat = lstatSync(path);
  return stat.isDirectory()
    ? readdirSync(path).reduce((sum, name) => sum + bytesAt(join(path, name)), 0)
    : stat.size;
}

/** The clock and live-owner answers are explicit for deterministic policy tests. */
export function pruneFailures(base: string, options: {
  now: number;
  legacyLive: boolean;
  isLive?: (value: unknown) => boolean;
}): Retention {
  if (!Number.isFinite(options.now)) throw new Error("invalid retention clock");
  const entries: Entry[] = [];
  const runs: string[] = [];
  for (const name of readdirSync(base)) {
    const match = /^failed-([a-f0-9]{16})-[A-Za-z0-9]+$/.exec(name);
    if (!match) continue;
    const run = join(base, name);
    if (!lstatSync(run).isDirectory()) continue;
    let live = options.legacyLive;
    if (present(join(run, OWNER))) {
      try { live = (options.isLive ?? ownerIsLive)(JSON.parse(readFileSync(join(run, OWNER), "utf8"))); }
      catch { live = true; } // An unreadable identity is not permission to delete.
    }
    const keptRun = present(join(run, "KEEP"));
    if (!live && !keptRun) runs.push(run);
    for (const child of readdirSync(run)) {
      const key = /^([a-f0-9]{64})-[A-Za-z0-9]+$/.exec(child);
      if (!key) continue;
      const path = join(run, child), stat = lstatSync(path);
      if (!stat.isDirectory()) continue;
      entries.push({ path, run, pair: `${match[1]}/${key[1]}`, modified: stat.mtimeMs,
        keep: keptRun || present(join(path, "KEEP")), live, dev: stat.dev, ino: stat.ino });
    }
  }
  entries.sort((a, b) => b.modified - a.modified || b.path.localeCompare(a.path));
  const seen = new Set<string>(), remove = new Set<Entry>();
  let retained = 0;
  for (const entry of entries) {
    if (entry.live) continue;
    const duplicate = seen.has(entry.pair);
    seen.add(entry.pair);
    if (entry.keep) continue;
    if (duplicate || entry.modified < options.now - WEEK || retained >= 100) remove.add(entry);
    else retained++;
  }
  let bytes = 0, removed = 0;
  for (const entry of remove) {
    if (present(join(entry.run, "KEEP")) || present(join(entry.path, "KEEP"))) continue;
    const current = lstatSync(entry.path);
    if (current.dev !== entry.dev || current.ino !== entry.ino || !current.isDirectory()) throw new Error(`failure evidence changed: ${entry.path}`);
    bytes += bytesAt(entry.path);
    rmSync(entry.path, { recursive: true });
    removed++;
  }
  for (const run of runs) {
    const remaining = readdirSync(run);
    if (remaining.every(name => name === OWNER)) rmSync(run, { recursive: true });
  }
  const marked = entries.filter(entry => present(join(entry.run, "KEEP")) || present(join(entry.path, "KEEP"))).length;
  return { removed, bytes, kept: entries.length - removed, marked };
}

/** Serialize collectors across verifier processes; the verifier itself holds no lock while running. */
export function retainRecentFailures(base: string, now: number): Retention {
  mkdirSync(base, { recursive: true });
  return JSON.parse(execFileSync("flock", ["--exclusive", join(base, ".retention.lock"), process.execPath,
    fileURLToPath(import.meta.url), "--prune", base, String(now), String(process.pid)], { encoding: "utf8" }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, base, now, caller] = process.argv.slice(2);
  if (mode !== "--prune" || !base || !/^\d+$/.test(caller ?? "")) throw new Error("expected --prune <base> <now> <caller>");
  console.log(JSON.stringify(pruneFailures(base, { now: Number(now), legacyLive: legacyVerifierIsLive(Number(caller)) })));
}
