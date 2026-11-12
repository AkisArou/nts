// The machine's memory ledger: one admission for every heavy job, whoever runs
// it -- the landing check, an agent's build, the full check -- so that no two
// jobs count on the same free memory. `reserve` waits until a job may start;
// `node tooling/gate/admit.ts` runs any command through it.
//
// **A job reserves what it will hold at its peak, and starts when that fits.**
// MemAvailable already counts what running jobs hold now. What it cannot see
// is what they will still take, so an admitted job counts as pending by what
// it has not used yet:
//
//   pending = the sum, over live reservations, of max(0, reserved - used)
//   admitted when MemAvailable - pending >= its bytes + SYSTEM_FLOOR_BYTES
//
// An unmeasured job has no forecast. It asks only for the margin on its live
// use (MemAvailable already excludes that use), and promises live use plus
// that margin at every decision. Its watcher records its peak for next time.
//
// **"Used" is counted in MemAvailable's own currency**: what the job holds
// that nobody else can have. MemAvailable already counts a job's file cache
// and reclaimable slab as available; counting them as used as well would
// count that memory twice, and admit over it. So:
//
//   - a job alone in its cgroup (everything in it is the owner or under it)
//     is that cgroup's memory.current less its file pages and reclaimable
//     slab, which also counts its kernel memory, its tmpfs pages and any
//     orphaned descendants;
//   - its processes outside that cgroup (a gate's steps run in scopes of their
//     own), and every process of a job whose cgroup it shares with others,
//     count the anonymous and shared memory they map (RssAnon + RssShmem).
//
// **The queue.** Requests wait in arrival order within a priority: the
// landing check first, then agents' work, then the full check. The longest
// prefix of the queue that fits together is admitted. So a request goes
// ahead of an earlier one only from the room left once that one has its own,
// and a request that does not fit holds everything behind it.
//
// **A request the machine cannot give now holds nobody.** One that could not
// fit even were every admitted job to end -- MemAvailable is low with memory
// that nobody reserved -- waits without holding the requests behind it, says
// so, and holds them again once it could fit, so smaller ones do not starve
// it. It is not refused: a machine briefly full of memory nobody reserved
// delays a job rather than failing it. Only a request larger than the
// machine could ever give, MemTotal less the floor, is refused (`neverFits`).
//
// **A reservation yields to a request that outranks it.** For a waiting
// request's decision, each admitted reservation of lower priority counts as
// promising only what its job uses and a margin -- what a measured unit
// would reserve for that use (step-scheduling.ts's `peakReservation`) --
// never its whole size. So a lower-priority job that reserved more than it
// uses (a fixed `admit.ts --bytes` job, a census pool that has stopped
// starting cases, a gate run) never holds a request that outranks it for the
// rest of its run, whatever code it runs: nothing is rewritten, nothing is
// stopped, and its whole promise counts again once nothing outranks it. The
// ledger stays accounting only: such a job can still grow back to its whole
// reservation after the request was admitted on its smaller figure, and no
// kernel limit holds a job to its grant (anonymous memory held at MemoryHigh
// without swap stops rather than slows): a gate step's slice bounds only a
// runaway, and if the machine itself runs out, its OOM killer takes the
// lowest priority's work first (OOM_SCORE). Only a waiting request that could
// fit were every admitted job to end makes a job yield (`outranked`): a yield
// frees nothing another one could use.
//
// **A request can take over a reservation** (`replaces`): admitting it ends
// that one under the same lock, so nothing is admitted between the two, and
// its decision counts nothing promised to the one it takes over. Only a
// reservation that counts the request's memory can be taken over -- its
// owner's, as a child's is counted inside its parent's -- so the memory moves
// between two reservations of one job and never leaves another job
// unreserved. The landing check holds its build's reservation until its gate
// run's first request takes it over.
//
// **A reservation can grow and shrink**, for a job whose need moves while it
// runs (a gate run, as its steps start and end). `grow` asks for more exactly
// as a new request would: at the reservation's priority and admitted order, before later requests
// that arrived before it. Once admitted, the bytes join the reservation's own
// entry, so a job is one entry and one measure however its size moves.
// `shrink` gives bytes back at once. A growth whose reservation has ended is
// dropped by the next decision.
//
// **Owners.** A reservation lasts as long as its owner, a process named by
// boot, pid and start time; a waiting request also lasts only as long as the
// process waiting for it. When either is gone, the next decision drops its
// entry, so a crashed holder or waiter never blocks anyone. Nothing here ever
// sends a signal to any process.
//
// **Nesting.** A reservation's `env` names it to child processes. A child
// that calls `reserve` with that environment (a gate step's oracle preparation
// inside the step's reservation) runs inside it and asks for nothing. That is
// sound only where the parent's measure counts the child's memory, so a
// child outside the owner's process tree and cgroup is refused.
//
// **A reservation made inside another job's draws on it first.** A request
// that holds a reservation of its own from inside another job's -- the one it
// names (`drawsOn`: a gate run's, of the admit.ts job or the gate step it was
// started in), else its nearest ancestor process's -- takes what that one
// has unused first, and asks the queue only for the rest. One the other
// covers whole asks the queue nothing and waits behind nobody, so a holder
// whose child needs memory never waits for itself. While the child holds
// it, what it drew is lent: the other promises that much less, and its
// measure leaves out what the child measures itself, so nothing is counted
// twice. A growth draws on the other as its reservation does; a shrink gives
// back the child's own part first.
//
// **The files**, under LEDGER_DIR or NTS_MEMORY_LEDGER: `waiting/<id>.json`
// and `admitted/<id>.json`, one entry per request, written whole and renamed
// into place; `lock`, held for every decision, so decisions are made one at a
// time and two waiters never both admit themselves on the same free memory.
// Every write holds the lock too: a growth joining its reservation and a
// shrink rewrite an entry, and only the reservation's own holder ever does.
// Releasing a reservation or withdrawing a request removes its own file
// without the lock: a decision that read the file before then counted memory
// that was being freed, which is the safe direction.
//
// **The lock is flock(2) on `lock`,** taken by flock(1) on a descriptor this
// process holds open (as `ownerLock` in tooling/differential/oracle-emit.ts
// does). The kernel releases it when that descriptor closes, however the
// process ends. A lock directory or an O_EXCL file stays behind when its
// holder crashes, and could only be taken back by checking that its writer is
// dead and then removing it. Two waiters can both make that check, and the
// second then removes the lock the first has just taken again.
//
// **What a job reserves is what it was measured to hold** (`reserveJob`,
// `admit.ts --key`): a job names a key, and its reservation comes from the
// peaks its earlier runs left in the scheduling history of the tree it runs
// in (step-scheduling.ts). A watcher (memory-watch.ts), started once the job
// is admitted, samples what the reservation's measure holds every second, and
// the peak goes to that history when the reservation ends. An entry says
// which of its keys were sized without a measurement of their own
// (`unmeasured`), and which have held more than they reserved (`over`).
import {hostObservations,hostObservationEnvironment,HostObservationError,parseMemory,parseProcessCharge,parseCgroupCharge,type HostObservations} from "./host-observations.ts";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import {workerLifecycle} from "./worker-lifecycle.ts";
import { historyFile, KEY, peakReservation, readCostHistory, unitReservation, writeCostHistory, type MemorySizing } from "./step-scheduling.ts";

/** Kept free beyond every reservation, for the rest of the system. */
export const SYSTEM_FLOOR_BYTES = 2 * 2 ** 30;
export const LEDGER_DIR = join(homedir(), ".cache/nts-gate/admission");
/** The reservation a child process runs inside; `Reservation.env` sets it. */
export const RESERVATION_ENV = "NTS_MEMORY_RESERVATION";
/** Another ledger directory, for tests; `Reservation.env` passes it on. */
export const LEDGER_ENV = "NTS_MEMORY_LEDGER";
/** The priority a launcher's code gives the job it starts (`priorityOf`). */
export const PRIORITY_ENV = "NTS_MEMORY_PRIORITY";
/** Highest first. */
export const PRIORITIES = ["landing", "agent", "full-check"] as const;
export type Priority = (typeof PRIORITIES)[number];

/**
 * The kernel's OOM score adjustment of each priority's work, lowest first to
 * keep: if the machine itself runs out of memory, its OOM killer takes the
 * full check's work first, then agents', and a landing's last. A user unit
 * cannot go below the user manager's own 100 (it asks 0 and is given 100), so
 * the landing check's unit asks 100; an agent's shell, started outside the
 * manager, sits at 0, so agents' work raises itself (`rankForOom`).
 */
export const OOM_SCORE: Readonly<Record<Priority, number>> = { landing: 100, agent: 300, "full-check": 500 };

/**
 * Raises this process's OOM score adjustment, which its children inherit, to
 * its priority's; never lowers it, which an unprivileged process cannot. It
 * says why it could not, and the work runs all the same.
 */
export function rankForOom(priority: Priority, report: (line: string) => void = () => {}): void {
  const path = "/proc/self/oom_score_adj", wanted = OOM_SCORE[priority];
  try {
    if (Number(readFileSync(path, "utf8")) < wanted) writeFileSync(path, String(wanted));
  } catch (error) { report(`memory: cannot raise this process's OOM score to its ${priority} priority's ${wanted}: ${(error as Error).message}`); }
}

/** The priority `env` names (PRIORITY_ENV), else an agent's. */
export function priorityOf(env: NodeJS.ProcessEnv = process.env): Priority {
  const named = env[PRIORITY_ENV];
  if (named === undefined || named === "") return "agent";
  if (!(PRIORITIES as readonly string[]).includes(named)) throw new RangeError(`${PRIORITY_ENV}=${named} is not a priority; one of ${PRIORITIES.join(", ")}`);
  return named as Priority;
}

