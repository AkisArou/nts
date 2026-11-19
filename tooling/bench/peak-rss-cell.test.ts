import assert from "node:assert/strict";
import { test } from "node:test";
import { COLUMNS, COMPARATORS, POLICY, SESSION_COLUMNS, ownBest, parseRun, renderFull, results, sealRun, type Cell, type Json, type RunRecord } from "./run-record.ts";
import { fromNts, type Metadata } from "./run-producers.ts";
import { LAUNCH_COUNT, LAUNCH_PROTOCOL, LAUNCH_WARMUPS, launchCell, type Launch, type LaunchDetails } from "./launch-cell.ts";
import { PEAK_RSS_KIND, checkPeakRssCell, peakRssCell, peakRssGrowth, peakRssOf } from "./peak-rss-cell.ts";

const pin = "a".repeat(40), digest = "b".repeat(64), out = "c".repeat(64), env = "e".repeat(64);
const launch = (wallNanoseconds: number, maxRssKib: number, change: Partial<Launch> = {}): Launch => ({
  wallNanoseconds, status: 0, signal: null, timedOut: false, userMicroseconds: 100, systemMicroseconds: 50, maxRssKib, siblingTicks: 0,
  stdoutSha256: out, ...change,
});
/** A column's sitting: timed launches around `wall` ns and `rss` KiB. */
function details(wall: number, rss: number, change: (launches: Launch[]) => void = () => {}): LaunchDetails {
  const launches = Array.from({ length: LAUNCH_COUNT }, (_, i) => launch(wall + i * 10, rss + i));
  change(launches);
  return { protocol: LAUNCH_PROTOCOL, warmups: Array.from({ length: LAUNCH_WARMUPS }, () => launch(wall * 3, rss)), launches, stdoutSha256: out, environmentSha256: env };
}
const cellOf = (wall: number, rss: number, change?: (launches: Launch[]) => void): Cell =>
  peakRssCell(launchCell(details(wall, rss, change), { argv: ["/x"] }, ""), "row/column");
const absent = (status: Cell["status"], reason: string): Cell =>
  ({ status, nanoseconds: null, spread: null, checksum: null, verified: false, reason, details: null, peakRss: null });

type Sizes = Record<number, Record<string, Cell>>;
function peakRow(name: string, input: number, cells: Record<string, Cell>, base = "clbg-binary-trees") {
  return {
    name, kind: PEAK_RSS_KIND, sized: { case: base, function: "work", input }, workloadIdentity: digest, eligibleForBest: true, conditions: null,
    cells: Object.fromEntries(COLUMNS.map((column) => [column, cells[column] ?? absent("NOT_PROVIDED", "A peak-RSS row launches a whole program")])),
    verdicts: {},
  };
}
function peakRun(sizes: Sizes, id = "peak", at = "2026-11-19T00:00:00.000Z", extra: object[] = []): RunRecord {
  const rows = [...Object.entries(sizes).map(([input, cells]) => peakRow(`rss-clbg-binary-trees-${input}`, Number(input), cells)), ...extra];
  return sealRun({
    schemaVersion: 1, id: `2026-11-19-${pin}-${id}`, startedAt: at, finishedAt: at, complete: true, inventory: rows.map((row) => (row as { name: string }).name),
    columns: [...COLUMNS], sourceCommit: pin, compiler: { commit: pin, sha256: digest },
    harness: { identity: digest, contract: "opaque-bit-input-v1", files: [] }, machine: { identity: "host-core-4", conditions: null },
    comparators: Object.fromEntries(COMPARATORS.map((c) => [c, null])) as RunRecord["comparators"],
    verdictPolicy: POLICY, provenance: null, rows,
  });
}
/** Three sizes where every column's time and memory grow; nts C uses about a tenth of node's bytes. */
const growing = (): Sizes => Object.fromEntries([10, 12, 14].map((input, i) => [input, {
  "nts C": cellOf(400 * (i + 1), 2_000 * (i + 1)), "nts LLVM": cellOf(380 * (i + 1), 2_500 * (i + 1)),
  node: cellOf(40_000 * (i + 1), 50_000 + 4_000 * i), "Bun JIT": cellOf(20_000 * (i + 1), 30_000 + 3_000 * i),
  "Bun AOT": cellOf(15_000 * (i + 1), 2_000 * (i + 1)), ScriptC: cellOf(500 * (i + 1), 1_900 * (i + 1)),
}]));

