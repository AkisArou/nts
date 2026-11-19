import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { COLUMNS, COMPARATORS, POLICY, SESSION_COLUMNS, ownBest, readRuns, renderFull, sealRun, type Cell, type Json, type RunRecord } from "./run-record.ts";
import { fromNts, type Metadata } from "./run-producers.ts";
import {
  LAUNCH_COUNT, LAUNCH_PROTOCOL, LAUNCH_WARMUPS, checkLaunchCell, comparableColdStartups, coldStartupProtocol,
  launchCell, launchSummary, type Launch, type LaunchDetails,
} from "./launch-cell.ts";

const pin = "a".repeat(40), digest = "b".repeat(64), out = "c".repeat(64), other = "d".repeat(64), env = "e".repeat(64);
const launch = (wallNanoseconds: number, change: Partial<Launch> = {}): Launch => ({
  wallNanoseconds, status: 0, signal: null, timedOut: false, userMicroseconds: 100, systemMicroseconds: 50, maxRssKib: 1500, siblingTicks: 0,
  stdoutSha256: out, ...change,
});
function details(base: number, change: (launches: Launch[]) => void = () => {}): LaunchDetails {
  const launches = Array.from({ length: LAUNCH_COUNT }, (_, i) => launch(base + i * 10));
  change(launches);
  return { protocol: LAUNCH_PROTOCOL, warmups: Array.from({ length: LAUNCH_WARMUPS }, () => launch(base * 3)), launches, stdoutSha256: out, environmentSha256: env };
}
const absent = (status: Cell["status"], reason: string): Cell =>
  ({ status, nanoseconds: null, spread: null, checksum: null, verified: false, reason, details: null });

function launchRun(cells: Record<string, Cell>, id = "launch", at = "2026-11-19T00:00:00.000Z", kind: string | null = "launch"): RunRecord {
  const row = {
    name: "startup-hello", ...(kind === null ? {} : { kind }), workloadIdentity: digest, eligibleForBest: true, conditions: null,
    cells: Object.fromEntries(COLUMNS.map((column) => [column, cells[column] ?? absent("NOT_PROVIDED", "No hand-written reference for a launch case")])),
    verdicts: {},
  };
  return sealRun({
    schemaVersion: 1, id: `2026-11-19-${pin}-${id}`, startedAt: at, finishedAt: at, complete: true, inventory: ["startup-hello"],
    columns: [...COLUMNS], sourceCommit: pin, compiler: { commit: pin, sha256: digest },
    harness: { identity: digest, contract: "opaque-bit-input-v1", files: [] }, machine: { identity: "host-core-4", conditions: null },
    comparators: Object.fromEntries(COMPARATORS.map((c) => [c, null])) as RunRecord["comparators"],
    verdictPolicy: POLICY, provenance: null, rows: [row],
  });
}
const cellOf = (base: number, change?: (launches: Launch[]) => void) => launchCell(details(base, change), { argv: ["/x"] }, "");

test("the median and the interquartile ratio are what a launch cell reports", () => {
  assert.deepEqual(launchSummary([5, 1, 3, 2, 4]), { median: 3, spread: 4 / 2 });
  assert.deepEqual(launchSummary([1, 2, 3, 4]), { median: 2.5, spread: 3.25 / 1.75 });
  const cell = cellOf(1000);
  assert.equal(cell.status, "OK");
  assert.equal(cell.nanoseconds, 1100);
  assert.equal(cell.spread, 1150 / 1050);
  assert.equal(cell.checksum, out.slice(0, 16));
  // One stray launch moves neither the value nor the spread much: the reason for the median.
  const stray = cellOf(1000, (launches) => { launches[20] = launch(1_000_000); });
  assert.equal(stray.nanoseconds, 1100);
  assert.equal(stray.spread, 1150 / 1050);
});

test("a failed, timed-out or disagreeing launch makes an absent cell with its reason, never a timing", () => {
  const aborted = launchCell(details(1000, (l) => { l[4] = launch(1000, { status: 3 }); }), {}, "boom\n");
  assert.equal(aborted.status, "ABORTED");
  assert.equal(aborted.reason, "Exited 3: boom");
  assert.equal(aborted.nanoseconds, null);
  const killed = launchCell(details(1000, (l) => { l[0] = launch(1000, { status: null, signal: 11 }); }), {}, "");
  assert.equal(killed.reason, "Killed by signal 11");
  const late = launchCell(details(1000, (l) => { l[2] = launch(1000, { status: null, signal: 9, timedOut: true }); }), {}, "");
  assert.equal(late.status, "TIMED_OUT");
  const mixed = launchCell(details(1000, (l) => { l[7] = launch(1000, { stdoutSha256: other }); }), {}, "");
  assert.equal(mixed.status, "INVALID");
});

