// `for...of`, over the three things this compiler can walk.
//
// One loop serves all of them. What differs is a cursor and three questions --
// where it starts, whether it is still going, and what it reads -- and naming
// those together is what keeps `break`, `continue` and the loop-carried names
// from being solved three times. An array still emits exactly the counted loop
// it emitted before any of this existed.
//
// The two shapes that are not counted loops:
//
//   A table's entries are not contiguous. Deleting one leaves a hole, so the
//   cursor is an entry index and the runtime is asked for the next live one
//   rather than told to add one. It re-reads the table on every step, which is
//   not an implementation detail: node visits an entry appended during the walk
//   and skips one deleted ahead of the cursor, and a snapshot would get both
//   wrong.
//
//   A string iterates by code *point*. `"a\u{1F600}b"` has `length` 4 and
//   yields three items, of one, two and one units. Stepping by one unit would
//   hand the body the halves of a surrogate pair as two lone surrogates.

export function overSet(n: number): number {
  const s = new Set<number>();
  s.add(n);
  s.add(n + 1);
  s.add(n + 2);
  s.add(n);
  let total = 0;
  for (const v of s) {
    total += v;
  }
  return total;
}

// The holes. Deleting from the middle leaves gaps in the entry array, and the
// walk has to step over them rather than through them.
export function afterDeletes(n: number): number {
  const s = new Set<number>();
  for (let i = 0; i < 8; i++) {
    s.add(i);
  }
  s.delete(1);
  s.delete(3);
  s.delete(6);
  let total = 0;
  let count = 0;
  for (const v of s) {
    total += v;
    count++;
  }
  return total * 100 + count + n * 0;
}

// `m.keys()` and `m.values()` in the head of a loop read the table directly.
// No iterator object is built: it would be allocated, stepped once per element
// and thrown away, to arrive at this same walk with an indirection in it.
export function mapKeys(n: number): number {
  const m = new Map<number, number>();
  m.set(n, 10);
  m.set(n + 3, 20);
  m.set(n + 7, 30);
  let total = 0;
  for (const k of m.keys()) {
    total += k;
  }
  return total;
}

export function mapValues(n: number): number {
  const m = new Map<number, number>();
  m.set(1, n);
  m.set(2, n * 2);
  m.set(3, n * 3);
  let total = 0;
  for (const v of m.values()) {
    total += v;
  }
  return total;
}

// String keys, so the walk reads references rather than doubles.
export function stringKeyed(n: number): number {
  const m = new Map<string, number>();
  m.set("alpha", n);
  m.set("beta", n * 2);
  let total = 0;
  let letters = 0;
  for (const k of m.keys()) {
    letters += k.length;
  }
  for (const v of m.values()) {
    total += v;
  }
  return letters * 1000 + total;
}

// `break` and `continue`, which are the reason one loop is better than three.
export function breaking(n: number): number {
  const s = new Set<number>();
  for (let i = 0; i < 10; i++) {
    s.add(i);
  }
  let total = 0;
  for (const v of s) {
    if (v === 2) {
      continue;
    }
    if (v > 5) {
      break;
    }
    total += v;
  }
  return total + n * 0;
}

// Nested, over two different tables at once.
export function nested(n: number): number {
  const outer = new Set<number>();
  const inner = new Set<number>();
  outer.add(1);
  outer.add(2);
  inner.add(10);
  inner.add(20);
  let total = 0;
  for (const a of outer) {
    for (const b of inner) {
      total += a * b;
    }
  }
  return total + n * 0;
}

// A string, by code point. The astral character is one item of two units.
export function overString(n: number): number {
  let items = 0;
  let units = 0;
  for (const c of "a\u{1F600}bc") {
    items++;
    units += c.length;
  }
  return items * 100 + units + n * 0;
}

export function emptyString(n: number): number {
  let items = 0;
  for (const c of "") {
    items += c.length;
  }
  return items + n * 0;
}

// Every character wide, so nothing is a lone unit.
export function allAstral(n: number): number {
  let items = 0;
  let units = 0;
  for (const c of "\u{1F600}\u{1F601}\u{1F602}") {
    items++;
    units += c.length;
  }
  return items * 100 + units + n * 0;
}

// An array still walks the way it always did.
export function overArray(n: number): number {
  const xs = [n, n + 1, n + 2];
  let total = 0;
  for (const x of xs) {
    total += x;
  }
  return total;
}