test("a peak-RSS cell's memory is the median and interquartile ratio of the same launches that time it", () => {
  const cell = cellOf(1000, 2048);
  assert.equal(cell.status, "OK");
  assert.equal(cell.nanoseconds, 1100);
  assert.deepEqual(cell.peakRss, { bytes: (2048 + 10) * 1024, spread: (2048 + 15) / (2048 + 5) });
  assert.deepEqual(peakRssOf(details(1, 7).launches, "x"), cell.peakRss && { bytes: 17 * 1024, spread: 22 / 12 });
  // An absent cell has no peak RSS, and says so.
  const aborted = peakRssCell(launchCell(details(1000, 2048, (l) => { l[3] = launch(1000, 2048, { status: 1 }); }), {}, "boom"), "x");
  assert.equal(aborted.status, "ABORTED");
  assert.equal(aborted.peakRss, null);
});

test("control: a peak-RSS cell whose measurement is missing or malformed is an instrument error, not a value", () => {
  const good = cellOf(400, 2000);
  const withLaunches = (edit: (launches: Record<string, Json>[]) => void): Cell => {
    const copy = structuredClone(good) as Cell & { details: { launch: { launches: Record<string, Json>[] } } };
    edit(copy.details.launch.launches);
    return copy;
  };
  const cases: [string, Cell, RegExp][] = [
    ["no peakRss field", (({ peakRss: _, ...rest }) => rest)(good) as Cell, /has no peakRss|missing or unknown field/],
    ["a null peak RSS on an OK cell", { ...good, peakRss: null }, /not the median/],
    ["a peak RSS its launches do not derive", { ...good, peakRss: { bytes: good.peakRss!.bytes + 1024, spread: good.peakRss!.spread } }, /not the median/],
    ["a spread its launches do not derive", { ...good, peakRss: { bytes: good.peakRss!.bytes, spread: 1 } }, /interquartile/],
    ["a launch with no resident set", withLaunches((l) => { l[0]!.maxRssKib = 0; }), /no peak resident set/],
    ["a launch whose resident set is missing", withLaunches((l) => { delete l[0]!.maxRssKib; }), /missing or unknown launch field/],
    ["a launch whose resident set is not a count", withLaunches((l) => { l[0]!.maxRssKib = 1.5; }), /whole number/],
    ["twenty launches", withLaunches((l) => { l.pop(); }), /expected 21 timed launches/],
    ["an absent cell carrying a peak RSS", { ...absent("ABORTED", "Exited 1"), peakRss: { bytes: 1024, spread: 1 } }, /absent cell carries a peak RSS/],
  ];
  for (const [what, cell, message] of cases) {
    assert.throws(() => checkPeakRssCell(cell, "rss/nts C"), message, what);
    const sizes = growing();
    sizes[12]!["nts C"] = cell;
    assert.throws(() => peakRun(sizes), message, what);
  }
  // A peak RSS on a throughput or launch row's cell is an unknown field there, and a peak-RSS row needs its sized workload.
  const throughput = peakRow("objects", 1, { "nts C": good, node: cellOf(40_000, 50_000) });
  assert.throws(() => peakRun({}, "t", undefined, [{ ...throughput, kind: undefined, sized: undefined }].map(({ kind: _k, sized: _s, ...row }) => row)), /missing or unknown field|peakRss|sized/);
  const unsized = (({ sized: _, ...row }) => row)(peakRow("rss-x-1", 1, { node: cellOf(40_000, 50_000) }));
  assert.throws(() => peakRun({}, "u", undefined, [unsized]), /sized workload/);
});

