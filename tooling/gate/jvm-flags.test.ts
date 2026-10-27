import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { VM_FLAGS, vmToolFlags } from "../jvm/vm-flags.ts";
import { FLAGS } from "../jvm/launch.ts";
test("every JVM launcher shares the no-perfdata policy", () => {
  assert.ok(VM_FLAGS.includes("-XX:-UsePerfData"));
  assert.ok(FLAGS.includes("-XX:-UsePerfData"));
  assert.deepEqual(vmToolFlags("/jdk/bin/java"), ["-XX:-UsePerfData"]);
  for (const tool of ["javac", "javap", "jar", "jmod"]) {
    assert.deepEqual(vmToolFlags(`/jdk/bin/${tool}`), ["-J-XX:-UsePerfData"]);
  }
  for (const tool of ["d8", "r8", "apksigner"]) {
    assert.deepEqual(vmToolFlags(`/sdk/${tool}`), ["-JXX:-UsePerfData"]);
  }
  assert.deepEqual(vmToolFlags("clang"), []);
});

test("installed JVM tool launchers accept the shared flags", () => {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  assert.ok(sdk, "the tooling gate requires its declared Android SDK capability");
  const versions = readdirSync(join(sdk, "build-tools")).sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
  const tools = versions.map(version => join(sdk, "build-tools", version)).find(dir => existsSync(join(dir, "d8")) && existsSync(join(dir, "apksigner")));
  assert.ok(tools, "the tooling gate requires complete Android build tools");
  for (const name of ["java", "javac", "javap", "jar", "keytool", "d8", "apksigner"]) {
    const tool = ["d8", "apksigner"].includes(name) ? join(tools, name) : process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin", name) : name;
    const version = name === "java" || name === "javac" || name === "javap" ? "-version" : name === "keytool" ? "-help" : "--version";
    const result = spawnSync(tool, [...vmToolFlags(tool), version], { encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 0, `${name}: ${result.error?.message ?? result.stdout + result.stderr}`);
  }
});
