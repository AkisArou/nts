// One meaning of "pending" for every check that holds a corpus to a record
// (docs/workflow.md, Records: the full check writes them).
//
//   pending   a case whose source exists and whose record has no row yet. It is
//             not measured at landing and does not fail: the full check writes
//             its row afterwards, with tooling/records/record-pending.ts.
//   stale     a row whose case no longer exists. Still an error: the change that
//             deletes a case deletes its row.
//
// A recorded case whose change the shared ratchet accepts (an improvement, or a
// refusal for other reasons) passes too and is listed; record-pending.ts
// rewrites its row. A recorded case that got worse stays red. This module
// names pending, accepted and native refresh requests separately, each with
// the record its row is in, and
// reads them back from a run's logs: the full check decides from them whether
// to record, and record-pending.ts which kinds to record.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { OutcomeTransition } from "../conformance/outcome-transition.ts";

/** Cases of a corpus against its record, by key: what has no row, and what has no case. */
export interface Inventory { pending: string[]; stale: string[] }

export function inventory(recorded: Iterable<string>, sources: Iterable<string>): Inventory {
  const rows = new Set(recorded), cases = new Set(sources);
  return {
    pending: [...cases].filter(key => !rows.has(key)).sort(),
    stale: [...rows].filter(key => !cases.has(key)).sort(),
  };
}

/** The line a check prints for a case its record has no row for yet: a line of a
 * shared record, or a record file of its own. */
export function pendingLine(name: string, record: string): string {
  return `pending: ${name} is not recorded in ${record} yet`;
}

/** A current observation requests native rederivation without claiming that
 * its row is missing or that a result got better. */
export function refreshLine(family:string,name:string,record:string):string{
  return `refresh requested: ${family}: ${name} in ${record}`;
}

/** The line a check prints for a recorded case that got better, in the record that holds its row. */
export function improvedLine(name: string, record: string, before: string, after: string): string {
  return `improved, record pending: ${name} in ${record}: ${before} -> ${after}`;
}

/** The line a check prints for a recorded case refused as before, for other reasons: accepted, not an improvement. */
export function refusesDifferentlyLine(name: string, record: string, before: string, after: string): string {
  return `refuses differently, record pending: ${name} in ${record}: ${before} -> ${after}`;
}

/** The line for a change the ratchet accepts (acceptedChange), by what it is. */
export function acceptedLine(transition: OutcomeTransition, name: string, record: string, before: string, after: string): string {
  return (transition.word === "REFUSES DIFFERENTLY" ? refusesDifferentlyLine : improvedLine)(name, record, before, after);
}

// The lines above read back, wherever a log puts them.
const PENDING = /\bpending: (\S.*?) is not recorded in (\S+) yet\b/;
const REFRESH = /\brefresh requested: ([a-z][a-z0-9-]*): (\S.*?) in (\S+)(?:$|\s)/;
const ACCEPTED = /\b(improved|refuses differently), record pending: (\S.*?) in (\S+): (.*)$/;

/** Whether `line` is a native refresh request (refreshLine): the full check answers it after landing, and it names no pending row. */
export const isRefreshLine = (line: string): boolean => REFRESH.test(line);
/** Whether `line` is one a check prints for the records, by its words alone: what a landing reports, not what is recorded. */
export const isListedLine = (line: string): boolean => PENDING.test(line) || isRefreshLine(line) || /\b(?:improved|refuses differently), record pending: \S/.test(line);

/** A case a check listed for the records, and the record that holds (or will hold) its row. */
export interface ListedCase { name: string; record: string }
/** A native refresh names its owning family as well as its case and record. */
export interface ListedRefresh extends ListedCase { family:string }
/** Missing rows, native refresh requests and accepted outcome changes stay distinct. */
export interface Listed { pending: ListedCase[]; refresh:ListedRefresh[]; accepted: (ListedCase & { change: string })[] }

/** The lines every step log (`<step>.log`) of a run prints for the records, each case once. */
export function listedIn(run: string): Listed {
  const pending = new Map<string, ListedCase>(), refresh = new Map<string,ListedRefresh>(), accepted = new Map<string, ListedCase & { change: string }>();
  if (!existsSync(run)) return { pending: [], refresh: [], accepted: [] };
  for (const name of readdirSync(run).filter(name => name.endsWith(".log")).sort()) {
    for (const line of readFileSync(join(run, name), "utf8").split("\n")) {
      const p = PENDING.exec(line);
      if (p) pending.set(`${p[1]}\0${p[2]}`, { name: p[1]!, record: p[2]! });
      const r = REFRESH.exec(line);
      if(r)refresh.set(`${r[1]}\0${r[2]}\0${r[3]}`,{family:r[1]!,name:r[2]!,record:r[3]!});
      const a = ACCEPTED.exec(line);
      if (a) accepted.set(`${a[2]}\0${a[3]}`, { name: a[2]!, record: a[3]!, change: `${a[1]} ${a[4]!.trim()}` });
    }
  }
  const order = (x: ListedCase, y: ListedCase) => x.record.localeCompare(y.record) || x.name.localeCompare(y.name);
  return { pending: [...pending.values()].sort(order), refresh:[...refresh.values()].sort((a,b)=>order(a,b)||a.family.localeCompare(b.family)), accepted: [...accepted.values()].sort(order) };
}
