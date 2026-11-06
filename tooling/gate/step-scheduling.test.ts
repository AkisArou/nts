import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gateEnvironment } from "./canonical-environment.ts";
import { spawnTest } from "./test-wait.ts";
import { inheritedStepWork, orderStepStarts, readPreviousStepCpu, readStepCpuHistory, usableWidth, writeStepCpuHistory } from "./step-scheduling.ts";

test("equal and missing estimates have a deterministic name tie-break", () => {
  const names = ["typescript-c", "tests", "blockers", "integrity"];
  const expected = ["blockers", "integrity", "tests", "typescript-c"];
  for (const input of [names, [...names].reverse()]) {
    assert.deepEqual(orderStepStarts(input, () => 60), expected);
    assert.deepEqual(orderStepStarts(input, () => NaN), expected);
  }
  assert.deepEqual(orderStepStarts(names, name => ({ "typescript-c": 1000, tests: 900 } as Record<string, number>)[name] ?? 100),
    ["typescript-c", "tests", "blockers", "integrity"]);
});

test("completed CPU history survives small trains and corrupt or failed cache writes are harmless", t => {
  const base = join(homedir(), ".cache/nts/step-scheduling-tests"); mkdirSync(base, { recursive: true });
  const own = mkdtempSync(join(base, "history-")); t.after(() => rmSync(own, { recursive: true, force: true }));
  const previous = join(own, "summary.json"), file = join(own, "costs/steps.json");
  writeFileSync(previous, JSON.stringify({ schema: 1, environment: { canonical: true }, steps: [
    { name: "typescript-c", verdict: "PASS", wall: 1067, cpu: 2663 }, { name: "blockers", verdict: "NOT RUN", wall: 900, cpu: 900 },
  ] }));
  const seed = readPreviousStepCpu(previous);
  assert.deepEqual([...seed], [["typescript-c", 2663]]);
  assert.equal(writeStepCpuHistory(file, [{ name: "rustfmt", verdict: "PASS", cpu: 2 }], seed), undefined);
  assert.deepEqual([...readStepCpuHistory(file)], [["rustfmt", 2], ["typescript-c", 2663]]);
  assert.equal(writeStepCpuHistory(file, [{ name: "typescript-c", verdict: "PASS", cpu: 600 },
    { name: "blockers", verdict: "FAIL", cpu: 1 }]), undefined);
  assert.deepEqual([...readStepCpuHistory(file)], [["rustfmt", 2], ["typescript-c", 600]]);
  writeFileSync(file, JSON.stringify({ version: 1, steps: { "typescript-c": 1067 } }));
  assert.equal(readStepCpuHistory(file).size, 0, "a wall-time history from before is not read as work");
  writeFileSync(file, "partial{"); assert.equal(readStepCpuHistory(file).size, 0);
  const blocked = join(own, "not-a-directory"); writeFileSync(blocked, "preserve");
  assert.equal(typeof writeStepCpuHistory(join(blocked, "steps.json"), []), "string");
  assert.equal(readFileSync(blocked, "utf8"), "preserve");
  writeFileSync(previous, JSON.stringify({ schema: 1, environment: { canonical: false }, steps: [
    { name: "typescript-c", verdict: "PASS", cpu: 1 },
  ] }));
  assert.equal(readPreviousStepCpu(previous).size, 0);
});

test("a split step's measured work is shared among its successors, never copied to each", () => {
  const successors = { "typescript-cases": { steps: ["typescript-c", "typescript-llvm", "typescript-jvm"] }, retired: { steps: [] } };
  const baseline = new Map([["typescript-c", 3000], ["typescript-llvm", 2000], ["typescript-jvm", 1000]]);
  const proportional = inheritedStepWork(new Map([["typescript-cases", 6000], ["retired", 500]]), name => baseline.get(name), successors);
  assert.deepEqual([...proportional].sort(), [["typescript-c", 3000], ["typescript-jvm", 1000], ["typescript-llvm", 2000]]);
  const equal = inheritedStepWork(new Map([["typescript-cases", 6000]]), name => name === "typescript-jvm" ? undefined : baseline.get(name), successors);
  assert.deepEqual([...equal].sort(), [["typescript-c", 2000], ["typescript-jvm", 2000], ["typescript-llvm", 2000]]);
  const measured = inheritedStepWork(new Map([["typescript-cases", 6000], ["typescript-c", 2663]]), name => baseline.get(name), successors);
  assert.deepEqual([...measured].sort(), [["typescript-jvm", 1000], ["typescript-llvm", 2000]], "a successor's own completed run wins");
  assert.equal(inheritedStepWork(new Map(), name => baseline.get(name), successors).size, 0);
  const merge = { "old-a": { steps: ["merged"] }, "old-b": { steps: ["merged"] } };
  assert.equal(inheritedStepWork(new Map([["old-a", 10], ["old-b", 20]]), () => undefined, merge).size, 0,
    "two measured predecessors of one step may be a merge or a rename chain, so neither is inherited");
  assert.deepEqual([...inheritedStepWork(new Map([["old-a", 10]]), () => undefined, merge)], [["merged", 10]]);
});

