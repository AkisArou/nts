import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { unsharedLaunches } from "../jvm/launcher-audit.ts";

test("direct launch mutations in all four languages fail the audit", () => {
  for (const [path, source] of [
    ["new.sh", "java -Xverify:all Main"],
    ["new.ts", 'spawnSync("javac", ["Main.java"])'],
    ["new.mjs", 'spawn(java, ["Main"])'],
    ["new.rs", 'std::process::Command::new("java").arg("Main").output();'],
    ["wrapped.rs", 'Command::new("prlimit").arg(java).args(["Main"]).output();'],
    ["alias.ts", 'const executable = "/jdk/bin/java"; spawnSync(executable, ["Main"]);'],
    ["alias.rs", 'let executable = tool("java"); Command::new(executable).arg("Main");'],
  ]) assert.equal(unsharedLaunches(path, source).length, 1, path);
});

test("shared flags survive continuations, substitutions and resource wrappers", () => {
  const shell = 'flags_file="$root/runtime/jvm/test-vm-flags.txt"\nflags=$(cat "$flags_file")\nanswer=$(java $flags \\\n-Xverify:all Main)';
  assert.deepEqual(unsharedLaunches("ok.sh", shell), []);
  assert.deepEqual(unsharedLaunches("ok.ts", 'spawnSync("java", [...vmToolFlags("java"), "Main"])'), []);
  assert.deepEqual(unsharedLaunches("ok.rs", 'Command::new("prlimit").arg(java).args(toolchain::vm_flags()).output();'), []);
  assert.deepEqual(unsharedLaunches("ok.rs", 'toolchain::command("java").arg("Main");'), []);
});

test("comments, embedded source and executable lookups are not launches", () => {
  assert.deepEqual(unsharedLaunches("example.rs", '// Command::new("java");\nlet source = r#"Command::new("java");"#;'), []);
  assert.deepEqual(unsharedLaunches("example.ts", '// spawn("java", []);\nconst code = `spawn("java", [])`;'), []);
  assert.deepEqual(unsharedLaunches("example.sh", '# java Main\ncommand -v java\ncat <<\'JAVA\'\njava Main\nJAVA\n'), []);
  assert.deepEqual(unsharedLaunches("example.sh", 'awfy=$root/benchmarks/Java\nref="(javac)"'), []);
});

test("removing flags from the real follow-up launchers is detected", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  for (const path of ["tests/interop/ts-from-java/build.sh", "tests/interop/java-from-ts/build.sh", "tests/interop/android-shape/build.sh", "benchmarks/interop-copy/run.sh", "benchmarks/interop-facade/run.sh", "runtime/ecmascript/tools/icu.ts"]) {
    const source = readFileSync(resolve(root, path), "utf8");
    assert.deepEqual(unsharedLaunches(path, source), [], path);
    const mutant = source.replace(/\$nts_(?:jvm|jdk)_flags\s+/g, "").replace(/\.\.\.vmToolFlags\("(?:java|javac|jar)"\),\s*/g, "");
    assert.ok(unsharedLaunches(path, mutant).length > 0, `${path}: removing the shared arguments must fail`);
  }
});

test("tracked JVM launchers use the shared flag policy", t => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const paths = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(path => /\.(sh|ts|mjs|rs)$/.test(path));
  assert.ok(paths.length > 0, "a launcher audit over no tracked files is not a verdict");
  // Bootstrap's user-facing JDK discovery precedes build/test setup. Its version
  // output is diagnostic, never compared program output. Each exception is exact
  // and must remain live, so a removed probe cannot leave a blanket permission.
  const exceptions = new Map([
    ["tooling/bootstrap/bootstrap.sh:java -version 2>", "user-facing JDK version discovery"],
    ["tooling/bootstrap/bootstrap.sh:java -XshowSettings:properties -version 2>", "user-facing JAVA_HOME discovery"],
  ]);
  const failures: string[] = [];
  for (const path of paths) {
    for (const launch of unsharedLaunches(path, readFileSync(resolve(root, path), "utf8"))) {
      const key = `${path}:${launch.code}`;
      if (exceptions.delete(key)) continue;
      failures.push(`${path}:${launch.line}: ${launch.tool}: ${launch.code}`);
    }
  }
  assert.deepEqual(failures, []);
  assert.deepEqual([...exceptions.keys()], [], "remove stale launcher exceptions");
  t.diagnostic(`${paths.length} tracked launcher files checked; 2 exact bootstrap discovery exceptions; no unshared direct JVM launch`);
});
