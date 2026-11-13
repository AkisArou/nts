// The step table's dependencies: every one names a step, and none waits for
// itself, so the runner never waits for ever on a prerequisite.
//
//   node --test tooling/gate/step-table.test.ts
import assert from "node:assert/strict";
import {existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, rmSync} from "node:fs";
import {join, dirname} from "node:path";

import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {gateEnvironment, hostEnvironment} from "./canonical-environment.ts";
import {STEPS, stepTableProblem} from "./step-table.mjs";
import {moduleClosure} from "./module-closure-fixture.ts";
import {removable} from "./run-temporary.ts";
import {spawnTest} from "./test-wait.ts";
import {newTestScratch} from "./test-scratch.ts";
import {ownMemory} from "./test-memory.ts";

test('the shell and runner catalogues contain exactly the same complete step set',()=>{
  const listed=spawnTest('sh',[fileURLToPath(new URL('./all.sh',import.meta.url)),'--list'],{encoding:'utf8'});
  assert.equal(listed.status,0,listed.stderr);
  const names=listed.stdout.trim().split('\n');
  assert.equal(new Set(names).size,names.length,'the shell cannot define a step twice');
  assert.deepEqual(names.sort(),STEPS.map(row=>row.name).sort());
});

test("the table's dependencies all name steps, and none waits for itself", () => {
  assert.equal(stepTableProblem(STEPS), null);
  assert.equal(stepTableProblem([{ name: "a", needs: ["gone"] }]), "a depends on gone, which is not a step");
  assert.equal(stepTableProblem([{ name: "a", needs: ["a"] }]), "steps wait for one another: a -> a");
  assert.equal(stepTableProblem([{ name: "a", needs: ["b"] }, { name: "b", after: ["c"] }, { name: "c", needs: ["a"] }]),
    "steps wait for one another: a -> b -> c -> a");
  assert.equal(stepTableProblem([{ name: "a", after: ["b"] }, { name: "b", needs: ["c"] }, { name: "c" }]), null, "a chain is not a cycle");
});

test("the runner refuses a table whose steps wait for one another, before any step starts", t => {
  const own = newTestScratch("step-table-run");t.after(() => {removable(own);rmSync(own, {recursive:true,force:true});});
  const root = join(own, "repo"), gate = join(root, "tooling/gate"), run = join(own, "home/.cache/gate-run"), started = join(own, "started");
  const source = fileURLToPath(new URL("./", import.meta.url));
  mkdirSync(gate, { recursive: true });
  for (const file of moduleClosure(["tooling/gate/run.mjs"])) {
    const target = join(root, file);
    mkdirSync(dirname(target), {recursive: true});
    const original = join(source, "../..", file);
    if (file === "tooling/gate/run.mjs") writeFileSync(target, readFileSync(original));
    else if (file === "tooling/gate/step-table.mjs") {
      // clippy needs tests, and tests waits for clippy as well as the build.
      const text = readFileSync(original, "utf8").replace('{ name: "clippy", slots: 6,', '{ name: "clippy", needs: ["tests"], slots: 6,').replace('after: ["build"], doc: "cargo test --workspace"', 'after: ["build", "clippy"], doc: "cargo test --workspace"');
      assert.notEqual(text, readFileSync(original, "utf8"));
      writeFileSync(target, text);
    } else symlinkSync(original, target);
  }
  symlinkSync(join(source, "times.tsv"), join(gate, "times.tsv"));
  const listed = spawnTest("sh", [join(source, "all.sh"), "--list"], { encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  writeFileSync(join(gate, "all.sh"), `#!/bin/sh\nif [ "$1" = --list ]; then\ncat <<'NAMES'\n${listed.stdout.trim()}\nNAMES\nelse\n  : > ${JSON.stringify(started)}\nfi\n`);
  // An ample memory reading and a ledger of its own, as every test that starts a real runner gives it.
  const planned = gateEnvironment({ ...hostEnvironment(process.env), HOME: join(own, "home") }, { run, owned: { NTS_GATE_STEPS: "clippy tests", CARGO_TARGET_DIR: join(own, "target"), ...ownMemory(join(own, "memory")) } });
  const refused = spawnTest(process.execPath, [join(gate, "run.mjs")], { cwd: root, env: planned.env, encoding: "utf8" });
  assert.equal(refused.status, 2, refused.stdout + refused.stderr);
  assert.match(refused.stderr, /run\.mjs: steps wait for one another: (clippy -> tests -> clippy|tests -> clippy -> tests)/);
  assert.equal(existsSync(started), false, "no step started");
});
