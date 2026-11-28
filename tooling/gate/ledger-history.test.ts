// The ledger history replay: its log lines, its pairing of waits, its reading
// of the ledger's own records, and its attribution, on lines and records
// written here.
//
//   node --test tooling/gate/ledger-history.test.ts
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { attributeEpisode, formatReport, gateRun, historyEpisodes, holderKind, logEpisodes, logHeld, parseLogLine, readLedgerHistory, replay, runOf } from "./ledger-history.ts";
import { LEDGER_HISTORY_VERSION, type HistoryHolder, type LedgerHistoryRecord } from "./ledger-history-record.ts";
import { testScratch } from "./test-scratch.ts";

const GiB = 2 ** 30, MiB = 2 ** 20;

const WAIT = "memory: 1049 prepared HIR tests/programs/a/tsconfig.json waits for 128.0 MiB (agent): 14.7 GiB available, 12.5 GiB of it promised to running jobs, 2.0 GiB kept for the system; 3 ahead of it in the queue";
const CENSUS = "memory: held now, of 16.3 GiB not available: nts.slice/nts-r09.slice 5.6 GiB: ledgered 5.5 GiB agent gate run /home/u/.cache/nts-landing/runs/here-e8b29b…; 34.1 MiB unledgered"
  + " | app.slice/nts-896-hir.service 465.6 MiB unledgered | nts.slice/run-p3.scope 321.3 MiB: ledgered 182.7 MiB agent 1049 five populations, 130.4 MiB agent conformance262 --backend c: 8405 case(s); 8.2 MiB unledgered"
  + "; 4.6 GiB outside these cgroups (system, kernel, caches)";

test("the ledger's wait, admission and census lines are read as the ledger writes them, colored or not", () => {
  assert.deepEqual(parseLogLine(`  \x1b[1m${WAIT}\x1b[0m`), { kind: "wait", what: "1049 prepared HIR tests/programs/a/tsconfig.json", grow: false, ask: 128 * MiB,
    priority: "agent", available: 14.7 * GiB, pending: 12.5 * GiB, floor: 2 * GiB, ahead: 3, fits: true });
  const grow = parseLogLine("memory: gate run /r waits to grow by 2.0 GiB to 19.0 GiB (agent): 14.7 GiB available, 12.5 GiB of it promised to running jobs, 2.0 GiB kept for the system; it could not fit even were every admitted job to end, so it holds nobody");
  assert.equal(grow?.kind === "wait" && [grow.grow, grow.ask, grow.ahead, grow.fits].join(), "true,2147483648,0,false");
  assert.deepEqual(parseLogLine("memory: x admitted with 5.9 GiB after 416 s"), { kind: "done", what: "x", waited_s: 416 });
  assert.deepEqual(parseLogLine("memory: gate run /r grew by 1.0 GiB to 3.0 GiB after 2 s"), { kind: "done", what: "gate run /r", waited_s: 2 });
  assert.deepEqual(parseLogLine(CENSUS), { kind: "census", rows: [
    { cgroup: "nts.slice/nts-r09.slice", charge: 5.6 * GiB, jobs: [{ bytes: 5.5 * GiB, priority: "agent", what: "gate run /home/u/.cache/nts-landing/runs/here-e8b29b…" }] },
    { cgroup: "app.slice/nts-896-hir.service", charge: 465.6 * MiB, jobs: [] },
    { cgroup: "nts.slice/run-p3.scope", charge: 321.3 * MiB, jobs: [{ bytes: 182.7 * MiB, priority: "agent", what: "1049 five populations" },
      { bytes: 130.4 * MiB, priority: "agent", what: "conformance262 --backend c: 8405 case(s)" }] },
  ] });
  assert.equal(parseLogLine("memory: dropped x's reservation of 1.0 GiB: its owner, pid 3, has exited"), null);
});

