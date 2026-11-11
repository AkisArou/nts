import {fixtureEnvironment} from "../gate/test-environment.ts";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, test } from "node:test";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFailureRun, pruneFailures, retainRecentFailures } from "./jvm-failure-retention.ts";

const roots: string[] = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const fingerprint = "a".repeat(16);
function root(): string {
  const path = mkdtempSync(join(tmpdir(), "jvm-retention-"));
  roots.push(path);
  return path;
}
function run(base: string, suffix: string, pin = fingerprint): string {
  const path = join(base, `failed-${pin}-${suffix}`);
  mkdirSync(path);
  return path;
}
function entry(run: string, key: number, suffix: string, modified = NOW): string {
  const path = join(run, `${key.toString(16).padStart(64, "0")}-${suffix}`);
  mkdirSync(path);
  writeFileSync(join(path, "evidence"), "bytes");
  utimesSync(path, modified / 1000, modified / 1000);
  return path;
}
function paths(base: string): string[] {
  return readdirSync(base).filter(name => name.startsWith("failed-")).flatMap(name =>
    readdirSync(join(base, name)).filter(child => /^[a-f0-9]{64}-/.test(child)).map(child => `${name}/${child}`)).sort();
}
function relative(path: string): string { return `${basename(join(path, ".."))}/${basename(path)}`; }

test("retention keeps the newest failure per fingerprint/project, a seven-day boundary, and KEEP at both levels", () => {
  const base = root(), older = run(base, "older"), newer = run(base, "newer");
  entry(older, 1, "old", NOW - DAY);
  const recent = entry(newer, 1, "new", NOW - 1000);
  entry(older, 2, "expired", NOW - 7 * DAY - 1);
  const boundary = entry(older, 3, "boundary", NOW - 7 * DAY);
  const anotherFingerprint = entry(run(base, "other", "b".repeat(16)), 1, "independent");
  const folderKeep = run(base, "kept");
  writeFileSync(join(folderKeep, "KEEP"), "cited run");
  const protectedRun = entry(folderKeep, 1, "old", NOW - 20 * DAY);
  const protectedEntry = entry(older, 4, "kept", NOW - 20 * DAY);
  writeFileSync(join(protectedEntry, "KEEP"), "cited project");
  utimesSync(protectedEntry, (NOW - 20 * DAY) / 1000, (NOW - 20 * DAY) / 1000);
  const result = pruneFailures(base, { now: NOW, legacyLive: false });
  assert.deepEqual(paths(base), [recent, boundary, anotherFingerprint, protectedRun, protectedEntry].map(relative).sort());
  assert.deepEqual(result, { removed: 2, bytes: 10, kept: 5, marked: 2 });
});

test("the newest 100 ordinary entries survive; KEEP does not consume the cap and empty runs disappear", () => {
  const base = root(), old = run(base, "old"), fresh = run(base, "fresh");
  entry(old, 1000, "old", NOW - DAY);
  const ordinary = Array.from({ length: 102 }, (_, index) => entry(fresh, index, "entry", NOW - index * 1000));
  const marked = entry(fresh, 2000, "keep", NOW - 20 * DAY);
  writeFileSync(join(marked, "KEEP"), "retained separately");
  utimesSync(marked, (NOW - 20 * DAY) / 1000, (NOW - 20 * DAY) / 1000);
  const result = pruneFailures(base, { now: NOW, legacyLive: false });
  assert.deepEqual(paths(base), [...ordinary.slice(0, 100), marked].map(relative).sort());
  assert.equal(result.removed, 3);
  assert.equal(result.kept, 101);
  assert.equal(result.marked, 1);
  assert.ok(!readdirSync(base).includes(basename(old)));
});

