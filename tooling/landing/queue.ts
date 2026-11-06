// The landing queue: one durable file per change waiting to land, checked one
// at a time against the newest main, each answered by a result file.
//
//   <home>/queue/<key>.json     waiting, in key order; a revert from the full
//                               check sorts first (`first`)
//   <home>/checking.json        the change being checked now
//   <home>/held/<id>.json       a change whose check could not finish for a
//                               reason only a person can clear
//   <home>/results/<id>.json    every answer: landed, refused, withdrawn, held
//   <home>/withdraw/<id>        a withdrawal asked while the change is checked
//   <home>/status.json          what the service is doing
//
// Every write is durable (durable-record.ts): a crash leaves either the old
// file or the new one, never half of one, and the service resumes from them.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { durableRecord } from "../lanes/durable-record.ts";

export type Entry = {
  version: 1; id: string; sha: string;
  /** The task's branch, deleted when the change lands; null when it has none. */
  branch: string | null;
  /** The tree it was submitted from, when it was a tree. */
  tree: string | null;
  first: boolean; submitted_at: string; by: string; note?: string;
};
export type Checking = Entry & { started_at: string; base?: string; tip?: string; run?: string; phase?: "checking" | "landing" };
export type State = "landed" | "refused" | "withdrawn" | "held";
export type Result = {
  version: 1; id: string; sha: string; state: State; message: string; at: string;
  /** main before and after; `commits` are base..tip, the change as it landed. */
  base?: string; tip?: string; commits?: string[]; run?: string;
  landing?: string[]; deferred?: string[]; estimate_s?: number; wall_s?: number;
  pending?: string[]; pushed?: boolean; branch?: unknown; pool?: string | null;
};
export type Status = { version: 1; state: "idle" | "checking" | "landing" | "held"; at: string; id?: string; sha?: string; message?: string; run?: string; since?: string };

const now = () => new Date().toISOString();
const readJson = <T>(path: string): T | null => { try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return null; } };
const files = (dir: string) => { try { return readdirSync(dir).filter(name => name.endsWith(".json")).sort(); } catch { return []; } };

export class Queue {
  readonly home: string;
  constructor(home: string) {
    this.home = home;
    for (const dir of ["queue", "held", "results", "withdraw"]) mkdirSync(join(home, dir), { recursive: true });
  }
  private path(...parts: string[]) { return join(this.home, ...parts); }

  /** Queue `sha` to land. `first` puts it ahead of every change waiting (the full check's reverts). */
  submit(sha: string, options: { branch?: string | null; tree?: string | null; first?: boolean; by?: string; note?: string } = {}): Entry {
    if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new Error(`submit wants a full commit id, not ${sha}`);
    const first = options.first === true;
    const entry: Entry = { version: 1, id: `${sha.slice(0, 12)}-${randomUUID().slice(0, 8)}`, sha, branch: options.branch ?? null,
      tree: options.tree ?? null, first, submitted_at: now(), by: options.by ?? "agent", ...(options.note ? { note: options.note } : {}) };
    durableRecord(this.path("queue", `${this.key(entry)}.json`), entry);
    return entry;
  }
  // `0-` sorts ahead of `1-`; among equals, by time and then id.
  private key(entry: Entry): string {
    return `${entry.first ? 0 : 1}-${String(Date.parse(entry.submitted_at)).padStart(15, "0")}-${entry.id}`;
  }

