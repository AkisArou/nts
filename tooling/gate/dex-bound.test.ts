import {fixtureEnvironment} from "./test-environment.ts";
// The dex step's compile is bounded per target (tooling/android/dexes.sh, under
// tooling/gate/case-bound.ts), and a bench case's timeout or decline is judged
// against its compile record (results/benchmarks/jvm/outcomes.tsv): as recorded
// or pending passes, a better row is red, and an example's timeout or decline
// is red. On 2026-11-07 one benchmark port compiled for 4.6 hours here, and
// four new ports' declines turned the step red before their rows were written.
//
//   node --test tooling/gate/dex-bound.test.ts
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { testScratch } from "./test-scratch.ts";
import { written, type DexOutcome } from "../android/dex-record.ts";
import { spawnTest } from "./test-wait.ts";
import { copyModuleClosure } from "./module-closure-fixture.ts";

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
  copyModuleClosure(["tooling/gate/case-bound.ts", "tooling/bench/compile-outcome.ts", "tooling/android/dex-record.ts"], root);
  // What the record's parser imports, as it is.
  for (const path of ["tooling/bench/outcomes.ts", "tooling/records", "tooling/census", "tooling/conformance"]) {
    if (!existsSync(join(root, path))) symlinkSync(join(ROOT, path), join(root, path));
  }
  writeFileSync(join(root, "tooling/gate/token.sh"), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
  // d8 refuses what a `*-refused` target emits and accepts the rest; javap
  // names one method of each class.
  writeFileSync(join(own, "sdk/build-tools/99.0.0/d8"), "#!/bin/sh\ncase \"$*\" in *-refused*) printf 'Error in x.class:\\ncom.android.tools.r8.internal.fx: Illegal class file: fake\\n'; exit 1 ;; esac\nexit 0\n", { mode: 0o755 });
  writeFileSync(join(own, "bin/javap"), "#!/bin/sh\necho '  public static void main(java.lang.String[]);'\n", { mode: 0o755 });
  const digest = (n: string) => n.repeat(64);
  writeFileSync(join(root, "results/benchmarks/jvm/outcomes.tsv"),
    `# nts-benchmark-outcomes {"version":1,"backend":"jvm","commit":"${"a".repeat(40)}","compiler":"${"b".repeat(16)}","harness":"${"c".repeat(16)}","under":"benchmarks/cases","scopes":["compile"]}\n` +
    Object.entries({ "other-case": { kind: "pass" }, ...recorded }).sort(([a], [b]) => a.localeCompare(b))
      .map(([name, outcome]) => `benchmarks/cases/${name}\t${JSON.stringify({ scope: "compile", source: digest("1"), driver: digest("2"), outcome })}\n`).join(""));
  const nts = join(own, "bin/nts");
  writeFileSync(nts, '#!/bin/sh\ncase "$2" in *-spin*) while :; do :; done ;; *-dexes*|*-refused*) mkdir -p "$4/nts/gen" && echo class > "$4/nts/gen/Program.class" && exit 0 ;; esac\necho "error: the backend declines this program" >&2\nexit 1\n', { mode: 0o755 });
  // The owner receives a fixed compile-timeout observation; normal targets retain live tool wiring.
  const preload = join(own, "compile-bound.mjs"), active = pathToFileURL(join(root, "tooling/gate/active-command.ts")).href;
  writeFileSync(preload, `import {mock} from 'node:test';import {scriptedCommand,commandSample} from ${JSON.stringify(new URL('./command-observations-fixture.ts',import.meta.url).href)};
const real=await import(${JSON.stringify(active)});mock.module(${JSON.stringify(active)},{namedExports:{...real,activeCommand:(command,args,options)=>
 args.some(arg=>String(arg).includes('-spin'))&&options.ownCpuSeconds?Promise.resolve(scriptedCommand(command,{...options,ownCpuSeconds:0.5},[commandSample(500,{own:50})])):real.activeCommand(command,args,options)}});\n`);
  writeFileSync(join(own, "bin/node"), `#!/bin/sh\nexec '${process.execPath}' --no-warnings --experimental-test-module-mocks --import '${preload}' "$@"\n`, { mode: 0o755 });
  const frame = join(own, "result.json");
  const run = (targets: string[], named: boolean, extra: NodeJS.ProcessEnv = {}) => {
    for (const target of targets) {
      if (target.startsWith("benchmarks/")) mkdirSync(join(root, target), { recursive: true });
      else { mkdirSync(join(root, "tests/programs", target), { recursive: true }); writeFileSync(join(root, "tests/programs", target, "tsconfig.json"), "{}"); }
    }
    return spawnTest("sh", [join(root, "tooling/android/dexes.sh"), ...(named ? targets.map(target => target.split("/").pop()!) : [])], { cwd: root, encoding: "utf8", env: {
      ...fixtureEnvironment(t), PATH: `${join(own, "bin")}:${process.env.PATH}`, NTS_BIN: nts, ANDROID_HOME: join(own, "sdk"), NTS_GATE_JOBS: "1",
      NTS_ART_WORK: join(own, "work"), NTS_GATE_STEP: "dex", NTS_GATE_STEP_ATTEMPT: "bound", NTS_GATE_STEP_RESULT: frame, ...extra,
    } });
  };
  // Named targets, as the step is run by hand; and the full run the gate makes,
  // over every target the tree has, where a decline fails the step. Nothing is
  // dexed here, so the method floor is 0.
  const dex = (...targets: string[]) => run(targets, true);
  const full = (...targets: string[]) => run(targets, false, { NTS_DEX_METHOD_FLOOR: "0" });
  const dexRecord = (rows: Record<string, DexOutcome>) => {
    mkdirSync(join(root, "results/dex"), { recursive: true });
    writeFileSync(join(root, "results/dex/outcomes.tsv"), written(null, Object.entries(rows).map(([path, outcome]) => ({ path, value: { outcome } }))));
  };
  return { dex, full, frame, dexRecord };
}