// An empty table has no first live entry, so the body never runs.
export function emptyTable(n: number): number {
  const s = new Set<number>();
  let ran = 0;
  for (const v of s) {
    ran += v + 1;
  }
  return ran + n * 0;
}

// Everything deleted: `used` is not zero but no entry is live.
export function allDeleted(n: number): number {
  const s = new Set<number>();
  s.add(1);
  s.add(2);
  s.delete(1);
  s.delete(2);
  let ran = 0;
  for (const v of s) {
    ran += v + 1;
  }
  return ran * 10 + s.size + n * 0;
}

// `continue` over an *array*, which is the case that was broken before any of
// this existed. The step used to be written at the end of the body, and
// `continue` jumps past the end of the body -- so the cursor never moved and
// the loop never ended. It hung rather than failed, and nothing in the suite
// wrote one, so it was never seen.
export function continueOverArray(n: number): number {
  const xs = [1, 2, 3, 4, 5];
  let total = 0;
  for (const x of xs) {
    if (x === 2) {
      continue;
    }
    total += x;
  }
  return total + n * 0;
}

// The same over text, where the step is a code-point width rather than a one.
export function continueOverText(n: number): number {
  let units = 0;
  for (const c of "a\u{1F600}bc") {
    if (c === "b") {
      continue;
    }
    units += c.length;
  }
  return units + n * 0;
}

// `break` out of a text walk, so the cursor is abandoned mid-string.
export function breakOverText(n: number): number {
  let units = 0;
  for (const c of "abcdef") {
    if (c === "d") {
      break;
    }
    units += c.length;
  }
  return units + n * 0;
}

// Mutating a table while walking it, which JavaScript defines rather than
// leaves open: an entry appended during the walk IS reached, and one deleted
// ahead of the cursor is NOT.
//
// This grows past a rehash on purpose. A walk's whole state is an entry index,
// so a rehash that renumbered entries -- which compacting the holes away does
// -- would leave the cursor on a different entry than the one it had reached.
// The first version of the table compacted, and this is the case that says so:
// node visits 0 through 12, and a compacting rehash skips.
export function growWhileWalking(n: number): number {
  const s = new Set<number>();
  s.add(0);
  let seen = 0;
  let total = 0;
  for (const v of s) {
    seen++;
    total += v;
    if (v < 12) {
      s.add(v + 1);
    }
  }
  return seen * 10000 + total * 10 + s.size + n * 0;
}

// Deleting ahead of the cursor and appending behind it, in one walk.
export function deleteAheadAndAdd(n: number): number {
  const s = new Set<number>();
  for (let i = 1; i <= 5; i++) {
    s.add(i);
  }
  let total = 0;
  let seen = 0;
  for (const v of s) {
    seen++;
    total += v;
    if (v === 1) {
      s.delete(3);
      s.add(9);
    }
  }
  return seen * 1000 + total + n * 0;
}

// The same for a Map, walked through `keys()`.
export function mapGrowWhileWalking(n: number): number {
  const m = new Map<number, number>();
  m.set(0, 0);
  let seen = 0;
  for (const k of m.keys()) {
    seen++;
    if (k < 10) {
      m.set(k + 1, k + 1);
    }
  }
  return seen * 100 + m.size + n * 0;
}

// Holes *and* a rehash, in one walk. This is the case that separates a table
// which keeps its entry positions from one which compacts them away.
//
// Three entries are deleted from the front, so the entry array has holes and
// the cursor starts past them. Then twelve are appended from inside the loop,
// which grows the table. A rehash that dropped the holes would renumber every
// surviving entry, and the cursor -- which is an entry index and nothing else
// -- would resume somewhere it had already been or somewhere it never reached.
//
// node visits 17 entries totalling 1291. A compacting rehash does not, and the
// two cases above this one do not notice, because one has no holes and the
// other never grows.
export function holesAndRehash(n: number): number {
  const s = new Set<number>();
  for (let i = 0; i < 8; i++) {
    s.add(i);
  }
  s.delete(0);
  s.delete(1);
  s.delete(2);
  let seen = 0;
  let total = 0;
  let added = false;
  for (const v of s) {
    seen++;
    total += v;
    if (!added) {
      added = true;
      for (let j = 100; j < 112; j++) {
        s.add(j);
      }
    }
  }
  return seen * 100000 + total * 10 + s.size + n * 0;
}