const CGROUP_ROOT = "/sys/fs/cgroup";
const POLL_MS = 1000;
const LOCK_RETRY_MS = 20;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const UNITS: Readonly<Record<string, number>> = { "": 1, k: 2 ** 10, m: 2 ** 20, g: 2 ** 30, t: 2 ** 40 };

/** A size as people write one: a count of bytes, or 512M, 8G, 1.5GiB. The units are binary. */
export function parseBytes(text: string): number {
  const match = /^(\d+(?:\.\d+)?)(?:([kmgt])(?:i?b)?|b)?$/i.exec(text.trim());
  const bytes = match ? Math.round(Number(match[1]) * UNITS[(match[2] ?? "").toLowerCase()]!) : NaN;
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new RangeError(`not a size: ${JSON.stringify(text)} (say 8G, 512M or 1048576)`);
  return bytes;
}

/** A size as the ledger reports one: 8.0 GiB, 512.0 MiB. */
export const gib = (bytes: number) => bytes >= 2 ** 30 || bytes <= -(2 ** 30) ? `${(bytes / 2 ** 30).toFixed(1)} GiB` : `${(bytes / 2 ** 20).toFixed(1)} MiB`;

// ---------------------------------------------------------------------------
// What the host says, parsed.
// ---------------------------------------------------------------------------

export type Meminfo = { availableBytes: number; totalBytes: number };

/** MemAvailable and MemTotal from /proc/meminfo's format, or null without both. */
export const parseMeminfo = parseMemory;

/** The complete resource view this run owns, or the live adapter. */
export function machineMemory(env:NodeJS.ProcessEnv=process.env):Meminfo {
  return hostObservations(env).memory();
}

/**
 * Why a reservation of `bytes` can never be admitted on a machine of
 * `totalBytes`, in the words a refused request gets; null when it can.
 * `asks` names the request: "<what> asks 8.0 GiB".
 */
export function neverFits(bytes: number, totalBytes: number, asks: string): string | null {
  if (bytes + SYSTEM_FLOOR_BYTES <= totalBytes) return null;
  return `memory: ${asks}, which can never fit: the machine has ${gib(totalBytes)}, and ${gib(SYSTEM_FLOOR_BYTES)} of it is kept for the system`;
}

/** What a process maps that no other job can have: its anonymous and shared memory, from /proc/<pid>/status. */
export const processCharge = parseProcessCharge;
export const cgroupCharge = parseCgroupCharge;

type Stat = { state: string; ppid: number; start: string };

/** /proc/<pid>/stat: the fields after the command name, which may itself hold spaces and parentheses. */
function parseStat(text: string): Stat {
  const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
  const state = fields[0], ppid = fields[1], start = fields[19];
  if (!state || ppid === undefined || !/^\d+$/.test(ppid) || start === undefined || !/^\d+$/.test(start)) throw new Error(`unreadable process stat: ${text.slice(0, 80)}`);
  return { state, ppid: Number(ppid), start };
}

const gone = (error: unknown) => ["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "");

function readStat(pid: number): Stat | null {
  try { return parseStat(readFileSync(`/proc/${pid}/stat`, "utf8")); }
  catch (error) { if (gone(error)) return null; throw error; }
}

// ---------------------------------------------------------------------------
// Processes and cgroups.
// ---------------------------------------------------------------------------

/** A process, by the boot it runs in, its pid and its start time: a pid the kernel reuses names another process. */
export type ProcessIdentity = { boot: string; pid: number; start: string };

let boot: string | undefined;
const bootId = () => boot ??= readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();

/** A running process's identity; null once it has exited, which a zombie has. */
export function processIdentity(pid: number): ProcessIdentity | null {
  const stat = readStat(pid);
  return stat === null || stat.state === "Z" || stat.state === "X" ? null : { boot: bootId(), pid, start: stat.start };
}

const alive = (who: ProcessIdentity) => who.boot === bootId() && processIdentity(who.pid)?.start === who.start;

type Table = ReadonlyMap<number, { ppid: number }>;

function processTable(): Map<number, Stat> {
  const table = new Map<number, Stat>();
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    const stat = readStat(Number(name));
    if (stat !== null && stat.state !== "Z" && stat.state !== "X") table.set(Number(name), stat);
  }
  return table;
}

/** `root` and every process under it, by the parent each one names now. */
export function processTree(root: number, table: Table): Set<number> {
  const children = new Map<number, number[]>();
  for (const [pid, { ppid }] of table) {
    const siblings = children.get(ppid);
    if (siblings) siblings.push(pid);
    else children.set(ppid, [pid]);
  }
  const tree = new Set<number>();
  const next = table.has(root) ? [root] : [];
  for (let pid = next.pop(); pid !== undefined; pid = next.pop()) {
    if (tree.has(pid)) continue;
    tree.add(pid);
    next.push(...(children.get(pid) ?? []));
  }
  return tree;
}

/**
 * Whether a cgroup listing `members` holds only `owner` and processes under
 * it, so that its charge is the owner's job. A member gone since the listing
 * is passed over: it holds no process memory now.
 */
export function ownedBy(owner: number, members: readonly number[], table: Table): boolean {
  const tree = processTree(owner, table);
  return members.every(pid => !table.has(pid) || tree.has(pid));
}

function cgroupOf(pid: number): string | null {
  try { return readFileSync(`/proc/${pid}/cgroup`, "utf8").split("\n").find(line => line.startsWith("0::"))?.slice(3) ?? null; }
  catch (error) { if (gone(error)) return null; throw error; }
}

/** Every process in the cgroup at `path` and in the cgroups under it. */
function cgroupMembers(path: string): number[] {
  const members: number[] = [];
  const walk = (dir: string) => {
    let procs: string;
    try { procs = readFileSync(join(dir, "cgroup.procs"), "utf8"); }
    catch (error) { if (gone(error)) return; throw error; }
    for (const line of procs.split("\n")) if (line) members.push(Number(line));
    for (const entry of readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory()) walk(join(dir, entry.name));
  };
  walk(CGROUP_ROOT + path);
  return members;
}

const inodeOf = (path: string) => String(statSync(path, { bigint: true }).ino);
const accounted = (path: string) => existsSync(join(CGROUP_ROOT + path, "memory.current"));
const within = (path: string, group: string) => path === group || path.startsWith(`${group}/`);

/** The owner's cgroup when it is the owner's own and has memory accounting. */
function ownCgroup(pid: number): CgroupRef | null {
  const path = cgroupOf(pid);
  if (path === null || path === "/" || !accounted(path)) return null;
  // Listed before the table, so a process started in between is one the
  // members started: a process enters a cgroup by being forked in it.
  const members = cgroupMembers(path);
  return ownedBy(pid, members, processTable()) ? { path, inode: inodeOf(CGROUP_ROOT + path) } : null;
}

function readCgroupCharge(ref: CgroupRef, host:HostObservations): number {
  const dir = CGROUP_ROOT + ref.path;
  try {
    // Another cgroup by the same name: the job's own has gone, and what is
    // gone is charged nothing, which leaves its whole reservation pending.
    if (inodeOf(dir) !== ref.inode) return 0;
    return host.cgroupCharge(ref.path);
  } catch (error) { if (gone(error)) return 0; throw error; }
}

function readProcessCharge(pid: number, host:HostObservations): number {
  try { return host.processCharge(pid); }
  catch (error) { if (gone(error)) return 0; throw error; }
}

const NONE: ReadonlySet<number> = new Set();

/**
 * What an admitted job uses now. `table` is read once per decision, when a
 * tree is measured. `exclude`, processes in the measure that are not the
 * job's to count -- the watcher of its peak, in the job's cgroup; what a
 * reservation drawn on this one measures itself -- are not counted.
 */
function measured(entry: LedgerEntry, table: () => Table, exclude: ReadonlySet<number> = NONE, host:HostObservations=hostObservations()): number {
  const { tree, cgroup } = entry.measure;
  let bytes = 0;
  let inside: ReadonlySet<number> = NONE;
  if (cgroup !== null) {
    bytes += readCgroupCharge(cgroup, host);
    const members = tree || exclude.size ? cgroupMembers(cgroup.path) : [];
    if (tree) inside = new Set(members);
    for (const pid of members) if (exclude.has(pid)) bytes -= readProcessCharge(pid, host);
  }
  if (tree) for (const pid of processTree(entry.owner.pid, table())) if (!inside.has(pid) && !exclude.has(pid)) bytes += readProcessCharge(pid, host);
  return Math.max(0, bytes);
}

/** Whether `pid`'s memory is in what `entry` measures: its owner's tree, or its cgroup. */
function counts(entry: LedgerEntry, pid: number): boolean {
  if (entry.measure.tree) {
    for (let at: number | undefined = pid, hops = 0; at !== undefined && at > 0 && hops < 65536; hops++) {
      if (at === entry.owner.pid) return true;
      at = readStat(at)?.ppid;
    }
  }
  const group = entry.measure.cgroup, own = group === null ? null : cgroupOf(pid);
  return group !== null && own !== null && within(own, group.path);
}

// ---------------------------------------------------------------------------
// The queue.
// ---------------------------------------------------------------------------

export type Queued = { id: string; bytes: number; priority: Priority; seq: number;
  /** An admitted job's order, inherited by its growth and borrowers. New jobs use seq. */
  order?: number;
};

const rank = (priority: Priority) => PRIORITIES.indexOf(priority);

/** Priority first; admitted work keeps its place, then requests retain arrival order. */
export function queueOrder(a: Pick<Queued, "priority" | "seq" | "order">, b: Pick<Queued, "priority" | "seq" | "order">): number {
  return rank(a.priority) - rank(b.priority) || (a.order ?? a.seq) - (b.order ?? b.seq) || a.seq - b.seq;
}

