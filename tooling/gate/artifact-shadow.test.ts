import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { artifactFiles, artifactShadow } from "./artifact-shadow.ts";

function fixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "nts-artifact-shadow-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cache = join(root, "cache"), costs = join(root, "costs"); mkdirSync(costs);
  const env = { NTS_GATE_SHADOW_DIR: cache, NTS_GATE_CASE_COSTS_DIR: costs, NTS_GATE_STEP: "assembles" };
  return { root, cache, costs, env };
}

test("every fresh run executes, matching hits compare results, and mismatches keep the first result", t => {
  const { root, env, costs } = fixture(t), file = join(root, "module.ll"); writeFileSync(file, "module");
  const inputs = () => ({ files: [{ name: "module.ll", path: file }], values: { tool: "llvm-1", flags: ["verify"] } });
  let runs = 0;
  const fresh = (value: string) => { const observe = artifactShadow("assemble", inputs, env); runs++; return observe({ status: 0, stdout: value }); };
  assert.equal(fresh("same")!.status, "miss");
  assert.equal(fresh("same")!.status, "hit-match");
  assert.equal(fresh("changed")!.status, "hit-mismatch");
  assert.equal(fresh("same")!.status, "hit-match", "a mismatch must not overwrite its comparison baseline");
  assert.equal(runs, 4);
  assert.equal(readdirSync(costs).length, 4);
});

test("keys follow bytes, tool/driver identity and flags, independently of artifact directory", t => {
  const { root, env } = fixture(t);
  const a = join(root, "a"), b = join(root, "deep", "b"); mkdirSync(a); mkdirSync(b, { recursive: true });
  writeFileSync(join(a, "A.class"), "bytes"); writeFileSync(join(b, "A.class"), "bytes");
  const run = (path: string, tool = "v1", driver = "d1", flags = ["verify"]) => artifactShadow("jvm-verifies", () => ({ files: artifactFiles(path), values: { tool, driver, flags } }), env)({ verdict: "PASS" })!;
  const first = run(a);
  assert.equal(first.status, "miss"); assert.equal(run(b).status, "hit-match");
  assert.equal(run(b, "v2").status, "miss");
  assert.equal(run(b, "v1", "d2").status, "miss");
  assert.equal(run(b, "v1", "d1", ["verify", "strict"]).status, "miss");
  writeFileSync(join(b, "A.class"), "different");
  assert.equal(run(b).status, "miss");
});

test("changing an input during the fresh run cannot seed a result under the old key", t => {
  const { root, env } = fixture(t), file = join(root, "artifact"); writeFileSync(file, "before");
  const observe = artifactShadow("assemble", () => ({ files: [{ name: "ir", path: file }] }), env);
  writeFileSync(file, "after");
  assert.equal(observe({ status: 0 })!.status, "unavailable");
});

test("missing inputs, corrupt entries and unwritable records never affect a fresh result", t => {
  const { root, env, cache } = fixture(t), file = join(root, "artifact"); writeFileSync(file, "ok");
  const input = () => ({ files: [{ name: "ir", path: file }] });
  const first = artifactShadow("assemble", input, env)({ status: 0 })!;
  writeFileSync(join(cache, "assemble", `${first.key}.json`), "broken");
  assert.equal(artifactShadow("assemble", input, env)({ status: 0 })!.status, "unavailable");
  assert.doesNotThrow(() => artifactShadow("assemble", input, { ...env, NTS_GATE_CASE_COSTS_DIR: join(root, "missing") })({ status: 7 }));
  assert.equal(artifactShadow("assemble", () => ({ files: [{ name: "missing", path: join(root, "absent") }] }), env)({ status: 7 })!.status, "unavailable");
  assert.equal(readFileSync(join(cache, "assemble", `${first.key}.json`), "utf8"), "broken");
});

test("disabled observation does not even inspect inputs", () => {
  let inspected = false;
  assert.equal(artifactShadow("assemble", () => { inspected = true; throw new Error("must not run"); }, {})({ status: 0 }), null);
  assert.equal(inspected, false);
});
