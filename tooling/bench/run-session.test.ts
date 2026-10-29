import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPARATORS, COLUMNS, POLICY } from "./run-record.ts";
import { unsharedLaunches } from "../jvm/launcher-audit.ts";
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
test("actual session CLI renders a header and a typed row, and rejects the old missing-import bridge", () => {
  const parent = join(homedir(), ".cache/nts-tmp");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "bench-session-cli-"));
  try {
    const input = join(root, "raw.json");
    writeFileSync(input, JSON.stringify(fixture()));
    const header = spawnSync(process.execPath, [script, "header", root], { encoding: "utf8" });
    assert.equal(header.status, 0, header.stderr);
    assert.ok(header.stdout.includes("nts C/node") && header.stdout.includes("nts LLVM/ScriptC"));
    const row = spawnSync(process.execPath, [script, "row", root, input], { encoding: "utf8" });
    assert.equal(row.status, 0, row.stderr);
    assert.match(row.stdout, /control\t/);
    assert.match(row.stdout, /1\.000× SHORT/);
    const mutant = join(root, "run-session.ts");
    const source = readFileSync(script, "utf8"),
      changed = source.replace(/\bconsoleHeader,\s*/g, "").replace(/\bconsoleRow,\s*/g, "")
        .replace('from "../jvm/vm-flags.ts"', "from " + JSON.stringify(new URL("../jvm/vm-flags.ts", import.meta.url).href));
    assert.notEqual(changed, source);
    writeFileSync(mutant, changed);
    for (const name of ["run-record.ts", "run-producers.ts", "comparator-pins.ts"])
      symlinkSync(fileURLToPath(new URL("./" + name, import.meta.url)), join(root, name));
    const old = spawnSync(process.execPath, [mutant, "header", root], { encoding: "utf8" });
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
