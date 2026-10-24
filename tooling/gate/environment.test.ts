import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { gateCapabilities, gateEnvironmentError, GATE_ENVIRONMENT, missingEnvironment, systemdEnvironment } from "./environment.ts";

const roots: string[] = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "gate-environment-"));
  roots.push(root);
  mkdirSync(join(root, "tooling/gate"), { recursive: true });
  mkdirSync(join(root, "tests/interop"), { recursive: true });
  writeFileSync(join(root, "tooling/gate/run.mjs"), `if (process.argv[2] !== "--capabilities") process.exit(1);
process.stdout.write(JSON.stringify({format: [], dex: ["android", "jvm"], jvm: ["jvm"], interop: []}));\n`);
  return root;
}

function project(root: string, name: string, capability: string): void {
  const directory = join(root, "tests/interop", name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "build.sh"), `#!/bin/sh\n# nts-gate-capabilities: ${capability}\nexit 0\n`);
}

test("only owed capabilities require environment, and empty values are missing", () => {
  const root = fixture();
  assert.equal(gateEnvironmentError(root, ["format"], null, {}), null);
  const error = gateEnvironmentError(root, ["dex"], null, { ANDROID_HOME: "", JAVA_HOME: " " });
  assert.match(error!, /ANDROID_HOME is missing; required by step dex/);
  assert.match(error!, /JAVA_HOME is missing; required by step dex/);
  assert.match(error!, /node tooling\/lanes\/land-unit.ts/);
  assert.equal(gateEnvironmentError(root, ["dex"], null, { ANDROID_HOME: "/sdk", JAVA_HOME: "/jdk" }), null);
});

test("a newly declared Valgrind project needs no central project-name entry", () => {
  const root = fixture();
  project(root, "new-leak-check", "valgrind");
  project(root, "plain-build", "");
  assert.equal(gateEnvironmentError(root, ["interop"], "plain-build", {}), null);
  assert.equal(gateEnvironmentError(root, ["format"], null, {}), null);
  for (const selected of [null, "new-leak-check"]) {
    const error = gateEnvironmentError(root, ["interop"], selected, {});
    assert.match(error!, /DEBUGINFOD_URLS is missing; required by step interop \(project new-leak-check\)/);
    assert.equal(gateEnvironmentError(root, ["interop"], selected, { DEBUGINFOD_URLS: "https://symbols.example" }), null);
  }
});

test("the train union and full gate keep requirements absent from one member", () => {
  const root = fixture();
  assert.equal(gateEnvironmentError(root, ["format"], null, {}), null);
  for (const steps of [["format", "jvm"], "all"] as const) {
    assert.match(gateEnvironmentError(root, steps, null, {})!, /JAVA_HOME is missing/);
  }
});

test("undeclared steps and misspelled capabilities cannot evade preflight", () => {
  const root = fixture();
  assert.throws(() => gateCapabilities(root, ["unknown"]), /no gate capability declaration for step unknown/);
  project(root, "typo", "valgrindd");
  assert.throws(() => gateEnvironmentError(root, ["interop"], null, {}), /project typo.*unknown environment capability valgrindd/);
});

test("the launcher forwards the one descriptor literally, without arbitrary variables", () => {
  const env = Object.fromEntries(GATE_ENVIRONMENT.map(({ name }) => [name, `${name} with spaces $literal=ok`]));
  env.UNRELATED_SECRET = "must not be forwarded";
  assert.deepEqual(systemdEnvironment(env), GATE_ENVIRONMENT.map(({ name }) => `--setenv=${name}=${env[name]}`));
  assert.deepEqual(systemdEnvironment({ JAVA_HOME: "", DEBUGINFOD_URLS: "https://symbols" }), ["--setenv=DEBUGINFOD_URLS=https://symbols"]);
});

test("step and project declarations cover the actual JVM, Android and Valgrind consumers", () => {
  const root = new URL("../../", import.meta.url).pathname;
  const sites = gateCapabilities(root, ["jvm", "test262-jvm", "jvm-verifies", "dex", "on-device", "interop"], "native-string java-from-ts");
  for (const step of ["jvm", "test262-jvm", "jvm-verifies"]) {
    assert.ok(sites.some(site => site.step === step && site.capabilities.includes("jvm")));
  }
  for (const step of ["dex", "on-device"]) {
    assert.ok(sites.some(site => site.step === step && site.capabilities.includes("android")));
  }
  assert.ok(sites.some(site => site.project === "native-string" && site.capabilities.includes("valgrind")));
  assert.ok(sites.some(site => site.project === "java-from-ts" && site.capabilities.includes("jvm")));
  assert.ok(readFileSync(join(root, "tests/interop/native-string/build.sh"), "utf8").includes("valgrind"));
});
