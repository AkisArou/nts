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
// **A reservation can grow and shrink**, for a job whose need moves while it
// runs (a gate run, as its steps start and end). `grow` asks for more exactly
// as a new request would: at the reservation's priority, behind every request
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
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";

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
const KIB = 1024;

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
export function parseMeminfo(text: string): Meminfo | null {
  const kib = (name: string) => new RegExp(`^${name}:\\s+(\\d+) kB$`, "m").exec(text)?.[1];
  const available = kib("MemAvailable"), total = kib("MemTotal");
  return available === undefined || total === undefined ? null : { availableBytes: Number(available) * KIB, totalBytes: Number(total) * KIB };
}

function readMeminfo(path: string): Meminfo {
  const meminfo = parseMeminfo(readFileSync(path, "utf8"));
  if (meminfo === null) throw new Error(`${path} names no MemAvailable and MemTotal`);
  return meminfo;
}

const meminfoPath = (env: NodeJS.ProcessEnv) => env.NTS_MEMINFO ?? "/proc/meminfo";

/** The reading decisions are made by: the file NTS_MEMINFO names in `env`, else the kernel's. */
export function machineMemory(env: NodeJS.ProcessEnv = process.env): Meminfo {
  return readMeminfo(meminfoPath(env));
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
export function processCharge(status: string): number {
  const kib = (name: string) => Number(new RegExp(`^${name}:\\s+(\\d+) kB$`, "m").exec(status)?.[1] ?? 0);
  return (kib("RssAnon") + kib("RssShmem")) * KIB;
}

/** What a cgroup holds that no other job can have: memory.current less the file pages and reclaimable slab MemAvailable counts as available. */
export function cgroupCharge(current: string, stat: string): number {
  const field = (name: string) => {
    const value = new RegExp(`^${name} (\\d+)$`, "m").exec(stat)?.[1];
    if (value === undefined) throw new Error(`memory.stat has no ${name}`);
    return Number(value);
  };
  return Math.max(0, Number(current.trim()) - field("active_file") - field("inactive_file") - field("slab_reclaimable"));
}

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

function readCgroupCharge(ref: CgroupRef): number {
  const dir = CGROUP_ROOT + ref.path;
  try {
    // Another cgroup by the same name: the job's own has gone, and what is
    // gone is charged nothing, which leaves its whole reservation pending.
    if (inodeOf(dir) !== ref.inode) return 0;
    return cgroupCharge(readFileSync(join(dir, "memory.current"), "utf8"), readFileSync(join(dir, "memory.stat"), "utf8"));
  } catch (error) { if (gone(error)) return 0; throw error; }
}

function readProcessCharge(pid: number): number {
  try { return processCharge(readFileSync(`/proc/${pid}/status`, "utf8")); }
  catch (error) { if (gone(error)) return 0; throw error; }
}

/** What an admitted job uses now. `table` is read once per decision, when a tree is measured. */
function measured(entry: LedgerEntry, table: () => Table): number {
  const { tree, cgroup } = entry.measure;
  let bytes = 0;
  let inside: ReadonlySet<number> = new Set();
  if (cgroup !== null) {
    bytes += readCgroupCharge(cgroup);
    if (tree) inside = new Set(cgroupMembers(cgroup.path));
  }
  if (tree) for (const pid of processTree(entry.owner.pid, table())) if (!inside.has(pid)) bytes += readProcessCharge(pid);
  return bytes;
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

export type Queued = { id: string; bytes: number; priority: Priority; seq: number };

const rank = (priority: Priority) => PRIORITIES.indexOf(priority);

/** Priority first, then arrival. */
export function queueOrder(a: Queued, b: Queued): number {
  return rank(a.priority) - rank(b.priority) || a.seq - b.seq;
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
};
type State = "waiting" | "admitted";

const entryPath = (dir: string, state: State, id: string) => join(dir, state, `${id}.json`);

function identity(value: unknown): value is ProcessIdentity {
  const who = value as ProcessIdentity;
  return typeof who === "object" && who !== null && typeof who.boot === "string" && Number.isSafeInteger(who.pid) && who.pid > 0 && typeof who.start === "string";
}

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
      || (entry.grows !== null && (typeof entry.grows !== "string" || !ID.test(entry.grows)))) {
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

export type ReserveRequest = { bytes: number; what: string; priority?: Priority; owner?: OwnerSpec };

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
};

export type ReserveOptions = {
  /** Read for RESERVATION_ENV, LEDGER_ENV and NTS_MEMINFO; process.env unless given. */
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
};

export type Reservation = {
  id: string;
  /** Inside a parent's reservation: nothing was asked, and `release` leaves the parent's. */
  inherited: boolean;
  /** What a child process needs to run inside this reservation. */
  env: Readonly<Record<string, string>>;
  /** What it holds: the bytes reserved, with every growth admitted and every shrink given back. */
  readonly bytes: number;
  /**
   * Waits until `bytes` more may start, exactly as a new request of `bytes`
   * at this reservation's priority would, then holds them in this
   * reservation's own entry. One growth at a time; `signal` withdraws it while
   * it waits, and so does `release`. Inside a parent's reservation it asks
   * for nothing, as `reserve` does there.
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
   * now; inside a parent's reservation, than the parent's. Its holder should
   * then start nothing new and give back what it does not use, so that the
   * request ahead of it waits only for work already running to end: nothing
   * running is ever stopped for it. Read without the lock.
   */
  outranked(): boolean;
  /** Ends the reservation, withdrawing a growth that waits; a second call does nothing. */
  release(): void;
};

function label(what: string): string {
  const text = String(what ?? "").replace(/\s+/g, " ").trim();
  if (!text) throw new TypeError("a reservation names what it is for");
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
}

function amount(bytes: number, what: string, verb: string): void {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new RangeError(`memory: ${what} ${verb} a positive whole number of bytes, not ${bytes}`);
}

const reservationEnv = (id: string, dir: string): Record<string, string> => ({ [RESERVATION_ENV]: id, ...(dir === LEDGER_DIR ? {} : { [LEDGER_ENV]: dir }) });

/** Whether a request of higher priority than `priority` waits in `dir`, among those whose waiter and owner are alive. */
function outrankedIn(dir: string, priority: Priority): boolean {
  return readEntries(dir, "waiting").some(entry => rank(entry.priority) < rank(priority) && alive(entry.waiter) && alive(entry.owner));
}

/** The parent's reservation when `parent` names a live one that counts `pid`'s memory. */
function inside(parent: string | undefined, dir: string, pid: number, what: string, bytes: number, report: (line: string) => void): Reservation | null {
  if (!parent) return null;
  if (!ID.test(parent)) throw new Error(`${RESERVATION_ENV}=${parent} is not a reservation id`);
  const file = entryPath(dir, "admitted", parent);
  let entry: LedgerEntry | null = null;
  try { entry = parseEntry(readFileSync(file, "utf8"), file); }
  catch (error) { if (!gone(error)) throw error; }
  if (entry === null || !alive(entry.owner)) {
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
  const { priority } = entry;
  return {
    id: entry.id, inherited: true, env: reservationEnv(entry.id, dir),
    get bytes() { return held; },
    grow: async more => { amount(more, what, "grows by"); held += more; },
    shrink: async less => {
      amount(less, what, "gives back");
      if (less >= held) throw new RangeError(`memory: ${what} holds ${gib(held)}, so it cannot give back ${gib(less)}; release it instead`);
      held -= less;
    },
    outranked: () => outrankedIn(dir, priority),
    release: () => {},
  };
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
  dir: string; meminfo: string; every: number;
  report: (line: string) => void; observe: (decision: Decision) => void;
  used: (entry: LedgerEntry, table: () => Table) => number;
};

const requestFor = (entry: LedgerEntry) => entry.grows === null ? `request for ${gib(entry.bytes)}` : `request to grow by ${gib(entry.bytes)}`;

/** One decision, holding the lock: drop what is dead, then admit `self` or queue it. */
function decide(context: Context, self: LedgerEntry, registered: boolean): { decision: Decision; registered: boolean } {
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
  if (!listed) self.seq = 1 + Math.max(0, ...waiting.map(entry => entry.seq));

  const { availableBytes } = readMeminfo(context.meminfo);
  let table: Table | undefined;
  const read = () => table ??= processTable();
  const pendingBytes = [...admitted.values()].reduce((sum, entry) => sum + Math.max(0, entry.bytes - context.used(entry, read)), 0);
  const roomBytes = availableBytes - pendingBytes - SYSTEM_FLOOR_BYTES;
  const queue = [...waiting, self].sort(queueOrder);
  const go = admissible(roomBytes, queue).has(self.id);
  if (go && grown !== undefined) {
    // The growth joins its reservation: one entry, and one measure, per job.
    writeEntry(dir, "admitted", { ...grown, bytes: grown.bytes + self.bytes });
    if (listed) removeQuietly(entryPath(dir, "waiting", self.id));
  } else if (go && listed) renameSync(entryPath(dir, "waiting", self.id), entryPath(dir, "admitted", self.id));
  else if (go) writeEntry(dir, "admitted", self);
  else if (!listed) writeEntry(dir, "waiting", self);
  return {
    decision: { id: self.id, what: self.what, admitted: go, grows: self.grows, availableBytes, pendingBytes, roomBytes, ahead: queue.indexOf(self) },
    registered: !go,
  };
}

/**
 * Decides on `self` now, and again every `every` while it does not fit,
 * until it is admitted or withdrawn (by `signal`, or by its owner's exit).
 * `admitted` runs with the decision that admits it, before this process runs
 * anything else. Returns that decision, and how long the request waited
 * (null when it did not).
 */
async function wait(context: Context, self: LedgerEntry, signal: AbortSignal | undefined, waits: () => string, admitted: () => void = () => {}): Promise<{ decision: Decision; waitedMs: number | null }> {
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
      let outcome: ReturnType<typeof decide>;
      try { outcome = decide(context, self, registered); }
      finally { lock.release(); }
      registered = outcome.registered;
      const { decision } = outcome;
      if (decision.admitted) {
        admitted();
        return { decision, waitedMs: waitedFrom === undefined ? null : Date.now() - waitedFrom };
      }
      context.observe(decision);
      if (waitedFrom === undefined) {
        waitedFrom = Date.now();
        context.report(`memory: ${self.what} ${waits()} (${self.priority}): ${gib(decision.availableBytes)} available, `
          + `${gib(decision.pendingBytes)} of it promised to running jobs, ${gib(SYSTEM_FLOOR_BYTES)} kept for the system`
          + (decision.ahead ? `; ${decision.ahead} ahead of it in the queue` : ""));
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
  // Writes the entry with what the handle holds now, under the lock. An entry
  // that is gone (released, or dropped once its owner exited) stays gone.
  const rewrite = async (): Promise<void> => {
    for (let retry = LOCK_RETRY_MS; ; retry = Math.min(2 * retry, Math.max(context.every, LOCK_RETRY_MS))) {
      const lock = lockLedger(dir);
      if (lock === null) { await pause(retry); continue; }
      try {
        const file = entryPath(dir, "admitted", self.id);
        let entry: LedgerEntry;
        try { entry = parseEntry(readFileSync(file, "utf8"), file); }
        catch (error) { if (gone(error)) return; throw error; }
        if (!released) writeEntry(dir, "admitted", { ...entry, bytes });
        return;
      } finally { lock.release(); }
    }
  };
  return {
    id: self.id, inherited: false, env: reservationEnv(self.id, dir),
    get bytes() { return bytes; },
    async grow(more, { signal } = {}) {
      amount(more, self.what, "grows by");
      if (released) throw new Error(`memory: ${self.what}'s reservation has been released, so it cannot grow`);
      if (growing !== null) throw new Error(`memory: ${self.what} already waits to grow; it grows by one request at a time`);
      const never = neverFits(bytes + more, readMeminfo(context.meminfo).totalBytes, `${self.what} asks to grow by ${gib(more)} to ${gib(bytes + more)}`);
      if (never !== null) throw new RangeError(never);
      const waiter = processIdentity(process.pid);
      if (waiter === null) throw new Error("this process has no identity in /proc");
      // A request of its own in the queue, owned as the reservation is: it
      // lasts no longer than the reservation's owner.
      const request: LedgerEntry = { ...self, id: randomUUID(), seq: 0, bytes: more, waiter, since: new Date().toISOString(), grows: self.id };
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
    outranked: () => !released && outrankedIn(dir, self.priority),
    async shrink(less) {
      amount(less, self.what, "gives back");
      if (released) return;
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
  const { bytes, priority = "agent" } = request;
  amount(bytes, what, "reserves");
  if (!PRIORITIES.includes(priority)) throw new RangeError(`memory: no priority ${String(priority)}; one of ${PRIORITIES.join(", ")}`);
  const nested = inside(env[RESERVATION_ENV], dir, request.owner?.pid ?? process.pid, what, bytes, report);
  if (nested !== null) return nested;

  const waiter = processIdentity(process.pid);
  if (waiter === null) throw new Error("this process has no identity in /proc");
  const pid = request.owner?.pid ?? process.pid;
  const owner = pid === process.pid ? waiter : processIdentity(pid);
  if (owner === null) throw new Error(`memory: ${what}'s owner, pid ${pid}, is not running`);
  const meminfo = meminfoPath(env);
  const never = neverFits(bytes, readMeminfo(meminfo).totalBytes, `${what} asks ${gib(bytes)}`);
  if (never !== null) throw new RangeError(never);
  const self: LedgerEntry = {
    version: 2, id: randomUUID(), seq: 0, bytes, what, priority, owner, waiter,
    measure: measureFor(owner, request.owner?.cgroup), since: new Date().toISOString(), grows: null,
  };
  const used = options.used;
  const context: Context = {
    dir, meminfo, report, every: options.everyMs ?? POLL_MS, observe: options.observe ?? (() => {}),
    used: used ? entry => used(entry) : measured,
  };
  const { decision, waitedMs } = await wait(context, self, options.signal, () => `waits for ${gib(bytes)}`);
  const reservation = holding(self, context);
  try { context.observe(decision); }
  catch (error) { reservation.release(); throw error; }
  if (waitedMs !== null) report(`memory: ${what} admitted with ${gib(bytes)} after ${Math.round(waitedMs / 1000)} s`);
  return reservation;
}
