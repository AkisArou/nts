// What owed.mjs maps a changed path to, on this tree:
//
//   node --test tooling/gate/owed.test.mjs
//
// Each case is a path whose reach is known, and the steps it must owe (and,
// where it matters, must not): a mapping that loses one owes too little
// silently, which is the failure owed.mjs exists to prevent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { allSteps, changedPaths, gateSteps, interopBuiltWith, interopOwed, isStrictPath, owed, parseNameStatus, targetFiles, WIDE } from "./owed.mjs";

const stepsFor = (...paths) => gateSteps(owed(paths.map((path) => ({ path, added: false }))));
const changeOwes = (changes) => gateSteps(owed(changes));
/** What a landing runs when it owes the full gate: every step but the wide ones. */
const landing = () => allSteps().filter((s) => !WIDE.has(s));
/**
 * What the rules reach, the wide steps included: a landing runs the core of it
 * and the full run the rest, so a claim of reach is a claim about the rules.
 */
const reachOf = (rules) => {
  const named = rules.some((r) => r.full) ? allSteps() : rules.flatMap((r) => r.steps);
  return [...new Set([...gateSteps(rules), ...named.filter((s) => WIDE.has(s))])];
};
const reach = (...paths) => reachOf(owed(paths.map((path) => ({ path, added: false }))));
const changeReach = (changes) => reachOf(owed(changes));
const superset = (got, want, what) => {
  for (const s of want) assert.ok(got.includes(s), `${what} should owe ${s}; owes ${got.join(" ")}`);
};
const full = () => stepsFor("no/rule/matches/this.txt");

