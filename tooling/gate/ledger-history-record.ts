// The memory ledger's history: one JSON line for each moment a request's wait
// is observed, written by the waiting process after its decision, outside the
// ledger's lock (memory-ledger.ts's `wait`), and read only by the history replay
// (ledger-history.ts). Admission never reads it.
//
// A request that waits writes a `wait` record at its first decision, a
// `census` record each time its holders census repeats (every five minutes
// while it waits), and an `admitted` record at the decision that admits it.
// A request admitted at its first decision waited for nothing and writes
// none. Each record holds what the request asked and the room it saw, the
// requests queued ahead of it, and every live admitted reservation with what
// it reserved and what it used then: what a replay needs to say who held the
// memory a waiter could not have, by how much beyond their use, and for how
// long.
//
// **The files** are `history/<UTC day>.jsonl` under the ledger's directory,
// appended whole, one line per record. Records are versioned per line
// (`version`), so a reader names one it does not know rather than misreading
// it. Nothing prunes them.
//
// **A failed write never touches admission.** The append is the last thing
// the waiter does with a decision already made; a failure (a full disk, a
// directory it may not write) is reported once per directory and process,
// and every later decision goes on unrecorded the same way.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Priority } from "./ranks.ts";

export const LEDGER_HISTORY_VERSION = 1;
export const LEDGER_HISTORY_DIR = "history";

export type LedgerHistoryKind = "wait" | "census" | "admitted";

/** A live admitted reservation as the decision counted it. */
export type HistoryHolder = {
  id: string; what: string; priority: Priority; since: string;
  /** What it reserved, and what its measure held at the decision. */
  bytes: number; used_bytes: number;
  /** What it has lent the reservations that draw on it, and what it drew on the one it draws on. */
  lent_bytes: number; drawn_bytes: number; draws_on: string | null;
  /** Unmeasured: it promises its live use and a margin, not `bytes`. */
  live_use: boolean;
};

/** A request queued ahead of the recorded one, in the queue's order. */
export type HistoryAhead = { id: string; what: string; priority: Priority; bytes: number; grows: string | null; fits: boolean };

export type LedgerHistoryRecord = {
  version: typeof LEDGER_HISTORY_VERSION; kind: LedgerHistoryKind; at: string;
  request: { id: string; what: string; priority: Priority; since: string; bytes: number; grows: string | null; drawn_bytes: number; fits: boolean };
  /** Seconds since the request started waiting; zero at its `wait` record. */
  waited_s: number;
  machine: { available_bytes: number; pending_bytes: number; room_bytes: number; floor_bytes: number };
  ahead: HistoryAhead[];
  admitted: HistoryHolder[];
};

const failed = new Set<string>();

/** The day file a record belongs to. */
export const historyDay = (at: string) => `${at.slice(0, 10)}.jsonl`;

/** Appends the record `make` builds to `ledgerDir`'s history; never throws. */
export function appendLedgerHistory(ledgerDir: string, make: () => LedgerHistoryRecord, report: (line: string) => void): void {
  const dir = join(ledgerDir, LEDGER_HISTORY_DIR);
  try {
    const record = make();
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, historyDay(record.at)), `${JSON.stringify(record)}\n`);
  } catch (error) {
    if (failed.has(ledgerDir)) return;
    failed.add(ledgerDir);
    report(`memory: cannot write the ledger's history in ${dir}, so this process's waits go unrecorded; admission is unchanged: ${error instanceof Error ? error.message : String(error)}`);
  }
}
