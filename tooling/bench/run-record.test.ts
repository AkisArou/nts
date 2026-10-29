import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  COMPARATORS,
  COLUMNS,
  POLICY,
  sealRun,
  parseRun,
  verdict,
  newestComplete,
  ownBest,
  renderFull,
  publishRun,
  readRuns,
  checkRecords,
  type Cell,
  type RunRecord,
} from "./run-record.ts";

const pin = "a".repeat(40),
  digest = "b".repeat(64);
function ok(ns = 100): Cell {
  return {
    status: "OK",
    nanoseconds: ns,
    spread: 1,
    checksum: "4000000000000000",
    verified: true,
    reason: null,
    details: null,
  };
}
function fixture(label = "one", at = "2026-10-29T12:00:00.000Z"): RunRecord {
  const row = (name: string) => ({
    name,
    workloadIdentity: digest,
    eligibleForBest: true,
    conditions: { gateRan: false },
    cells: Object.fromEntries(COLUMNS.map((c) => [c, ok(c === "nts C" ? 80 : 100)])),
    verdicts: {},
  });
  return sealRun({
    schemaVersion: 1,
    id: "2026-10-29-" + pin + "-" + label,
    startedAt: at,
    finishedAt: at,
    complete: true,
    inventory: ["a", "b"],
    columns: [...COLUMNS],
    sourceCommit: pin,
    compiler: { commit: pin, sha256: digest },
    harness: {
      identity: digest,
      contract: "opaque-bit-input-v1",
      files: [{ path: "loop.ts", sha256: digest }],
    },
    machine: {
      identity: "host-core-4",
      conditions: { gateRan: true, load: [2, 3, 2], cpu: 4, sibling: 5 },
    },
    comparators: Object.fromEntries(
      COMPARATORS.map((c) => [c, { version: "1", commit: pin, sha256: digest, command: [c] }]),
    ),
    verdictPolicy: POLICY,
    provenance: { kind: "test" },
    rows: [row("a"), row("b")],
  });
}
function temp(): string {
  const directory = join(homedir(), ".cache/nts-tmp");
  mkdirSync(directory, { recursive: true });
  return mkdtempSync(join(directory, "bench-record-test-"));
}
function git(root: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

test("policy v1 reproduces every boundary and records the authority", () => {
  const row = fixture().rows[0];
  for (const [ns, kind] of [
    [80, "WON"],
    [80.001, "SHORT"],
    [100, "SHORT"],
    [100.001, "LOSS"],
  ] as const) {
    row.cells["nts C"] = ok(ns);
    row.cells["nts LLVM"] = ok(1000);
    row.cells["nts JVM"] = ok(1000);
    assert.equal(verdict(row, "nts C", "node").kind, kind);
    assert.equal(verdict(row, "nts C", "Bun JIT").kind, kind);
  }
  for (const [ns, kind] of [
    [94.999, "WON"],
    [95, "TIE"],
    [105, "TIE"],
    [105.001, "LOSS"],
  ] as const) {
    row.cells["nts C"] = ok(ns);
    assert.equal(verdict(row, "nts C", "Bun AOT").kind, kind);
    assert.equal(verdict(row, "nts C", "ScriptC").kind, kind);
  }
  row.cells["Bun AOT"].spread = 1.2;
  row.cells["nts C"] = ok(115);
  assert.equal(verdict(row, "nts C", "Bun AOT").kind, "TIE");
  assert.equal(POLICY.authority, "docs/README.md#the-bar");
});

test("missing/duplicate/orphan rows and columns, malformed cells and mutated verdicts fail closed", () => {
  const run = fixture();
  assert.deepEqual(parseRun(run), run);
  const mutations = [
    (r: any) => r.rows.pop(),
    (r: any) => r.rows.push(r.rows[0]),
    (r: any) => (r.rows[0].name = "orphan"),
    (r: any) => delete r.rows[0].cells.node,
    (r: any) => (r.rows[0].cells.node.status = "mystery"),
    (r: any) => (r.rows[0].cells.node.nanoseconds = -1),
    (r: any) => (r.rows[0].cells.node.checksum = "0000000000000000"),
    (r: any) => (r.rows[0].cells.node.checksum = null),
    (r: any) => (r.rows[0].verdicts["nts C"].node.kind = "LOSS"),
    (r: any) => (r.verdictPolicy.version = 2),
    (r: any) => (r.verdictPolicy.authority = "somewhere-else"),
    (r: any) => (r.surprise = true),
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(run);
    mutate(changed);
    assert.throws(() => parseRun(changed));
  }
});

test("newest complete does not borrow missing cells from a later partial run", () => {
  const old = fixture("complete"),
    partial = fixture("partial", "2026-10-29T13:00:00.000Z");
  partial.complete = false;
  partial.rows.pop();
  assert.deepEqual(parseRun(partial), partial);
  assert.equal(newestComplete([old, partial])?.id, old.id);
  const text = renderFull([old, partial]);
  assert.ok(text.includes(old.id));
  assert.ok(!text.includes(partial.id));
});

test("own best excludes invalid, unverified, different workload and different harness records", () => {
  const current = fixture("current"),
    good = fixture("good");
  good.rows[0].cells["nts LLVM"] = ok(40);
  const bad = fixture("invalid");
  bad.rows[0].cells["nts C"] = {
    status: "INVALID",
    nanoseconds: null,
    spread: null,
    checksum: null,
    verified: false,
    reason: "timing hoisted",
    details: null,
  };
  bad.rows[0].eligibleForBest = false;
  const foreign = fixture("foreign");
  foreign.rows[0].cells["nts C"] = ok(1);
  foreign.rows[0].workloadIdentity = "c".repeat(64);
  const incompatible = fixture("incompatible");
  incompatible.harness.contract = "old-unconsumed-loop";
  incompatible.rows[0].cells["nts C"] = ok(1);
  const legacy = fixture("legacy");
  legacy.rows[0].cells["nts C"] = { ...ok(1), verified: false, checksum: null, spread: null };
  legacy.rows[0].eligibleForBest = false;
  const best = ownBest(current, current.rows[0], "nts LLVM", [
    good,
    bad,
    foreign,
    incompatible,
    legacy,
    current,
  ]);
  assert.equal(best?.nanoseconds, 40);
  assert.equal(best?.backend, "nts LLVM");
  assert.equal(best?.run, good.id);
  assert.equal(ownBest(current, current.rows[1], "nts C", [good, current])?.nanoseconds, 80);
});

test("slower-than-best flag stays beside current timing and all best provenance", () => {
  const old = fixture("old"),
    current = fixture("current", "2026-10-29T13:00:00.000Z");
  old.rows[0].cells["nts C"] = ok(40);
  const rendered = renderFull([old, current]);
  assert.match(rendered, /SLOWER THAN BEST/);
  assert.match(rendered, /80\.0 ns/);
  assert.match(rendered, /40\.0 ns/);
  assert.ok(rendered.includes(old.id));
  assert.ok(rendered.includes(pin));
  assert.match(rendered, /Verdict policy v1/);
  assert.match(rendered, /node: 2 WON/);
});

test("immutable publication refuses overwrite and renders latest complete, including beside-gate conditions", () => {
  const root = temp();
  try {
    const run = fixture(),
      path = publishRun(root, run, false),
      original = readFileSync(path, "utf8");
    assert.equal(readRuns(root).length, 1);
    assert.equal(publishRun(root, run, false), path);
    assert.equal(readFileSync(path, "utf8"), original);
    const changed = fixture();
    changed.rows[0].cells["nts C"] = ok(70);
    const sealed = sealRun(changed);
    assert.throws(() => publishRun(root, sealed, false), /immutable run already exists/);
    assert.match(readFileSync(join(root, "results/benchmarks/full.md"), "utf8"), /gateRan/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a results-only commit never sweeps unrelated index contents", () => {
  const root = temp();
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.name", "Record control"]);
    git(root, ["config", "user.email", "control@example.invalid"]);
    writeFileSync(join(root, "source.ts"), "export const value=1;\n");
    git(root, ["add", "source.ts"]);
    git(root, ["commit", "-qm", "initial"]);
    const run = fixture();
    publishRun(root, run, true);
    assert.deepEqual(git(root, ["show", "--pretty=", "--name-only", "HEAD"]).split("\n").sort(), [
      "results/benchmarks/full.md",
      "results/benchmarks/runs/" + run.id + ".json",
    ]);
    writeFileSync(join(root, "source.ts"), "export const value=2;\n");
    git(root, ["add", "source.ts"]);
    assert.throws(() => publishRun(root, fixture("next"), true), /clean index/);
    assert.equal(git(root, ["diff", "--cached", "--name-only"]), "source.ts");
    assert.equal(readRuns(root).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("two concurrent producers serialize publication and render the newest complete run", async () => {
  const root = temp();
  try {
    const inputs = [fixture("first"), fixture("second", "2026-10-29T14:00:00.000Z")];
    const script = fileURLToPath(new URL("./run-record.ts", import.meta.url));
    const children = inputs.map((run, index) => {
      const file = join(root, index + ".json");
      writeFileSync(file, JSON.stringify(run));
      const child = spawn(process.execPath, [script, "publish", root, file, "no-commit"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (b) => (stderr += b));
      return new Promise<void>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (status) => (status === 0 ? resolve() : reject(new Error(stderr))));
      });
    });
    await Promise.all(children);
    assert.equal(readRuns(root).length, 2);
    assert.match(readFileSync(join(root, "results/benchmarks/full.md"), "utf8"), /second/);
    assert.equal(
      readdirSync(join(root, "results/benchmarks/runs")).filter((f) => f.endsWith(".tmp")).length,
      0,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("native verdicts and own-best never borrow the other backend's faster observation", () => {
  const old = fixture("old-native"),
    current = fixture("new-native", "2026-10-29T13:00:00.000Z");
  old.rows[0].cells["nts C"] = ok(1);
  old.rows[0].cells["nts LLVM"] = ok(110);
  current.rows[0].cells["nts C"] = ok(70);
  current.rows[0].cells["nts LLVM"] = ok(120);
  const sealed = sealRun(current);
  assert.equal(sealed.rows[0].verdicts["nts C"].node.kind, "WON");
  assert.equal(sealed.rows[0].verdicts["nts LLVM"].node.kind, "LOSS");
  assert.equal(ownBest(sealed, sealed.rows[0], "nts LLVM", [old, sealed])?.nanoseconds, 110);
  const output = renderFull([old, sealed]);
  assert.match(output, /LLVM TRAILS C/);
  assert.match(output, /\*\*nts C\*\*/);
  assert.match(output, /\*\*nts LLVM\*\*/);
});

test("record check catches corruption, edited rendering and a missing committed run", () => {
  const root = temp();
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "test@example.invalid"]);
    git(root, ["config", "user.name", "record control"]);
    writeFileSync(join(root, "README"), "fixture\n");
    git(root, ["add", "README"]);
    git(root, ["commit", "-qm", "fixture"]);
    const path = publishRun(root, fixture("gate"));
    assert.equal(checkRecords(root).runs, 1);
    const original = readFileSync(path, "utf8"),
      fullPath = join(root, "results/benchmarks/full.md"),
      full = readFileSync(fullPath, "utf8");
    const corrupted = JSON.parse(original);
    corrupted.rows[0].verdicts["nts C"].node.kind = "LOSS";
    writeFileSync(path, JSON.stringify(corrupted));
    assert.throws(() => checkRecords(root), /recorded verdict/);
    writeFileSync(path, original);
    writeFileSync(fullPath, full + "hand edit\n");
    assert.throws(() => checkRecords(root), /shared renderer/);
    writeFileSync(fullPath, full);
    rmSync(path);
    assert.throws(() => checkRecords(root), /missing immutable/);
    writeFileSync(path, original);
    // A valid re-sealing and matching regenerated page cannot rewrite committed evidence.
    corrupted.rows[0].cells["nts C"].nanoseconds = 70;
    const forged = sealRun(corrupted);
    writeFileSync(path, JSON.stringify(forged, null, 2) + "\n");
    writeFileSync(fullPath, renderFull([forged]));
    assert.throws(() => checkRecords(root), /immutable.*rewritten/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the real check CLI detects a one-change renderer drift", () => {
  const root = temp();
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "test@example.invalid"]);
    git(root, ["config", "user.name", "record control"]);
    writeFileSync(join(root, "README"), "fixture\n");
    git(root, ["add", "README"]);
    git(root, ["commit", "-qm", "fixture"]);
    publishRun(root, fixture("renderer"));
    const implementation = fileURLToPath(new URL("./run-record.ts", import.meta.url)),
      mutant = join(root, "mutant.ts"),
      source = readFileSync(implementation, "utf8");
    assert.ok(source.includes("# Benchmark results"));
    writeFileSync(mutant, source.replaceAll("# Benchmark results", "# Drifted benchmark results"));
    const good = spawnSync(process.execPath, [implementation, "check", root], { encoding: "utf8" });
    assert.equal(good.status, 0, good.stderr);
    const bad = spawnSync(process.execPath, [mutant, "check", root], { encoding: "utf8" });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /shared renderer/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
