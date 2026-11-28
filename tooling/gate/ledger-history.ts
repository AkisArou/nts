// How long requests waited in the memory ledger while they could have fit, and
// who held the memory they could not have:
//
//   node tooling/gate/ledger-history.ts [--since <ISO time|commit>] [--json] [--history <dir>] [<log root>...]
//
// A request is **held at the head of the line** when it started waiting
// although it fit the room the ledger saw (what it asked was at most the
// available memory less what running jobs still promise and the system's
// floor, and it could fit were every admitted job to end), because a request
// ahead of it did not. The replay counts each such wait once and adds up how
// long it waited, by kind of request.
//
// It reads two sources:
//
// - **The ledger's history** (ledger-history-record.ts, `<ledger>/history/`):
//   a record when a wait starts, at each holders census and at admission,
//   each with every admitted reservation's bytes and use. For each held wait
//   it attributes the memory reserved above use, holder by holder, over the
//   interval to the next record, so the attribution has the census's
//   granularity (five minutes). A gate run's share is split among its steps
//   that were running then, by what each was granted above its own measured
//   peak (the run's summary.json), and what no step accounts for is the run's
//   own.
// - **Logs that predate it**: every `.log` and `.txt` file under the log roots
//   (default: ~/.cache/nts-scratch, ~/.cache/nts-landing/runs and
//   ~/.cache/nts-full-check/runs), whose ledger lines carry no time and no
//   reservation per holder. From those it pairs each "waits" line with its
//   "admitted ... after N s" (or "grew ... after N s") in the same file,
//   reads the census that follows it, and attributes only what those lines
//   hold: the total promised but unused, and which ledgered jobs held memory.
//   A gate run named in a held wait's census is found by its folder, and its
//   steps' grants above their own peaks are summed over their wall time.
//   The same wait is often copied into several logs; each is counted once.
//
// `--since` keeps history records at or after that time, log files created
// at or after it (a log's lines carry no time, so one begun before holds
// earlier waits and is left out), and gate runs started at or after it; a
// commit means its commit time. Nothing is written.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LEDGER_HISTORY_DIR, LEDGER_HISTORY_VERSION, type LedgerHistoryRecord } from "./ledger-history-record.ts";
import { LEDGER_DIR } from "./memory-ledger.ts";
import { PRIORITIES, type Priority } from "./ranks.ts";

const GiB = 2 ** 30;
const UNIT: Readonly<Record<string, number>> = { MiB: 2 ** 20, GiB };
const size = (n: string, unit: string) => Number(n) * UNIT[unit]!;
const SIZE = String.raw`([\d.]+) (MiB|GiB)`;
const RANK = PRIORITIES.join("|");

// ---------------------------------------------------------------------------
// The logs' ledger lines.
// ---------------------------------------------------------------------------

export type WaitLine = { kind: "wait"; what: string; grow: boolean; ask: number; priority: Priority;
  available: number; pending: number; floor: number; ahead: number; fits: boolean };
export type DoneLine = { kind: "done"; what: string; waited_s: number };
export type CensusJob = { bytes: number; priority: Priority; what: string };
export type CensusRow = { cgroup: string; charge: number; jobs: CensusJob[] };
export type CensusLine = { kind: "census"; rows: CensusRow[] };
export type LogLine = WaitLine | DoneLine | CensusLine;

