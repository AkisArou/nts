// One meaning of "pending" for every check that holds a corpus to a record
// (docs/workflow.md, Records: the full check writes them).
//
//   pending   a case whose source exists and whose record has no row yet. It is
//             not measured at landing and does not fail: the full check writes
//             its row afterwards, with tooling/records/record-pending.ts.
//   stale     a row whose case no longer exists. Still an error: the change that
//             deletes a case deletes its row.
//
// A recorded case that got better, by the check's own ordering of outcomes,
// passes too and is listed; record-pending.ts rewrites its row. A recorded case
// that got worse stays red. Each check keeps its own vocabulary for "better";
// this module only names the two lines every check prints.

/** Cases of a corpus against its record, by key: what has no row, and what has no case. */
export interface Inventory { pending: string[]; stale: string[] }

export function inventory(recorded: Iterable<string>, sources: Iterable<string>): Inventory {
  const rows = new Set(recorded), cases = new Set(sources);
  return {
    pending: [...cases].filter(key => !rows.has(key)).sort(),
    stale: [...rows].filter(key => !cases.has(key)).sort(),
  };
}

/** The line a check prints for a case its record has no row for yet. */
export function pendingLine(name: string, record: string): string {
  return `pending: ${name} has no row in ${record}`;
}

/** The line a check prints for a recorded case that got better. */
export function improvedLine(name: string, before: string, after: string): string {
  return `improved, record pending: ${name} ${before} -> ${after}`;
}
