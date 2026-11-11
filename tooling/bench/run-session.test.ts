import {testEnvironment} from "../gate/test-environment.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPARATORS, COLUMNS, POLICY } from "./run-record.ts";
import { unsharedLaunches } from "../jvm/launcher-audit.ts";
import { newTestScratch, testScratch } from "../gate/test-scratch.ts";
import { readJournal } from "./run-journal.ts";
const script = fileURLToPath(new URL("./run-session.ts", import.meta.url));
const pin = "a".repeat(40),
  sha = "b".repeat(64);
function fixture() {
  const measurement = { ns_per_op: 100, checksum: "4000000000000000", spread: 1 };
  const metadata = {
    schemaVersion: 1,
    id: "2026-10-29-" + pin + "-console",
    startedAt: null,
    finishedAt: null,
    complete: false,
    inventory: ["control"],
    columns: [...COLUMNS],
    sourceCommit: pin,
    compiler: { commit: pin, sha256: sha },
    harness: { identity: sha, contract: null, files: [] },
    machine: { identity: null, conditions: null },
    comparators: Object.fromEntries(COMPARATORS.map((c) => [c, null])),
    verdictPolicy: POLICY,
    provenance: null,
  };
  return {
    metadata,
    cases: ["control"],
    lanes: null,
    spoiled: [],
    failed: [],
    measured: [
      {
        shown: "control",
        workload: null,
        source_capture: null,
        results: [measurement, measurement, null, measurement, measurement, null],
        absences: { outcomes: {}, jvm: null, cpp: null },
        node: measurement,
        bun: measurement,
      },
    ],
  };
}

test("journal recovery accepts only a complete ordered prefix and never an interrupted row", t => {
  const root = testScratch(t, "bench-journal"), path = join(root, "run.jsonl"), raw = fixture();
  const header = JSON.stringify({ version: 1, metadata: raw.metadata, cases: ["control", "next"], requested: [], lanes: null }) + "\n";
  const frame = JSON.stringify({ name: "control", measured: raw.measured[0], failure: null, spoiled: false, failed: [], conditions: {} }) + "\n";
  writeFileSync(path, header + frame + '{"name":"next"');
  const saved = readJournal(path);
  assert.deepEqual(saved.unreached, ["next"]);
  assert.deepEqual(saved.raw.measured, raw.measured);
  writeFileSync(path, header + frame + frame);
  assert.throws(() => readJournal(path), /out-of-order/);
  writeFileSync(path, header + frame + "{bad}\n");
  assert.throws(() => readJournal(path), SyntaxError);
  writeFileSync(path, header.slice(0, -1));
  assert.throws(() => readJournal(path), /no committed header/);
});
test("actual session CLI renders a header and a typed row, and rejects the old missing-import bridge", () => {
  const root = newTestScratch("bench-session-cli");
  try {
    const input = join(root, "raw.json");
    writeFileSync(input, JSON.stringify(fixture()));
    const header = spawnSync(process.execPath, [script, "header", root], {env:testEnvironment(), encoding: "utf8" });
    assert.equal(header.status, 0, header.stderr);
    assert.ok(header.stdout.includes("nts C/node") && header.stdout.includes("nts LLVM/ScriptC"));
    const row = spawnSync(process.execPath, [script, "row", root, input], {env:testEnvironment(), encoding: "utf8" });
    assert.equal(row.status, 0, row.stderr);
    assert.match(row.stdout, /control\t/);
    assert.match(row.stdout, /1\.000× SHORT/);
    const mutant = join(root, "run-session.ts");
    const source = readFileSync(script, "utf8"),
      changed = source.replace(/\bconsoleHeader,\s*/g, "").replace(/\bconsoleRow,\s*/g, "")
        .replace('from "../jvm/vm-flags.ts"', "from " + JSON.stringify(new URL("../jvm/vm-flags.ts", import.meta.url).href));
    assert.notEqual(changed, source);
    writeFileSync(mutant, changed);
    for (const name of ["run-record.ts", "run-producers.ts", "comparator-pins.ts", "run-journal.ts", "groups.ts"])
      symlinkSync(fileURLToPath(new URL("./" + name, import.meta.url)), join(root, name));
    const old = spawnSync(process.execPath, [mutant, "header", root], {env:testEnvironment(), encoding: "utf8" });
    assert.equal(old.status, 1);
    assert.match(old.stderr, /consoleHeader is not defined/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("session toolchain discovery rejects the old bare JVM launch", () => {
  const source = readFileSync(script, "utf8");
  assert.deepEqual(unsharedLaunches("tooling/bench/run-session.ts", source), []);
  const mutant = source.replace('...vmToolFlags("java"), "-version"', '"-version"');
  assert.notEqual(mutant, source);
  const findings = unsharedLaunches("tooling/bench/run-session.ts", mutant);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.tool, "java");
  assert.match(findings[0]!.code, /-version/);
});

test("session conditions have no dependency on the old landing lock probe", t => {
  const root = testScratch(t, "bench-session-conditions"), bin = join(root, "bin"), invoked = join(root, "invoked");
  mkdirSync(bin);
  writeFileSync(join(bin, "flock"), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(invoked)}, 'invoked');process.exit(99);\n`, { mode: 0o755 });
  const result = spawnSync(process.execPath, [script, "conditions", root], {
    encoding: "utf8", env: { ...testEnvironment(), PATH: `${bin}:${process.env.PATH ?? ""}` },
  });
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout);
  assert.equal(typeof observed.load, "string");
  assert.ok(observed.memoryAvailableBytes > 0);
  assert.equal(Object.hasOwn(observed, "landingLockHeld"), false);
  assert.equal(existsSync(invoked), false);
});