const WAIT = new RegExp(String.raw`memory: (.+?) waits (for|to grow by) ${SIZE}(?: to ${SIZE})? \((${RANK})\): ${SIZE} available, ${SIZE} of it promised to running jobs, ${SIZE} kept for the system(?:; (\d+) ahead of it in the queue)?(.*)$`);
const DONE = new RegExp(String.raw`memory: (.+?) (?:admitted with|grew by) ${SIZE}(?: to ${SIZE})? after (\d+) s$`);
const CENSUS = /memory: held now, of [\d.]+ (?:MiB|GiB) not available: (.*); [\d.]+ (?:MiB|GiB) outside these cgroups/;
const ROW = new RegExp(String.raw`^(\S+) ${SIZE}(?:: ledgered (.*?))?(?:; ${SIZE} unledgered| unledgered)?$`);
const JOB_START = new RegExp(String.raw`, (?=${SIZE} (?:${RANK}) )`);
const JOB = new RegExp(String.raw`^${SIZE} (${RANK}) (.*)$`);
const ANSI = /\x1b\[[0-9;]*m/g;

/** One line of a log, if it is one of the ledger's wait, admission or census lines. */
export function parseLogLine(raw: string): LogLine | null {
  const text = raw.replace(ANSI, "").trimEnd();
  let m = WAIT.exec(text);
  if (m) {
    const [, what, kind, n, u, , , priority, a, au, p, pu, f, fu, ahead, rest] = m;
    return { kind: "wait", what: what!, grow: kind !== "for", ask: size(n!, u!), priority: priority as Priority,
      available: size(a!, au!), pending: size(p!, pu!), floor: size(f!, fu!), ahead: Number(ahead ?? 0), fits: !rest!.includes("could not fit") };
  }
  m = DONE.exec(text);
  if (m) return { kind: "done", what: m[1]!, waited_s: Number(m[6]) };
  m = CENSUS.exec(text);
  if (m) {
    const rows: CensusRow[] = [];
    for (const part of m[1]!.split(" | ")) {
      const row = ROW.exec(part);
      if (row === null) continue;
      const jobs = (row[4] ?? "").split(JOB_START).flatMap(job => {
        const j = JOB.exec(job);
        return j === null ? [] : [{ bytes: size(j[1]!, j[2]!), priority: j[3] as Priority, what: j[4]! }];
      });
      rows.push({ cgroup: row[1]!, charge: size(row[2]!, row[3]!), jobs });
    }
    return { kind: "census", rows };
  }
  return null;
}

export type LogEpisode = Omit<WaitLine, "kind"> & { source: string; waited_s: number; census: CensusRow[] | null };

/**
 * Each wait in `lines` paired with the admission that ended it, in the same
 * source and for the same request, with the census printed right after it.
 * A wait copied into several sources is kept once.
 */
export function logEpisodes(lines: Iterable<{ source: string; text: string }>): LogEpisode[] {
  const open = new Map<string, LogEpisode>(), episodes: LogEpisode[] = [], seen = new Set<string>();
  let last: { source: string; episode: LogEpisode } | undefined;
  for (const { source, text } of lines) {
    const line = parseLogLine(text);
    if (line === null) continue;
    if (line.kind === "census") {
      if (last?.source === source && last.episode.census === null) last.episode.census = line.rows;
      last = undefined;
      continue;
    }
    const key = `${source}\0${line.what}`;
    if (line.kind === "wait") {
      const episode: LogEpisode = { what: line.what, grow: line.grow, ask: line.ask, priority: line.priority, available: line.available,
        pending: line.pending, floor: line.floor, ahead: line.ahead, fits: line.fits, source, waited_s: 0, census: null };
      open.set(key, episode);
      last = { source, episode };
      continue;
    }
    last = undefined;
    const episode = open.get(key);
    if (episode === undefined) continue;
    open.delete(key);
    episode.waited_s = line.waited_s;
    const same = [episode.what, episode.ask, Math.round(episode.available - episode.pending), episode.ahead, episode.waited_s].join("|");
    if (seen.has(same)) continue;
    seen.add(same);
    episodes.push(episode);
  }
  return episodes;
}

/** Whether a logged wait fit the room it saw, behind a request ahead of it. */
export const logHeld = (e: LogEpisode) => e.fits && e.ahead > 0 && e.ask <= e.available - e.pending - e.floor;

// ---------------------------------------------------------------------------
// The ledger's history.
// ---------------------------------------------------------------------------

export type HistoryRead = { records: LedgerHistoryRecord[]; unread: { file: string; line: number; why: string }[] };

/** Every record in a history directory; a line that is not a record of a known version is named, not read. */
export function readLedgerHistory(dir: string): HistoryRead {
  const read: HistoryRead = { records: [], unread: [] };
  let days: string[];
  try { days = readdirSync(dir).filter(name => name.endsWith(".jsonl")).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return read; throw error; }
  for (const day of days) {
    const file = join(dir, day);
    readFileSync(file, "utf8").split("\n").forEach((text, at) => {
      if (text === "") return;
      let value: unknown;
      try { value = JSON.parse(text); } catch { read.unread.push({ file, line: at + 1, why: "not JSON (a write cut short)" }); return; }
      const version = (value as { version?: unknown } | null)?.version;
      if (version !== LEDGER_HISTORY_VERSION) { read.unread.push({ file, line: at + 1, why: `version ${String(version)}, not ${LEDGER_HISTORY_VERSION}` }); return; }
      read.records.push(value as LedgerHistoryRecord);
    });
  }
  return read;
}

export type HistoryEpisode = { id: string; what: string; priority: Priority; grows: string | null; ask: number;
  held: boolean; admitted: boolean; waited_s: number; records: LedgerHistoryRecord[] };

/** The records of each request's wait, in order. */
export function historyEpisodes(records: readonly LedgerHistoryRecord[]): HistoryEpisode[] {
  const by = new Map<string, LedgerHistoryRecord[]>();
  for (const record of records) by.set(record.request.id, [...by.get(record.request.id) ?? [], record]);
  return [...by.values()].map(list => {
    list.sort((a, b) => a.waited_s - b.waited_s || a.at.localeCompare(b.at));
    const first = list[0]!, { request } = first;
    const ask = request.bytes - request.drawn_bytes;
    return { id: request.id, what: request.what, priority: request.priority, grows: request.grows, ask,
      held: request.fits && first.ahead.length > 0 && ask <= first.machine.room_bytes,
      admitted: list.some(record => record.kind === "admitted"), waited_s: list.at(-1)!.waited_s, records: list };
  });
}

// ---------------------------------------------------------------------------
// Gate runs.
// ---------------------------------------------------------------------------

export type RunStep = { name: string; started: number; wall_s: number; grant: number; peak: number };
export type GateRun = { path: string; started: number; steps: RunStep[] };

/** A gate run's steps from its summary.json, or null when it records none. */
export function gateRun(path: string, summary: unknown): GateRun | null {
  const value = summary as { started?: unknown; steps?: unknown } | null;
  if (!Array.isArray(value?.steps)) return null;
  const steps: RunStep[] = [];
  for (const step of value.steps as Record<string, unknown>[]) {
    const memory = step.memory as Record<string, unknown> | undefined;
    const started = Date.parse(String(step.started_at)), grant = Number(memory?.grant_bytes ?? memory?.reserved_bytes), peak = Number(memory?.peak_bytes);
    if (!Number.isFinite(started) || !Number.isFinite(grant) || !Number.isFinite(peak) || typeof step.wall !== "number") continue;
    steps.push({ name: String(step.name), started, wall_s: step.wall, grant, peak });
  }
  const started = Date.parse(String(value.started));
  return { path, started: Number.isFinite(started) ? started : Math.min(...steps.map(step => step.started)), steps };
}

/** The gate run a reservation is for, by its label (`gate run <folder>`, which a census cuts to 60 characters and ends with …). */
export function runOf(what: string, runs: ReadonlyMap<string, GateRun>): GateRun | undefined {
  const named = /^gate run (\/.*)$/.exec(what)?.[1];
  if (named === undefined) return undefined;
  if (!named.endsWith("…")) return runs.get(named);
  const prefix = named.slice(0, -1);
  const found = [...runs.keys()].filter(path => path.startsWith(prefix));
  return found.length === 1 ? runs.get(found[0]!) : undefined;
}

// ---------------------------------------------------------------------------
// Attribution.
// ---------------------------------------------------------------------------

/** A holder's kind of work: a gate run's step, or a job's label without its paths, hashes and issue number. */
export function holderKind(what: string): string {
  if (what.startsWith("gate run ")) return "gate run";
  return what.replace(/^#?\d+ /, "").replace(/\S*\/\S*/g, "<path>").replace(/\b[0-9a-f]{10,}\b/g, "<commit>").replace(/…$/, "").trim();
}

/** Memory reserved above use: byte-seconds, its largest figure, and the seconds it was held. */
export type Held = { byte_s: number; most: number; seconds: number };
const add = (into: Map<string, Held>, key: string, bytes: number, seconds: number) => {
  if (bytes <= 0 || seconds <= 0) return;
  const held = into.get(key) ?? { byte_s: 0, most: 0, seconds: 0 };
  held.byte_s += bytes * seconds; held.most = Math.max(held.most, bytes); held.seconds += seconds;
  into.set(key, held);
};

/**
 * Who held memory above use while `episode` waited: each interval between its
 * records charged to each admitted holder at the earlier record, a gate run's
 * share split among its steps then running by their grants above their peaks.
 */
export function attributeEpisode(episode: HistoryEpisode, runs: ReadonlyMap<string, GateRun>): Map<string, Held> {
  const held = new Map<string, Held>();
  episode.records.forEach((record, at) => {
    const next = episode.records[at + 1];
    if (next === undefined) return;
    const seconds = next.waited_s - record.waited_s, when = Date.parse(record.at);
    for (const holder of record.admitted) {
      const unused = holder.live_use ? 0 : Math.max(0, holder.bytes - holder.lent_bytes - holder.used_bytes);
      const run = runOf(holder.what, runs);
      if (run === undefined) { add(held, holderKind(holder.what), unused, seconds); continue; }
      let left = unused;
      for (const step of run.steps) {
        if (step.started > when || step.started + step.wall_s * 1000 <= when) continue;
        const share = Math.min(left, Math.max(0, step.grant - step.peak));
        add(held, `gate run: ${step.name}`, share, seconds);
        left -= share;
      }
      add(held, "gate run: no running step's (run slack, withheld or pending demand)", left, seconds);
    }
  });
  return held;
}

// ---------------------------------------------------------------------------
// The report.
// ---------------------------------------------------------------------------

export type KindRow = { kind: string; waits: number; waited_s: number; median_s: number; most_s: number };
export type HolderRow = { holder: string; gib_s: number; most_gib: number; seconds: number };
export type Report = {
  since: string | null;
  history: { records: number; unread: number; waits: number; held: number; held_s: number; by_kind: KindRow[]; holders: HolderRow[] };
  logs: { files: number; waits: number; waited_s: number; held: number; held_s: number; held_60s: number; by_kind: KindRow[];
    unused_median_gib: number | null; unused_4gib: number; census: number; with_gate_run: number; with_gate_run_s: number;
    gate_runs: number; steps_over_peak: HolderRow[] };
};

const median = (values: readonly number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[sorted.length >> 1]! : null; };
const kindRows = (episodes: readonly { what: string; grow: boolean; waited_s: number }[]): KindRow[] => {
  const by = new Map<string, number[]>();
  for (const e of episodes) { const kind = e.grow ? "growth of " + holderKind(e.what) : holderKind(e.what); by.set(kind, [...by.get(kind) ?? [], e.waited_s]); }
  return [...by].map(([kind, waits]) => ({ kind, waits: waits.length, waited_s: waits.reduce((a, b) => a + b, 0), median_s: median(waits)!, most_s: Math.max(...waits) }))
    .sort((a, b) => b.waited_s - a.waited_s || a.kind.localeCompare(b.kind));
};
const holderRows = (held: ReadonlyMap<string, Held>): HolderRow[] => [...held]
  .map(([holder, h]) => ({ holder, gib_s: h.byte_s / GiB, most_gib: h.most / GiB, seconds: h.seconds }))
  .sort((a, b) => b.gib_s - a.gib_s || a.holder.localeCompare(b.holder));

export function replay(input: { records: readonly LedgerHistoryRecord[]; unread: number; logs: readonly LogEpisode[]; files: number;
  runs: ReadonlyMap<string, GateRun>; since: number | null }): Report {
  const { since } = input;
  const records = since === null ? input.records : input.records.filter(record => Date.parse(record.at) >= since);
  const waits = historyEpisodes(records), heldWaits = waits.filter(e => e.held);
  const held = new Map<string, Held>();
  for (const episode of heldWaits) for (const [key, h] of attributeEpisode(episode, input.runs)) {
    const into = held.get(key) ?? { byte_s: 0, most: 0, seconds: 0 };
    into.byte_s += h.byte_s; into.most = Math.max(into.most, h.most); into.seconds += h.seconds;
    held.set(key, into);
  }
  const logs = input.logs, heldLogs = logs.filter(logHeld);
  const censused = heldLogs.filter(e => e.census !== null);
  const gateRunNamed = (e: LogEpisode) => e.census!.some(row => row.jobs.some(job => job.what.startsWith("gate run ")));
  const withRun = censused.filter(gateRunNamed);
  const named = new Map<string, GateRun>();
  for (const e of withRun) for (const row of e.census!) for (const job of row.jobs) {
    const run = runOf(job.what, input.runs);
    if (run !== undefined && (since === null || run.started >= since)) named.set(run.path, run);
  }
  const over = new Map<string, Held>();
  for (const run of named.values()) for (const step of run.steps) add(over, step.name, step.grant - step.peak, step.wall_s);
  const unused = heldLogs.map(e => e.pending);
  const total = (es: readonly { waited_s: number }[]) => es.reduce((sum, e) => sum + e.waited_s, 0);
  return {
    since: since === null ? null : new Date(since).toISOString(),
    history: { records: records.length, unread: input.unread, waits: waits.length, held: heldWaits.length, held_s: total(heldWaits),
      by_kind: kindRows(heldWaits.map(e => ({ what: e.what, grow: e.grows !== null, waited_s: e.waited_s }))), holders: holderRows(held) },
    logs: { files: input.files, waits: logs.length, waited_s: total(logs), held: heldLogs.length, held_s: total(heldLogs),
      held_60s: heldLogs.filter(e => e.waited_s >= 60).length, by_kind: kindRows(heldLogs),
      unused_median_gib: unused.length ? median(unused)! / GiB : null, unused_4gib: unused.filter(bytes => bytes >= 4 * GiB).length,
      census: censused.length, with_gate_run: withRun.length, with_gate_run_s: total(withRun), gate_runs: named.size, steps_over_peak: holderRows(over) },
  };
}

const g = (value: number) => value.toFixed(1);
export function formatReport(report: Report, top = 12): string {
  const { history: h, logs: l } = report;
  const kinds = (rows: readonly KindRow[]) => ["  kind\twaits\twaited s\tmedian s\tlongest s",
    ...rows.slice(0, top).map(row => `  ${row.kind}\t${row.waits}\t${row.waited_s}\t${row.median_s}\t${row.most_s}`)];
  const holders = (rows: readonly HolderRow[], what: string) => [`  ${what}\tGiB·s\tlargest GiB\tseconds`,
    ...rows.slice(0, top).map(row => `  ${row.holder}\t${g(row.gib_s)}\t${g(row.most_gib)}\t${Math.round(row.seconds)}`)];
  return [
    `ledger history replay${report.since === null ? "" : ` since ${report.since}`}`,
    `history: ${h.records} records${h.unread ? ` (${h.unread} lines unread)` : ""}, ${h.waits} waits; held at the head of the line: ${h.held}, waiting ${h.held_s} s`,
    ...(h.held ? [...kinds(h.by_kind), "  reserved above use while they waited, by holder (census intervals):", ...holders(h.holders, "holder")] : []),
    `logs: ${l.files} files, ${l.waits} waits, ${l.waited_s} s; held at the head of the line: ${l.held}, waiting ${l.held_s} s (${l.held_60s} of them 60 s or more)`,
    ...(l.held ? [
      ...kinds(l.by_kind),
      `  promised but unused when they started waiting: median ${l.unused_median_gib === null ? "-" : g(l.unused_median_gib)} GiB; 4 GiB or more in ${l.unused_4gib} of ${l.held}`,
      `  with a census: ${l.census}; a gate run among its ledgered holders: ${l.with_gate_run}, waiting ${l.with_gate_run_s} s`,
      `  those gate runs found (${l.gate_runs}), their steps' grants above their own peaks over their wall time:`,
      ...holders(l.steps_over_peak, "step"),
    ] : []),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Reading the machine.
// ---------------------------------------------------------------------------

/** Every regular file under `root`, not following links. */
function* files(root: string): Generator<string> {
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (entry.isFile()) yield path;
  }
}

function* ledgerLines(paths: readonly string[], source: string, gone: string[]): Generator<{ source: string; text: string }> {
  for (const path of paths) {
    let buffer: Buffer;
    // Other work's scratch comes and goes while the replay reads it.
    try { buffer = readFileSync(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; gone.push(path); continue; }
    if (buffer.indexOf("memory: ") < 0) continue;
    // From one occurrence to the next: the lines between hold none.
    for (let at = buffer.indexOf("memory: "); at >= 0;) {
      const start = at === 0 ? 0 : buffer.lastIndexOf(10, at) + 1;
      let end = buffer.indexOf(10, at);
      if (end < 0) end = buffer.length;
      yield { source: `${source}${path}`, text: buffer.toString("utf8", start, end) };
      at = buffer.indexOf("memory: ", end);
    }
  }
}

function sinceOf(value: string, cwd: string): number {
  const time = Date.parse(value);
  if (Number.isFinite(time) && /^\d{4}-/.test(value)) return time;
  const committed = execFileSync("git", ["--no-optional-locks", "show", "-s", "--format=%cI", value], { cwd, encoding: "utf8" }).trim();
  return Date.parse(committed);
}

function main(argv: readonly string[]): void {
  let since: number | null = null, json = false, history = join(process.env.NTS_MEMORY_LEDGER ?? LEDGER_DIR, LEDGER_HISTORY_DIR);
  const roots: string[] = [];
  for (let at = 0; at < argv.length; at++) {
    const arg = argv[at]!;
    if (arg === "--json") json = true;
    else if (arg === "--since") since = sinceOf(argv[++at] ?? "", process.cwd());
    else if (arg === "--history") history = resolve(argv[++at] ?? "");
    else if (arg.startsWith("--")) throw new Error(`unknown argument ${arg}`);
    else roots.push(resolve(arg));
  }
  if (roots.length === 0) roots.push(...["nts-scratch", "nts-landing/runs", "nts-full-check/runs"].map(dir => join(homedir(), ".cache", dir)));
  const logs: string[] = [], runs = new Map<string, GateRun>();
  for (const root of roots) for (const path of files(root)) {
    if (path.endsWith("/summary.json")) {
      try { const run = gateRun(realpathSync(dirname(path)), JSON.parse(readFileSync(path, "utf8"))); if (run !== null) runs.set(run.path, run); } catch { /* not a gate run's summary */ }
    } else if (/\.(log|txt)$/.test(path) && (since === null || (statSync(path, { throwIfNoEntry: false })?.birthtimeMs ?? -Infinity) >= since)) logs.push(path);
  }
  const read = readLedgerHistory(history);
  const gone: string[] = [];
  const episodes = logEpisodes(ledgerLines(logs, "", gone));
  const report = replay({ records: read.records, unread: read.unread.length, logs: episodes, files: logs.length - gone.length, runs, since });
  process.stdout.write(json ? `${JSON.stringify(report, null, 1)}\n` : `${formatReport(report)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main(process.argv.slice(2));