/**
 * The requests that may start now, with `room` bytes free beyond what is
 * pending and the floor: the longest prefix of the queue whose requests fit
 * together. A request behind one that does not fit waits, even when it would
 * fit alone, so a big request is never delayed by small ones.
 */
export function admissible(room: number, queue: readonly Queued[]): Set<string> {
  const admitted = new Set<string>();
  let left = room;
  for (const request of [...queue].sort(queueOrder)) {
    if (request.bytes > left) break;
    left -= request.bytes;
    admitted.add(request.id);
  }
  return admitted;
}

// ---------------------------------------------------------------------------
// The files.
// ---------------------------------------------------------------------------

export type CgroupRef = { path: string; inode: string };
/** What counts as the job's memory: its owner's process tree, a cgroup, or both (the cgroup, and the tree's processes outside it). */
export type Measure = { tree: boolean; cgroup: CgroupRef | null };
export type LedgerEntry = {
  version: 2; id: string; seq: number; bytes: number; what: string; priority: Priority;
  owner: ProcessIdentity; waiter: ProcessIdentity; measure: Measure; since: string;
  /** For a waiting request to grow an admitted reservation, that reservation's id; null for one of its own. */
  grows: string | null;
  /** The steps or jobs this reservation sized without a measurement of their own in their history. */
  unmeasured?: string[];
  /** An unmeasured job promises its live use and margin, rather than a forecast. */
  liveUse?: boolean;
  /** Largest live sample observed by this job's peak watcher. */
  sampledPeak?: number;
  /** The steps or jobs of this reservation that held more than they reserved. */
  over?: string[];
  /** For a request of its own, the admitted reservation it takes over: admitting it ends that one. */
  replaces?: string;
  /**
   * The admitted reservation of an ancestor process this one draws on: it
   * takes what that one has unused first, and asks the ledger only for the
   * rest. A growth draws on it as its reservation does.
   */
  drawsOn?: string;
  /** Of an admitted reservation that draws on another, the bytes of it that came from that one. */
  drawn?: number;
  /** Of a waiting request, whether its last decision found it could fit were every admitted job to end. */
  fits?: boolean;
};
type State = "waiting" | "admitted";

const entryPath = (dir: string, state: State, id: string) => join(dir, state, `${id}.json`);

function identity(value: unknown): value is ProcessIdentity {
  const who = value as ProcessIdentity;
  return typeof who === "object" && who !== null && typeof who.boot === "string" && Number.isSafeInteger(who.pid) && who.pid > 0 && typeof who.start === "string";
}

const keyList = (value: unknown) => value === undefined || (Array.isArray(value) && value.every(key => typeof key === "string" && KEY.test(key)));

function parseEntry(text: string, file: string): LedgerEntry {
  const parsed = JSON.parse(text) as Omit<LedgerEntry, "version" | "grows"> & { version: 1 | 2; grows?: string | null };
  // Version 1 has the same fields and no growth: an admit.ts from before
  // reservations could grow may still write one, so it reads as a request of
  // its own rather than one that stops every decision.
  const entry = (parsed?.version === 1 && !("grows" in parsed) ? { ...parsed, version: 2, grows: null } : parsed) as LedgerEntry;
  const measure = entry?.measure, cgroup = measure?.cgroup;
  if (entry?.version !== 2 || typeof entry.id !== "string" || !ID.test(entry.id) || !Number.isSafeInteger(entry.seq)
      || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || typeof entry.what !== "string" || !PRIORITIES.includes(entry.priority)
      || !identity(entry.owner) || !identity(entry.waiter) || typeof entry.since !== "string" || typeof measure?.tree !== "boolean"
      || (cgroup !== null && (typeof cgroup?.path !== "string" || typeof cgroup.inode !== "string"))
      || (entry.grows !== null && (typeof entry.grows !== "string" || !ID.test(entry.grows)))
      || !keyList(entry.unmeasured) || !keyList(entry.over)
      || (entry.liveUse !== undefined && typeof entry.liveUse !== "boolean")
      || (entry.sampledPeak !== undefined && (!Number.isSafeInteger(entry.sampledPeak) || entry.sampledPeak <= 0))
      || (entry.replaces !== undefined && (typeof entry.replaces !== "string" || !ID.test(entry.replaces)))
      || (entry.drawsOn !== undefined && (typeof entry.drawsOn !== "string" || !ID.test(entry.drawsOn)))
      || (entry.drawn !== undefined && (!Number.isSafeInteger(entry.drawn) || entry.drawn < 0 || entry.drawn > entry.bytes))
      || (entry.fits !== undefined && typeof entry.fits !== "boolean")) {
    throw new Error(`${file} is not a memory ledger entry`);
  }
  return entry;
}

function readEntries(dir: string, state: State): LedgerEntry[] {
  let names: string[];
  try { names = readdirSync(join(dir, state)); }
  catch (error) { if (gone(error)) return []; throw error; }
  const entries: LedgerEntry[] = [];
  for (const name of names.filter(name => name.endsWith(".json"))) {
    const file = join(dir, state, name);
    let text: string;
    try { text = readFileSync(file, "utf8"); }
    catch (error) { if (gone(error)) continue; throw error; } // released since the listing
    entries.push(parseEntry(text, file));
  }
  return entries;
}

function writeEntry(dir: string, state: State, entry: LedgerEntry): void {
  const temporary = join(dir, `.tmp-${entry.id}`);
  writeFileSync(temporary, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  renameSync(temporary, entryPath(dir, state, entry.id));
}

function removeQuietly(path: string): void {
  try { unlinkSync(path); }
  catch (error) { if (!gone(error)) throw error; }
}

export type LedgerView = { waiting: (LedgerEntry & { live: boolean })[]; admitted: (LedgerEntry & { live: boolean })[] };

/** The ledger as its files stand, each entry with whether the processes it lasts for are alive. */
export function readLedger(dir: string = process.env[LEDGER_ENV] ?? LEDGER_DIR): LedgerView {
  return {
    waiting: readEntries(dir, "waiting").sort(queueOrder).map(entry => ({ ...entry, live: alive(entry.waiter) && alive(entry.owner) })),
    admitted: readEntries(dir, "admitted").sort((a, b) => a.since.localeCompare(b.since) || a.id.localeCompare(b.id)).map(entry => ({ ...entry, live: alive(entry.owner) })),
  };
}

// ---------------------------------------------------------------------------
// The lock.
// ---------------------------------------------------------------------------

export type LedgerLock = { release(): void };

/** The ledger's lock, held until `release`; null while another holder has it. */
export function lockLedger(dir: string): LedgerLock | null {
  mkdirSync(dir, { recursive: true });
  const fd = openSync(join(dir, "lock"), "a", 0o600);
  let locked: SpawnSyncReturns<string>;
  try {
    // flock(1) locks the open file description it is handed as fd 8, which
    // this process shares; the lock outlives flock and ends when `fd` closes.
    locked = spawnSync("flock", ["-n", "-E", "75", "8"], { stdio: ["ignore", "ignore", "pipe", null, null, null, null, null, fd], encoding: "utf8" });
  } catch (error) { closeSync(fd); throw error; }
  if (locked.status === 0) {
    let held = true;
    return { release: () => { if (held) { held = false; closeSync(fd); } } };
  }
  closeSync(fd);
  if (locked.status === 75) return null;
  throw new Error(`cannot lock the memory ledger in ${dir}: ${locked.error?.message ?? (locked.stderr.trim() || `flock ended ${locked.status ?? locked.signal}`)}`);
}

// ---------------------------------------------------------------------------
// Reserving.
// ---------------------------------------------------------------------------

export type OwnerSpec = {
  /** The process the reservation lasts as long as; this one unless given. */
  pid?: number;
  /**
   * Given, the cgroup (a path under /sys/fs/cgroup) that holds the job and
   * nothing else, read alone: a gate run's slice, which holds the slice of
   * every step it starts. Absent, the owner's process tree, read through its
   * own cgroup when it has one (see the top of this file).
   */
  cgroup?: string;
};

export type ReserveRequest = {
  bytes: number; what: string; priority?: Priority; owner?: OwnerSpec;
  /** The steps or jobs these bytes were sized for without a measurement of their own: the entry says so. */
  unmeasured?: readonly string[];
  /** No forecast exists: admit its live margin and charge live use until its peak is known. */
  liveUse?: boolean;
  /** An admitted reservation this one takes over: the decision that admits it ends that one, under the same lock. */
  replaces?: string;
  /**
   * The reservation this one runs inside, though it holds one of its own (a
   * gate run started inside an admit.ts job): it draws on that one's unused
   * part first. Named, it must count this one's memory, as a parent's does
   * (`inside`); unnamed, or not counting it, it is the nearest ancestor
   * process's reservation, if one holds any.
   */
  drawsOn?: string;
};

/** One decision on one request: what it saw and what it decided. */
export type Decision = {
  id: string; what: string; admitted: boolean;
  /** For a growth, the reservation it would grow; null for a request of its own. */
  grows: string | null;
  availableBytes: number; pendingBytes: number;
  /** Free beyond pending and the floor, for the queue. */
  roomBytes: number;
  /** Requests ahead of this one in the queue. */
  ahead: number;
  /** Whether it could fit were every admitted job to end: one that could not holds nobody behind it. */
  fits: boolean;
  /** What it draws on the unused part of the reservation it draws on (`drawsOn`): the queue is asked only for the rest. */
  drawnBytes: number;
};


/** A second resource acquired in the same decision as memory, never while waiting for memory. */
export type JointAdmission = {
  /** Called under the ledger lock. False withdraws the memory request without losing the resource's queue position. */
  ready(): boolean;
  /** Nonblocking, under the same lock, only after memory fits. False leaves neither resource held. */
  acquire(): boolean;
};

export type ReserveOptions = {
  /** Read for RESERVATION_ENV, LEDGER_ENV and NTS_HOST_OBSERVATIONS; process.env unless given. */
  env?: NodeJS.ProcessEnv;
  /** The ledger's directory; else LEDGER_ENV, else LEDGER_DIR. */
  dir?: string;
  /**
   * Told one line when the request, or a growth of its reservation, starts
   * waiting, one when it is admitted after a wait, and one for each entry a
   * decision drops.
   */
  report?: (line: string) => void;
  /** Told every decision made on this request and on its reservation's growths. */
  observe?: (decision: Decision) => void;
  /** Withdraws the request while it waits. */
  signal?: AbortSignal;
  everyMs?: number;
  /** What an admitted job uses now, in place of reading the host: for tests. */
  used?: (entry: LedgerEntry) => number;
  joint?: JointAdmission;
};

export type Reservation = {
  id: string;
  /** The ledger's directory. */
  ledger: string;
  /** Inside a parent's reservation: nothing was asked, and `release` leaves the parent's. */
  inherited: boolean;
  /** Whether this reservation still has a live admitted entry. Read without the lock. */
  active(): boolean;
  /** What a child process needs to run inside this reservation. */
  env: Readonly<Record<string, string>>;
  /** Its fixed forecast, or an unmeasured job's live use and margin. */
  readonly bytes: number;
  /**
   * Waits until `bytes` more may start, exactly as a new request of `bytes`
   * at this reservation's priority and admission order would, then holds them in this
   * reservation's own entry. One growth at a time; `signal` withdraws it while
   * it waits, and so does `release`. Inside a parent's reservation it asks
   * for nothing, as `reserve` does there. A live job follows its use and
   * asks nothing for explicit growth or shrink.
   */
  grow(bytes: number, options?: { signal?: AbortSignal }): Promise<void>;
  /**
   * Gives `bytes` back without waiting in the queue: `bytes` drops when it is
   * called, and the entry once the ledger's lock is free. A reservation keeps
   * at least one byte; `release` ends it.
   */
  shrink(bytes: number): Promise<void>;
  /**
   * Whether a live request of higher priority than this reservation's waits
   * now, one that could fit were every admitted job to end; inside a
   * parent's reservation, than the parent's. Its holder should
   * then start nothing new and give back what it does not use, so that the
   * request ahead of it waits only for work already running to end: nothing
   * running is ever stopped for it. Read without the lock.
   */
  outranked(): boolean;
  /**
   * Says in the entry that `key`, a step or job of this reservation, held
   * more than it reserved. Inside a parent's reservation it says nothing:
   * the parent measures what runs inside it.
   */
  noteOver(key: string): Promise<void>;
  /** Ends the reservation, withdrawing a growth that waits; a second call does nothing. */
  release(): void;
  /** The sampler has replied and exited; ordinary reservations have no service. */
  readonly closed: Promise<void>;
};

function label(what: string): string {
  const text = String(what ?? "").replace(/\s+/g, " ").trim();
  if (!text) throw new TypeError("a reservation names what it is for");
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
}

function amount(bytes: number, what: string, verb: string): void {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new RangeError(`memory: ${what} ${verb} a positive whole number of bytes, not ${bytes}`);
}

const reservationEnv = (id: string, dir: string, priority: Priority): Record<string, string> => ({ [RESERVATION_ENV]: id, [PRIORITY_ENV]: priority, ...(dir === LEDGER_DIR ? {} : { [LEDGER_ENV]: dir }) });

/** The one scheduling owner of admitted work: its oldest live reserving ancestor.
 * Growth belongs to the admitted job; a new independent request owns its ticket. */
function reservationOrder(entry: LedgerEntry, admitted: ReadonlyMap<string, LedgerEntry>): {priority: Priority; order: number} {
  let owner = entry.grows === null ? entry : admitted.get(entry.grows) ?? entry;
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(owner.id)) throw new Error(`memory: reservation ancestry contains a cycle at ${owner.id}`);
    seen.add(owner.id);
    const parent = owner.drawsOn === undefined ? undefined : admitted.get(owner.drawsOn);
    if (parent === undefined) return {priority: owner.priority, order: owner.seq};
    owner = parent;
  }
}
function liveReservations(dir: string): Map<string, LedgerEntry> {
  return new Map(readEntries(dir, "admitted").filter(entry => alive(entry.owner)).map(entry => [entry.id, entry]));
}

