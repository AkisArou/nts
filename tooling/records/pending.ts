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
// rewrites its row. A recorded case that got worse stays red. This module only
// names the lines every check prints.

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

/** The line a check prints for a recorded case that got better. */
export function improvedLine(name: string, before: string, after: string): string {
  return `improved, record pending: ${name} ${before} -> ${after}`;
}

/** The line a check prints for a recorded case refused as before, for other reasons: accepted, not an improvement. */
export function refusesDifferentlyLine(name: string, before: string, after: string): string {
  return `refuses differently, record pending: ${name} ${before} -> ${after}`;
}

/** The line for a change the ratchet accepts (acceptedChange), by what it is. */
export function acceptedLine(transition: OutcomeTransition, name: string, before: string, after: string): string {
  return (transition.word === "REFUSES DIFFERENTLY" ? refusesDifferentlyLine : improvedLine)(name, before, after);
}