test("growth: a column whose time rises at every larger input GROWS; a flat one is FLAT; below two sizes UNESTABLISHED", () => {
  const sizes = growing();
  // ScriptC's time stops rising at the largest input: whatever it did, it has not shown it ran the work.
  sizes[14]!.ScriptC = cellOf(1000, 1_900 * 3);
  // Bun AOT ran at only one size.
  sizes[12]!["Bun AOT"] = absent("ABORTED", "Exited 1");
  sizes[14]!["Bun AOT"] = absent("ABORTED", "Exited 1");
  const run = peakRun(sizes), row = run.rows.find((one) => one.name === "rss-clbg-binary-trees-12")!;
  assert.equal(row.kind, PEAK_RSS_KIND);
  assert.deepEqual(row.sized, { case: "clbg-binary-trees", function: "work", input: 12 });
  assert.equal(row.growth!["nts C"], "GROWS");
  assert.equal(row.growth!.node, "GROWS");
  assert.equal(row.growth!.ScriptC, "FLAT");
  assert.equal(row.growth!["Bun AOT"], "UNESTABLISHED");
  assert.equal(row.growth!["nts JVM"], "UNESTABLISHED");
  // Every row of a case shares its case's growth.
  for (const one of run.rows) assert.deepEqual(one.growth, row.growth);
  // Control: work done in constant memory GROWS, its time rising; its bytes are what it is ranked by, and it is ranked.
  const constant = growing();
  for (const input of [10, 12, 14]) constant[input]!["nts C"] = cellOf(400 * (input - 9), 2_000);
  const streamed = peakRun(constant);
  assert.equal(streamed.rows[0]!.growth!["nts C"], "GROWS");
  for (const one of streamed.rows) assert.equal(one.verdicts["nts C"].node.kind, "WON");
  // And a column whose memory rises with its time flat is FLAT: memory alone does not show the work ran.
  const memory = growing();
  memory[14]!["nts LLVM"] = cellOf(380 * 2, 2_500 * 3);
  assert.equal(peakRun(memory).rows[0]!.growth!["nts LLVM"], "FLAT");
  // Two rows of one case at one input are an error, not two observations.
  assert.throws(() => peakRssGrowth([
    { name: "a", sized: { case: "c", function: "work", input: 1 }, cells: {} },
    { name: "b", sized: { case: "c", function: "work", input: 1 }, cells: {} },
  ], []), /two peak-RSS rows of c at input 1/);
});

test("verdicts hold the bar's ratios to peak bytes; a comparison with a column that does not grow is SUSPECT, never ranked", () => {
  const sizes = growing();
  sizes[14]!.ScriptC = cellOf(1000, 1_900 * 3);
  const run = peakRun(sizes), row = run.rows.find((one) => one.name === "rss-clbg-binary-trees-14")!;
  const c = row.verdicts["nts C"];
  // 6000 KiB median-ish against node's 58000: won on bytes, though node's time is what a timing row would compare.
  assert.equal(c.node.kind, "WON");
  assert.equal(c.node.ratio, row.cells["nts C"]!.peakRss!.bytes / row.cells.node!.peakRss!.bytes);
  assert.equal(c["Bun AOT"].kind, "TIE");
  assert.equal(c["Bun AOT"].tolerance, Math.max(1.05, row.cells["nts C"]!.peakRss!.spread, row.cells["Bun AOT"]!.peakRss!.spread));
  // nts LLVM uses more bytes than Bun AOT: a losing row stays a loss.
  assert.equal(row.verdicts["nts LLVM"]["Bun AOT"].kind, "LOSS");
  // ScriptC is flat: the comparison keeps its ratio and is SUSPECT, never WON.
  assert.equal(c.ScriptC.kind, "SUSPECT");
  assert.equal(c.ScriptC.ratio, row.cells["nts C"]!.peakRss!.bytes / row.cells.ScriptC!.peakRss!.bytes);
  assert.equal(c.ScriptC.tolerance, null);
  assert.equal(row.verdicts["nts JVM"].node.kind, "UNAVAILABLE");
  // A flat nts column is SUSPECT against every comparator, even ones it beats.
  const flat = growing();
  flat[14]!["nts C"] = cellOf(400 * 2, 2_000 * 3);
  for (const comparator of COMPARATORS) assert.equal(peakRun(flat).rows[2]!.verdicts["nts C"][comparator].kind, "SUSPECT");
  // The recorded growth and verdicts are re-derived on every read.
  const recorded = JSON.parse(JSON.stringify(run));
  assert.doesNotThrow(() => parseRun(recorded));
  const forged = JSON.parse(JSON.stringify(run));
  forged.rows[2].growth.ScriptC = "GROWS";
  assert.throws(() => parseRun(forged), /changed or missing recorded growth/);
  const lost = JSON.parse(JSON.stringify(run));
  delete lost.rows[0].growth;
  assert.throws(() => parseRun(lost), /expected object/);
});

