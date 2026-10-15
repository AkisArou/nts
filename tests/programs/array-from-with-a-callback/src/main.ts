// `Array.from(xs, f)`, which is two features wearing one name.
//
// With an **iterable** the second argument is a mapping callback, and that is
// what this example is. With **`{ length: n }`** it is not an iteration at all
// — an array-like is read by index, and `Array.from({ length: 4 })` builds four
// `undefined`s out of an object with no elements. That half still refuses, and
// refuses as itself: `a for...of over an object type`, which is what it is.
//
// The mapper runs between source steps, so additions, deletions and changed
// elements are observed by the next step. Collecting first and mapping later
// would lose those effects. The walk shares callback-body delivery with array
// methods and appends each result to a private, growing output array.
//
// The source and result have independent element types.
// `Array.from("abc", (c) => c.length)` has expression type `number[]` while the
// walk produces strings. Bind the callback from the walk's element and coerce
// its return to the result's element, rather than collecting an intermediate
// array at the result's width.

/** Control: no callback, which already worked. */
export function noCallback(n: number): number {
  const xs = Array.from([1, 2, n & 3]);
  return xs.length * 10 + xs[2];
}

/** Under test: a mapping callback over an array. */
export function mapped(n: number): number {
  const xs = Array.from([1, 2, n & 3], (v) => v * 2);
  return xs.length * 10 + xs[2];
}

/** Under test: the callback's second parameter is the index. */
export function withIndex(n: number): number {
  const xs = Array.from([5, 6, n & 3], (v, i) => v * 10 + i);
  return xs[0] + xs[1] + xs[2];
}

/**
 * Under test: a source whose element type is **not** the result's.
 *
 * A string walks by code point, so the walk produces strings and the callback
 * produces numbers. This arm fails if the source element takes its width
 * from the expression's result type.
 */
export function changesTheElementType(n: number): number {
  const xs = Array.from("abcd", (c) => c.length + (n & 1));
  return xs.length * 10 + xs[0];
}

/** Under test: over a generator, which has no length before it runs. */
function* upTo(limit: number): Generator<number> {
  for (let i = 0; i < limit; i++) yield i;
}

export function overAGenerator(n: number): number {
  const xs = Array.from(upTo(n & 3), (v) => v + 1);
  let total = 0;
  for (const v of xs) total += v;
  return total * 10 + xs.length;
}

/** Under test: over a `Set`, whose cursor is an entry index and not a position. */
export function overASet(n: number): number {
  const s = new Set<number>();
  s.add(1);
  s.add(n & 3);
  s.add(9);
  const xs = Array.from(s, (v) => v * 3);
  let total = 0;
  for (const v of xs) total += v;
  return total * 10 + xs.length;
}

/** Under test: a block-bodied callback with an early `return`. */
export function blockBodiedCallback(n: number): number {
  const xs = Array.from([1, 2, n & 3], (v) => {
    if (v > 2) return 100;
    return v;
  });
  return xs[0] + xs[1] + xs[2];
}
