import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { artifactFiles, artifactShadow, canonicalJson, fileDigest, jdkIdentity, toolIdentity } from "./artifact-shadow.ts";
import { artifactResult, completeVerifier, REUSE, verifierEnvironment, verifierExecution, type VerifierResult } from "./artifact-reuse.ts";
import { vmToolFlags } from "../jvm/vm-flags.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ok: VerifierResult = { status: 0, signal: null, error: null, stdout: "VERIFIED 1 OF 1\n", stderr: "" };
function fixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "nts-verifier-reuse-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const costs = join(root, "costs"), cache = join(root, "cache"); mkdirSync(costs);
  const file = join(root, "A.class"); writeFileSync(file, "class");
  const env = { NTS_GATE_SHADOW_DIR: cache, NTS_GATE_CASE_COSTS_DIR: costs, NTS_GATE_STEP: "jvm-verifies", NTS_GATE_RUN_DIR: join(root, "first-run") };
  return { root, env, costs, cache, file, inputs: () => ({ files: [{ name: "A.class", path: file }] }) };
}
const accept = (v: unknown): v is VerifierResult => completeVerifier(v, 1);
const entry = (cache: string) => join(cache, "jvm-verifies", readdirSync(join(cache, "jvm-verifies"))[0]);

test("off policy executes on every hit; explicit reuse logs key/source and never invokes the tool", async t => {
  const { env, inputs, costs } = fixture(t); let calls = 0;
  const fresh = async () => { calls++; return { result: ok, cpu_s: .75 }; };
  await artifactResult("jvm-verifies", inputs, fresh, accept, "project", { env, enabled: false });
  await artifactResult("jvm-verifies", inputs, fresh, accept, "project", { env, enabled: false });
  assert.ok(Object.isFrozen(REUSE)); assert.equal(calls, 2);
  const logs: string[] = [];
  assert.deepEqual(await artifactResult("jvm-verifies", inputs, fresh, accept, "project", { env: { ...env, NTS_GATE_RUN_DIR: "second-run" }, enabled: true, log: line => logs.push(line) }), ok);
  assert.equal(calls, 2); assert.match(logs[0], /key=[a-f0-9]{64} source_run=.*first-run/);
  const rows = readdirSync(costs).filter(f => f.startsWith("reuse-")).map(f => JSON.parse(readFileSync(join(costs, f), "utf8")));
  assert.equal(rows.filter(r => r.status === "reused").length, 1);
  assert.equal(rows.find(r => r.matching_hit_cpu_s !== null)?.matching_hit_cpu_s, .75);
});

test("the default execution path follows the checked-in per-kind policy", async t => {
  const { env, inputs } = fixture(t); let calls = 0;
  const fresh = async () => { calls++; return { result: ok, cpu_s: .5 }; };
  const options = { env, log: () => {} };
  await artifactResult("jvm-verifies", inputs, fresh, accept, "project", options);
  await artifactResult("jvm-verifies", inputs, fresh, accept, "project", options);
  assert.equal(calls, REUSE["jvm-verifies"] ? 1 : 2);
});

test("corruption, incomplete payloads, signals and missing origins always execute fresh", async t => {
  const { env, inputs, cache } = fixture(t); let calls = 0;
  const fresh = async () => { calls++; return { result: ok, cpu_s: null }; };
  await artifactResult("jvm-verifies", inputs, fresh, accept, "project", { env });
  const path = entry(cache), original = JSON.parse(readFileSync(path, "utf8"));
  const mutants = [null, {}, { ...ok, stdout: "VERIFIED 0 OF 0\n" }, { ...ok, stdout: "INVALID A broken\n" }, { ...ok, signal: "SIGKILL" }, { ...ok, stderr: "warning from another path" }];
  for (const result of mutants) {
    writeFileSync(path, JSON.stringify({ ...original, result, result_sha256: createHash("sha256").update(canonicalJson(result)).digest("hex") }));
    await artifactResult("jvm-verifies", inputs, fresh, accept, "project", { env, enabled: true });
  }
  writeFileSync(path, JSON.stringify({ ...original, run: null }));
  await artifactResult("jvm-verifies", inputs, fresh, accept, "project", { env, enabled: true });
  writeFileSync(path, JSON.stringify({ ...original, result_sha256: "0".repeat(64) }));
  await artifactResult("jvm-verifies", inputs, fresh, accept, "project", { env, enabled: true });
  assert.equal(calls, 1 + mutants.length + 2);
});