/** Resolve a launcher's rank before it sets irreversible kernel OOM scores.
 * The same scheduling owner feeds admission, growth, yield, status and handoffs. */
export function reservationPriority(priority: Priority, env: NodeJS.ProcessEnv = process.env, named = env[RESERVATION_ENV]): Priority {
  const dir = resolve(env[LEDGER_ENV] ?? LEDGER_DIR);
  const on = (named === undefined ? undefined : counting(dir, named, process.pid, undefined, "job priority"))
    ?? ancestorReservation(dir, process.pid, undefined);
  const admitted = liveReservations(dir), owner = on === undefined ? undefined : admitted.get(on);
  return owner === undefined ? priority : reservationOrder(owner, admitted).priority;
}

/**
 * Whether a request of higher priority than `priority` waits in `dir`, among
 * those whose waiter and owner are alive and that could fit were every
 * admitted job to end: one that could not is not helped by what a yield frees.
 */
function outrankedIn(dir: string, self: LedgerEntry): boolean {
  const admitted = liveReservations(dir), {priority} = reservationOrder(self, admitted);
  return readEntries(dir, "waiting").some(entry => rank(reservationOrder(entry, admitted).priority) < rank(priority)
    && entry.fits !== false && alive(entry.waiter) && alive(entry.owner));
}

/**
 * Checks that the request of `what`, owned by `pid`, may take over reservation
 * `id`: one whose measure counts `pid`'s memory, as a child's is counted
 * inside its parent's (`inside`), so the memory moves between two
 * reservations of one job and never leaves another job unreserved. One that
 * has ended leaves nothing to take over.
 */
function taking(dir: string, id: string, pid: number, what: string): void {
  if (!ID.test(id)) throw new TypeError(`memory: ${what} would take over ${JSON.stringify(id)}, which is not a reservation id`);
  const entry = admittedEntry(dir, id);
  if (entry !== null && !counts(entry, pid)) {
    throw new Error(`memory: ${what} (pid ${pid}) would take over ${entry.what}'s reservation, which does not count its memory: `
      + `it is outside that reservation's process tree${entry.measure.cgroup ? " and cgroup" : ""}`);
  }
}

/** `id` when it names a live admitted reservation, other than `except`, that counts `pid`'s memory. */
function counting(dir: string, id: string, pid: number, except: string | undefined, what: string): string | undefined {
  if (!ID.test(id)) throw new TypeError(`memory: ${what} would draw on ${JSON.stringify(id)}, which is not a reservation id`);
  if (id === except) return undefined;
  const entry = admittedEntry(dir, id);
  return entry !== null && counts(entry, pid) ? id : undefined;
}

/**
 * The admitted reservation of the nearest ancestor of `pid` that holds one --
 * its parent's, else its grandparent's, and so on -- other than `except` (one
 * it takes over): what a request for `pid` draws on first. Of an ancestor
 * that holds more than one, the latest. Read without the lock: the decision
 * draws on it only while it is still admitted.
 */
function ancestorReservation(dir: string, pid: number, except: string | undefined): string | undefined {
  const held = new Map<number, LedgerEntry>();
  for (const entry of readEntries(dir, "admitted")) {
    if (entry.id === except || !alive(entry.owner)) continue;
    const other = held.get(entry.owner.pid);
    if (other === undefined || other.since < entry.since) held.set(entry.owner.pid, entry);
  }
  if (!held.size) return undefined;
  for (let at = readStat(pid)?.ppid, hops = 0; at !== undefined && at > 1 && hops < 65536; at = readStat(at)?.ppid, hops++) {
    const entry = held.get(at);
    if (entry !== undefined) return entry.id;
  }
  return undefined;
}

/** The parent's reservation when `parent` names a live one that counts `pid`'s memory. */
function inside(parent: string | undefined, dir: string, pid: number, what: string, bytes: number, report: (line: string) => void): Reservation | null {
  if (!parent) return null;
  if (!ID.test(parent)) throw new Error(`${RESERVATION_ENV}=${parent} is not a reservation id`);
  const entry = admittedEntry(dir, parent);
  if (entry === null) {
    report(`memory: ${what} was started inside reservation ${parent}, which has ended; it asks for its own`);
    return null;
  }
  if (!counts(entry, pid)) {
    throw new Error(`memory: ${what} (pid ${pid}) was started inside ${entry.what}'s reservation, which does not count its memory: `
      + `it is outside that reservation's process tree${entry.measure.cgroup ? " and cgroup" : ""}`);
  }
  // The parent sized its reservation for what runs inside it, so a growth
  // asks for nothing more than the request did.
  let held = bytes;
  const {priority} = reservationOrder(entry, liveReservations(dir));
  return {
    id: entry.id, ledger: dir, inherited: true, closed:Promise.resolve(), env: reservationEnv(entry.id, dir, priority),
    active: () => admittedEntry(dir, entry.id) !== null,
    get bytes() { return held; },
    grow: async more => { amount(more, what, "grows by"); held += more; },
    shrink: async less => {
      amount(less, what, "gives back");
      if (less >= held) throw new RangeError(`memory: ${what} holds ${gib(held)}, so it cannot give back ${gib(less)}; release it instead`);
      held -= less;
    },
    outranked: () => outrankedIn(dir, entry),
    noteOver: async () => {},
    release: () => {},
  };
}

/**
 * Rewrites the admitted entry `id` in `dir` under the lock, as `change`
 * makes it from the entry as it stands (null: leave it); an entry that is
 * gone (released, or dropped once its owner exited) stays gone.
 */
