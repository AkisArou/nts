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

// `for (const [k, v] of map)` — the pair the language says the element is,
// bound through a destructuring pattern.
//
// Nothing materializes the pair. The table already holds keys and values in
// separate arrays, so two names are two reads; building a `[key, value]` per
// iteration only to take it apart immediately would be an allocation for
// nothing, and it is the reason this waited for the walk rather than for
// tuples.
export function overMapPairs(n: number): number {
  const m = new Map<number, number>();
  m.set(1, n);
  m.set(2, n * 2);
  m.set(3, n * 3);
  let keys = 0;
  let values = 0;
  for (const [k, v] of m) {
    keys += k;
    values += v;
  }
  return keys * 100000 + values;
}

// `entries()` is the same walk written the other way, and is recognised in the
// head rather than lowered as a call.
export function viaEntries(n: number): number {
  const m = new Map<string, number>();
  m.set("a", n);
  m.set("bb", n + 1);
  m.set("ccc", n + 2);
  let letters = 0;
  let total = 0;
  for (const [k, v] of m.entries()) {
    letters += k.length;
    total += v;
  }
  return letters * 10000 + total;
}

// A `Set`'s `entries()` yields `[v, v]` — the same value twice, which is what
// node does and what a table storing no values has to arrange deliberately.
export function setEntries(n: number): number {
  const s = new Set<number>();
  s.add(n);
  s.add(n + 4);
  let first = 0;
  let second = 0;
  for (const [x, y] of s.entries()) {
    first += x;
    second += y;
  }
  return first * 1000 + second;
}

// Destructured, with holes punched first, so the pair walk skips them too.
export function pairsAfterDeletes(n: number): number {
  const m = new Map<number, number>();
  for (let i = 0; i < 6; i++) {
    m.set(i, i * 10);
  }
  m.delete(1);
  m.delete(4);
  let keys = 0;
  let values = 0;
  let seen = 0;
  for (const [k, v] of m) {
    keys += k;
    values += v;
    seen++;
  }
  return seen * 1000000 + keys * 1000 + values + n * 0;
}

// `break` and `continue` through a destructured walk, since the cursor is
// advanced in the latch and both names are bound in the body.
export function pairsBreaking(n: number): number {
  const m = new Map<number, number>();
  for (let i = 0; i < 8; i++) {
    m.set(i, i * 2);
  }
  let total = 0;
  for (const [k, v] of m) {
    if (k === 2) {
      continue;
    }
    if (k > 5) {
      break;
    }
    total += v;
  }
  return total + n * 0;
}


// --- a user type's own iterator ------------------------------------------
//
// The fourth walk, and the only one with no cursor. The other three know where
// they are from an index the loop advances; this one's whole state lives inside
// the iterator object, and the *call* to `next()` is what moves it.
//
// So one call answers both questions -- whether to go round again, and with
// what. The result is computed in the header and the element is read back out
// of that same result in the body, which the header dominates. Calling `next()`
// once for the test and again for the element would drop every other item.
//
// That is also why the header is the latch here. `continue` has to reach the
// `next()` call; a latch of its own would step the iterator nowhere and spin,
// which is what `continueReachesTheStep` exists to catch.
//
// `[Symbol.iterator]` is an ordinary symbol-keyed method -- see
// `examples/computed-members` for the three places that had to agree on its
// name.
//
// Every count here is `bounded(n)` rather than `n`. The argument pool is
// hostile on purpose and hands out values in the billions; a walk whose length
// *is* the argument turns a correctness example into a benchmark, and the
// nested one turns it into a quadratic benchmark. The existing walks above are
// bounded by an array they build, which is the same protection by accident.

type Step = { value: number; done: boolean };

function bounded(n: number): number {
  // `% 7` keeps it small, keeps a negative negative -- which yields nothing at
  // all, the case a loop that reads before testing gets wrong -- and keeps a
  // fraction fractional.
  return n % 7;
}

class CountdownSteps {
  at: number;
  constructor(at: number) {
    this.at = at;
  }
  next(): Step {
    this.at = this.at - 1;
    return { value: this.at < 0 ? 0 : this.at, done: this.at < 0 };
  }
}

class Countdown {
  from: number;
  constructor(from: number) {
    this.from = from;
  }
  [Symbol.iterator](): CountdownSteps {
    return new CountdownSteps(this.from);
  }
}

export function userIterable(n: number): number {
  let sum = 0;
  for (const v of new Countdown(bounded(n))) {
    sum = sum + v;
  }
  return sum;
}

// A negative `from` yields nothing, which the pool supplies directly.
export function userIterableEmpty(n: number): number {
  let seen = 0;
  for (const _v of new Countdown(bounded(n) - 8)) {
    seen = seen + 1;
  }
  return seen;
}

export function breaksEarly(n: number): number {
  let sum = 0;
  for (const v of new Countdown(bounded(n))) {
    if (v < 2) {
      break;
    }
    sum = sum + v;
  }
  return sum;
}

// `continue` jumps to the latch, and here the latch *is* the header -- so it
// must reach `next()`. A loop that stepped the iterator anywhere else would
// hang rather than answer wrongly, which is why this counts what it saw.
export function continueReachesTheStep(n: number): number {
  let sum = 0;
  let seen = 0;
  for (const v of new Countdown(bounded(n))) {
    seen = seen + 1;
    if (v % 2 === 0) {
      continue;
    }
    sum = sum + v;
  }
  return sum * 100 + seen;
}

// Two at once, so the inner iterator is built per outer iteration and neither
// loop's state is the other's.
export function nestedUserIterables(n: number): number {
  let total = 0;
  for (const outer of new Countdown(bounded(n))) {
    for (const inner of new Countdown(outer)) {
      total = total + inner;
    }
  }
  return total;
}

// The iterator is made once, before the loop, and stepped by it. Walking the
// same *source* twice builds two iterators, so the second starts again rather
// than continuing where the first stopped.
export function iteratorIsBuiltOnce(n: number): number {
  const source = new Countdown(bounded(n));
  let first = 0;
  for (const v of source) {
    first = first + v;
  }
  let second = 0;
  for (const v of source) {
    second = second + v;
  }
  return first * 1000 + second;
}
