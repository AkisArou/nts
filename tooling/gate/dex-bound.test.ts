// The dex step's compile is bounded per target (tooling/android/dexes.sh, under
// tooling/gate/case-bound.ts), and a bench case's timeout is judged against its
// compile record (results/benchmarks/jvm/outcomes.tsv): as recorded or pending
// passes, a better row is red, and an example's timeout is red. On 2026-11-07
// one benchmark port compiled for 4.6 hours here.
//
//   node --test tooling/gate/dex-bound.test.ts
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { testScratch } from "./test-scratch.ts";
import { spawnTest } from "./test-wait.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** A scratch tree whose compiler spins on every target named `*-spin` and declines the rest. */
function sandbox(t: TestContext, recorded: Record<string, object>) {
  const own = testScratch(t, "dex-bound"), root = join(own, "repo");
  for (const dir of ["tooling/android", "tooling/gate", "tooling/bench", "runtime/jvm", "results/benchmarks/jvm"]) mkdirSync(join(root, dir), { recursive: true });
  for (const dir of ["bin", "sdk/build-tools/99.0.0"]) mkdirSync(join(own, dir), { recursive: true });
  copyFileSync(join(ROOT, "tooling/android/dexes.sh"), join(root, "tooling/android/dexes.sh"));
  copyFileSync(join(ROOT, "runtime/jvm/test-vm-flags.txt"), join(root, "runtime/jvm/test-vm-flags.txt"));
  // Copies, not links: a tool's main-module guard compares its own path, and
  // compile-outcome.ts reads the record of the tree it sits in.
  for (const path of ["tooling/gate/case-bound.ts", "tooling/gate/active-command.ts", "tooling/gate/step-result.ts", "tooling/bench/compile-outcome.ts"]) {
    copyFileSync(join(ROOT, path), join(root, path));
  }
  // What the record's parser imports, as it is.
  for (const path of ["tooling/bench/outcomes.ts", "tooling/records", "tooling/census", "tooling/conformance"]) {
    if (!existsSync(join(root, path))) symlinkSync(join(ROOT, path), join(root, path));
  }
  writeFileSync(join(root, "tooling/gate/token.sh"), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
  writeFileSync(join(own, "sdk/build-tools/99.0.0/d8"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const digest = (n: string) => n.repeat(64);
  writeFileSync(join(root, "results/benchmarks/jvm/outcomes.tsv"),
    `# nts-benchmark-outcomes {"version":1,"backend":"jvm","commit":"${"a".repeat(40)}","compiler":"${"b".repeat(16)}","harness":"${"c".repeat(16)}","under":"benchmarks/cases","scopes":["compile"]}\n` +
    Object.entries({ "other-case": { kind: "pass" }, ...recorded }).sort(([a], [b]) => a.localeCompare(b))
      .map(([name, outcome]) => `benchmarks/cases/${name}\t${JSON.stringify({ scope: "compile", source: digest("1"), driver: digest("2"), outcome })}\n`).join(""));
  const nts = join(own, "bin/nts");
  writeFileSync(nts, '#!/bin/sh\ncase "$2" in *-spin*) while :; do :; done ;; esac\necho "error: the backend declines this program" >&2\nexit 1\n', { mode: 0o755 });
  // The real supervisor, with the compile bound it was asked for made small.
  const preload = join(own, "compile-bound.mjs"), active = pathToFileURL(join(root, "tooling/gate/active-command.ts")).href;
  writeFileSync(preload, `import {mock} from 'node:test';const real=await import(${JSON.stringify(active)});mock.module(${JSON.stringify(active)},{namedExports:{...real,activeCommand:(command,args,options)=>real.activeCommand(command,args,{...options,...(options.ownCpuSeconds?{ownCpuSeconds:0.5}:{}),pollMs:50})}});\n`);
  writeFileSync(join(own, "bin/node"), `#!/bin/sh\nexec '${process.execPath}' --no-warnings --experimental-test-module-mocks --import '${preload}' "$@"\n`, { mode: 0o755 });
  const frame = join(own, "result.json");
  const dex = (...targets: string[]) => {
    for (const target of targets) {
      if (target.startsWith("benchmarks/")) mkdirSync(join(root, target), { recursive: true });
      else { mkdirSync(join(root, "tests/programs", target), { recursive: true }); writeFileSync(join(root, "tests/programs", target, "tsconfig.json"), "{}"); }
    }
    return spawnTest("sh", [join(root, "tooling/android/dexes.sh"), ...targets.map(target => target.split("/").pop()!)], { cwd: root, encoding: "utf8", env: {
      ...process.env, PATH: `${join(own, "bin")}:${process.env.PATH}`, NTS_BIN: nts, ANDROID_HOME: join(own, "sdk"), NTS_GATE_JOBS: "1",
      NTS_ART_WORK: join(own, "work"), NTS_GATE_STEP: "dex", NTS_GATE_STEP_ATTEMPT: "bound", NTS_GATE_STEP_RESULT: frame,
    } });
  };
  return { dex, frame };
}

test("a bench case's timeout its compile record holds reproduces: named, counted, not red, and the next target runs", t => {
  const { dex, frame } = sandbox(t, { "a-spin": { kind: "timeout", stage: "compile" } });
  const result = dex("benchmarks/cases/a-spin", "benchmarks/cases/b-declines");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^a-spin +emit-jvm timed out, as its compile record says: .*used its 0\.5 s CPU bound/m);
  assert.match(result.stdout, /^b-declines +the backend declined it: error: the backend declines this program$/m, "the next target ran");
  assert.match(result.stdout, /^0 dexed, 0 refused, 1 declined by the backend, 0 timed out compiling$/m);
  assert.match(result.stdout, /^1 timed out as their compile record says, 0 pending their compile record$/m);
  assert.equal(existsSync(frame), false, "a timeout is the target's outcome: nothing holds the step");
});

test("a bench case with no compile row yet: its timeout is pending, named and counted, not red", t => {
  const { dex } = sandbox(t, {});
  const result = dex("benchmarks/cases/new-spin");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^new-spin +emit-jvm timed out, pending: benchmarks\/cases\/new-spin is not recorded in results\/benchmarks\/jvm\/outcomes\.tsv yet: /m);
  assert.match(result.stdout, /^0 timed out as their compile record says, 1 pending their compile record$/m);
});

test("a bench case whose compile row is better than a timeout got worse: red", t => {
  const { dex } = sandbox(t, { "was-spin": { kind: "pass" } });
  const result = dex("benchmarks/cases/was-spin");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^was-spin +emit-jvm timed out, where the record says pass: /m);
  assert.match(result.stdout, /^0 dexed, 0 refused, 0 declined by the backend, 1 timed out compiling$/m);
  assert.match(result.stderr, /1 target\(s\) timed out compiling, each named above/);
});

test("an example has no compile record: its timeout is red", t => {
  const { dex } = sandbox(t, {});
  const result = dex("example-spin");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^example-spin +emit-jvm timed out: .*used its 0\.5 s CPU bound/m);
  assert.match(result.stdout, /^0 dexed, 0 refused, 0 declined by the backend, 1 timed out compiling$/m);
});