async function rewriteEntry(dir: string, id: string, change: (entry: LedgerEntry) => LedgerEntry | null, every = POLL_MS): Promise<void> {
  for (let retry = LOCK_RETRY_MS; ; retry = Math.min(2 * retry, Math.max(every, LOCK_RETRY_MS))) {
    const lock = lockLedger(dir);
    if (lock === null) { await pause(retry); continue; }
    try {
      const file = entryPath(dir, "admitted", id);
      let entry: LedgerEntry;
      try { entry = parseEntry(readFileSync(file, "utf8"), file); }
      catch (error) { if (gone(error)) return; throw error; }
      const next = change(entry);
      if (next !== null) writeEntry(dir, "admitted", next);
      return;
    } finally { lock.release(); }
  }
}

/**
 * Says in admitted entry `id` that `key` held more than it reserved: its
 * holder does, and so does the watcher of a job's peak (memory-watch.ts),
 * which writes nothing else.
 */
export async function noteOver(dir: string, id: string, key: string): Promise<void> {
  if (!KEY.test(key)) throw new TypeError(`memory: ${JSON.stringify(key)} is not a step or job key`);
  await rewriteEntry(dir, id, entry => entry.over?.includes(key) ? null : { ...entry, over: [...entry.over ?? [], key] });
}

/** Publishes a live job's observed peak before its watcher waits again. */
export async function noteSampledPeak(dir: string, id: string, bytes: number): Promise<void> {
  await rewriteEntry(dir, id, entry => !entry.liveUse || bytes <= (entry.sampledPeak ?? 0) ? null : { ...entry, sampledPeak: bytes });
}

function measureFor(owner: ProcessIdentity, cgroup: string | undefined): Measure {
  if (cgroup === undefined) return { tree: true, cgroup: ownCgroup(owner.pid) };
  if (!cgroup.startsWith("/") || cgroup === "/" || cgroup.endsWith("/") || cgroup.split("/").some(part => part === "." || part === "..")) {
    throw new Error(`not a cgroup path: ${cgroup}`);
  }
  if (!accounted(cgroup)) throw new Error(`cgroup ${cgroup} does not exist or has no memory accounting`);
  return { tree: false, cgroup: { path: cgroup, inode: inodeOf(CGROUP_ROOT + cgroup) } };
}

type Context = {
  dir: string; host: HostObservations; every: number;
  report: (line: string) => void; observe: (decision: Decision) => void;
  used: (entry: LedgerEntry, table: () => Table, exclude: ReadonlySet<number>) => number;
};

const requestFor = (entry: LedgerEntry) => entry.grows === null ? `request for ${gib(entry.bytes)}` : `request to grow by ${gib(entry.bytes)}`;

/**
 * What admitted jobs may still take, as the decision on request `deciding`
 * counts them: each what it reserved and has not used yet; one of lower
 * priority than `deciding`, only its use and a margin, what a measured unit
 * reserves for that use (step-scheduling.ts's `peakReservation`); the one
 * `deciding` takes over, nothing (see the top of this file). With no request
 * deciding, each its whole promise.
 */
function pendingFor(admitted: Iterable<{ entry: Pick<LedgerEntry, "id" | "bytes" | "priority" | "liveUse">; used: number; lent: number }>,
  deciding: Pick<LedgerEntry, "priority" | "replaces"> | null): number {
  let pending = 0;
  for (const { entry, used, lent } of admitted) {
    if (entry.id === deciding?.replaces) continue;
    // What it has lent the reservations that draw on it is theirs to promise.
    const own = Math.max(0, entry.bytes - lent);
    const yields = deciding !== null && rank(deciding.priority) < rank(entry.priority);
    const live = peakReservation([Math.max(1, used)]);
    pending += Math.max(0, (entry.liveUse ? live : yields ? Math.min(own, live) : own) - used);
  }
  return pending;
}

/** What an admitted reservation uses now, and what it has lent the reservations that draw on it. */
type Account = { used: number; lent: number; drawn: number };

/**
 * Each admitted reservation's account. One that draws on another (`drawsOn`)
 * counts what its own measure holds, and the other's measure leaves those
 * processes out, so nothing is counted twice; what it drew (`drawn`) the
 * other has lent it, and promises that much less while it holds it.
 */
function accountsOf(admitted: ReadonlyMap<string, LedgerEntry>, use: (entry: LedgerEntry, exclude: ReadonlySet<number>) => number,
  table: () => Table): Map<string, Account> {
  const drawers = new Map<string, LedgerEntry[]>();
  for (const entry of admitted.values()) {
    if (entry.drawsOn === undefined || !admitted.has(entry.drawsOn)) continue;
    drawers.set(entry.drawsOn, [...drawers.get(entry.drawsOn) ?? [], entry]);
  }
  const accounts = new Map<string, Account>();
  for (const entry of admitted.values()) {
    const children = drawers.get(entry.id) ?? [];
    const theirs = new Set<number>();
    for (const child of children) {
      if (child.measure.tree) for (const pid of processTree(child.owner.pid, table())) theirs.add(pid);
      if (child.measure.cgroup !== null) for (const pid of cgroupMembers(child.measure.cgroup.path)) theirs.add(pid);
    }
    accounts.set(entry.id, { used: use(entry, theirs), lent: 0, drawn: entry.drawn ?? 0 });
  }
  for (const entry of admitted.values()) {
    const account = accounts.get(entry.id)!, children = drawers.get(entry.id) ?? [];
    account.lent = children.filter(child => !child.liveUse).reduce((sum, child) => sum + (child.drawn ?? 0), 0);
    let unused = entry.liveUse ? 0 : Math.max(0, entry.bytes - account.used - account.lent);
    // A live child's share follows its current charge, so its growth and
    // shrink neither duplicate nor strand the ancestor's unused forecast.
    for (const child of children.filter(child => child.liveUse).map(child => ({...child, ...reservationOrder(child, admitted)})).sort(queueOrder)) {
      const theirs = accounts.get(child.id)!;
      theirs.drawn = Math.min(unused, peakReservation([Math.max(1, theirs.used)]));
      unused -= theirs.drawn; account.lent += theirs.drawn;
    }
  }
  return accounts;
}

/** The live admitted reservation a request draws on: its own ancestor's, or for a growth, its reservation's. */
function drawnOn(entry: LedgerEntry, admitted: ReadonlyMap<string, LedgerEntry>): string | undefined {
  const on = entry.grows === null ? entry.drawsOn : admitted.get(entry.grows)?.drawsOn;
  return on !== undefined && admitted.has(on) ? on : undefined;
}

