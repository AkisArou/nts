// A string keeps its hash once a table has asked for it (`NTS_HASHED`, string
// design §4), and being hashed settles it: a grown string gives up its room,
// so no append writes into it afterwards. This asks for a grown string, then
// appends to it: after `k += "c"` the table must find "abc", not look where
// "ab" would be and miss. An append that wrote into a hashed string in place
// breaks it -- as it did, measured, when the clear on append was removed.
//
// Control, one difference -- the same string asked for only after it grew, so
// nothing could have been kept before the write:
//
//     lookedUpAfterItGrew
//
// The starting text comes from the argument, so neither append folds into a
// literal: the first makes a grown string with room, the second writes into it.

function keys(): Map<string, number> {
  const table = new Map<string, number>();
  table.set("ab", 1);
  table.set("abc", 2);
  table.set("-b", 3);
  table.set("-bc", 4);
  return table;
}

export function lookedUpBeforeItGrew(n: number): number {
  const table = keys();
  let k = n < 0 ? "-" : "a";
  k += "b";
  const before = table.get(k) ?? 0;
  k += "c";
  return before * 10 + (table.get(k) ?? 0);
}

export function lookedUpAfterItGrew(n: number): number {
  const table = keys();
  let k = n < 0 ? "-" : "a";
  k += "b";
  k += "c";
  return table.get(k) ?? 0;
}