test("a launch row seals with derived verdicts against every comparator", () => {
  const run = launchRun({ "nts C": cellOf(400), "nts LLVM": cellOf(380), node: cellOf(40_000), "Bun JIT": cellOf(4000), "Bun AOT": cellOf(3500), ScriptC: cellOf(200),
    "nts JVM": absent("NOT_RUN", "Startup rows measure native executables and the engines; the JVM's launch is not in this group") });
  const row = run.rows[0]!;
  assert.equal(row.kind, "launch");
  assert.equal(row.verdicts["nts C"].node.kind, "WON");
  assert.equal(row.verdicts["nts C"].ScriptC.kind, "LOSS");
  assert.equal(row.verdicts["nts JVM"].node.kind, "UNAVAILABLE");
});

test("control: a launch cell whose measurement is missing or malformed is an instrument error, not a value", () => {
  const good = cellOf(400);
  const withLaunch = (edit: (launch: Record<string, Json>) => void): Cell => {
    const copy = structuredClone(good) as Cell & { details: { launch: Record<string, Json> } };
    edit(copy.details.launch);
    return copy;
  };
  const cases: [string, Cell, RegExp][] = [
    ["no launch details", { ...good, details: { argv: ["/x"] } }, /expected object/],
    ["no launches", withLaunch((l) => { delete l.launches; }), /timed launches/],
    ["twenty launches", withLaunch((l) => { (l.launches as Json[]).pop(); }), /expected 21 timed launches/],
    ["a failed launch", withLaunch((l) => { (l.launches as Record<string, Json>[])[3]!.status = 1; }), /failed launch/],
    ["a launch field missing", withLaunch((l) => { delete (l.launches as Record<string, Json>[])[3]!.maxRssKib; }), /missing or unknown launch field/],
    ["a non-finite time", withLaunch((l) => { (l.launches as Record<string, Json>[])[3]!.wallNanoseconds = 1.5; }), /whole number/],
    ["a different stdout", withLaunch((l) => { l.stdoutSha256 = other; }), /different output/],
    ["an unknown protocol", withLaunch((l) => { l.protocol = "launch-to-exit-v0"; }), /unknown launch protocol/],
    ["a value that is not the median", { ...good, nanoseconds: 399 }, /not the median/],
    ["a spread that is not the interquartile ratio", { ...good, spread: 1 }, /interquartile/],
    ["a checksum that is not the digest", { ...good, checksum: "0".repeat(16) }, /checksum/],
  ];
  for (const [what, cell, message] of cases) {
    assert.throws(() => checkLaunchCell(cell, "startup-hello/nts C"), message, what);
    assert.throws(() => launchRun({ "nts C": cell, node: cellOf(40_000) }), message, what);
  }
  // The same cell in a throughput row is an ordinary timing: launch details are checked only where they are the row.
  assert.doesNotThrow(() => launchRun({ "nts C": { ...good, details: null }, node: cellOf(40_000) }, "throughput", undefined, null));
  assert.throws(() => launchRun({ "nts C": good, node: cellOf(40_000) }, "odd", undefined, "warm"), /unknown row kind/);
});

test("committed runs, without row kinds or cold-startup protocols, still decode", () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const runs = readRuns(root);
  assert.ok(runs.length > 0);
  for (const run of runs) for (const row of run.rows) assert.equal(row.kind, undefined);
});

test("a launch row's own best never comes from a throughput row of the same name and workload", () => {
  const throughput = launchRun({ "nts C": { ...cellOf(1), details: null }, node: { ...cellOf(1_000_000), details: null } }, "throughput", "2026-11-18T00:00:00.000Z", null);
  const earlierLaunch = launchRun({ "nts C": cellOf(400), node: cellOf(40_000) }, "earlier", "2026-11-18T12:00:00.000Z");
  const current = launchRun({ "nts C": cellOf(500), node: cellOf(40_000) }, "current", "2026-11-19T00:00:00.000Z");
  const best = ownBest(current, current.rows[0]!, "nts C", "node", [throughput, earlierLaunch, current]);
  assert.ok(best);
  assert.equal(best.run, earlierLaunch.id);
  assert.equal(ownBest(current, current.rows[0]!, "nts C", "node", [throughput, current]), null);
});

test("cold-startup details compare only under one named protocol; legacy details have none", () => {
  const legacy: Json = { attempts: [], coldStartup: { kind: "process launch through first completed workload, separate from warm throughput", wallNanoseconds: 5, status: "OK" } };
  const timed: Json = { attempts: [], coldStartup: { protocol: LAUNCH_PROTOCOL, wallNanoseconds: 5, status: "OK" } };
  assert.equal(coldStartupProtocol(legacy), null);
  assert.equal(coldStartupProtocol(timed), LAUNCH_PROTOCOL);
  assert.equal(comparableColdStartups(legacy, timed), false);
  assert.equal(comparableColdStartups(legacy, legacy), false);
  assert.equal(comparableColdStartups(timed, timed), true);
});

