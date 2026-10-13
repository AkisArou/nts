#!/usr/bin/env node
/**
 * The Chromium lane's verification, as one command: everything that says the
 * lane still agrees with V8, on both backends. tooling/gate/owed.mjs settles
 * the lane's files -- they owe no gate step of their own -- on the strength
 * of this run.
 *
 *   node tooling/chromium/verify.ts
 *
 * Run it from the tree to verify; NTS_BIN names the compiler
 * (target/release/nts by default). It stops at the first failure:
 *
 *   1. the bindings are what the generator makes of Blink's IDL, and its
 *      reports are current (bindgen/generate.py --check);
 *   2. without Chromium: the embedder's program on both backends, the
 *      contracts, and the standalone rows;
 *   3. for each backend: the probe staged (probe.ts), the perf engine built
 *      with it, and the dom and microtasks smokes;
 *   4. the V8 oracle -- the same pages' own script on unmodified
 *      content_shell -- and compare.ts, both backends' transcripts against it;
 *   5. each example app, built and checked (app.ts).
 *
 * Chromium's source and its build are shared by every tree (checkout.ts), so
 * another tree can stage between this run's build and its smokes. What ran
 * must therefore be what this run staged: the staging manifest's hash, taken
 * right after staging, must be the build's and each smoke's, and an app's
 * staging must be unchanged across its check.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromiumSource } from "./checkout.ts";
import { sha256File } from "./hash.ts";
import { buildProfile } from "./profiles.ts";

const root = resolve(import.meta.dirname, "../..");
const profile = buildProfile(root, ["--profile", "perf"]);
const engine = resolve(chromiumSource(root), profile.directory);
const runs = resolve(root, "target/chromium/perf");
const apps = resolve(root, "runtime/chromium/examples");
const staging = (): string => sha256File(resolve(chromiumSource(root), "nts/manifest.json"));
const record = (path: string): { nativeManifestSha256?: string } => JSON.parse(readFileSync(path, "utf8"));
const built = (): string | undefined => record(resolve(profile.evidence, "build-result.json")).nativeManifestSha256;

function run(label: string, command: string, args: string[]): void {
  console.log(`\n== ${label}`);
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}
const tool = (label: string, script: string, ...args: string[]): void =>
  run(label, process.execPath, [resolve(root, script), ...args]);

run("the bindings are current", "python3", [resolve(root, "tooling/chromium/bindgen/generate.py"), "--check"]);
tool("the embedder's program, C and LLVM", "runtime/chromium/embedder/program/check.ts");
tool("the contracts", "runtime/chromium/contracts/check.ts");
tool("the standalone rows", "runtime/chromium/benchmarks/standalone/check.ts");

for (const backend of ["c", "llvm"]) {
  tool(`stage the ${backend} probe`, "tooling/chromium/probe.ts", backend, "--profile", profile.name);
  const staged = staging();
  tool(`build the engine with the ${backend} probe`, "tooling/chromium/chromium.ts", "build", "--profile", profile.name);
  assert.equal(built(), staged, "the engine was built from another staging");
  for (const mode of ["dom", "microtasks"]) {
    const output = resolve(runs, `native-${mode}-${backend}-smoke`);
    tool(`${backend}: ${mode}`, "tooling/chromium/smoke.ts", resolve(engine, "nts_shell"), output, backend, mode);
    assert.equal(record(resolve(output, "result.json")).nativeManifestSha256, staged, `${backend}/${mode} ran another staging`);
  }
}
for (const mode of ["dom", "microtasks"]) {
  tool(`the V8 oracle: ${mode}`, "tooling/chromium/smoke.ts", resolve(engine, "content_shell"),
    resolve(runs, `native-${mode}-oracle-smoke`), "v8", mode);
}
tool("both backends against the oracle", "tooling/chromium/compare.ts", runs);

const names = readdirSync(apps, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
for (const name of names) {
  const app = resolve(apps, name);
  tool(`build ${name}`, "tooling/chromium/app.ts", "build", app, "--profile", profile.name);
  const staged = staging();
  assert.equal(built(), staged, `${name}'s engine was built from another staging`);
  tool(`check ${name}`, "tooling/chromium/app.ts", "check", app, "--profile", profile.name);
  assert.equal(staging(), staged, `${name} was restaged during its check`);
}

console.log(`\nPASS: bindings current; both backends agree with V8; ${names.join(", ")} built and checked`);