test("a logged wait pairs with its admission in its own log, keeps the census after it, and a copy in another log counts once", () => {
  const lines = [
    { source: "a.log", text: WAIT }, { source: "a.log", text: CENSUS },
    { source: "b.log", text: WAIT.replace("128.0 MiB (agent)", "64.0 MiB (agent)") },
    { source: "a.log", text: "memory: 1049 prepared HIR tests/programs/a/tsconfig.json admitted with 128.0 MiB after 90 s" },
    { source: "copy.log", text: WAIT }, { source: "copy.log", text: "memory: 1049 prepared HIR tests/programs/a/tsconfig.json admitted with 128.0 MiB after 90 s" },
    // An admission in another log closes nothing here.
    { source: "c.log", text: "memory: 1049 prepared HIR tests/programs/a/tsconfig.json admitted with 64.0 MiB after 5 s" },
  ];
  const episodes = logEpisodes(lines);
  assert.equal(episodes.length, 1, "b.log's wait never ended in b.log, and copy.log repeats a.log");
  assert.equal(episodes[0]!.waited_s, 90);
  assert.equal(episodes[0]!.census?.length, 3);
  assert.equal(logHeld(episodes[0]!), true, "128 MiB fits 0.2 GiB of room, behind three");
  assert.equal(logHeld({ ...episodes[0]!, ahead: 0 }), false, "nothing ahead holds it: it waits for room");
  assert.equal(logHeld({ ...episodes[0]!, ask: GiB }), false, "it did not fit the room");
  assert.equal(logHeld({ ...episodes[0]!, fits: false }), false, "it could not fit the machine: it held nobody and nobody held it");
});

/** A holder of `bytes` using `used`, promising the waiter what it has not used unless told otherwise (a yielding or live holder promises less). */
const holder = (what: string, bytes: number, used: number, extra: Partial<HistoryHolder> = {}): HistoryHolder =>
  ({ id: what, what, priority: "agent", since: "2026-11-28T00:00:00.000Z", bytes, used_bytes: used, promised_bytes: bytes - used, lent_bytes: 0, drawn_bytes: 0, draws_on: null, live_use: false, ...extra });
const record = (kind: LedgerHistoryRecord["kind"], waited: number, admitted: HistoryHolder[],
  extra: { ahead?: number; room?: number; bytes?: number; busy?: boolean; from?: string } = {}): LedgerHistoryRecord => {
  const from = Date.parse(extra.from ?? "2026-11-28T03:00:00.000Z"), ahead = extra.ahead ?? 1;
  return {
    version: LEDGER_HISTORY_VERSION, kind, at: new Date(from + waited * 1000).toISOString(), waited_s: waited,
    request: { id: "w", what: "1085 count", priority: "agent", since: new Date(from).toISOString(), bytes: extra.bytes ?? 128 * MiB, grows: null, drawn_bytes: 0, fits: true },
    machine: { available_bytes: 10 * GiB, pending_bytes: 7 * GiB, room_bytes: extra.room ?? GiB, floor_bytes: 2 * GiB },
    resource_busy: extra.busy ?? false, ahead,
    head: ahead ? { id: "h0", what: "gate run /runs/head", priority: "agent", bytes: 5 * GiB, grows: "g", fits: true } : null,
    admitted,
  };
};