test("a step's usable width counts the frontend cap, so a capped step is not ranked as if it ran at full width", () => {
  const steps: Record<string, { slots: number; fe?: boolean }> = { frontend: { slots: 8, fe: true }, other: { slots: 2 } };
  const budget = { slots: 24, frontends: 2 };
  assert.equal(usableWidth(steps.frontend!, budget), 2);
  assert.equal(usableWidth(steps.other!, budget), 2);
  assert.equal(usableWidth({ slots: 8, fe: true }, { slots: 24, frontends: 24 }), 8);
  assert.equal(usableWidth({}, budget), 1);
  const work: Record<string, number> = { frontend: 800, other: 400 };
  assert.deepEqual(orderStepStarts(["other", "frontend"], name => work[name]! / usableWidth(steps[name]!, budget)), ["frontend", "other"]);
});

test("measured CPU work starts TypeScript at full width against a competing fixed grant", t => {
  const base = join(homedir(), ".cache/nts/step-scheduling-tests"); mkdirSync(base, { recursive: true });
  const own = mkdtempSync(join(base, "run-")); t.after(() => rmSync(own, { recursive: true, force: true }));
  const root = join(own, "repo"), gate = join(root, "tooling/gate"), target = join(own, "target"), run = join(own, "gate-run");
  mkdirSync(gate, { recursive: true }); mkdirSync(join(target, "gate-costs"), { recursive: true });
  const source = fileURLToPath(new URL("./", import.meta.url));
  for (const name of readdirSync(source)) {
    if (name === "run.mjs") writeFileSync(join(gate, name), readFileSync(join(source, name)));
    else if (!["all.sh", "times.tsv"].includes(name)) symlinkSync(join(source, name), join(gate, name));
  }
  const baseline = "tests\t900\t10000\t8\ntypescript-c\t1\t1\t8\n";
  writeFileSync(join(gate, "times.tsv"), baseline);
  writeFileSync(join(target, "gate-costs/steps.json"), JSON.stringify({ version: 2, steps: { tests: 100, "typescript-c": 8000 } }) + "\n");
  const listed = spawnTest("sh", [join(source, "all.sh"), "--list"], { encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  const observed = join(own, "starts.jsonl");
  writeFileSync(join(gate, "all.sh"), `#!/bin/sh
if [ "$1" = --list ]; then
cat <<'NAMES'
${listed.stdout.trim()}
NAMES
else
  node --input-type=module -e 'import {appendFileSync} from "node:fs";appendFileSync(${JSON.stringify(observed)},JSON.stringify({step:process.env.NTS_GATE_STEP,slots:Number(process.env.NTS_GATE_JOBS)})+"\\n");'
fi
`);
  const compiler = join(own, "nts"); writeFileSync(compiler, "controlled compiler identity\n");
  const meminfo = join(own, "meminfo"); writeFileSync(meminfo, "MemAvailable: 64000000 kB\n");
  const planned = gateEnvironment(process.env, { run, owned: {
    NTS_GATE_STEPS: "tests typescript-c", NTS_GATE_SLOTS: "12", NTS_GATE_MEM_GB: "20",
    NTS_MEMINFO: meminfo, CARGO_TARGET_DIR: target, NTS_BIN: compiler,
  } });
  const actual = spawnTest(process.execPath, [join(gate, "run.mjs")], { cwd: root, env: planned.env, encoding: "utf8" });
  assert.equal(actual.status, 0, actual.stdout + actual.stderr);
  const summary = JSON.parse(readFileSync(join(run, "summary.json"), "utf8")) as {
    environment?: { canonical?: boolean }; steps: { name: string; slots: number; cpu?: number }[];
  };
  assert.equal(summary.steps.find(step => step.name === "typescript-c")?.slots, 8, "the census starts its whole pool of workers");
  const starts = readFileSync(observed, "utf8").trim().split("\n").map(line => JSON.parse(line) as { step: string; slots: number });
  assert.deepEqual(starts.map(row => row.step).sort(), ["tests", "typescript-c"]);
  const admissions = [...actual.stderr.matchAll(/^-- ([a-z-]+) started /gm)].map(match => match[1]);
  assert.deepEqual(admissions, ["typescript-c", "tests"], "measured CPU work takes precedence over the committed baseline");
  assert.equal(readFileSync(join(gate, "times.tsv"), "utf8"), baseline, "scheduling must never rewrite timing-verdict baselines");
  const history = JSON.parse(readFileSync(join(target, "gate-costs/steps.json"), "utf8")) as { version: number; steps: Record<string, number> };
  assert.equal(history.version, 2);
  // Only a canonical run writes the history (run.mjs); this test's run is
  // canonical alone and not inside a gate, whose variables make it an experiment.
  const measured = summary.steps.find(step => step.name === "typescript-c")?.cpu;
  const written = summary.environment?.canonical === true && typeof measured === "number" && measured > 0;
  assert.equal(history.steps["typescript-c"], written ? measured : 8000,
    "a canonical run records the step's measured CPU; any other run leaves the history as it was");
});