test("a peak-RSS row's own best is of bytes, from the same kind, and never from a column that does not grow", () => {
  const earlier = growing();
  for (const sizes of Object.values(earlier)) sizes["nts C"] = { ...sizes["nts C"]! };
  const prior = peakRun(earlier, "earlier", "2026-11-18T00:00:00.000Z");
  const current = peakRun(growing(), "current", "2026-11-19T00:00:00.000Z");
  const row = current.rows[0]!;
  const best = ownBest(current, row, "nts C", "node", [prior, current]);
  assert.ok(best);
  assert.equal(best.run, prior.id);
  assert.equal(best.backendValue, prior.rows[0]!.cells["nts C"]!.peakRss!.bytes);
  // A prior run where nts C was flat offers no best.
  const flat = growing();
  flat[14]!["nts C"] = cellOf(400 * 2, 2_000 * 3);
  assert.equal(ownBest(current, row, "nts C", "node", [peakRun(flat, "flat", "2026-11-18T00:00:00.000Z"), current]), null);
  // The model's comparison is of bytes, and LLVM versus C too.
  const model = results([prior, current])!, first = model.rows.find((one) => one.row.name === row.name)!;
  assert.equal(first.backends["nts C"].ownBest.node!.currentRatio, row.cells["nts C"]!.peakRss!.bytes / row.cells.node!.peakRss!.bytes);
  assert.equal(first.llvmVersusC!.ratio, row.cells["nts LLVM"]!.peakRss!.bytes / row.cells["nts C"]!.peakRss!.bytes);
});

function meta(names: string[]): Metadata {
  return {
    schemaVersion: 1, id: `2026-11-19-${pin}-producer`, startedAt: null, finishedAt: null, complete: true, inventory: names,
    columns: [...SESSION_COLUMNS], sourceCommit: pin, compiler: { commit: pin, sha256: digest },
    harness: { identity: digest, contract: "opaque-bit-input-v1", files: [] }, machine: { identity: "test", conditions: null },
    comparators: Object.fromEntries(COMPARATORS.map((c) => [c, null])) as RunRecord["comparators"], verdictPolicy: POLICY, provenance: null,
  };
}
function frame(input: number, cells: Record<string, Cell>) {
  return { kind: PEAK_RSS_KIND, sized: { case: "clbg-binary-trees", function: "work", input }, floor: { median: 300, launch: details(300, 1500) },
    provenance: { protocol: LAUNCH_PROTOCOL, commit: pin },
    cells: Object.fromEntries(SESSION_COLUMNS.map((column) => [column, cells[column] ?? absent("NOT_PROVIDED", "A peak-RSS row launches a whole program")])) };
}
function raw(frames: [string, ReturnType<typeof frame>][]) {
  return {
    lanes: null, cases: frames.map(([name]) => name), spoiled: [], failed: [],
    measured: frames.map(([name, value]) => ({ shown: name, workload: { roots: ["module__init"], numeric: null }, source_capture: null,
      results: [null, null, null, null, null, null], absences: { outcomes: {} }, node: null, bun: null, launch: JSON.stringify(value) })),
  };
}

test("the producer keeps a peak-RSS row's cells and workload, and refuses a frame that is not one", () => {
  const sizes = growing(), names = [10, 12, 14].map((input) => `rss-clbg-binary-trees-${input}`);
  const run = fromNts(meta(names), raw([10, 12, 14].map((input, i) => [names[i]!, frame(input, sizes[input]!)])));
  assert.deepEqual(run.rows.map((row) => [row.kind, row.sized?.input, row.growth?.["nts C"]]), [[PEAK_RSS_KIND, 10, "GROWS"], [PEAK_RSS_KIND, 12, "GROWS"], [PEAK_RSS_KIND, 14, "GROWS"]]);
  assert.equal(run.rows[2]!.verdicts["nts C"].node.kind, "WON");
  // A cell whose output differs from node's is not ranked, and keeps saying it has no peak RSS.
  const disagreeing = growing();
  disagreeing[12]!["nts LLVM"] = cellOf(800, 5_000, (l) => { for (const one of l) one.stdoutSha256 = "f".repeat(64); });
  const invalid = fromNts(meta(names), raw([10, 12, 14].map((input, i) => [names[i]!, frame(input, disagreeing[input]!)]))).rows[1]!;
  assert.equal(invalid.cells["nts LLVM"]!.status, "INVALID");
  assert.equal(invalid.cells["nts LLVM"]!.peakRss, null);
  // A launch-to-exit cell where a peak-RSS row wants one with peakRss is a malformed frame.
  const timed = frame(10, {});
  timed.cells["nts C"] = launchCell(details(400, 2000), {}, "") as typeof timed.cells[string];
  assert.throws(() => fromNts(meta([names[0]!]), raw([[names[0]!, timed]])), /malformed launch cell/);
  const unsized = frame(10, sizes[10]!) as Partial<ReturnType<typeof frame>>;
  delete unsized.sized;
  assert.throws(() => fromNts(meta([names[0]!]), raw([[names[0]!, unsized as ReturnType<typeof frame>]])), /malformed frame/);
});

