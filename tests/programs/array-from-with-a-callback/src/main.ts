// `Array.from(xs, f)`, which is two features wearing one name.
//
// With an **iterable** the second argument is a mapping callback, and that is
// what this example is. With **`{ length: n }`** it is not an iteration at all
// — an array-like is read by index, and `Array.from({ length: 4 })` builds four
// `undefined`s out of an object with no elements. That half still refuses, and
// refuses as itself: `a for...of over an object type`, which is what it is.
//
// # Built and then mapped, rather than fused
//
// `Array.from(xs, f)` is specified as `f` applied to each element with its
// index. `Array.from(xs).map(f)` calls `f` with the same two arguments in the
// same order over the same elements — `map`'s third argument is the array,
// which this compiler passes to neither — and `Array.from` produces no holes,
// so the one thing `map` does differently cannot arise.
//
// So this is two proven paths composed rather than a third written: the walk
// `Array.from` already does over every shape `for...of` knows, and the callback
// inlining `map` already does, which allocates nothing per element and calls
// nothing indirectly.
//
// **The cost is one intermediate array and it is stated rather than hidden.**
// Fusing the callback into the walk removes it; it needs the delivery machinery
// to write into a destination being *grown* rather than indexed, which is a
// third shape of `iteration_delivery`. Nothing regresses by composing first —
// the construct was refused outright — and the fused version now has a
// measurement to beat rather than an argument to win.
//
// # The element type has two sources, and that is the whole of the bug found here
//
// Without a callback the built array's element is the *expression's* type:
// `Array.from(xs)` produces exactly what it walks. With one it cannot be.
// `Array.from("abc", (c) => c.length)` has expression type `number[]` while the
// walk produces strings, so taking the element from the expression coerced a
// string into a double and said so — `a value of type Managed(String) where
// Float { bits: 64 } is wanted`.
//
// One of the four arms below changes the element's type, and it is the only one
// that could have caught it. The other three would have agreed with node
// forever.

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
 * produces numbers. This is the arm that fails when the intermediate array
 * takes its element from the expression's type.
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