function meta(): Metadata {
  return {
    schemaVersion: 1, id: `2026-11-19-${pin}-producer`, startedAt: null, finishedAt: null, complete: true, inventory: ["startup-hello"],
    columns: [...SESSION_COLUMNS], sourceCommit: pin, compiler: { commit: pin, sha256: digest },
    harness: { identity: digest, contract: "opaque-bit-input-v1", files: [] }, machine: { identity: "test", conditions: null },
    comparators: Object.fromEntries(COMPARATORS.map((c) => [c, null])) as RunRecord["comparators"], verdictPolicy: POLICY, provenance: null,
  };
}
function launchRaw(cells: Record<string, Cell>) {
  return {
    lanes: null, cases: ["startup-hello"], spoiled: [], failed: [],
    measured: [{ shown: "startup-hello", workload: { roots: ["module__init"], numeric: null }, source_capture: null,
      results: [null, null, null, null, null, null], absences: { outcomes: {} }, node: null, bun: null,
      launch: JSON.stringify(launchFrame(cells)) }],
  };
}
function launchFrame(cells: Record<string, Cell>) {
  return { kind: "launch", floor: { median: 300 }, provenance: { protocol: LAUNCH_PROTOCOL, commit: pin },
    cells: Object.fromEntries(SESSION_COLUMNS.map((column) => [column, cells[column] ?? absent("NOT_PROVIDED", "No hand-written reference for a launch case")])) };
}

test("the producer keeps a launch row's cells: an abort stays ABORTED, and output unlike node's is not timed", () => {
  const aborted = launchCell(details(400, (l) => { l[1] = launch(400, { status: 134 }); }), {}, "nts: abort");
  const row = fromNts(meta(), launchRaw({ "nts C": aborted, "nts LLVM": cellOf(380), node: cellOf(40_000) })).rows[0]!;
  assert.equal(row.kind, "launch");
  assert.equal(row.cells["nts C"]!.status, "ABORTED");
  assert.equal(row.cells["nts LLVM"]!.status, "OK");
  // Every session column is the launch row's own: a column it omits is refused, not filled in.
  const frame = launchFrame({ node: cellOf(40_000) });
  delete frame.cells["nts f64"];
  const omitting = launchRaw({});
  omitting.measured[0]!.launch = JSON.stringify(frame);
  assert.throws(() => fromNts(meta(), omitting), /launch row omits column nts f64/);
  // A launch row measured at another commit than its run is refused, not filed under the run's.
  const moved = launchRaw({});
  moved.measured[0]!.launch = JSON.stringify({ ...launchFrame({ node: cellOf(40_000) }), provenance: { protocol: LAUNCH_PROTOCOL, commit: "f".repeat(40) } });
  assert.throws(() => fromNts(meta(), moved), /measured at another commit than its run/);
  assert.deepEqual((row.conditions as Record<string, Json>).launchFloor, { median: 300 });
  const wrong = launchCell({ ...details(380, (l) => { for (const one of l) one.stdoutSha256 = other; }), warmups: [], stdoutSha256: other }, {}, "");
  assert.equal(wrong.status, "OK");
  // A cell with too few warm-ups is malformed, and the producer refuses it rather than recording it.
  assert.throws(() => fromNts(meta(), launchRaw({ "nts LLVM": wrong, node: cellOf(40_000) })), /warm-up/);
  const disagreeing = launchCell(details(380, (l) => { for (const one of l) one.stdoutSha256 = other; }), {}, "");
  assert.equal(disagreeing.status, "INVALID"); // its warm-ups printed node's output, its timed launches another
  const consistent = launchCell({ ...details(380), stdoutSha256: other, warmups: Array.from({ length: LAUNCH_WARMUPS }, () => launch(900, { stdoutSha256: other })),
    launches: details(380).launches.map((one) => ({ ...one, stdoutSha256: other })) }, {}, "");
  const sealed = fromNts(meta(), launchRaw({ "nts LLVM": consistent, node: cellOf(40_000) })).rows[0]!;
  assert.equal(sealed.cells["nts LLVM"]!.status, "INVALID");
  assert.match(sealed.cells["nts LLVM"]!.reason!, /Checksum disagreement/);
  assert.equal(sealed.cells.node!.status, "INVALID");
});

test("full.md shows a launch group as per-launch times beside the timer's floor, losing rows included", () => {
  const run = launchRun({ "nts C": cellOf(400), "nts LLVM": cellOf(380), node: cellOf(40_000), ScriptC: cellOf(200) });
  const withFloor = sealRun({ ...run, rows: [{ ...run.rows[0]!, conditions: { launchFloor: { median: 300_000 } } }] });
  const text = renderFull([withFloor], [{ name: "startup", pages: ["docs/foundations/memory.md"], rows: ["startup-hello"] }]);
  assert.match(text, /## startup\n\nDeclared by .*\n\nLaunch rows: each time is one process from launch to exit/);
  assert.match(text, /- startup-hello, launch floor: 300\.00 µs \(\/bin\/true in the same sitting\)/);
  assert.match(text, /LOSS/);
});