test("full.md shows a peak-RSS group's memory beside time, its baselines, ratios and verdicts, losing and suspect rows included", () => {
  const sizes = growing();
  sizes[14]!.ScriptC = cellOf(1000, 1_900 * 3);
  const empty = {
    name: "startup-empty", kind: "launch", workloadIdentity: digest, eligibleForBest: true, conditions: null, verdicts: {},
    cells: Object.fromEntries(COLUMNS.map((column) => [column, column === "nts C" || column === "node"
      ? launchCell(details(300, column === "node" ? 45_000 : 1_200), {}, "") : { ...absent("NOT_RUN", "not here"), peakRss: undefined }])),
  };
  for (const cell of Object.values(empty.cells)) delete (cell as Partial<Cell>).peakRss;
  const run = peakRun(sizes, "render", undefined, [empty]);
  const floored = sealRun({ ...run, rows: run.rows.map((row) => row.kind === PEAK_RSS_KIND ? { ...row, conditions: { launchFloor: { median: 300_000, launch: details(300_000, 1_400) as unknown as Json } } } : row) });
  const text = renderFull([floored], [{ name: "peak-rss", pages: ["docs/foundations/memory.md"], rows: ["rss-clbg-binary-trees-10", "rss-clbg-binary-trees-12", "rss-clbg-binary-trees-14"] }]);
  assert.match(text, /## peak-rss\n\nDeclared by .*\n\nPeak-RSS rows: each cell is the median peak resident set/);
  assert.match(text, /Baselines: startup-empty's peak RSS in this run, the program that does nothing: nts C 1\.18 MiB, node 43\.96 MiB\./);
  assert.match(text, /- rss-clbg-binary-trees-14, floor: \/bin\/true peak RSS 1\.38 MiB, 300\.00 µs \(the same sitting\)/);
  // A case's rows read by input, whatever their names sort as.
  const order = text.split("\n").filter((one) => one.startsWith("|rss-")).map((one) => one.split("|")[1]);
  assert.deepEqual(order, ["rss-clbg-binary-trees-10", "rss-clbg-binary-trees-12", "rss-clbg-binary-trees-14"]);
  assert.deepEqual(results([{ ...floored, rows: floored.rows.map((row) => row.sized?.input === 10 ? { ...row, name: "rss-clbg-binary-trees-z" } : row),
    inventory: floored.inventory.map((name) => name === "rss-clbg-binary-trees-10" ? "rss-clbg-binary-trees-z" : name) }])!.rows
    .filter((one) => one.row.sized).map((one) => one.row.sized!.input), [10, 12, 14]);
  // The order is total: sorted by case, function and input, never by a mix of names and inputs.
  const cases = (names: [string, string, number][]) => results([peakRun({}, "order", undefined,
    names.map(([name, base, input]) => peakRow(name, input, growing()[10]!, base)))])!.rows.map((one) => one.row.name);
  const mixed: [string, string, number][] = [["rss-fasta-16384", "fasta", 16384], ["rss-fasta-2d-50", "fasta-2d", 50], ["rss-fasta-8192", "fasta", 8192]];
  for (const order of [mixed, [...mixed].reverse(), [mixed[1]!, mixed[0]!, mixed[2]!]])
    assert.deepEqual(cases(order), ["rss-fasta-8192", "rss-fasta-16384", "rss-fasta-2d-50"]);
  const line = text.split("\n").find((one) => one.startsWith("|rss-clbg-binary-trees-14|"))!;
  assert.match(line, /\|5\.87 MiB · 1\.30 µs\|/);
  assert.match(line, /\(FLAT\)/);
  assert.match(line, /SUSPECT/);
  assert.match(line, /LOSS/);
  assert.match(line, /WON/);
});
