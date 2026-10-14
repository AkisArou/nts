// `for (const [a, b] of pairs)` where `pairs` is an array of tuples.
//
// **`[a, b]` has two readings and the sequence decides which.** Over a `Map` the
// names are a key and a value: the walk produces two values per step and there
// is no pair object to take apart. Over an array of *tuples* the walk produces
// one value per step and the brackets are an ordinary destructuring of it,
// exactly as `const [a, b] = pair` is.
//
// The head was read before the sequence, so only the first reading existed, and
// the second was refused as `a `for...of` binding 2 names over this sequence` --
// a true sentence that describes the other one. The pattern is identical in both
// and the difference is entirely in what is being walked, so the question is
// asked of the lowered sequence now, which is also after `m.entries()` has been
// folded back to `m`.

interface Point {
  x: number;
  y: number;
}

const pairs: [number, number][] = [
  [1, 2],
  [3, 4],
  [5, 6],
];

const points: Point[] = [
  { x: 1, y: 2 },
  { x: 3, y: 4 },
];

const labelled: [string, number][] = [
  ["a", 1],
  ["b", 2],
];

export function tuples(n: number): number {
  let s = 0;
  for (const [a, b] of pairs) {
    s += a * b;
  }
  return s + n;
}

/** A hole, which binds one name and consumes two positions. */
export function withAHole(n: number): number {
  let s = 0;
  for (const [, b] of pairs) {
    s += b;
  }
  return s + n;
}

/** Tuples of mixed type, so the two names cannot share a representation. */
export function mixedTuples(n: number): string {
  let out = "";
  for (const [name, count] of labelled) {
    out += name + count.toString();
  }
  return out + n.toString();
}

/** An object pattern over the same kind of sequence, which already worked and
 *  has to keep working: it is the reading this one is now spelled as. */
export function objectPattern(n: number): number {
  let s = 0;
  for (const { x, y } of points) {
    s += x * y;
  }
  return s + n;
}

/** A `Map`, which is the *other* reading and must not become a destructuring:
 *  there is no pair object here for a pattern to take apart. */
export function overAMap(n: number): number {
  const m = new Map<string, number>();
  m.set("a", 1);
  m.set("b", 2);
  let s = 0;
  for (const [, v] of m) {
    s += v;
  }
  return s + n;
}

/** The same `Map` written through `entries()`, which is folded back to the map
 *  before the question is asked -- so the fold and the reading have to agree. */
export function throughEntries(n: number): number {
  const m = new Map<string, number>();
  m.set("a", 3);
  m.set("b", 4);
  let s = 0;
  for (const [, v] of m.entries()) {
    s += v;
  }
  return s + n;
}