test("live and unreadable owners are protected, dead owners expire, and run-* scratch and symlinks are untouched", () => {
  const base = root(), live = run(base, "live"), dead = run(base, "dead"), bad = run(base, "bad");
  for (const [path, value] of [[live, "live"], [dead, "dead"], [bad, "bad"]]) writeFileSync(join(path, "owner.json"), JSON.stringify(value));
  const active = entry(live, 1, "active", NOW - 20 * DAY);
  entry(dead, 2, "dead", NOW - 20 * DAY);
  const unknown = entry(bad, 3, "unknown", NOW - 20 * DAY);
  const scratch = join(base, "run-scratch");
  mkdirSync(scratch); writeFileSync(join(scratch, "marker"), "scratch");
  const outside = root(); writeFileSync(join(outside, "marker"), "outside");
  symlinkSync(outside, join(base, `failed-${fingerprint}-link`));
  pruneFailures(base, { now: NOW, legacyLive: false, isLive: value => {
    if (value === "bad") throw new Error("unreadable owner");
    return value === "live";
  } });
  assert.deepEqual(paths(base).filter(path => !path.endsWith("/marker")), [active, unknown].map(relative).sort());
  assert.equal(readFileSync(join(scratch, "marker"), "utf8"), "scratch");
  assert.equal(readFileSync(join(outside, "marker"), "utf8"), "outside");
});

test("legacy evidence remains while a receipt-less verifier could own it", () => {
  const base = root(), folder = run(base, "legacy");
  const old = entry(folder, 1, "old", NOW - 20 * DAY);
  assert.equal(pruneFailures(base, { now: NOW, legacyLive: true }).removed, 0);
  assert.deepEqual(paths(base), [relative(old)]);
  assert.equal(pruneFailures(base, { now: NOW, legacyLive: false }).removed, 1);
});

test("a newly published run has its real live owner before any entry, and locked pruning preserves it", () => {
  const base = root(), folder = createFailureRun(base, fingerprint);
  const evidence = entry(folder, 1, "live", NOW - 20 * DAY);
  const result = retainRecentFailures(base, NOW);
  assert.deepEqual(paths(base), [relative(evidence)]);
  assert.equal(result.removed, 0);
  assert.equal(JSON.parse(readFileSync(join(folder, "owner.json"), "utf8")).pid, process.pid);
});

test("two concurrent collectors serialize and remove each expired entry once", async t => {
  // The full gate runs the verifier beside tooling. Reproduce that live
  // legacy owner explicitly so this guard cannot depend on machine timing.
  const verifier = spawn(process.execPath, ["-e", "process.stdout.write('ready');process.stdin.resume()", "jvm-verifies.ts"],
    {env:fixtureEnvironment(t), stdio: ["pipe", "pipe", "pipe"] });
  t.after(async () => { const closed = once(verifier, "close"); verifier.stdin.end(); await closed; });
  const ready = await once(verifier.stdout, "data");
  assert.equal(String(ready[0]), "ready");
  const base = root(), folder = createFailureRun(base, fingerprint);
  const receipt = JSON.parse(readFileSync(join(folder, "owner.json"), "utf8"));
  // This known owner is dead even while a receipt-less verifier is live.
  // A live process cannot have two different start identities.
  writeFileSync(join(folder, "owner.json"), JSON.stringify({ ...receipt, start: String(BigInt(receipt.start) + 1n) }));
  entry(folder, 1, "one", NOW - 20 * DAY);
  entry(folder, 2, "two", NOW - 20 * DAY);
  const collect = () => new Promise<{ removed: number }>((done, reject) => {
    const child = spawn("flock", ["--exclusive", join(base, ".retention.lock"), process.execPath,
      fileURLToPath(new URL("./jvm-failure-retention.ts", import.meta.url)), "--prune", base, String(NOW), String(process.pid)], {env:fixtureEnvironment(t)});
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    child.on("error", reject);
    child.on("close", (status, signal) => {
      if (status !== 0 || signal) { reject(new Error(`${status}/${signal}: ${stderr}`)); return; }
      try { done(JSON.parse(stdout)); } catch (error) { reject(error); }
    });
  });
  const results = await Promise.all([collect(), collect()]);
  assert.equal(results.reduce((sum, result) => sum + result.removed, 0), 2);
  assert.deepEqual(paths(base), []);
});