/** One decision, holding the lock: drop what is dead, then admit `self` or queue it. */
function decide(context: Context, self: LedgerEntry, registered: boolean, joint?: JointAdmission): { decision: Decision; registered: boolean } {
  const { dir, report } = context;
  for (const state of ["waiting", "admitted"] as const) mkdirSync(join(dir, state), { recursive: true });
  // What a writer left between its write and its rename: none writes without the lock.
  for (const name of readdirSync(dir)) if (name.startsWith(".tmp-")) removeQuietly(join(dir, name));
  const admitted = new Map<string, LedgerEntry>();
  for (const entry of readEntries(dir, "admitted")) {
    if (alive(entry.owner)) { admitted.set(entry.id, entry); continue; }
    removeQuietly(entryPath(dir, "admitted", entry.id));
    report(`memory: dropped ${entry.what}'s reservation of ${gib(entry.bytes)}: its owner, pid ${entry.owner.pid}, has exited`);
  }
  const waiting: LedgerEntry[] = [];
  let listed = false;
  for (const entry of readEntries(dir, "waiting")) {
    if (entry.id === self.id) { listed = true; continue; }
    const lost = !alive(entry.waiter) ? entry.waiter : !alive(entry.owner) ? entry.owner : null;
    if (lost !== null) {
      removeQuietly(entryPath(dir, "waiting", entry.id));
      report(`memory: dropped ${entry.what}'s ${requestFor(entry)}: pid ${lost.pid}, which ${lost === entry.waiter ? "waited for it" : "owns it"}, has exited`);
    } else if (entry.grows !== null && !admitted.has(entry.grows)) {
      removeQuietly(entryPath(dir, "waiting", entry.id));
      report(`memory: dropped ${entry.what}'s ${requestFor(entry)}: its reservation has ended`);
    } else waiting.push(entry);
  }
  const refuse: (message: string) => never = message => {
    if (listed) removeQuietly(entryPath(dir, "waiting", self.id));
    throw new Error(message);
  };
  if (!alive(self.owner)) refuse(`memory: ${self.what}'s owner, pid ${self.owner.pid}, exited while it waited`);
  const grown = self.grows === null ? undefined : admitted.get(self.grows);
  if (self.grows !== null && grown === undefined) refuse(`memory: ${self.what}'s reservation has ended, so its ${requestFor(self)} is dropped`);
  if (registered && !listed) report(`memory: ${self.what}'s ${requestFor(self)} left the ledger while it waited; it asks again, at the back of the queue`);
  if (!listed) self.seq = 1 + Math.max(0, ...waiting.map(entry => entry.seq), ...[...admitted.values()].map(entry => entry.seq));
  const policy = reservationOrder(self, admitted);
  self.priority = policy.priority;

  const { availableBytes } = context.host.memory();
  let table: Table | undefined;
  const read = () => table ??= processTable();
  const accounts = accountsOf(admitted, (entry, exclude) => context.used(entry, read, exclude), read);
  // MemAvailable already excludes these waiting processes' live use. They
  // ask only for the additional margin, not for memory they hold already.
  const liveMargins = new Map<string, number>();
  for (const entry of [...waiting, self]) if (entry.liveUse) {
    const used = context.used(entry, read, NONE);
    const charged = peakReservation([Math.max(1, used)]);
    if (entry.id === self.id) self.bytes = charged;
    liveMargins.set(entry.id, Math.max(0, charged - used));
  }
  const usedBytes = [...accounts.values()].reduce((sum, account) => sum + account.used, 0);
  const pendingBytes = pendingFor([...admitted.values()].map(entry => ({ entry: {...entry, ...reservationOrder(entry, admitted)}, ...accounts.get(entry.id)! })), self);
  const roomBytes = availableBytes - pendingBytes - SYSTEM_FLOOR_BYTES;
  // What the queue could be given were every admitted job to end.
  const freeBytes = availableBytes + usedBytes - SYSTEM_FLOOR_BYTES;
  const everyone = [...waiting, self].map(entry => ({...entry, ...reservationOrder(entry, admitted)})).sort(queueOrder);
  // What each request draws on the unused part of the reservation it draws
  // on, in the queue's order: it asks the queue only for the rest.
  const left = new Map<string, number>(), draws = new Map<string, number>();
  for (const entry of everyone) {
    const on = drawnOn(entry, admitted);
    if (on === undefined) continue;
    const account = accounts.get(on)!;
    const unused = left.get(on) ?? (admitted.get(on)!.liveUse ? 0 : Math.max(0, admitted.get(on)!.bytes - account.lent - account.used));
    const take = Math.min(entry.bytes, unused);
    left.set(on, unused - take);
    draws.set(entry.id, take);
  }
  const ask = (entry: LedgerEntry) => Math.max(0, (liveMargins.get(entry.id) ?? entry.bytes) - (draws.get(entry.id) ?? 0));
  // What a request would hold beyond what it draws: a growth with its reservation's own part.
  const whole = (entry: LedgerEntry) => {
    const into = entry.grows === null ? undefined : admitted.get(entry.grows);
    return ask(entry) + (into === undefined ? 0 : into.bytes - (into.drawn ?? 0));
  };
  const fits = whole(self) <= freeBytes;
  // A request that could not fit now holds nobody behind it. One the
  // reservation it draws on covers asks the queue nothing, so it waits behind
  // nobody: a holder whose child needs memory never waits for itself.
  const queue = everyone.filter(entry => ask(entry) > 0 && whole(entry) <= freeBytes).map(entry => ({ ...entry, bytes: ask(entry) }));
  const drawnBytes = draws.get(self.id) ?? 0;
  const memoryFits = fits && (ask(self) === 0 || admissible(roomBytes, queue).has(self.id));
  const resourceBusy = memoryFits && joint !== undefined && !joint.acquire();
  const go = memoryFits && !resourceBusy;
  if (go && grown !== undefined) {
    // The growth joins its reservation: one entry, and one measure, per job.
    writeEntry(dir, "admitted", { ...grown, bytes: grown.bytes + self.bytes, ...(drawnBytes ? { drawn: (grown.drawn ?? 0) + drawnBytes } : {}) });
    if (listed) removeQuietly(entryPath(dir, "waiting", self.id));
  } else if (go) {
    // Admitted, it says what it drew on the reservation it draws on.
    const on = drawnOn(self, admitted);
    const entry: LedgerEntry = { ...self, fits: undefined, drawsOn: on, ...(on === undefined ? {} : { drawn: drawnBytes }) };
    if (listed) {
      writeEntry(dir, "waiting", entry);
      renameSync(entryPath(dir, "waiting", self.id), entryPath(dir, "admitted", self.id));
    } else writeEntry(dir, "admitted", entry);
    if (on !== undefined && drawnBytes) report(`memory: ${self.what} drew ${gib(drawnBytes)} of its ${gib(self.bytes)} on ${admitted.get(on)!.what}'s unused reservation`);
  } else if (resourceBusy) {
    if (listed) removeQuietly(entryPath(dir, "waiting", self.id));
  } else if (!listed || self.fits !== fits) {
    // Waiting, it says whether it could fit, which `outranked` reads.
    self.fits = fits;
    writeEntry(dir, "waiting", self);
  }
  // The reservation it takes over ends with the decision that admits it.
  const replaced = self.replaces === undefined ? undefined : admitted.get(self.replaces);
  if (go && replaced !== undefined) {
    removeQuietly(entryPath(dir, "admitted", replaced.id));
    report(`memory: ${self.what} took over ${replaced.what}'s reservation of ${gib(replaced.bytes)}`);
  }
  return {
    decision: { id: self.id, what: self.what, admitted: go, grows: self.grows, availableBytes, pendingBytes, roomBytes, ahead: everyone.findIndex(entry => entry.id === self.id), fits, drawnBytes },
    registered: !go && !resourceBusy,
  };
}

/**
 * Decides on `self` now, and again every `every` while it does not fit,
 * until it is admitted or withdrawn (by `signal`, or by its owner's exit).
 * `admitted` runs with the decision that admits it, before this process runs
 * anything else. Returns that decision, and how long the request waited
 * (null when it did not).
 */
async function wait(context: Context, self: LedgerEntry, signal: AbortSignal | undefined, waits: () => string, admitted: () => void = () => {}, joint?: JointAdmission): Promise<{ decision: Decision; waitedMs: number | null }> {
  let registered = false;
  let waitedFrom: number | undefined;
  // A decision holds the lock for milliseconds, so a busy lock is tried again
  // soon; while it stays busy, the tries back off to one every `every`.
  let retry = LOCK_RETRY_MS;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const lock = lockLedger(context.dir);
      if (lock === null) {
        await pause(retry, undefined, { signal });
        retry = Math.min(2 * retry, Math.max(context.every, LOCK_RETRY_MS));
        continue;
      }
      retry = LOCK_RETRY_MS;
      let outcome: ReturnType<typeof decide> | undefined;
      try {
        if (joint !== undefined && !joint.ready()) {
          if (registered) removeQuietly(entryPath(context.dir, "waiting", self.id));
          registered = false;
        } else outcome = decide(context, self, registered, joint);
      }
      finally { lock.release(); }
      if (outcome === undefined) { await pause(context.every, undefined, { signal }); continue; }
      registered = outcome.registered;
      const { decision } = outcome;
      if (decision.admitted) {
        admitted();
        return { decision, waitedMs: waitedFrom === undefined ? null : context.host.now() - waitedFrom };
      }
      context.observe(decision);
      if (waitedFrom === undefined) {
        waitedFrom = context.host.now();
        context.report(`memory: ${self.what} ${waits()} (${self.priority}): ${gib(decision.availableBytes)} available, `
          + `${gib(decision.pendingBytes)} of it promised to running jobs, ${gib(SYSTEM_FLOOR_BYTES)} kept for the system`
          + (decision.ahead ? `; ${decision.ahead} ahead of it in the queue` : "")
          + (decision.drawnBytes ? `; ${gib(decision.drawnBytes)} of it comes from the unused reservation it draws on` : "")
          + (decision.fits ? "" : "; it could not fit even were every admitted job to end, so it holds nobody behind it until memory nobody reserved frees"));
      }
      await pause(context.every, undefined, { signal });
    }
  } catch (error) {
    // Nobody waits for it any more.
    if (registered) removeQuietly(entryPath(context.dir, "waiting", self.id));
    throw error;
  }
}

/** An admitted reservation's handle: what it holds, and its growth, shrink and release through `context`'s ledger. */
function holding(self: LedgerEntry, context: Context): Reservation {
  const { dir } = context;
  let bytes = self.bytes;
  let released = false;
  let growing: { id: string; withdraw: AbortController } | null = null;
  // Writes the entry with what the handle holds now. A shrink gives back its
  // own part first, then what it drew on another reservation.
  const rewrite = () => rewriteEntry(dir, self.id, entry => released ? null
    : { ...entry, bytes, ...(entry.drawn === undefined ? {} : { drawn: Math.min(entry.drawn, bytes) }) }, context.every);
  return {
    id: self.id, ledger: dir, inherited: false, closed:Promise.resolve(), env: reservationEnv(self.id, dir, reservationOrder(self, liveReservations(dir)).priority),
    active: () => !released && admittedEntry(dir, self.id) !== null,
    get bytes() { return self.liveUse ? peakReservation([Math.max(1, context.used(self, processTable, NONE))]) : bytes; },
    async grow(more, { signal }: { signal?: AbortSignal } = {}) {
      amount(more, self.what, "grows by");
      if (released) throw new Error(`memory: ${self.what}'s reservation has been released, so it cannot grow`);
      if (self.liveUse) return; // No forecast: live accounting follows its use instead.
      if (growing !== null) throw new Error(`memory: ${self.what} already waits to grow; it grows by one request at a time`);
      const never = neverFits(bytes + more, context.host.memory().totalBytes, `${self.what} asks to grow by ${gib(more)} to ${gib(bytes + more)}`);
      if (never !== null) throw new RangeError(never);
      const waiter = processIdentity(process.pid);
      if (waiter === null) throw new Error("this process has no identity in /proc");
      // A request of its own in the queue, owned as the reservation is: it
      // lasts no longer than the reservation's owner.
      const request: LedgerEntry = { ...self, id: randomUUID(), seq: 0, bytes: more, waiter, since: new Date().toISOString(), grows: self.id,
        replaces: undefined, drawsOn: undefined, drawn: undefined };
      const withdraw = new AbortController();
      growing = { id: request.id, withdraw };
      let outcome: Awaited<ReturnType<typeof wait>>;
      try {
        outcome = await wait(context, request, signal ? AbortSignal.any([signal, withdraw.signal]) : withdraw.signal,
          () => `waits to grow by ${gib(more)} to ${gib(bytes + more)}`,
          // With the entry's own write, so no shrink in between can write the
          // entry without these bytes.
          () => { bytes += more; });
      } catch (error) {
        throw withdraw.signal.aborted ? withdraw.signal.reason : error;
      } finally { growing = null; }
      context.observe(outcome.decision);
      if (outcome.waitedMs !== null) context.report(`memory: ${self.what} grew by ${gib(more)} to ${gib(bytes)} after ${Math.round(outcome.waitedMs / 1000)} s`);
    },
    outranked: () => !released && outrankedIn(dir, self),
    noteOver: async key => { if (!released) await noteOver(dir, self.id, key); },
    async shrink(less) {
      amount(less, self.what, "gives back");
      if (released) return;
      if (self.liveUse) return;
      if (less >= bytes) throw new RangeError(`memory: ${self.what} holds ${gib(bytes)}, so it cannot give back ${gib(less)}; release it instead`);
      bytes -= less;
      try { await rewrite(); }
      catch (error) { bytes += less; throw error; }
    },
    release() {
      if (released) return;
      released = true;
      if (growing !== null) {
        growing.withdraw.abort(new Error(`memory: ${self.what}'s reservation was released while it waited to grow`));
        removeQuietly(entryPath(dir, "waiting", growing.id));
      }
      removeQuietly(entryPath(dir, "admitted", self.id));
    },
  };
}