test("a bench case's timeout its compile record holds reproduces: named, counted, not red, and the next target runs", t => {
  const { dex, frame } = sandbox(t, { "a-spin": { kind: "timeout", stage: "compile" } });
  const result = dex("benchmarks/cases/a-spin", "benchmarks/cases/b-declines");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^a-spin +emit-jvm timed out, as its compile record says: .*used its 0\.5 s CPU bound/m);
  assert.match(result.stdout, /^b-declines +the backend declined it, pending: benchmarks\/cases\/b-declines is not recorded in results\/benchmarks\/jvm\/outcomes\.tsv yet: error: the backend declines this program$/m, "the next target ran");
  assert.match(result.stdout, /^0 dexed, 0 refused, 0 declined by the backend, 0 timed out compiling$/m);
  assert.match(result.stdout, /^1 declined or timed out as their compile record says, 1 pending their compile record$/m);
  assert.equal(existsSync(frame), false, "a timeout is the target's outcome: nothing holds the step");
});

test("a bench case with no compile row yet: its timeout is pending, named and counted, not red", t => {
  const { dex } = sandbox(t, {});
  const result = dex("benchmarks/cases/new-spin");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^new-spin +emit-jvm timed out, pending: benchmarks\/cases\/new-spin is not recorded in results\/benchmarks\/jvm\/outcomes\.tsv yet: /m);
  assert.match(result.stdout, /^0 declined or timed out as their compile record says, 1 pending their compile record$/m);
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

test("a full run: a bench case's decline its compile record holds, or one with no row yet, is named and counted, not red", t => {
  const { full } = sandbox(t, { "held-declines": { kind: "refused", diagnostic: "<path> NTS1001 a shape this lowering does not take" } });
  const result = full("benchmarks/cases/held-declines", "benchmarks/cases/new-declines");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^held-declines +the backend declined it, as its compile record says \(refused\): error: the backend declines this program$/m);
  assert.match(result.stdout, /^new-declines +the backend declined it, pending: benchmarks\/cases\/new-declines is not recorded in results\/benchmarks\/jvm\/outcomes\.tsv yet: error: the backend declines this program$/m);
  assert.match(result.stdout, /^0 dexed, 0 refused, 0 declined by the backend, 0 timed out compiling$/m);
  assert.match(result.stdout, /^1 declined or timed out as their compile record says, 1 pending their compile record$/m);
});

test("a full run: a bench case declined where its compile record says pass got worse, and an example's decline is red", t => {
  for (const [target, line] of [["benchmarks/cases/was-passing", /^was-passing +the backend declined it, where the record says pass: error: the backend declines this program$/m],
    ["example-declines", /^example-declines +the backend declined it: error: the backend declines this program$/m]] as const) {
    const { full } = sandbox(t, { "was-passing": { kind: "pass" } });
    const result = full(target);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, line);
    assert.match(result.stdout, /^0 dexed, 0 refused, 1 declined by the backend, 0 timed out compiling$/m);
    assert.match(result.stderr, /^1 target\(s\) were declined by the backend, where 0 is expected$/m);
  }
});

test("d8's verdict is judged against the dex record: a new target is pending, a recorded refusal holds, a new refusal is red", t => {
  const { full, dexRecord } = sandbox(t, {});
  const fake: DexOutcome = { kind: "build-failure", diagnostic: "Illegal class file: fake" };
  dexRecord({ "tests/programs/held-refused": fake, "tests/programs/was-dexing-refused": { kind: "pass" } });
  const result = full("new-dexes", "held-refused", "was-dexing-refused");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^pending: tests\/programs\/new-dexes is not recorded in results\/dex\/outcomes\.tsv yet: d8 accepts it$/m);
  assert.match(result.stdout, /^tests\/programs\/held-refused: d8 refuses it: Illegal class file: fake, as its dex record says$/m);
  assert.match(result.stdout, /^tests\/programs\/was-dexing-refused: REGRESSED: d8 refuses it: Illegal class file: fake, where its dex record says: d8 accepts it$/m);
  assert.match(result.stderr, /^1 target\(s\) worse than the dex record/m);
  // Without the regression the same run is green: the held refusal and the pending target pass.
  dexRecord({ "tests/programs/held-refused": fake, "tests/programs/was-dexing-refused": fake });
  assert.equal(full().status, 0);
});
