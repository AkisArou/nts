// Remove this bridge once no pinned compiler or stored record predates the
// introduction of the per-fixture oracle authority. The pin's own commit,
// never its executable name or the candidate's version, decides whether the
// view is needed. Unprovenanced binaries are never given a legacy view.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { isRecordedBinary, provenanceOf } from "../conformance/pin.ts";
import { GENERATOR, fixtureOf, parseGenerator, parseLegacyTable, readRecords, readRecordsAt } from "./oracle-records.ts";

function git(root: string, args: string[], input?: Buffer): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024 });
}
function ancestor(root: string, before: string, after: string): boolean {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", before, after], { cwd: root });
  if (result.status !== 0 && result.status !== 1) throw new Error("cannot establish oracle migration ancestry");
  return result.status === 0;
}
export function legacyOraclePin(root: string, binary: string, migration: string): boolean {
  const record = provenanceOf(binary);
  if (!record) return false;
  if (!isRecordedBinary(binary, record.sha)) throw new Error("oracle bridge needs verified pin bytes");
  const commit = git(root, ["rev-parse", "--verify", `${record.sha}^{commit}`]).trim();
  if (ancestor(root, migration, commit)) return false;
  if (!ancestor(root, commit, migration)) throw new Error("pin and oracle migration have no ordered ancestry");
  return true;
}
export type OracleRoot = { root: string; legacy: boolean; forBinary(binary: string): string; dispose(): void };

export function comparisonOracleRoot(root: string, binaries: string[], cache: string): OracleRoot {
  const unchanged: OracleRoot = { root, legacy: false, forBinary() { return root; }, dispose() {} };
  if (!existsSync(join(root, GENERATOR))) return unchanged;
  const introductions = git(root, ["log", "--format=%H", "--diff-filter=A", "HEAD", "--", GENERATOR]).trim().split("\n").filter(Boolean);
  const migration = introductions.at(-1);
  if (!migration) throw new Error("oracle authority migration must be committed before comparison");
  const legacy = binaries.filter(binary => legacyOraclePin(root, binary, migration));
  if (!legacy.length) return unchanged;
  mkdirSync(cache, { recursive: true });
  const directory = mkdtempSync(join(cache, "oracle-bridge-"));
  const snapshots: string[] = [], byBinary = new Map<string, string>(), byCommit = new Map<string, string>();
  let disposed = false;
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    // Always remove the derived view before the checkout, including failures.
    for (const snapshot of snapshots) {
      rmSync(join(snapshot, "results/oracle-counts.json"), { force: true });
      git(root, ["worktree", "remove", "--force", snapshot]);
    }
    rmSync(directory, { recursive: true, force: true });
  }
  try {
    const current = readRecords(root);
    for (const binary of legacy) {
      const commit = provenanceOf(binary)!.sha;
      const existing = byCommit.get(commit);
      if (existing) { byBinary.set(resolve(root, binary), existing); continue; }
      const snapshot = join(directory, `${basename(directory)}-${snapshots.length}`);
      git(root, ["worktree", "add", "--quiet", "--detach", snapshot, "HEAD"]);
      snapshots.push(snapshot);
      // Both compilers get precisely the candidate's current fixture bytes,
      // including a contributor's uncommitted tracked and untracked sources.
      const diff = execFileSync("git", ["diff", "--binary", "HEAD", "--"], { cwd: root, maxBuffer: 256 * 1024 * 1024 });
      if (diff.length) git(snapshot, ["apply", "--binary", "-"], diff);
      const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
      for (const path of untracked) {
        const source = join(root, path), target = join(snapshot, path);
        mkdirSync(dirname(target), { recursive: true });
        if (lstatSync(source).isSymbolicLink()) symlinkSync(readlinkSync(source), target);
        else copyFileSync(source, target);
      }
      const shared = dirname(git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim());
      execFileSync("sh", [join(snapshot, "tooling/lanes/inputs.sh"), "lane", shared, snapshot], { cwd: snapshot, maxBuffer: 64 * 1024 * 1024 });
      const historical = readRecordsAt(root, commit);
      const {rows: currentRows, ...currentRawHeader} = current;
      const {rows: historicalRows, ...historicalRawHeader} = historical;
      const currentHeader = parseGenerator(currentRawHeader), historicalHeader = parseGenerator(historicalRawHeader);
      if (JSON.stringify(currentHeader) !== JSON.stringify(historicalHeader)) throw new Error("legacy oracle view cannot substitute another generator identity");
      const currentFixtures = new Set(currentRows.map(row => fixtureOf(row.source)));
      const historicalFixtures = new Set(historicalRows.map(row => fixtureOf(row.source)));
      const newFixtures = new Set([...currentFixtures].filter(fixture => !historicalFixtures.has(fixture) &&
        git(root, ["ls-tree", "-z", commit, "--", fixture]).length === 0));
      // An existing fixture keeps the pin's original population, count and
      // no-oracle source digest. The legacy compiler must match that exact key
      // against the candidate sources; a changed/unmeasured key still holds.
      // Only genuinely new fixtures use their current measured records.
      const table = parseLegacyTable({...historicalHeader, rows: [
        ...historicalRows.filter(row => currentFixtures.has(fixtureOf(row.source)) && existsSync(join(snapshot, row.source))),
        ...currentRows.filter(row => newFixtures.has(fixtureOf(row.source))),
      ]});
      const view = join(snapshot, "results/oracle-counts.json");
      mkdirSync(dirname(view), { recursive: true });
      const temporary = view + ".partial";
      writeFileSync(temporary, JSON.stringify(table) + "\n");
      renameSync(temporary, view);
      byCommit.set(commit, snapshot); byBinary.set(resolve(root, binary), snapshot);
    }
    const snapshot = snapshots[0]!;
    return { root: snapshot, legacy: true, forBinary(binary) {
      const path = resolve(root, binary);
      if (!binaries.some(known => resolve(root, known) === path)) throw new Error("oracle view requested for an unregistered comparison pin");
      return byBinary.get(path) ?? snapshot;
    }, dispose };
  } catch (error) { dispose(); throw error; }
}
