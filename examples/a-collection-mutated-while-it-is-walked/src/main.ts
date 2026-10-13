// A walk over a Map or a Set re-reads the collection at every step: an entry
// appended during the walk is visited, one deleted ahead of the cursor is not,
// and a key deleted and set again moves to the end and is visited again.
// The same holds through keys(), values() and entries(). Each function folds
// the visit order into one number, a digit per visit.
function letters(): Map<string, number> {
  return new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
}

export function anAppendIsVisited(n: number): number {
  const m = letters();
  let seen = 0;
  for (const [key, value] of m) {
    seen = seen * 10 + value;
    if (key === "a") m.set("d", 4 + (n & 1));
  }
  return seen;
}

export function aDeleteAheadIsSkipped(n: number): number {
  const m = letters();
  let seen = 0;
  for (const [key, value] of m) {
    seen = seen * 10 + value;
    if (key === "a" && n > 0) m.delete("b");
  }
  return seen;
}

export function aDeleteBehindIsNotRevisited(n: number): number {
  const m = letters();
  let seen = 0;
  for (const [key, value] of m) {
    seen = seen * 10 + value;
    if (key === "b" && n > 0) m.delete("a");
  }
  return seen * 10 + m.size;
}

export function aReAddedKeyMovesToTheEnd(n: number): number {
  const m = letters();
  let seen = 0;
  for (const [key, value] of m) {
    seen = seen * 10 + value;
    if (key === "a" && value === 1) {
      m.delete("a");
      m.set("a", 5 + (n & 3));
    }
  }
  return seen;
}

export function aSetAppendAndDelete(n: number): number {
  const s = new Set<number>([1, 2, 3]);
  let seen = 0;
  for (const item of s) {
    seen = seen * 10 + item;
    if (item === 1) {
      s.delete(2);
      s.add(4 + (n & 1));
    }
  }
  return seen;
}

export function throughKeys(n: number): number {
  const m = letters();
  let seen = 0;
  for (const key of m.keys()) {
    seen = seen * 10 + (m.get(key) ?? 0);
    if (key === "b") m.set("e", 6 + (n & 1));
  }
  return seen;
}

export function throughValues(n: number): number {
  const m = letters();
  let seen = 0;
  for (const value of m.values()) {
    seen = seen * 10 + value;
    if (value === 1 && n > 0) m.delete("c");
  }
  return seen;
}

export function throughEntries(n: number): number {
  const m = letters();
  let seen = 0;
  for (const [key, value] of m.entries()) {
    seen = seen * 10 + value;
    if (key === "c") {
      m.delete("a");
      m.set("a", 7 + (n & 1));
    }
  }
  return seen;
}