/**
 * Waits until `request.bytes` may start, then holds them until the returned
 * reservation is released or its owner exits. Inside a parent's reservation
 * (RESERVATION_ENV) it returns at once and asks for nothing.
 */
export async function reserve(request: ReserveRequest, options: ReserveOptions = {}): Promise<Reservation> {
  const env = options.env ?? process.env;
  const dir = resolve(options.dir ?? env[LEDGER_ENV] ?? LEDGER_DIR);
  const report = options.report ?? (() => {});
  const what = label(request.what);
  const { priority = "agent" } = request;
  if (request.liveUse && request.bytes !== 0) throw new TypeError("a live job has no byte forecast; pass zero bytes");
  const bytes = request.liveUse ? peakReservation([1]) : request.bytes;
  amount(bytes, what, "reserves");
  if (!PRIORITIES.includes(priority)) throw new RangeError(`memory: no priority ${String(priority)}; one of ${PRIORITIES.join(", ")}`);
  const nested = inside(env[RESERVATION_ENV], dir, request.owner?.pid ?? process.pid, what, bytes, report);
  if (nested !== null) {
    if (options.joint !== undefined) {
      // A caller may measure inside an ancestor's job, but must not pre-reserve
      // the measurement itself: that would keep memory while its CPUs wait.
      const entry = readEntries(dir, "admitted").find(entry => entry.id === nested.id);
      if (entry?.owner.pid === process.pid) throw new Error("a measurement must enter through with-lock.sh --key, without an outer admit.ts reservation");
      for (;;) {
        options.signal?.throwIfAborted();
        const lock = lockLedger(dir);
        let go = false;
        try { if (lock !== null) go = options.joint.ready() && options.joint.acquire(); }
        finally { lock?.release(); }
        if (go) break;
        await pause(options.everyMs ?? POLL_MS, undefined, { signal: options.signal });
      }
    }
    return nested;
  }

  const waiter = processIdentity(process.pid);
  if (waiter === null) throw new Error("this process has no identity in /proc");
  const pid = request.owner?.pid ?? process.pid;
  const owner = pid === process.pid ? waiter : processIdentity(pid);
  if (owner === null) throw new Error(`memory: ${what}'s owner, pid ${pid}, is not running`);
  const host = hostObservations(env);
  const never = neverFits(bytes, host.memory().totalBytes, `${what} asks ${gib(bytes)}`);
  if (never !== null) throw new RangeError(never);
  const unmeasured = [...new Set(request.unmeasured ?? [])];
  if (!keyList(unmeasured)) throw new TypeError(`memory: ${what}'s unmeasured keys are not step or job keys: ${unmeasured.join(", ")}`);
  if (request.replaces !== undefined) taking(dir, request.replaces, owner.pid, what);
  // Inside another job's reservation -- the one it names, else its nearest
  // ancestor process's -- it draws on that one first.
  const drawsOn = (request.drawsOn === undefined ? undefined : counting(dir, request.drawsOn, owner.pid, request.replaces, what))
    ?? ancestorReservation(dir, owner.pid, request.replaces);
  const self: LedgerEntry = {
    version: 2, id: randomUUID(), seq: 0, bytes, what, priority, owner, waiter,
    measure: measureFor(owner, request.owner?.cgroup), since: new Date().toISOString(), grows: null,
    ...(unmeasured.length ? { unmeasured } : {}),
    ...(request.liveUse ? { liveUse: true } : {}),
    ...(request.replaces !== undefined ? { replaces: request.replaces } : {}),
    ...(drawsOn !== undefined ? { drawsOn } : {}),
  };
  const used = options.used;
  const context: Context = {
    dir, host, report, every: options.everyMs ?? POLL_MS, observe: options.observe ?? (() => {}),
    used: used ? entry => used(entry) : (entry, table, exclude) => measured(entry, table, exclude, host),
  };
  const { decision, waitedMs } = await wait(context, self, options.signal, () => `waits for ${gib(bytes)}`, undefined, options.joint);
  const reservation = holding(self, context);
  try { context.observe(decision); }
  catch (error) { reservation.release(); throw error; }
  if (waitedMs !== null) report(`memory: ${what} admitted with ${gib(bytes)} after ${Math.round(waitedMs / 1000)} s`);
  return reservation;
}

// ---------------------------------------------------------------------------
// A job's memory, and the ledger's state.
// ---------------------------------------------------------------------------

/** A job that reserves memory outside any step. */
export type JobRequest = {
  /** Its name in the scheduling history, where its earlier runs left their peaks. */
  key: string;
  what: string;
  /** Its parallel workers: the history keeps its peak per worker. */
  units?: number;
  /** The most it can ever hold, its own kernel cap where it has one: it never reserves more. */
  atMostBytes?: number;
};

/** What a job reserves, why, and the history its peak goes to. */
export type JobSizing = { bytes: number; basis: MemorySizing["basis"]; history: string; units: number };

/**
 * What a job reserves in the environment `env`: per worker, what its own
 * peaks in the history of the target it runs against say (step-scheduling.ts's
 * `historyFile`). A job without peaks returns zero and basis `live`: no
 * forecast, with admission and accounting following live use and its margin.
 * Measured forecasts stay capped at the machine and the job's own kernel cap.
 */
export function jobSizing(request: Omit<JobRequest, "what">, env: NodeJS.ProcessEnv = process.env): JobSizing {
  const units = request.units ?? 1;
  if (!KEY.test(request.key)) throw new TypeError(`memory: a job's key is lower-case words joined by hyphens, not ${JSON.stringify(request.key)}`);
  if (!Number.isSafeInteger(units) || units < 1) throw new RangeError(`memory: ${request.key} runs a positive whole number of workers, not ${units}`);
  if (request.atMostBytes !== undefined) amount(request.atMostBytes, request.key, "holds at most");
  const history = historyFile(env);
  const { totalBytes } = machineMemory(env);
  const capacity = totalBytes - SYSTEM_FLOOR_BYTES;
  const unit = unitReservation(readCostHistory(history), { job: request.key }, "worker", 0);
  if (unit.basis === "live") return { bytes: 0, basis: "live", history, units };
  const bytes = Math.max(1, Math.min(unit.bytes * units, capacity, request.atMostBytes ?? Infinity));
  return { bytes, basis: unit.basis, history, units };
}

const WATCHER = new URL("./memory-watch.ts", import.meta.url);
/** How often the watcher of a job's peak samples what its reservation's measure holds. */
export const WATCH_MS = POLL_MS;

/**
 * Watches the peak of a job that `admit.ts` is about to become, from a
 * process of its own (memory-watch.ts): it samples what the reservation's
 * measure holds every WATCH_MS, says in the entry when that passes what the
 * job reserved, and adds the most it saw, per worker, to the history under
 * the job's key once the reservation has ended. It runs under `setsid -f`:
 * in a session of its own, and orphaned at once, so it is in neither the
 * job's process tree nor its process group -- the job's measure does not
 * count it, and a signal to the job's group does not end it before it has
 * written the peak. It holds the job's standard output and error open, so a
 * caller that reads the job's output to its end has the peak written by
 * then. It stays in the job's cgroup, so stopping the job's unit stops it
 * too, and where that cgroup is the job's measure it does not count itself.
 * A watcher that does not start leaves the job unmeasured, and the job runs:
 * the history is observation-only.
 */
export function watchPeak(reservation: Pick<Reservation, "id" | "ledger">, job: Pick<JobSizing, "history" | "units"> & { key: string },
  report: (line: string) => void, env:NodeJS.ProcessEnv=process.env): void {
  const started = spawnSync("setsid", ["-f", process.execPath, fileURLToPath(WATCHER), reservation.ledger, reservation.id, job.history, job.key, String(job.units)],
    { stdio: ["ignore", "inherit", "inherit"], cwd: "/", env: { PATH: env.PATH ?? "/usr/bin:/bin",...hostObservationEnvironment(env) } });
  if (started.status !== 0) report(`memory: ${job.key}'s peak goes unmeasured: its watcher did not start (${started.error?.message ?? `setsid ended ${started.status ?? started.signal}`})`);
}

/**
 * Samples a job's peak on a thread of its own process (memory-watch.ts),
 * every WATCH_MS while its reservation is held: a job that blocks in a child
 * process is sampled all the same. `stop` ends it, and returns the most the
 * reservation's measure held, its own last sample included.
 */
