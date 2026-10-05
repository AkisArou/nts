#!/usr/bin/env node
// Compare independently executed browser artifacts, including full CE/MO traces.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The evidence directory: target/chromium (baseline) by default, or e.g.
// target/chromium/perf for the optimized profile's runs.
const output = resolve(process.argv[2] ?? resolve(import.meta.dirname, "../../target/chromium"));
interface Result {
  chromiumRevision: string;
  fixture: string;
  fixtureSha256: string;
  dom: { html: string; exactUnits: number[]; result: number; exceptionCodes: Record<string, number> };
  microtasks?: { observerSha256: string; traces: unknown[]; canceledJobs?: number; endCheckpoints?: number };
  lifecycle?: { attachments: number; disposals: number; browserSurvivedRendererCrash: boolean };
  counter: { applicationScripts: number; managedLiveObjectsAfterCheckpoint?: number };
}
const comparisons = [];
async function readResult(path: string): Promise<Result> {
  const result = JSON.parse(await readFile(path, "utf8")) as Result;
  assert.equal(result.fixtureSha256, createHash("sha256").update(await readFile(fileURLToPath(result.fixture))).digest("hex"), `stale fixture evidence: ${path}`);
  return result;
}
for (const mode of ["dom", "microtasks"]) {
  const oraclePath = resolve(output, `native-${mode}-oracle-smoke/result.json`);
  const oracle = await readResult(oraclePath);
  assert.equal(oracle.counter.applicationScripts, 1);
  for (const backend of ["c", "llvm"]) {
    const nativePath = resolve(output, `native-${mode}-${backend}-smoke/result.json`);
    const native = await readResult(nativePath);
    assert.equal(native.chromiumRevision, oracle.chromiumRevision);
    assert.deepEqual(native.dom.html, oracle.dom.html, `${backend}/${mode}: observable DOM`);
    assert.deepEqual(native.dom.exactUnits, oracle.dom.exactUnits, `${backend}/${mode}: UTF-16 units`);
    assert.deepEqual(native.dom.exceptionCodes, oracle.dom.exceptionCodes);
    assert.equal(native.dom.result, 0);
    assert.equal(native.counter.applicationScripts, 0);
    assert.equal(native.lifecycle?.attachments, 5);
    assert.equal(native.lifecycle?.disposals, 4);
    assert.equal(native.lifecycle?.browserSurvivedRendererCrash, true);
    if (mode === "microtasks") {
      assert.equal(native.microtasks?.traces.length, 10);
      assert.equal(oracle.microtasks?.traces.length, 10);
      assert.equal(native.microtasks?.observerSha256, oracle.microtasks?.observerSha256);
      assert.deepEqual(native.microtasks?.traces, oracle.microtasks?.traces, `${backend}: complete mixed job/CE/MO traces`);
      assert.equal(native.microtasks?.canceledJobs, 4);
      assert.equal(native.microtasks?.endCheckpoints, 10);
      assert.equal(native.counter.managedLiveObjectsAfterCheckpoint, 1);
    }
    comparisons.push({ backend, mode, nativePath, oraclePath, passed: true });
    console.log(`PASS: ${backend}/${mode} agrees with the independently executed V8 oracle`);
  }
}
await writeFile(resolve(output, "comparison-result.json"), `${JSON.stringify({ observedAt: new Date().toISOString(), comparisons }, null, 2)}\n`);
