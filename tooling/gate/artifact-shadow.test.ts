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
  assert.equal(readdirSync(costs).filter(f => /^shadow-\d+-\d+\.jsonl$/.test(f)).length, 4);
  assert.equal(readdirSync(costs).filter(f => f.startsWith("shadow-mismatch-")).length, 1);
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

test("a prepared key and absent package observations are rechecked after fresh execution", t => {
  const { root, env } = fixture(t), file = join(root, "artifact"), absent = join(root, "package.json");
  writeFileSync(file, "before");
  const inputs = () => ({ files: [{ name: "ir", path: file }], absent: [absent] });
  const before = artifactShadow("assemble", inputs, env).key;
  writeFileSync(file, "after");
  assert.equal(artifactShadow("assemble", inputs, env, before)({ status: 0 })!.status, "unavailable");
  const current = artifactShadow("assemble", inputs, env);
  writeFileSync(absent, "{}");
  assert.equal(current({ status: 0 })!.status, "unavailable");
});

test("mismatch evidence preserves the canonical baseline, fresh log and separate DEX digests", t => {
  const { root, env, costs } = fixture(t), file = join(root, "A.class"); writeFileSync(file, "class");
  const inputs = () => ({ files: [{ name: "A.class", path: file }] });
  const baseline = { status: 0, log: "first log", outputs: [{ name: "classes.dex", sha256: "a".repeat(64) }] };
  const first = artifactShadow("dex", inputs, env, undefined, "project-a")(baseline)!;
  const matched = artifactShadow("dex", inputs, env, undefined, "project-b")(baseline)!;
  assert.equal(matched.key, first.key, "context does not enter the artifact key");
  assert.equal(matched.status, "hit-match");
  assert.equal(readdirSync(costs).filter(f => f.startsWith("shadow-mismatch-")).length, 0);
  const changed = { ...baseline, log: "second log" };
  const mismatch = artifactShadow("dex", inputs, env, undefined, "project-c")(changed)!;
  assert.equal(mismatch.status, "hit-mismatch");
  const evidence = JSON.parse(readFileSync(mismatch.evidence!, "utf8"));
  assert.deepEqual(evidence.changed_components, ["log"]);
  assert.equal(evidence.context, "project-c");
  assert.equal(evidence.baseline.context, "project-a");
  assert.deepEqual(evidence.baseline.result, baseline);
  assert.deepEqual(evidence.fresh.result, changed);
  assert.deepEqual(evidence.fresh.result.outputs, baseline.outputs);
});

test("a legacy baseline payload is recovered only from a proven matching hit", t => {
  const { root, cache, env } = fixture(t), file = join(root, "A.class"); writeFileSync(file, "class");
  const inputs = () => ({ files: [{ name: "A.class", path: file }] });
  const first = artifactShadow("dex", inputs, env)({ status: 0, log: "original", outputs: [] })!;
  const path = join(cache, "dex", `${first.key}.json`), legacy = JSON.parse(readFileSync(path, "utf8"));
  delete legacy.result; delete legacy.context; writeFileSync(path, JSON.stringify(legacy));
  const saved = readFileSync(path, "utf8");
  const mismatch = artifactShadow("dex", inputs, env)({ status: 0, log: "different", outputs: [] })!;
  assert.equal(JSON.parse(readFileSync(mismatch.evidence!, "utf8")).baseline.available, false);
  assert.equal(artifactShadow("dex", inputs, env)({ status: 0, log: "original", outputs: [] })!.status, "hit-match");
  const later = artifactShadow("dex", inputs, env)({ status: 0, log: "different", outputs: [] })!;
  assert.equal(JSON.parse(readFileSync(later.evidence!, "utf8")).baseline.result.log, "original");
  assert.equal(readFileSync(path, "utf8"), saved, "the original comparison entry stays immutable");
});