test("input mutation at cache acceptance invalidates the hit", async t => {
  const { env, inputs, file } = fixture(t); let calls = 0;
  const fresh = async () => { calls++; return { result: ok, cpu_s: 0 }; };
  await artifactResult("jvm-verifies", inputs, fresh, accept, "project", { env });
  await artifactResult("jvm-verifies", inputs, fresh, (v): v is VerifierResult => { writeFileSync(file, "new class"); return accept(v); }, "project", { env, enabled: true });
  assert.equal(calls, 2);
});

test("cached verifier facts still expose INVALID findings for today's policy", async t => {
  const { env, inputs } = fixture(t);
  const invalid = { ...ok, stdout: "INVALID A VerifyError: wrong type\nVERIFIED 0 OF 1\n" };
  await artifactResult("jvm-verifies", inputs, async () => ({ result: invalid, cpu_s: .2 }), accept, "project", { env });
  const reused = await artifactResult("jvm-verifies", inputs, async () => { throw new Error("must reuse"); }, accept, "project", { env, enabled: true, log: () => {} });
  const findings = reused.stdout.split("\n").filter(line => line.startsWith("INVALID"));
  assert.equal(findings.length, 1, "reuse returns facts rather than a stored PASS verdict");
});

test("JDK identity follows release, modules and native VM bytes despite an unchanged launcher", t => {
  const { root } = fixture(t), home = join(root, "jdk"); mkdirSync(join(home, "lib/server"), { recursive: true });
  mkdirSync(join(home, "bin"));
  const launcher = join(home, "bin/java"); writeFileSync(launcher, '#!/bin/sh\nprintf "fake JDK version 1\\n"\n'); chmodSync(launcher, 0o755);
  writeFileSync(join(home, "release"), "release 1"); writeFileSync(join(home, "lib/modules"), "modules 1"); writeFileSync(join(home, "lib/server/libjvm.so"), "VM 1");
  let previous = jdkIdentity(home, {}), previousTool = toolIdentity(launcher);
  for (const name of ["release", "lib/modules", "lib/server/libjvm.so"]) {
    writeFileSync(join(home, name), "changed payload");
    const next = jdkIdentity(home, {}); assert.notDeepEqual(previous, next); previous = next;
    const nextTool = toolIdentity(launcher); assert.notDeepEqual(previousTool, nextTool); previousTool = nextTool;
  }
  assert.throws(() => jdkIdentity(join(root, "missing-jdk"), {}));
});

test("real JDK verification reuses complete output and measures only the verifier command", async t => {
  const { root, env } = fixture(t), out = join(root, "classes"); mkdirSync(out);
  const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin/java") : "/usr/bin/java";
  const javac = join(dirname(java), "javac"), driver = join(ROOT, "tooling/conformance/JvmVerify.java");
  const run = (cmd: string, args: string[]) => new Promise<any>((done, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }); let stdout = "", stderr = "";
    child.stdout.on("data", data => stdout += data); child.stderr.on("data", data => stderr += data);
    child.on("error", reject); child.on("close", (status, signal) => done({ status, signal, stdout, stderr }));
  });
  writeFileSync(join(root, "A.java"), 'public class A { static { if (true) throw new Error("must not initialize"); } public int value() { return 2; } }');
  const compiled = await run(javac, [...vmToolFlags(javac), "-d", out, join(root, "A.java")]); assert.equal(compiled.status, 0, compiled.stderr);
  const inputs = () => ({ files: [...artifactFiles(out), { name: "driver", path: driver }], values: { jdk: toolIdentity(java) } });
  let calls = 0, cpu: number | null = null;
  const fresh = async () => { calls++; const measured = await verifierExecution(run, java, [...vmToolFlags(java), "-Xverify:all", "-cp", out, driver, out], root); cpu = measured.cpu_s; return measured; };
  const first = await artifactResult("jvm-verifies", inputs, fresh, accept, "A", { env });
  assert.equal(first.stdout, "VERIFIED 1 OF 1\n"); assert.equal(first.stderr, ""); assert.ok(cpu !== null && cpu > 0);
  assert.deepEqual(await artifactResult("jvm-verifies", inputs, fresh, accept, "A", { env, enabled: true, log: () => {} }), first);
  assert.equal(calls, 1);
});

