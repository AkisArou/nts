import assert from "node:assert/strict";
import {existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync} from "node:fs";
import {userInfo} from "node:os";
import {testScratch} from "../gate/test-scratch.ts";
import {dirname, join, relative} from "node:path";
import {test} from "node:test";
import {NODE_COMPILE_CACHE_ROOT} from "../gate/canonical-environment.ts";
import {acquire} from "../landing/lock.ts";
import * as retention from "./node-cache-retention.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2030, 0, 20);
type Result = { state: string; removed: number; removedBytes: number; kept: number; keptBytes: number; changed: number; skipped: number; errors: string[] };
type Options = { home?: string; now?: number; maxBytes?: number; onAttempt?: (path: string) => void };
function prune(options: Options): Result {
  const api = retention as typeof retention & { pruneNodeCompileCache?: (options?: Options) => Result };
  assert.equal(typeof api.pruneNodeCompileCache, "function", "shared Node cache must have its hourly retention owner");
  return api.pruneNodeCompileCache!(options);
}
function fixture(t: { after(fn: () => void): void }) {
  const dir=testScratch(t,"node-cache-retention"),home=join(dir,"home");
  const root = join(home, relative(userInfo().homedir, NODE_COMPILE_CACHE_ROOT)); mkdirSync(root, { recursive: true });
  const file = (name: string, bytes: string, accessDays: number, writeDays = accessDays) => {
    const path = join(root, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes);
    utimesSync(path, new Date(NOW - accessDays * DAY), new Date(NOW - writeDays * DAY)); return path;
  };
  return { dir, home, root, file };
}

test("hourly Node cache retention removes old entries and empty temporary siblings while retaining recent use", t => {
  const f = fixture(t);
  const old = f.file("node24/old", "old!", 8), empty = f.file("node24/old.tmp", "", 8);
  const recentRead = f.file("node24/read", "read", 1, 10), recentWrite = f.file("node26/write", "write", 10, 1);
  const boundary = f.file("node26/seven", "seven", 7), freshTemporary = f.file("node26/fresh.tmp", "", 0);
  const result = prune({ home: f.home, now: NOW });
  assert.equal(result.state, "complete"); assert.equal(result.removed, 2); assert.equal(result.removedBytes, 4);
  assert.equal(result.kept, 4); assert.equal(result.keptBytes, 14);
  for (const path of [old, empty]) assert.equal(existsSync(path), false, path);
  for (const path of [recentRead, recentWrite, boundary, freshTemporary]) assert.ok(existsSync(path), path);
  assert.deepEqual(result.errors, []);
});

test("the byte cap evicts oldest cache entries with deterministic ties and retains a fresh empty temporary", t => {
  const f = fixture(t), first = f.file("node24/a", "aaaa", 3), second = f.file("node24/b", "bbbb", 3);
  const newer = f.file("node26/c", "cccc", 1), temporary = f.file("node26/inflight.tmp", "", 0);
  const result = prune({ home: f.home, now: NOW, maxBytes: 8 });
  assert.equal(result.removed, 1); assert.equal(result.removedBytes, 4); assert.equal(result.keptBytes, 8);
  assert.equal(existsSync(first), false); assert.equal(readFileSync(second, "utf8"), "bbbb");
  assert.ok(existsSync(newer)); assert.ok(existsSync(temporary));
});

test("a concurrent pruner owns the non-blocking lock and a later run can collect", t => {
  const f = fixture(t), old = f.file("node24/old", "old", 8);
  const lock = acquire(join(dirname(f.root), "retention.lock")); assert.ok(lock);
  try { assert.equal(prune({ home: f.home, now: NOW }).state, "busy"); assert.ok(existsSync(old)); }
  finally { lock.release(); }
  assert.equal(prune({ home: f.home, now: NOW }).removed, 1); assert.equal(existsSync(old), false);
});

test("retention never follows symlinks and reports an invalid cache root without deleting its target", t => {
  const f = fixture(t), outside = join(f.dir, "outside"); mkdirSync(outside); writeFileSync(join(outside, "keep"), "keep");
  symlinkSync(outside, join(f.root, "link"));
  assert.equal(prune({ home: f.home, now: NOW }).skipped, 1);
  assert.equal(readFileSync(join(outside, "keep"), "utf8"), "keep");
  rmSync(f.root, { recursive: true }); symlinkSync(outside, f.root);
  const result = prune({ home: f.home, now: NOW });
  assert.equal(result.state, "warning"); assert.match(result.errors.join("\n"), /owned real directory/);
  assert.equal(readFileSync(join(outside, "keep"), "utf8"), "keep");
});

test("an entry accessed or atomically replaced after the scan is retained", t => {
  for (const change of ["access", "replace"] as const) {
    const f = fixture(t), path = f.file("node24/old", "old", 8);
    const result = prune({ home: f.home, now: NOW, onAttempt(candidate) {
      assert.equal(candidate, path);
      if (change === "access") utimesSync(path, new Date(NOW), new Date(NOW - 8 * DAY));
      else { rmSync(path); writeFileSync(path, "replacement"); }
    } });
    assert.equal(result.removed, 0); assert.equal(result.changed, 1); assert.ok(existsSync(path));
  }
});

test("a fresh empty temporary survives even when a concurrent read prevents reaching the byte cap", t => {
  const f = fixture(t), used = f.file("node24/reused", "used", 1), temporary = f.file("node24/publishing.tmp", "", 0);
  const result = prune({ home: f.home, now: NOW, maxBytes: 0, onAttempt(path) {
    assert.equal(path, used); utimesSync(used, new Date(NOW), new Date(NOW));
  } });
  assert.equal(result.state, "warning"); assert.equal(result.changed, 1); assert.ok(existsSync(temporary));
  assert.equal(result.removed, 0); assert.equal(result.keptBytes, 4);
});