test("a held wait charges each holder what its decision counted it as promising over each census interval, and a gate run's share goes to its running steps above their peaks", () => {
  const run = gateRun("/runs/r1", { started: "2026-11-28T02:59:00.000Z", steps: [
    // Running through the first interval only: 4 GiB granted above its 1 GiB peak.
    { name: "rust-inputs", started_at: "2026-11-28T02:59:00.000Z", wall: 200, memory: { grant_bytes: 5 * GiB, peak_bytes: GiB } },
    // Running throughout, at its peak.
    { name: "format", started_at: "2026-11-28T02:59:30.000Z", wall: 1000, memory: { grant_bytes: GiB, peak_bytes: GiB } },
    { name: "no memory", started_at: "2026-11-28T02:59:30.000Z", wall: 1000 },
  ] })!;
  assert.deepEqual(run.steps.map(step => step.name), ["rust-inputs", "format"], "a step without a memory record is left out");
  const runs = new Map([[run.path, run]]);
  const gate = holder("gate run /runs/r1", 10 * GiB, 3 * GiB);
  const [episode] = historyEpisodes([
    record("census", 300, [gate, holder("1043 hir-compare tests/programs/x", GiB, GiB)]),
    record("wait", 0, [gate, holder("1043 hir-compare tests/programs/x", 2 * GiB, GiB),
      // It yields to the waiter: 6 GiB unused, but its decision counted only its 0.5 GiB margin.
      holder("lower census", 8 * GiB, 2 * GiB, { priority: "full-check", promised_bytes: GiB / 2 }),
      holder("unmeasured", GiB, GiB, { live_use: true, promised_bytes: GiB / 4 })]),
    record("admitted", 420, []),
  ]);
  assert.equal(episode!.held, true);
  assert.equal(episode!.waited_s, 420);
  assert.deepEqual(episode!.records.map(r => r.kind), ["wait", "census", "admitted"]);
  const held = attributeEpisode(episode!, runs);
  // First interval, 300 s: the run had 7 GiB above use; rust-inputs accounts for 4, the rest is the run's own.
  // Second interval, 120 s: rust-inputs has ended, so all 7 GiB are the run's own.
  assert.deepEqual(Object.fromEntries([...held].map(([key, h]) => [key, [h.byte_s / GiB, h.most / GiB, h.seconds]])), {
    "gate run: rust-inputs": [4 * 300, 4, 300],
    "gate run: no running step's (run slack, withheld or pending demand)": [3 * 300 + 7 * 120, 7, 420],
    "hir-compare <path>": [300, 1, 300],
    "lower census": [150, 0.5, 300],
    "unmeasured": [75, 0.25, 300],
  }, "each holder is charged its promise, never its reservation less its use");
});

test("a wait is held only when it fit the room it saw and something was ahead of it", () => {
  const holders = [holder("x", 2 * GiB, GiB)];
  assert.equal(historyEpisodes([record("wait", 0, holders, { ahead: 0 })])[0]!.held, false);
  assert.equal(historyEpisodes([record("wait", 0, holders, { room: 64 * MiB })])[0]!.held, false);
  assert.equal(historyEpisodes([record("wait", 0, holders)])[0]!.held, true);
  assert.equal(historyEpisodes([record("wait", 0, holders, { busy: true })])[0]!.held, false, "memory admitted it: it waited for its joint resource");
  const [partial] = historyEpisodes([record("census", 300, holders), record("admitted", 400, [])]);
  assert.deepEqual([partial!.started, partial!.held], [null, false], "without its start, a wait is never judged held from a census");
});

test("the history is read day by day, and a line of an unknown version or cut short is named, not read", t => {
  const dir = join(testScratch(t, "ledger-history"), "history");
  mkdirSync(dir, { recursive: true });
  const ok = record("wait", 0, []);
  writeFileSync(join(dir, "2026-11-28.jsonl"), `${JSON.stringify(ok)}\n${JSON.stringify({ ...ok, version: 3 })}\n{"version":1,"ki\n`);
  writeFileSync(join(dir, "2026-11-27.jsonl"), `${JSON.stringify({ ...ok, at: "2026-11-27T23:00:00.000Z" })}\n`);
  writeFileSync(join(dir, "notes.txt"), "not a day\n");
  const read = readLedgerHistory(dir);
  assert.deepEqual(read.records.map(r => r.at), ["2026-11-27T23:00:00.000Z", ok.at]);
  assert.deepEqual(read.unread.map(u => [u.line, u.why]), [[2, "version 3, not 2"], [3, "not JSON (a write cut short)"]]);
  assert.deepEqual(readLedgerHistory(dir, Date.parse("2026-11-28T00:30:00.000Z")).records.map(r => r.at), [ok.at], "a day before --since is not read");
  assert.deepEqual(readLedgerHistory(join(dir, "absent")), { records: [], unread: [] });
});