test("a failed Cargo metadata prerequisite is named instead of losing crate reach", t => {
  const directory = mkdtempSync(join(tmpdir(), "owed-cargo-failure-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = join(directory, "bin");
  mkdirSync(bin);
  const cargo = join(bin, "cargo");
  writeFileSync(cargo, "#!/bin/sh\nprintf '%s\\n' 'metadata prerequisite control: offline input unavailable' >&2\nexit 73\n");
  chmodSync(cargo, 0o755);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./owed.mjs", import.meta.url)), "--self-test"], {
    encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /cargo metadata --format-version 1 --no-deps --offline/);
  assert.match(result.stderr, /metadata prerequisite control: offline input unavailable/);
  assert.doesNotMatch(result.stdout, /the LLVM backend's steps|the gate steps owed/);
});

test("an earlier data path cannot erase a source script's wide obligations", () => {
  const source = "tooling/conformance/integrity.ts";
  const data = "results/test262/c/language.tsv";
  const wide = stepsFor(source).filter(step => WIDE.has(step));
  assert.ok(wide.includes("integrity-runtime"));
  for (const paths of [[data, source], [source, data]]) {
    superset(stepsFor(...paths), wide, paths.join(" then "));
  }
});

test("JSON providers have explicit reach without an unmatched-path full gate", () => {
  const json = ["runtime/ecmascript/src/json/json.ts", "runtime/ecmascript/src/json/parse.ts", "runtime/ecmascript/src/json/plain.ts", "runtime/ecmascript/src/json/stringify.ts", "runtime/ecmascript/src/json/text.ts", "runtime/ecmascript/src/json/value.ts"];
  for (const path of [...json, "tooling/conformance/provider-family-paths.test.ts"]) {
    for (const added of [false, true]) {
      const rules = owed([{ path, added }]);
      assert.ok(!rules.some(rule => rule.full), `${path} should have a precise rule`);
      superset(gateSteps(rules), ["tooling", "types"], path);
      for (const step of ["interop", "test262", "test262-cases", "test262-jvm"]) {
        assert.ok(!gateSteps(rules).includes(step), `${path} does not reach ${step}`);
      }
    }
  }
  for (const path of json) {
    superset(stepsFor(path), ["examples", "llvm", "llvm-rc", "jvm", "rc", "benches"], path);
    superset(reach(path), ["definitions", "integrity-runtime", "profile", "c-compiles", "addons", "bench-agree"], path);
    assert.ok(owed([{ path, added: false }]).flatMap(rule => rule.arms).some(arm => arm.kind === "answers" && arm.run === "sh tooling/conformance/web-platform/check.sh"), path);
  }
  assert.ok(owed([{path:"runtime/ecmascript/unplaced-provider.ts",added:true}]).some(rule=>rule.full));
  assert.ok(owed([{path:"tooling/conformance/unplaced-provider-guard.ts",added:true}]).some(rule=>rule.full));
});

test("the native counter control owes tooling without an unmatched-path full gate", () => {
  const rules = owed([{ path: "tooling/gate/fixtures/counter-thread.c", added: true }]);
  assert.ok(!rules.some(rule => rule.full));
  superset(gateSteps(rules), ["tooling"], "the counter control");
  assert.ok(!gateSteps(rules).includes("interop"));
});

test("the resident worker fixture owes its kernel controls without an unplaced instrument full gate", () => {
  const rules = owed([{ path: "tooling/census/fixtures/resident-worker.ts", added: false }]);
  assert.ok(!rules.some(rule => rule.full));
  assert.ok(rules.some(rule => rule.name === "the resident worker control fixture"));
  superset(gateSteps(rules), ["tooling"], "the resident allocation control");
  for (const step of ["interop", "test262", "test262-cases", "test262-jvm", "test262-llvm"]) {
    assert.ok(!gateSteps(rules).includes(step), `the synthetic fixture does not run in ${step}`);
  }
  // Naming the one control does not narrow production workers or unknown tools.
  for (const path of ["tooling/census/worker-memory.ts", "tooling/census/worker-pool.ts"]) {
    superset(stepsFor(path), ["tooling", "test262-cases", "test262-jvm", "test262-llvm"], path);
  }
  superset(stepsFor("tooling/census/attempt262-worker.ts"), ["test262-cases", "test262-jvm", "test262-llvm"], "the production compiler worker");
  assert.ok(owed([{ path: "tooling/census/fixtures/unknown-worker.ts", added: true }]).some(rule => rule.full));
});

test("the standalone ICU driver has an explicit validation obligation", () => {
  const rules = owed([{path:"runtime/ecmascript/tools/icu.ts",added:false}]);
  assert.ok(!rules.some(r => r.full));
  superset(gateSteps(rules), ["tooling", "licenses"], "the standalone ICU validator");
  const driver = rules.find(r => r.name === "the standalone ICU validation driver");
  assert.ok(driver?.arms.some(a => a.run.includes("icu.ts --string-case")));
});

test("verdict machinery and every verifier entry point stay strict", () => {
  for (const path of ["tooling/gate/run.mjs", "tooling/lanes/land.ts", "tooling/lanes/verify.ts", "tooling/lanes/verify-unit.ts", "tooling/lanes/gate-resource.ts", "tooling/lanes/verification-ledger.ts",
    "tooling/lanes/revert.ts", "tooling/lanes/notify.ts", "tooling/conformance/outcomes-check.ts", "tooling/census/worker-memory.ts",
    "tooling/differential/agree.mjs", "tooling/memory/run.sh", "results/test262/c/language.tsv"]) assert.ok(isStrictPath(path), path);
  for (const path of ["compiler/core/src/hir/lower.rs", "runtime/c/nts_runtime.c", "docs/architecture.md"]) assert.equal(isStrictPath(path), false, path);
});

test("tool-written result outputs owe tree checks while recorded baselines retain their readers", () => {
  const tree = new Set(["rustfmt","format","reformat","records","old-paths","primitives","config","licenses","audit"]);
  for (const path of ["results/benchmarks/cells.tsv","results/typed-release/cells.tsv","results/suite/corpus.md","results/a-new-tool/measurements.json"]) {
    const got=stepsFor(path);
    assert.ok(got.length>0);
    for(const step of got) assert.ok(tree.has(step), `${path}: ${got.join(" ")}`);
  }
  for (const [path,expected] of [
    ["results/test262/c/language.tsv","test262-cases"],
    ["results/test262/c/builtins.tsv","test262-builtins-cases"],
    ["results/test262/c/staging.tsv","test262-rest-cases"],
    ["results/test262/jvm/language.tsv","test262-jvm"],
    ["results/test262/llvm/language.tsv","test262-llvm"],
    ["results/typescript/jvm/cases.tsv","typescript-cases"],
  ]) assert.ok(stepsFor(path).includes(expected), path);
});

function owes(path, want, { not = [] } = {}) {
  const got = stepsFor(path);
  const reached = reach(path);
  // Owing everything would satisfy any `want`: these are claims of reach.
  assert.ok(got.length < landing().length, `${path} owes the full gate, so this case shows nothing about its reach`);
  for (const s of want) assert.ok(reached.includes(s), `${path} should owe ${s}; owes ${reached.join(" ")}`);
  for (const s of not) assert.ok(!reached.includes(s), `${path} should not owe ${s}; owes ${reached.join(" ")}`);
  return got;
}

test("native frontend and vendor changes select native validation", () => {
  for (const path of [
    "third_party/tsrs/crates/tsrs_checker/src/checker.rs",
    "third_party/tsrs/MANIFEST",
    "compiler/frontend-tsrs/src/lib.rs",
    "compiler/frontend-tsrs/vendor.ts",
  ]) {
    owes(path, ["frontend-tsrs"]);
  }
});

test("compiler notice inputs select the independent license check", () => {
  for (const path of ["licenses/packages.json", "tooling/licenses/licenses.ts", "Cargo.lock", "compiler/core/Cargo.toml", "third_party/react-compiler/LICENSE"]) {
    assert.ok(stepsFor(path).includes("licenses"), path);
  }
  assert.ok(!stepsFor("compiler/core/src/lower.rs").includes("licenses"));
});

test("native dependency and toolchain inputs select native validation", () => {
  for (const path of ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml"]) {
    assert.ok(reach(path).includes("frontend-tsrs"), path);
  }
});

test("unrelated source changes do not select native frontend integrity", () => {
  for (const path of ["tests/programs/hello/src/main.ts", "docs/architecture.md", "compiler/core/src/lower.rs"]) {
    assert.ok(!stepsFor(path).includes("frontend-tsrs"), path);
  }
});

test("a representation fact is checked wherever the program it describes can change", () => {
  // What `expect-ir` reads: core's preparation, the frontend's snapshot, the
  // CLI that checks it, and the sources that state the facts.
  for (const path of [
    "compiler/core/src/hir/loops.rs",
    "compiler/frontend-ts/src/cache.rs",
    "tooling/cli/src/expect_ir.rs",
    "benchmarks/cases/optional-chain/case.ts",
    "tests/programs/a-class-expression/src/main.ts",
  ]) {
    superset(stepsFor(path), ["expect-ir"], path);
  }
  // A backend emits from the prepared program; it cannot move a fact.
});

test("a compiler change runs the core and leaves the wide steps to the full run", () => {
  const got = stepsFor("compiler/core/src/hir/lower.rs");
  for (const s of ["examples", "llvm", "jvm", "rc", "llvm-rc", "memory", "test262-cases", "outcomes", "blockers", "expect-ir", "benches", "c-compiles"]) {
    assert.ok(got.includes(s), `lowering should run ${s} per landing; runs ${got.join(" ")}`);
  }
  for (const s of WIDE) assert.ok(!got.includes(s), `lowering should leave ${s} to the full run`);
  // The rule still names them: the full run is where they are owed.
  superset(reach("compiler/core/src/hir/lower.rs"), ["integrity", "dex", "bench-agree"], "lowering, with the full run");
});

test("native compiler and runtime changes run shipping counting and allocation checks", () => {
  for (const path of [
    "compiler/core/src/hir/own.rs",
    "compiler/core/src/hir/escape.rs",
    "compiler/core/src/hir/regions.rs",
    "compiler/core/src/hir/regions/placement.rs",
    "compiler/core/src/hir/new-analysis/pass.rs",
    "runtime/c/nts_runtime.c",
    "runtime/c/a-new-helper.c",
  ]) {
    const rules = owed([{ path, added: false }]);
    assert.ok(!rules.some((r) => r.full), `${path} must select its checks without falling back to every step`);
    superset(gateSteps(rules), ["rc", "llvm-rc", "memory"], path);
  }
});

test("backend-only changes run counting checks for the backend they change", () => {
  const c = stepsFor("compiler/codegen/c/src/emit.rs");
  superset(c, ["rc", "memory"], "the C backend");
  assert.ok(!c.includes("llvm-rc"), "C output cannot change counted LLVM output");
  const llvm = stepsFor("compiler/codegen/llvm/src/lib.rs");
  superset(llvm, ["llvm-rc"], "the LLVM backend");
  for (const step of ["rc", "memory"]) assert.ok(!llvm.includes(step), `LLVM output cannot change the C-only ${step} check`);
});

test("every HIR pass owes the counting checks, not just files named for ownership", () => {
  // CFG/liveness, scalarization, cycle classification and callee summaries
  // also change allocation or reference placement. Cover the whole directory.
  const listed = spawnSync("git", ["ls-files", "--", "compiler/core/src/hir"], { encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  const paths = listed.stdout.trim().split("\n").filter((p) => p.endsWith(".rs"));
  assert.ok(paths.length > 0);
  for (const path of paths) superset(stepsFor(path), ["rc", "llvm-rc", "memory"], path);
});

test("documentation changes owe no counted execution or allocation checks", () => {
  for (const path of ["README.md", "docs/architecture.md", "docs/foundations/memory.md"]) {
    const got = stepsFor(path);
    for (const step of ["rc", "llvm-rc", "memory"]) assert.ok(!got.includes(step), `${path} should not owe ${step}`);
  }
});

test("a path that is a wide step's subject still owes it per landing", () => {
  superset(stepsFor("compiler/codegen/napi/src/lib.rs"), ["addons"], "the N-API backend");
  superset(stepsFor("tooling/conformance/integrity.ts"), ["integrity"], "integrity's own tool");
  superset(stepsFor("tests/memory/closure-capture/src/main.ts"), ["memory"], "a memory case");
  superset(stepsFor("runtime/node/path/index.ts"), ["integrity-runtime", "definitions"], "a runtime module");
});

test("the JVM keeps the wide steps it chose for its own paths, and the device stays in the full run", () => {
  for (const p of ["compiler/codegen/jvm/src/lib.rs", "compiler/jvm-emitter/src/lib.rs", "runtime/jvm/NtsRuntime.java"]) {
    const got = stepsFor(p);
    for (const s of ["dex", "bench-agree", "interop"]) assert.ok(got.includes(s), `${p} should run ${s} per landing; runs ${got.join(" ")}`);
    assert.ok(!got.includes("on-device"), `${p} should leave on-device to the full run`);
  }
  // A core change does not inherit them.
  assert.ok(!stepsFor("compiler/core/src/hir/lower.rs").includes("dex"));
});

test("a path no rule names owes the full gate", () => {
  assert.deepEqual([...full()].sort(), [...landing()].sort());
  assert.equal(stepsFor("Cargo.lock").length, landing().length);
});

test("the runner owes the full gate", () => {
  for (const p of ["tooling/gate/all.sh", "tooling/gate/run.mjs", "tooling/gate/token.sh", "tooling/gate/tokenpool.mjs", "tooling/gate/pinned.sh"]) {
    // Every step, the wide ones too: the runner runs them all.
    assert.equal(stepsFor(p).length, allSteps().length, p);
  }
});

test("an input of a corpus's tsconfig owes that corpus's steps", () => {
  // Named by three blockers fixtures' `files`, not by any rule.
  owes("runtime/chromium/dom/types/dom-idl.d.ts", ["blockers", "integrity"], { not: ["examples", "definitions"] });
  // Extended by every fixture config.
  owes("tsconfig.fixtures.json", ["examples", "blockers", "memory", "bench-agree"]);
  owes("tests/memory/closure-capture/src/main.ts", ["memory"], { not: ["examples"] });
});

test("a crate no rule names owes what the crates that use it owe", () => {
  // semantic-schema has no rule; codegen-c and codegen-llvm depend on it.
  owes("compiler/semantic-schema/src/lib.rs", ["examples", "rc", "llvm", "llvm-rc"]);
  // A crate's own rule adds to what the crates linking it owe; it never
  // stands in for them.
  owes("compiler/codegen/llvm/src/lib.rs", ["llvm", "llvm-rc", "assembles", "corpus", "bench-agree"]);
});

test("a backend the CLI selects owes the steps that select it, not everything the CLI owes", () => {
  owes("compiler/codegen/napi/src/lib.rs", ["addons", "profile", "divergence"], { not: ["interop", "examples"] });
  // The JVM and LLVM backends build interop projects and pinned outcomes
  // through the CLI, so their own rules owe those.
  owes("compiler/codegen/jvm/src/lib.rs", ["jvm", "dex", "jvm-verifies", "interop", "outcomes", "bench-agree", "on-device"]);
  owes("compiler/jvm-emitter/src/lib.rs", ["jvm", "dex", "jvm-verifies", "interop", "outcomes"]);
  owes("compiler/codegen/llvm/src/lib.rs", ["llvm", "llvm-rc", "assembles", "interop", "outcomes", "benches", "test262-llvm"]);
  // The C backend is what the CLI runs by default: it keeps the CLI's reach.
  superset(reach("compiler/codegen/c/src/lib.rs"), ["interop", "addons", "profile", "config"], "the C backend");
});

test("interop builds only the projects a range reaches, when it can say which", () => {
  const projects = (...paths) => interopOwed(owed(paths.map((path) => ({ path, added: false }))));
  const jvm = interopBuiltWith("jvm");
  assert.ok(jvm.includes("java-from-ts") && jvm.includes("android-shape") && !jvm.includes("gtk-hello"), jvm.join(" "));
  // The JVM keeps interop per landing for its own paths, narrowed to the
  // projects built with it; a core change leaves interop to the full run.
  assert.deepEqual(projects("compiler/codegen/jvm/src/lib.rs"), jvm);
  assert.deepEqual(projects("runtime/jvm/NtsRuntime.java"), jvm);
  assert.equal(projects("compiler/core/src/hir/lower.rs"), null);
  assert.deepEqual(projects("tests/interop/gtk-hello/src/main.ts"), ["gtk-hello"]);
  assert.deepEqual(projects("tests/interop/gtk-hello/src/main.ts", "tests/interop/native-fd/build.sh"), ["gtk-hello", "native-fd"]);
  // Once interop runs for a project, it builds the ones the JVM change reaches
  // too: the narrowing still decides which.
  assert.deepEqual(projects("tests/interop/gtk-hello/src/main.ts", "compiler/codegen/jvm/src/lib.rs"), [...new Set(["gtk-hello", ...jvm])].sort());
  // The runner owes every project.
  assert.equal(projects("tooling/gate/token.sh"), "all");
});

test("what a step runs owes that step", () => {
  owes("tooling/conformance/integrity.ts", ["integrity", "integrity-runtime"], { not: ["examples"] });
  owes("tooling/conformance/c-compiles.mjs", ["c-compiles"], { not: ["examples"] });
  owes("tooling/gate/costs.mjs", ["integrity-runtime", "assembles", "jvm-verifies", "types"]);
  // Run by llvm, llvm-rc and jvm through all.sh's backend_examples.
  owes("tooling/differential/agree.mjs", ["llvm", "llvm-rc", "jvm"]);
  owes("tooling/android/dexes.sh", ["dex"]);
  owes("tooling/gate/definitions", ["definitions"]);
  owes("results/test262/c/language.tsv", ["test262-cases"]);
  // A backend's records owe that backend's step alone.
  owes("results/test262/jvm/language.tsv", ["test262-jvm"], { not: ["test262-cases", "examples"] });
  owes("results/test262/llvm/staging.tsv", ["test262-llvm"], { not: ["test262-jvm", "test262-cases", "examples"] });
  // The TypeScript suite: a case or a record owes its step alone, on every backend at once.
  owes("results/typescript/jvm/cases.tsv", ["typescript-cases"], { not: ["test262-jvm", "test262-cases", "examples"] });
  // A case is also an input of the runner every test262 step drives (its
  // default directory), so stepInputs owes those too: broad, never short.
  owes("tests/typescript/enums/numeric-members.ts", ["typescript-cases"], { not: ["examples"] });
  owes("tests/typescript-pending/decorators/README.md", ["typescript-cases"], { not: ["examples", "test262-cases"] });
  owes("tooling/gate/compile-times.tsv", ["compile-time"]);
});

test("a data file a step's tool reads beside itself owes that step", () => {
  owes("tooling/gate/compile-times.tsv", ["compile-time"], { not: ["examples"] });
  owes("tooling/conformance/integrity.known", ["integrity", "integrity-runtime"]);
  assert.ok(stepsFor("tooling/gate/times.tsv").length < landing().length);
});

test("the Chromium lane's own files owe only what every change owes", () => {
  // As the gate's step times do: placed, and owing nothing of its own.
  const always = [...stepsFor("tooling/gate/times.tsv")].sort();
  assert.ok(always.includes("clippy") && !always.includes("blockers"), `every change owes ${always.join(" ")}`);
  for (const p of [
    "tooling/chromium/bindgen/generate.py", "tooling/chromium/smoke.ts", "tooling/chromium/args.gn",
    "runtime/chromium/host/host.c", "runtime/chromium/adapter/dom_bridge.cc", "runtime/chromium/examples/todo/main.ts",
    "runtime/chromium/embedder/program/check.ts", "runtime/chromium/docs/lib-dom.md", "runtime/chromium/dom/types/dom-testing.d.ts",
  ]) {
    assert.deepEqual([...stepsFor(p)].sort(), always, p);
  }
});

test("the node lane's harness owes only what every change owes", () => {
  // Its `tooling/` paths in tooling/lanes/lanes.json, which no gate step runs.
  const always = [...stepsFor("tooling/gate/times.tsv")].sort();
  for (const p of [
    "tooling/conformance/run.mjs", "tooling/conformance/run-one.mjs", "tooling/conformance/tmpdir.mjs",
    "tooling/conformance/common.mjs", "tooling/conformance/check.sh", "tooling/conformance/unclaimed-reviewed",
  ]) {
    assert.deepEqual([...stepsFor(p)].sort(), always, p);
  }
});

test("a node harness file a gate step runs still owes that step", () => {
  // `addons` runs build-floor.sh, which runs build.sh.
  owes("tooling/conformance/build.sh", ["addons"]);
});

test("an instrument outside the node lane that no step runs still owes the full gate", () => {
  // The node rule settles the lane's own paths, not tooling/conformance.
  assert.equal(stepsFor("tooling/conformance/not-the-node-lanes.mjs").length, landing().length);
});

test("what a target brings owes the corpora built for it", () => {
  // tests/interop/chromium-surface reaches Chromium's DOM through
  // `target.chromium()` in its nts.config.ts; its tsconfig names neither half.
  owes("runtime/chromium/dom/types/lib-dom-bindings.d.ts", ["interop"]);
  owes("runtime/chromium/dom/abi/dom_idl.h", ["interop"], { not: ["blockers"] });
});

test("the files a target brings are read from its constructor", async () => {
  // targetFiles() reads target.ts's text; the constructors that need no
  // argument say what they bring themselves.
  const source = new URL("../config/src/target.ts", import.meta.url);
  const { target } = await import(source.href);
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const files = targetFiles();
  assert.deepEqual([...files.keys()].sort(), Object.keys(target).sort());
  for (const [name, make] of Object.entries(target)) {
    let made;
    try { made = make(); } catch { continue; } // android, ios and macos take a required argument
    const brought = [...(made.surface ?? []), ...(made.native ?? [])].map((p) => relative(root, p));
    assert.deepEqual(files.get(name), brought, `target.${name}`);
  }
  assert.ok(files.get("chromium").length > 0, "target.chromium() brings no files");
  // And none is called outside a constructor, where no target would own it.
  const calls = readFileSync(source, "utf8").match(/runtimeFile\("/g).length;
  assert.equal([...files.values()].flat().length, calls);
});

test("what the bindings generator writes still owes its readers", () => {
  // The rule above settles the generator, not its output: a regenerated
  // declaration file is an input to the blockers fixtures' tsconfigs.
  owes("runtime/chromium/dom/types/lib-dom-bindings.d.ts", ["blockers", "integrity"]);
  owes("runtime/chromium/dom/types/dom-idl.d.ts", ["blockers", "integrity"]);
  // And together, the generator's change owes what its output owes.
  superset(reach("tooling/chromium/bindgen/generate.py", "runtime/chromium/dom/types/dom-idl.d.ts"), ["blockers", "integrity"], "a regeneration");
});

test("a gate test owes the tooling step, not the full gate", () => {
  // all.sh runs them as `node --test tooling/gate/*.test.mjs`: a glob, which
  // the step map expands to the files it matches.
  for (const p of ["tooling/gate/owed.test.mjs", "tooling/gate/cputime.test.mjs"]) {
    const steps = stepsFor(p);
    assert.ok(steps.includes("tooling"), `${p} owes ${steps.join(" ")}`);
    assert.ok(steps.length < landing().length, `${p} owes the full gate`);
  }
});

test("a range is the same change as the commits in it", () => {
  // e936aecf4 is one commit, so its range and the commit agree.
  const one = (argv) => changedPaths(argv).map((c) => `${c.path}:${c.added}:${c.deleted}`).sort();
  assert.deepEqual(one(["--range", "e936aecf4^..e936aecf4"]), one(["--commit", "e936aecf4"]));
  assert.throws(() => changedPaths(["--range", "e936aecf4"]), /A\.\.B/);
});

test("documentation owes its two readers, not the gate", () => {
  owes("docs/primitives.md", ["primitives", "records"], { not: ["examples", "interop"] });
});

test("the hand-written rules still decide what they name", () => {
  owes("tests/programs/strings/src/main.ts", ["examples", "llvm", "llvm-rc", "jvm", "rc"]);
  owes("runtime/c/nts_runtime.h", ["tests", "bench-agree", "format"]);
  owes("compiler/core/src/hir/lower.rs", ["test262-cases", "test262-jvm", "test262-llvm", "typescript-cases", "jvm-verifies", "benches"]);
  // The JVM runtime owes the program step that runs it and the JVM's test262
  // rows, not only the lane's wide trio. (It owes the other test262 steps too,
  // but through their shared runner, which names the jar: `stepInputs`.)
  owes("runtime/jvm/src/nts/rt/NtsValue.java", ["jvm", "jvm-verifies", "test262-jvm"], { not: ["examples"] });
  // (Every compiler crate also reaches the CLI's crate, whose diagnostics rule
  // owes all the test262 steps; so a backend's own rule is its floor, not its
  // ceiling.)
  owes("compiler/codegen/jvm/src/ops.rs", ["jvm", "test262-jvm"]);
  // The jar too, and the class writer every JVM class goes through; the
  // lane's direct wide trio stays as it was.
  owes("runtime/jvm/nts-runtime.jar", ["jvm", "jvm-verifies", "test262-jvm", "dex", "bench-agree", "interop"]);
  owes("compiler/jvm-emitter/src/lib.rs", ["jvm", "jvm-verifies", "test262-jvm"]);
  // The CLI's manifest and the runner's shared pieces owe both backends' rows.
  owes("tooling/cli/Cargo.toml", ["test262-jvm"]);
  for (const file of ["tooling/census/attempt262.ts", "tooling/census/project.ts", "tooling/census/conformance262.ts"]) {
    owes(file, ["test262-cases", "test262-jvm"]);
  }
  // And the runner's tests are the tool step's now.
  owes("tooling/census/project.test.ts", ["tooling"]);
  owes("runtime/node/path/index.ts", ["definitions", "integrity-runtime", "addons", "compile-time"]);
});


test("every step the rules can owe exists", () => {
  const all = new Set(allSteps());
  for (const p of ["compiler/core/src/lib.rs", "runtime/node/fs/index.ts", "tsconfig.fixtures.json", "tooling/gate/costs.mjs"]) {
    for (const s of stepsFor(p)) assert.ok(all.has(s), `${p} owes ${s}, which all.sh does not define`);
  }
});

// ---------------------------------------------------------------------------
// The review of 2026-10-07: each case is a change that owed too little.
// ---------------------------------------------------------------------------

test("the N-API backend owes the addon steps", () => {
  owes("compiler/codegen/napi/src/lib.rs", ["addons", "profile", "divergence"]);
});

test("runtime/c is compiled into the C backend, so it owes at least what the C backend owes", () => {
  const backend = stepsFor("compiler/codegen/c/src/lib.rs");
  superset(reach("runtime/c/nts_runtime.c"), backend, "runtime/c/nts_runtime.c");
  // A new file there, which nothing includes yet, owes the same.
  superset(reach("runtime/c/a-file-nobody-includes-yet.c"), backend, "a new runtime/c file");
});

test("a crate owes its own rule and its production consumers' rules", () => {
  superset(reach("compiler/semantic-schema/src/lib.rs"), stepsFor("compiler/core/src/lib.rs"), "semantic-schema");
  superset(reach("compiler/core/src/lib.rs"), stepsFor("compiler/codegen/c/src/lib.rs"), "core");
  for (const crate of ["compiler/codegen/common", "compiler/jvm-emitter"]) {
    superset(reach(`${crate}/src/lib.rs`), ["corpus", "benches", "bench-agree"], crate);
  }
  // nts-build reaches the CLI normally, but the JVM only uses it in tests.
  // That dev edge must keep workspace tests without selecting suite/bench runs.
  const build = stepsFor("build/src/lib.rs");
  superset(build, ["tests", "config"], "build's production and test consumers");
  for (const step of ["corpus", "benches"]) assert.ok(!build.includes(step), `build's dev-only JVM edge should not select ${step}`);
});

test("a deleted example still owes every step that compiles the examples", () => {
  const got = changeReach([{ path: "tests/programs/an-example-that-was-removed/src/main.ts", added: false, deleted: true }]);
  superset(got, ["examples", "llvm", "llvm-rc", "jvm", "rc", "integrity", "example-refusals", "dex"], "a deleted example");
});

test("a rename is both paths: a blocker moved out still owes blockers, and moved into examples is a new example", () => {
  const changes = parseNameStatus("R100\ttests/refusals/old-fixture/src/main.ts\ttests/programs/old-fixture/src/main.ts\nR100\ttests/refusals/old-fixture/tsconfig.json\ttests/programs/old-fixture/tsconfig.json\n");
  assert.deepEqual(changes.map((c) => [c.path, c.added, c.deleted]), [
    ["tests/refusals/old-fixture/src/main.ts", false, true],
    ["tests/programs/old-fixture/src/main.ts", true, false],
    ["tests/refusals/old-fixture/tsconfig.json", false, true],
    ["tests/programs/old-fixture/tsconfig.json", true, false],
  ]);
  const rules = owed(changes).map((r) => r.name);
  assert.ok(rules.includes("a new example"), rules.join(", "));
  superset(changeReach(changes), ["blockers", "integrity", "examples", "llvm", "jvm", "rc"], "a renamed blocker");
});

test("the census files a tool runs or reads beside itself owe the test262 steps", () => {
  for (const file of ["tooling/census/attempt262-worker.ts", "tooling/census/harness.ts", "tooling/census/harness-done.ts"]) {
    owes(file, ["test262-cases", "test262-builtins-cases", "test262-rest-cases"]);
  }
});

test("an instrument no step is found to run owes the full gate", () => {
  assert.equal(stepsFor("tooling/conformance/an-instrument-nobody-runs.ts").length, landing().length);
});

test("integrity.ts, which blockers-check.mjs spawns, owes blockers", () => {
  owes("tooling/conformance/integrity.ts", ["integrity", "integrity-runtime", "blockers"]);
});

// ---------------------------------------------------------------------------
// Second round of the review.
// ---------------------------------------------------------------------------

test("a step that reads another's output through the runner owes what that step runs", () => {
  // integrity --runtime keeps its listings for definitions and compile-time
  // (run.mjs's NTS_DEFINITIONS_FROM, NTS_COMPILE_TIMES_FROM); profile's
  // emission goes to addons (NTS_ADDON_EMITTED).
  owes("tooling/conformance/integrity.ts", ["integrity-runtime", "definitions", "compile-time"]);
  owes("tooling/census/node-refusals.ts", ["profile", "addons", "c-compiles"]);
});

test("the C backend and every runtime module owe C validation", () => {
  for (const path of ["compiler/codegen/c/src/emit.rs", "runtime/web-platform/src/provider.ts", "runtime/node/http/src/main.ts"]) {
    owes(path, ["c-compiles"]);
  }
});

test("an example's nts.config.ts owes config, new or changed, interop's too", () => {
  owes("tests/programs/strings/nts.config.ts", ["config"]);
  superset(changeOwes([{ path: "tests/programs/a-new-one/nts.config.ts", added: true }, { path: "tests/programs/a-new-one/tsconfig.json", added: true }]), ["config"], "a new example with a config");
  owes("tests/interop/gtk-async/nts.config.ts", ["config", "interop"]);
});

test("an unavailable Cargo toolchain grants no scope for compiled inputs or documentation", () => {
  const script = `
    const { owed } = await import(${JSON.stringify(new URL("./owed.mjs", import.meta.url).href)});
    const { selectionInfrastructure } = await import(${JSON.stringify(new URL("./owed-range.ts", import.meta.url).href)});
    const paths=["compiler/core/src/lib.rs","runtime/c/nts_runtime.c","compiler/codegen/c/Cargo.toml","docs/primitives.md"];
    console.log(JSON.stringify(paths.map(path=>{
      try { return {path, rules:owed([{path,added:false}])}; }
      catch(error) { return {path,infrastructure:selectionInfrastructure(error),message:String(error)}; }
    })));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, RUSTUP_TOOLCHAIN: "no-such-toolchain-for-this-test" },
  });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  for (const row of got) {
    assert.equal(row.infrastructure, true, JSON.stringify(row));
    assert.match(row.message, /cargo metadata --format-version 1 --no-deps --offline/);
    assert.match(row.message, /no-such-toolchain-for-this-test/);
    assert.equal(row.rules, undefined, "no scope is granted without the dependency graph");
  }
});

test("land.ts and the registry owe tooling tests; lane.ts owes the baseline; the inputs owe everything", () => {
  const always = [...stepsFor("tooling/gate/times.tsv")].sort();
  // land.ts imports retire.ts and topics.ts, which tooling tests. Its derived
  // reach now includes tooling as well as the steps every change owes.
  // The current graph does not execute lane.ts itself in a tooling test.
  assert.deepEqual([...stepsFor("tooling/lanes/land.ts")].sort(), [...new Set([...always, "tooling"])].sort());
  assert.deepEqual([...stepsFor("tooling/lanes/lane.ts")].sort(), always);
  owes("tooling/lanes/lanes.json", ["tooling"]);
  assert.ok(stepsFor("tooling/lanes/lanes.json").length < landing().length, "lanes.json owes the full gate");
  // pinned.sh builds every gate tree through it.
  assert.equal(stepsFor("tooling/lanes/inputs.sh").length, allSteps().length);
});

test("the stable TypeScript sample stays core; full population enforcement is deferred", () => {
  assert.ok(!WIDE.has("ts-corpus"));
  assert.ok(!WIDE.has("corpus"));
  assert.ok(!allSteps().includes("ts-corpus"));
  assert.ok(landing().includes("corpus"));
});

test("the retired backend has no runnable or selected gate step", () => {
  for (const name of ["wasm", "test262-wasm"]) {
    assert.ok(!allSteps().includes(name), name);
    for (const path of ["compiler/core/src/hir/lower.rs", "tooling/cli/src/main.rs", "tests/programs/example/src/main.ts"]) {
      assert.ok(!stepsFor(path).includes(name), `${path}: ${name}`);
    }
  }
});

test("every compile-time subject owes the independent RC arm, while docs do not", () => {
  for (const path of ["compiler/core/src/hir/lower.rs", "runtime/node/path/index.ts", "tooling/conformance/integrity.ts",
    "tooling/gate/compile-times.tsv", "tooling/gate/compile-times-rc.tsv", "results/compile-counter-rc-calibration.json"]) {
    const steps = stepsFor(path);
    assert.equal(steps.includes("compile-time"), steps.includes("compile-time-rc"), path);
  }
  owes("tooling/gate/compile-times-rc.tsv", ["compile-time", "compile-time-rc"], { not: ["examples"] });
  owes("docs/architecture.md", [], { not: ["compile-time", "compile-time-rc"] });
});
