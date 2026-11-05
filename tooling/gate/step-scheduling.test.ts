import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gateEnvironment } from "./canonical-environment.ts";
import { spawnTest } from "./test-wait.ts";
import { orderStepStarts, readStepWallHistory, readPreviousStepWalls, writeStepWallHistory } from "./step-scheduling.ts";

test("equal and missing histories have a deterministic name tie-break", () => {
  const names = ["typescript-cases", "tests", "blockers", "integrity"];
  const expected = ["blockers", "integrity", "tests", "typescript-cases"];
  for (const input of [names, [...names].reverse()]) {
    assert.deepEqual(orderStepStarts(input, new Map(), () => 60), expected);
    assert.deepEqual(orderStepStarts(input, new Map(names.map(name => [name, 7])), () => 60), expected);
  }
  assert.deepEqual(orderStepStarts(names, new Map([["typescript-cases", 1000]]), name => name === "tests" ? 900 : 100),
    ["typescript-cases", "tests", "blockers", "integrity"]);
});

test("completed history survives small trains and corrupt or failed cache writes are harmless", t => {
  const base = join(homedir(), ".cache/nts/step-scheduling-tests"); mkdirSync(base, { recursive: true });
  const own = mkdtempSync(join(base, "history-")); t.after(() => rmSync(own, { recursive: true, force: true }));
  const previous = join(own, "summary.json"), file = join(own, "costs/steps.json");
  writeFileSync(previous, JSON.stringify({ schema: 1, environment: { canonical: true }, steps: [
    { name: "typescript-cases", verdict: "PASS", wall: 2000 }, { name: "blockers", verdict: "NOT RUN", wall: 900 },
  ] }));
  const seed = readPreviousStepWalls(previous);
  assert.deepEqual([...seed], [["typescript-cases", 2000]]);
  assert.equal(writeStepWallHistory(file, [{ name: "rustfmt", verdict: "PASS", wall: 2 }], seed), undefined);
  assert.deepEqual([...readStepWallHistory(file)], [["rustfmt", 2], ["typescript-cases", 2000]]);
  assert.equal(writeStepWallHistory(file, [{ name: "typescript-cases", verdict: "PASS", wall: 600 },
    { name: "blockers", verdict: "FAIL", wall: 1 }]), undefined);
  assert.deepEqual([...readStepWallHistory(file)], [["rustfmt", 2], ["typescript-cases", 600]]);
  writeFileSync(file, "partial{"); assert.equal(readStepWallHistory(file).size, 0);
  const blocked = join(own, "not-a-directory"); writeFileSync(blocked, "preserve");
  assert.equal(typeof writeStepWallHistory(join(blocked, "steps.json"), []), "string");
  assert.equal(readFileSync(blocked, "utf8"), "preserve");
  writeFileSync(previous, JSON.stringify({ schema: 1, environment: { canonical: false }, steps: [
    { name: "typescript-cases", verdict: "PASS", wall: 1 },
  ] }));
  assert.equal(readPreviousStepWalls(previous).size, 0);
});

test("measured wall history starts TypeScript at full width against a competing fixed grant", t => {
  const base = join(homedir(), ".cache/nts/step-scheduling-tests"); mkdirSync(base, { recursive: true });
  const own = mkdtempSync(join(base, "run-")); t.after(() => rmSync(own, { recursive: true, force: true }));
  const root = join(own, "repo"), gate = join(root, "tooling/gate"), target = join(own, "target"), run = join(own, "gate-run");
  mkdirSync(gate, { recursive: true }); mkdirSync(join(target, "gate-costs"), { recursive: true });
  const source = fileURLToPath(new URL("./", import.meta.url));
  for (const name of readdirSync(source)) {
    if (name === "run.mjs") writeFileSync(join(gate, name), readFileSync(join(source, name)));
    else if (!["all.sh", "times.tsv"].includes(name)) symlinkSync(join(source, name), join(gate, name));
  }
  const baseline = "tests\t900\t10000\t8\ntypescript-cases\t1\t1\t8\n";
  writeFileSync(join(gate, "times.tsv"), baseline);
  writeFileSync(join(target, "gate-costs/steps.json"), JSON.stringify({ version: 1, steps: { tests: 1, "typescript-cases": 1000 } }) + "\n");
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
    NTS_GATE_STEPS: "tests typescript-cases", NTS_GATE_SLOTS: "12", NTS_GATE_MEM_GB: "20",
    NTS_MEMINFO: meminfo, CARGO_TARGET_DIR: target, NTS_BIN: compiler,
  } });
  const actual = spawnTest(process.execPath, [join(gate, "run.mjs")], { cwd: root, env: planned.env, encoding: "utf8" });
  assert.equal(actual.status, 0, actual.stdout + actual.stderr);
  const summary = JSON.parse(readFileSync(join(run, "summary.json"), "utf8")) as { steps: { name: string; slots: number }[] };
  assert.equal(summary.steps.find(step => step.name === "typescript-cases")?.slots, 8, "the fixed census cannot remain on a partial grant");
  const starts = readFileSync(observed, "utf8").trim().split("\n").map(line => JSON.parse(line) as { step: string; slots: number });
  assert.deepEqual(starts.map(row => row.step).sort(), ["tests", "typescript-cases"]);
  const admissions = [...actual.stderr.matchAll(/^-- ([a-z-]+) started /gm)].map(match => match[1]);
  assert.deepEqual(admissions, ["typescript-cases", "tests"], "measured wall time takes precedence over CPU work and the old baseline");
  assert.equal(readFileSync(join(gate, "times.tsv"), "utf8"), baseline, "scheduling must never rewrite timing-verdict baselines");
  const history = JSON.parse(readFileSync(join(target, "gate-costs/steps.json"), "utf8")) as { version: number; steps: Record<string, number> };
  assert.equal(history.version, 1);
  assert.ok(history.steps["typescript-cases"]! > 0 && history.steps["typescript-cases"]! < 1000, "the completed wall time is retained");
});