test("a census names a gate run by its folder cut short; a holder's kind drops its paths, commit and issue", () => {
  const runs = new Map([["/c/runs/here-e8b29b7bba44-1", gateRun("/c/runs/here-e8b29b7bba44-1", { steps: [] })!],
    ["/c/runs/here-ffff-2", gateRun("/c/runs/here-ffff-2", { steps: [] })!]]);
  assert.equal(runOf("gate run /c/runs/here-e8b29b…", runs)?.path, "/c/runs/here-e8b29b7bba44-1");
  assert.equal(runOf("gate run /c/runs/here-…", runs), undefined, "two folders begin so: neither is named");
  assert.equal(runOf("gate run /c/runs/here-ffff-2", runs)?.path, "/c/runs/here-ffff-2");
  assert.equal(runOf("landing build of 6c56bb6e3a27", runs), undefined);
  assert.equal(holderKind("1049 parallel prepared HIR benchmarks/cases/strings"), "parallel prepared HIR <path>");
  assert.equal(holderKind("pinned compiler preparation a522452bba"), "pinned compiler preparation <commit>");
  assert.equal(holderKind("gate run /c/runs/x"), "gate run");
});

test("--since keeps the waits that started after it, whole, and none that started before it", () => {
  const holders = [holder("x", 2 * GiB, GiB)];
  const before = ["wait", "census", "admitted"].map((kind, at) => record(kind as LedgerHistoryRecord["kind"], at * 300, holders, { from: "2026-11-27T23:55:00.000Z" }));
  const after = ["wait", "admitted"].map((kind, at) => ({ ...record(kind as LedgerHistoryRecord["kind"], at * 60, holders, { from: "2026-11-28T00:01:00.000Z" }),
    request: { ...record("wait", 0, []).request, id: "later" } }));
  const report = replay({ records: [...before, ...after], unread: 0, logs: [], files: 0, runs: new Map(), since: Date.parse("2026-11-28T00:00:00.000Z") });
  assert.deepEqual([report.history.waits, report.history.held, report.history.held_s, report.history.records], [1, 1, 60, 2]);
});

test("the replay keeps what is since its start, and reports both sources", () => {
  const runs = new Map<string, NonNullable<ReturnType<typeof gateRun>>>();
  const old = { ...record("wait", 0, [holder("x", 2 * GiB, GiB)]), at: "2026-11-20T00:00:00.000Z" };
  old.request = { ...old.request, id: "old" };
  const records = [old, record("wait", 0, [holder("x", 2 * GiB, GiB)]), record("admitted", 60, [])];
  const logs = logEpisodes([{ source: "a.log", text: WAIT }, { source: "a.log", text: CENSUS },
    { source: "a.log", text: "memory: 1049 prepared HIR tests/programs/a/tsconfig.json admitted with 128.0 MiB after 90 s" }]);
  const report = replay({ records, unread: 0, logs, files: 1, runs, since: Date.parse("2026-11-28T00:00:00.000Z") });
  assert.equal(report.history.records, 2);
  assert.equal(report.history.waits, 1);
  assert.equal(report.history.held, 1);
  assert.deepEqual(report.history.holders, [{ holder: "x", gib_s: 60, most_gib: 1, seconds: 60 }]);
  assert.equal(report.logs.held, 1);
  assert.equal(report.logs.with_gate_run, 1);
  assert.equal(report.logs.unused_median_gib, 12.5);
  const text = formatReport(report);
  assert.match(text, /^ledger history replay since 2026-11-28T00:00:00\.000Z$/m);
  assert.match(text, /held at the head of the line: 1, waiting 60 s/);
  assert.match(text, /a gate run among its ledgered holders: 1, waiting 90 s/);
});