function samplePeak(reservation: Pick<Reservation, "id" | "ledger">, key: string, env:NodeJS.ProcessEnv,report:(line:string)=>void): { stop(): number;closed:Promise<void> } {
  const shared = new SharedArrayBuffer(8), cell = new BigInt64Array(shared);
  let worker: Worker | null = null, fixtureFailure:Error|undefined;
  let lifecycle:ReturnType<typeof workerLifecycle>|undefined;
  try {
    // The file-backed sampler owns its flags. Eval modes and parent preloads
    // describe the caller, and cannot be applied to this Worker entry.
    worker = new Worker(WATCHER, { execArgv: [], workerData: { ledger: reservation.ledger, id: reservation.id, key, peak: shared, observations:hostObservationEnvironment(env) } });
    lifecycle=workerLifecycle(worker,`memory: ${key} sampler`,report);
    worker.postMessage({kind:"start"});
    // A sampler that fails leaves the job less measured, never stopped.
    worker.on("error", error => {if(error instanceof Error && error.name==="HostObservationError")fixtureFailure=error;});
  } catch(error) { if(error instanceof HostObservationError)throw error;report(`memory: ${key} sampler did not start: ${String(error)}`);worker = null; }
  return {
    closed:lifecycle?.closed??Promise.resolve(),
    stop() {
      let last = 0;
      try {
        const entry = admittedEntry(reservation.ledger, reservation.id);
        if (entry !== null) last = entryUsage(entry,{env});
        if(fixtureFailure)throw fixtureFailure;
        return Math.max(last, Number(Atomics.load(cell, 0)));
      } catch(error) { if(error instanceof HostObservationError || (error as Error).name==="HostObservationError")throw error;return Number(Atomics.load(cell,0)); }
      finally {lifecycle?.stop();worker=null;}
    },
  };
}

/**
 * The memory a job holds while it runs, reserved once at its start. Inside a
 * reservation already -- a gate step's, or one this process reserved before,
 * named by RESERVATION_ENV in the job's environment -- it is that one, and
 * nothing is asked or measured: the job keeps sizing itself by its step's
 * budget, and its memory is the step's. Otherwise it reserves what
 * `jobSizing` says, at the priority PRIORITY_ENV names (an agent's by
 * default), and names the reservation in the job's environment, so that the
 * job's later calls and the processes it starts run inside it; it ends when
 * the handle is released or the process exits, and then the most it held,
 * sampled while it ran, goes to the job's history (`samplePeak`). A job that
 * starts a gate run holds none across it: the run reserves its own.
 *
 * The job's environment is `options.env`, this process's by default: where
 * the ledger, the reading, the history and a reservation already held are
 * found.
 */
export async function reserveJob(request: JobRequest,
  options: { env?: NodeJS.ProcessEnv; signal?: AbortSignal; report?: (line: string) => void } = {}): Promise<Reservation> {
  const env = options.env ?? process.env;
  const report = options.report ?? (line => process.stderr.write(`${line}\n`));
  const sizing = jobSizing(request, env);
  const held = await reserve({ bytes: sizing.bytes, what: request.what, priority: priorityOf(env), liveUse: sizing.basis === "live", unmeasured: sizing.basis === "measured" ? [] : [request.key] },
    { env, signal: options.signal, report });
  if (held.inherited) return held;
  let sampler:ReturnType<typeof samplePeak>;
  try{sampler=samplePeak(held,request.key,env,report);}catch(error){held.release();throw error;}
  // What the environment named before, so that the release leaves it so: a
  // ledger the job was already given stays its ledger.
  const before = new Map(Object.keys(held.env).map(name => [name, env[name]]));
  Object.assign(env, held.env);
  let released = false;
  const release = () => {
    // A second call does nothing: the peak goes to the history once.
    if (released) return;
    released = true;
    process.off("exit", release);
    process.off("beforeExit",finish);
    let peak:number;
    try{peak=sampler.stop();}
    finally {
      held.release();
      for (const [name, value] of Object.entries(held.env)) {
        if (env[name] !== value) continue;
        const was = before.get(name);
        if (was === undefined) delete env[name];
        else env[name] = was;
      }
    }
    if (peak <= 0) return;
    const warning = writeCostHistory(sizing.history, { jobs: [{ key: request.key, peak: Math.ceil(peak / sizing.units) }] });
    if (warning) report(`memory: ${request.key}'s peak is not in its history: ${warning}`);
  };
  const finish=async()=>{release();try{await sampler.closed;}catch{/* the lifecycle already reported its named failure */}};
  process.once("beforeExit",finish);
  process.once("exit", release);
  return {
    closed:sampler.closed,
    id: held.id, ledger: held.ledger, inherited: false, env: held.env,
    active: () => held.active(),
    get bytes() { return held.bytes; },
    grow: (bytes, growOptions) => held.grow(bytes, growOptions),
    shrink: bytes => held.shrink(bytes),
    outranked: () => held.outranked(),
    noteOver: key => held.noteOver(key),
    release,
  };
}

/** The admitted entry `id` in `dir` while its owner lives; null once it is released, or dropped, or its owner has exited. */
export function admittedEntry(dir: string, id: string): LedgerEntry | null {
  const file = entryPath(dir, "admitted", id);
  let entry: LedgerEntry;
  try { entry = parseEntry(readFileSync(file, "utf8"), file); }
  catch (error) { if (gone(error)) return null; throw error; }
  return alive(entry.owner) ? entry : null;
}

/**
 * What an admitted entry's measure holds now; `exclude`, a process in it that
 * is not the job's, is not counted. A reservation drawn on this one counts
 * here too: this is what the job held, as its history learns it.
 */
export function entryUsage(entry: LedgerEntry, options: { exclude?: number; env?:NodeJS.ProcessEnv } = {}): number {
  return measured(entry, processTable, options.exclude === undefined ? NONE : new Set([options.exclude]), hostObservations(options.env));
}

/** The ledger as a status reader prints it: kind "memory", in `check.ts status --json`'s envelope. */
export type LedgerStatus = {
  version: 1; kind: "memory"; at: string; ledger: string;
  machine: { total_bytes: number; available_bytes: number; floor_bytes: number };
  /**
   * What the live admitted jobs have still to take, and the room that leaves
   * the queue, as the decision on its head counts them: a reservation of
   * lower priority than the head promises it only its use and a margin.
   * A live job promises only its current margin at every priority. With
   * nothing waiting, a measured forecast promises all it has not used.
   */
  pending_bytes: number; room_bytes: number;
  /**
   * `unmeasured`: the steps or jobs a reservation sized without a measurement
   * of their own in their history; `over`: those that held more than they
   * reserved. `draws_on`: the reservation of an ancestor process this one
   * draws on, of which `drawn_bytes` are its bytes; `lent_bytes`: what this
   * one has lent those that draw on it, which it does not promise.
   * `used_bytes` leaves out what a reservation that draws on this one
   * measures itself.
   */
  admitted: { id: string; what: string; priority: Priority; bytes: number; used_bytes: number; owner_pid: number; since: string; live: boolean;
    unmeasured: string[]; over: string[]; draws_on: string | null; drawn_bytes: number; lent_bytes: number; liveUse?: boolean }[];
  /** In the queue's order. */
  waiting: { id: string; what: string; priority: Priority; bytes: number; grows: string | null; owner_pid: number; waiter_pid: number; since: string; waited_s: number; live: boolean }[];
};

/** The ledger's state, read without the lock: each admitted job with what it uses now, the queue in order, and the room between them. */
export function ledgerStatus(options: { dir?: string; env?: NodeJS.ProcessEnv } = {}): LedgerStatus {
  const env = options.env ?? process.env;
  const dir = resolve(options.dir ?? env[LEDGER_ENV] ?? LEDGER_DIR);
  const view = readLedger(dir);
  const { availableBytes, totalBytes } = machineMemory(env);
  let table: Table | undefined;
  const read = () => table ??= processTable();
  const now = Date.now();
  // A dead entry is dropped by the next decision, so it uses and promises nothing.
  const live = new Map(view.admitted.filter(entry => entry.live).map(entry => [entry.id, entry]));
  const accounts = accountsOf(live, (entry, exclude) => measured(entry, read, exclude, hostObservations(env)), read);
  const admitted = view.admitted.map(entry => {
    const account = accounts.get(entry.id) ?? { used: 0, lent: 0, drawn: 0 };
    const on = entry.live ? drawnOn(entry, live) : undefined;
    return {
      id: entry.id, what: entry.what, priority: reservationOrder(entry, live).priority, bytes: entry.liveUse ? peakReservation([Math.max(1, account.used)]) : entry.bytes,
      ...(entry.liveUse ? { liveUse: true } : {}),
      used_bytes: account.used, owner_pid: entry.owner.pid, since: entry.since, live: entry.live,
      unmeasured: entry.unmeasured ?? [], over: entry.over ?? [],
      draws_on: on ?? null, drawn_bytes: on === undefined ? 0 : account.drawn, lent_bytes: account.lent,
    };
  });
  const waiting = view.waiting.map(entry => ({...entry, ...reservationOrder(entry, live)})).sort(queueOrder);
  const head = waiting.find(entry => entry.live) ?? null;
  const pending = pendingFor(admitted.filter(entry => entry.live).map(entry => ({ entry, used: entry.used_bytes, lent: entry.lent_bytes })), head);
  return {
    version: 1, kind: "memory", at: new Date(now).toISOString(), ledger: dir,
    machine: { total_bytes: totalBytes, available_bytes: availableBytes, floor_bytes: SYSTEM_FLOOR_BYTES },
    pending_bytes: pending, room_bytes: availableBytes - pending - SYSTEM_FLOOR_BYTES,
    admitted,
    waiting: waiting.map(entry => ({
      id: entry.id, what: entry.what, priority: entry.priority, bytes: entry.bytes, grows: entry.grows,
      owner_pid: entry.owner.pid, waiter_pid: entry.waiter.pid, since: entry.since,
      waited_s: Math.max(0, (now - Date.parse(entry.since)) / 1000), live: entry.live,
    })),
  };
}