test("different lander environments produce identical emitted bytes, verifier facts and keys", async t => {
  const { root, env } = fixture(t);
  const bin = process.env.NTS_BIN ?? join(ROOT, "target/nts-dev/nts");
  const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin/java") : "/usr/bin/java";
  const driver = join(ROOT, "tooling/conformance/JvmVerify.java");
  const run = (command: string, args: string[], childEnv: NodeJS.ProcessEnv) => new Promise<any>((done, reject) => {
    const child = spawn(command, args, { cwd: ROOT, env: childEnv, stdio: ["ignore", "pipe", "pipe"] }); let stdout = "", stderr = "";
    child.stdout.on("data", data => stdout += data); child.stderr.on("data", data => stderr += data);
    child.on("error", reject); child.on("close", (status, signal) => done({ status, signal, stdout, stderr }));
  });
  const first = { ...process.env, LANG: "C.UTF-8" }; delete first.NODE_OPTIONS;
  const second = { ...process.env, LANG: "en_US.UTF-8", NODE_OPTIONS: "--max-old-space-size=8192 --disable-warning=ExperimentalWarning" };
  const records = [];
  for (const [i, parent] of [first, second].entries()) {
    const out = join(root, `out-${i}`);
    const emit = await run(bin, ["emit-jvm", "tests/programs/induction-boundary-near-start", "--out", out], parent);
    assert.equal(emit.status, 0, emit.stdout + emit.stderr);
    const files = artifactFiles(out); assert.ok(files.some(file => file.name.endsWith(".class")));
    const canonical = verifierEnvironment(java, parent);
    assert.deepEqual(Object.keys(canonical).sort(), ["JAVA_HOME", "LANG", "PATH"]);
    assert.equal(canonical.LANG, "C.UTF-8");
    const flags = [...vmToolFlags(java), "-Xverify:all"], args = ["-Xverify:all", "-cp", `${out}:${join(out, "nts-runtime.jar")}`, driver, out];
    const before = await run(java, [...vmToolFlags(java), ...args], parent), after = await run(java, [...vmToolFlags(java), ...args], canonical);
    assert.equal(after.status, 0, after.stderr); assert.equal(after.stderr, "");
    assert.deepEqual(after, before, "canonicalization must preserve the real verifier's verdict lines");
    // Separate lander processes matter: computing both keys in this process
    // would fail to detect a helper accidentally reading process.env.
    const probe = `
      import { artifactFiles, artifactShadow, toolIdentity } from ${JSON.stringify(new URL("./artifact-shadow.ts", import.meta.url).href)};
      import { verifierEnvironment } from ${JSON.stringify(new URL("./artifact-reuse.ts", import.meta.url).href)};
      const [java, out, driver, metadata] = process.argv.slice(1);
      const canonical = verifierEnvironment(java);
      const key = artifactShadow("jvm-verifies", () => ({ files: [...artifactFiles(out), { name: "driver", path: driver }],
        values: { flags: ${JSON.stringify(flags)}, tool: toolIdentity(java, canonical) } }), JSON.parse(metadata)).key;
      console.log(JSON.stringify({ key, canonical }));
    `;
    const measuredKey = await run(process.execPath, ["--input-type=module", "-e", probe, java, out, driver, JSON.stringify(env)], parent);
    assert.equal(measuredKey.status, 0, measuredKey.stderr);
    const { key, canonical: keyedEnvironment } = JSON.parse(measuredKey.stdout);
    assert.deepEqual(keyedEnvironment, canonical);
    assert.ok(key);
    records.push({ key, bytes: files.map(file => [file.name, fileDigest(file.path)]), verdict: after, canonical });
    // VM and dynamic-loader injection in a lander's shell must never reach
    // the verifier or its version/identity probe.
    const injected = verifierEnvironment(java, { ...parent, JAVA_TOOL_OPTIONS: "-not-a-jvm-option", LD_PRELOAD: "/missing/injected.so" });
    assert.deepEqual(injected, canonical);
    assert.deepEqual(toolIdentity(java, injected), toolIdentity(java, canonical));
  }
  assert.deepEqual(records[0], records[1]);
});
