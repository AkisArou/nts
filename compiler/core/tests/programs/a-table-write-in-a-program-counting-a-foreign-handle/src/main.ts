// A table write in a program that counts a foreign handle (#902).
//
// Giving up a GObject can run its handlers, which can write any slot, and a
// table's static types cannot rule one out: `counts` is a `Map<string,
// number>` here, and the same table could be written through a `Map<string,
// unknown>` alias. So where the program counts a foreign handle anywhere, a
// table write still ends a borrow held across it, and the update's key keeps
// the retain and release it had before table writes were known to write only
// their table (`runtime::WRITES_ONLY_ITS_TABLE`).
//
// Compiled by `compiler/core/tests/table_write_borrows.rs`, never run: the
// foreign module has no C beside it.
import { makeTarget, type Target } from "nts:gtarget";

const vocabulary: string[] = [];
for (let i = 0; i < 8; i++) vocabulary.push("word" + i);

export function updates(n: number): number {
  const counts = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const w = vocabulary[i & 7];
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return counts.size;
}

export function holds(): Target {
  return makeTarget();
}