  /** The changes waiting, in the order they will be checked. */
  waiting(): Entry[] {
    return files(this.path("queue")).map(name => readJson<Entry>(this.path("queue", name))).filter((e): e is Entry => e !== null);
  }
  /** Move the next waiting change to `checking.json`; null when none waits. */
  take(): Checking | null {
    for (const name of files(this.path("queue"))) {
      const entry = readJson<Entry>(this.path("queue", name));
      if (!entry) { rmSync(this.path("queue", name), { force: true }); continue; }
      const checking: Checking = { ...entry, started_at: now(), phase: "checking" };
      durableRecord(this.path("checking.json"), checking);
      rmSync(this.path("queue", name), { force: true });
      return checking;
    }
    return null;
  }
  checking(): Checking | null { return readJson<Checking>(this.path("checking.json")); }
  update(fields: Partial<Checking>): Checking {
    const current = this.checking();
    if (!current) throw new Error("no change is being checked");
    const next = { ...current, ...fields };
    durableRecord(this.path("checking.json"), next);
    return next;
  }
  /** Put the change being checked back at the front: its check starts again. */
  requeue(): Entry | null {
    const current = this.checking();
    if (!current) return null;
    const { started_at: _s, base: _b, tip: _t, run: _r, phase: _p, ...entry } = current;
    const again: Entry = { ...entry, first: true };
    durableRecord(this.path("queue", `${this.key(again)}.json`), again);
    rmSync(this.path("checking.json"), { force: true });
    return again;
  }

  /** Answer `entry`: its result is durable before it leaves `checking.json`. */
  answer(entry: Entry, result: Omit<Result, "version" | "id" | "sha" | "at">): Result {
    const full: Result = { version: 1, id: entry.id, sha: entry.sha, at: now(), ...result };
    durableRecord(this.path("results", `${entry.id}.json`), full);
    if (result.state === "held") durableRecord(this.path("held", `${entry.id}.json`), entry);
    if (this.checking()?.id === entry.id) rmSync(this.path("checking.json"), { force: true });
    rmSync(this.path("withdraw", entry.id), { force: true });
    return full;
  }
  result(id: string): Result | null { return readJson<Result>(this.path("results", `${id}.json`)); }
  results(): Result[] {
    return files(this.path("results")).map(name => readJson<Result>(this.path("results", name))).filter((r): r is Result => r !== null)
      .sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
  }
  held(): Entry[] {
    return files(this.path("held")).map(name => readJson<Entry>(this.path("held", name))).filter((e): e is Entry => e !== null);
  }
  /** Queue a held change again, at the front. */
  retry(id: string): Entry {
    const entry = readJson<Entry>(this.path("held", `${id}.json`));
    if (!entry) throw new Error(`no held change ${id}`);
    const again: Entry = { ...entry, first: true, submitted_at: now() };
    durableRecord(this.path("queue", `${this.key(again)}.json`), again);
    rmSync(this.path("held", `${id}.json`), { force: true });
    return again;
  }

  /** The entry an id or a commit (or its prefix) names, waiting, checked or held. */
  find(asked: string): { entry: Entry; where: "waiting" | "checking" | "held" } | null {
    const match = (e: Entry) => e.id === asked || (asked.length >= 7 && e.sha.startsWith(asked));
    const checking = this.checking();
    if (checking && match(checking)) return { entry: checking, where: "checking" };
    for (const e of this.waiting()) if (match(e)) return { entry: e, where: "waiting" };
    for (const e of this.held()) if (match(e)) return { entry: e, where: "held" };
    return null;
  }
  /**
   * Withdraw a change: one waiting or held is answered at once; the one being
   * checked is answered when its check ends, and never lands.
   */
  withdraw(asked: string): "withdrawn" | "requested" | "unknown" {
    const found = this.find(asked);
    if (!found) return "unknown";
    if (found.where === "checking") { writeFileSync(this.path("withdraw", found.entry.id), `${now()}\n`); return "requested"; }
    for (const dir of ["queue", "held"]) for (const name of files(this.path(dir))) {
      if (readJson<Entry>(this.path(dir, name))?.id === found.entry.id) rmSync(this.path(dir, name), { force: true });
    }
    this.answer(found.entry, { state: "withdrawn", message: "withdrawn before it was checked" });
    return "withdrawn";
  }
  withdrawRequested(id: string): boolean { return existsSync(this.path("withdraw", id)); }

  status(): Status { return readJson<Status>(this.path("status.json")) ?? { version: 1, state: "idle", at: now() }; }
  setStatus(fields: Omit<Status, "version" | "at">): void {
    const previous = this.status();
    const since = previous.state === fields.state && previous.id === fields.id ? previous.since ?? previous.at : now();
    durableRecord(this.path("status.json"), { version: 1, at: now(), since, ...fields });
  }
}
