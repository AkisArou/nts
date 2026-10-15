import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { caseRoot, collectCaseRoots, environment, materialise, workspace } from "./project.ts";
import { parseDiagnostics } from "./attempt262.ts";

function thaw(path) {
  const meta = lstatSync(path);
  if (!meta.isDirectory()) return;
  chmodSync(path, 0o700);
  for (const name of readdirSync(path)) thaw(join(path, name));
}

function scratch(t) {
  const base = mkdtempSync(join(tmpdir(), "nts-case-roots-"));
  t.after(() => { thaw(base); rmSync(base, { recursive: true, force: true }); });
  return base;
}

function fill(dir, text = "assert.sameValue(1, 1);") {
  workspace(dir);
  materialise(dir, text);
}

test("same bytes share a root across names, workers and flag order", (t) => {
  const base = scratch(t);
  const a = caseRoot((dir) => fill(dir), { base, flags: ["module", "async"] });
  const b = caseRoot((dir) => fill(dir), { base, flags: ["async", "module", "async"] });
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(a.key, b.key);
  assert.equal(a.root, join(base, a.key));
  assert.match(a.key, /^[a-f0-9]{64}$/);
});

test("config, harness, include, fixture, body and flags each change the key", (t) => {
  const base = scratch(t);
  const original = caseRoot((dir) => fill(dir), { base });
  for (const file of ["tsconfig.json", "src/harness.ts", "src/include-extra.js", "src/nested/a_FIXTURE.js", "src/main.js"]) {
    const changed = caseRoot((dir) => {
      fill(dir);
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), "different bytes");
    }, { base });
    assert.notEqual(changed.key, original.key, file);
  }
  assert.notEqual(caseRoot((dir) => fill(dir), { base, flags: ["raw"] }).key, original.key);
  assert.throws(() => caseRoot((dir) => fill(dir), { base, flags: [1] }), /flag/i);
});

test("publication rejects symlinks and reserved files, and cleans failed temporary roots", (t) => {
  const base = scratch(t);
  assert.throws(() => caseRoot((dir) => symlinkSync(base, join(dir, "link")), { base }), /symlink|regular/i);
  assert.throws(() => caseRoot((dir) => writeFileSync(join(dir, ".nts-case-root.json"), "{}"), { base }), /reserved/i);
  assert.throws(() => caseRoot(() => { throw new Error("materialise failed"); }, { base }), /materialise failed/);
  assert.equal(readdirSync(base).filter((name) => name.startsWith(".tmp-")).length, 0);
});

test("published inputs are read-only and output can live beside them", (t) => {
  const base = scratch(t);
  const { root } = caseRoot((dir) => fill(dir), { base });
  for (const path of [root, join(root, "src"), join(root, "src/main.js"), join(root, "tsconfig.json")]) {
    assert.equal(lstatSync(path).mode & 0o222, 0, path);
  }
  const output = join(base, "worker-2-c");
  mkdirSync(output);
  writeFileSync(join(output, "program.c"), "an output");
  assert.equal(existsSync(join(root, "program.c")), false);
});

test("a corrupt existing winner is rejected rather than overwritten", (t) => {
  const base = scratch(t);
  const { root } = caseRoot((dir) => fill(dir), { base });
  chmodSync(join(root, "src/main.js"), 0o644);
  writeFileSync(join(root, "src/main.js"), "corruption");
  assert.throws(() => caseRoot((dir) => fill(dir), { base }), /winner|manifest|content/i);
  assert.equal(readFileSync(join(root, "src/main.js"), "utf8"), "corruption");
});

test("an empty foreign directory at the key is retained", (t) => {
  const base = scratch(t);
  const { root } = caseRoot((dir) => fill(dir), { base });
  thaw(root);
  rmSync(root, { recursive: true });
  mkdirSync(root);
  assert.throws(() => caseRoot((dir) => fill(dir), { base }));
  assert.deepEqual(readdirSync(root), []);
});

test("collection is explicit, by last use, and removes only owned roots", (t) => {
  const base = scratch(t);
  const old = caseRoot((dir) => fill(dir, "old"), { base });
  const recent = caseRoot((dir) => fill(dir, "recent"), { base });
  const ago = new Date(Date.now() - 10 * 86400_000);
  utimesSync(join(base, "uses", old.key), ago, ago);
  const foreign = join(base, "f".repeat(64));
  mkdirSync(foreign);
  utimesSync(foreign, ago, ago);
  caseRoot((dir) => fill(dir, "a third case"), { base });
  assert.equal(existsSync(old.root), true, "per-case publication must not sweep");
  const result = collectCaseRoots({ base, maxAge: 7 * 86400_000 });
  assert.equal(result.removed, 1);
  assert.equal(existsSync(old.root), false);
  assert.equal(existsSync(recent.root), true);
  assert.equal(existsSync(foreign), true);
});

test("a hit refreshes old use records without rewriting the published tree", (t) => {
  const base = scratch(t);
  const first = caseRoot((dir) => fill(dir), { base });
  const manifest = join(first.root, ".nts-case-root.json");
  const before = lstatSync(manifest).mtimeMs;
  const use = join(base, "uses", first.key);
  const ago = new Date(Date.now() - 10 * 86400_000);
  utimesSync(use, ago, ago);
  assert.equal(caseRoot((dir) => fill(dir), { base }).created, false);
  assert.equal(lstatSync(manifest).mtimeMs, before);
  assert.ok(lstatSync(use).mtimeMs > ago.getTime());
  assert.equal(collectCaseRoots({ base }).removed, 0);
});

test("body, harness, include and fixture diagnostics keep their classification", (t) => {
  const base = scratch(t);
  const { root } = caseRoot((dir) => fill(dir), { base });
  const cases = [["src/harness.ts", 4, "harness"], ["src/include-extra.js", 2, "harness"], ["src/main.js", 3, "body"], ["src/a_FIXTURE.js", 2, "other"]];
  for (const [file, line, where] of cases) {
    const rows = parseDiagnostics(`${join(root, file)}:${line}:1: TS2322 A diagnostic`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].where, where);
    if (where === "body") assert.equal(rows[0].line, 2);
  }
  assert.equal(environment().NTS_NO_SNAPSHOT_CACHE, "1");
  assert.equal(environment({ snapshotCache: true }).NTS_NO_SNAPSHOT_CACHE, "0");
});

test("concurrent publishers agree on the complete read-only root", async (t) => {
  const base = scratch(t);
  const source = `import {caseRoot,workspace,materialise} from ${JSON.stringify(new URL("./project.ts", import.meta.url).href)}; process.stdout.write(JSON.stringify(caseRoot(d=>{workspace(d);materialise(d,'same input');},{base:process.argv[1]})));`;
  const publish = () => new Promise<any>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source, base]);
    let output = "", error = "";
    child.stdout.on("data", (bytes) => output += bytes);
    child.stderr.on("data", (bytes) => error += bytes);
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve(JSON.parse(output)) : reject(new Error(error)));
  });
  const results = await Promise.all([publish(), publish(), publish(), publish()]);
  assert.equal(new Set(results.map((r) => r.key)).size, 1);
  assert.equal(results.filter((r) => r.created).length, 1);
});
