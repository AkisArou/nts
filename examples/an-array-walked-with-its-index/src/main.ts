// `for (const [i, v] of xs.entries())`, and the two spellings beside it.
//
// A counted loop already keeps the index it walks by, so `entries()`, `keys()`
// and `values()` over an array are that one loop reading its own cursor —
// nothing is allocated, no iterator is stepped and no `[index, element]` pair
// is built to be taken apart. It is the argument the `Map` walk already made,
// one container over.
//
// The arm that makes the rest mean something is `pairsAreStillDestructured`:
// `for (const [a, b] of pairs)` over an array of **tuples** binds two names to
// one element, and `for (const [i, v] of xs.entries())` binds two names to two
// values, and the source is identical in both. What separates them is whether
// the `entries()` call was written — so a change that read the pattern alone
// would answer one of the two wrongly, and this file fails if it does.
//
// `for (const pair of xs.entries())` is refused rather than answered: with one
// name the element *is* the pair, which this compiler does not build here, and
// the fold has already replaced the call by the time the arity is known — so
// that refusal is the only thing between such a program and a loop that
// quietly walks elements. `tooling/conformance/blockers/an-entries-walk-
// binding-one-name` asserts it *by message*, because a silent pass is the
// failure mode and "something refused" would not tell them apart.

/** The shape that refused: two names, an array, and `entries()`. */
export function sumOfIndexTimesValue(n: number): number {
  const xs = [1, 2, n, 4];
  let total = 0;
  for (const [i, v] of xs.entries()) {
    total += i * v;
  }
  return total;
}

/** The elements are references rather than numbers, so the read is a pointer
 *  load where the index is still a double. */
export function labelled(n: number): string {
  const xs = ["a", "b", "c"];
  let out = "";
  for (const [i, v] of xs.entries()) {
    out += String(i) + v;
  }
  return out + String(n);
}

/** `keys()` yields the positions, so the walk's element *is* the index. */
export function sumOfKeys(n: number): number {
  const xs = [10, 20, n];
  let total = 0;
  for (const i of xs.keys()) {
    total += i;
  }
  return total;
}

/** `values()` is the plain walk written the other way, which is what
 *  JavaScript says too. */
export function sumOfValues(n: number): number {
  const xs = [10, 20, n];
  let total = 0;
  for (const v of xs.values()) {
    total += v;
  }
  return total;
}

/** `break` and `continue` still reach the right loop when the head binds two
 *  names, which is the part a second cursor would break. */
export function firstIndexOver(n: number): number {
  const xs = [1, 5, 9, 13];
  for (const [i, v] of xs.entries()) {
    if (v <= n) {
      continue;
    }
    return i;
  }
  return -1;
}

/** Nested, so there are two cursors alive at once. */
export function nestedPairs(n: number): number {
  const xs = [1, 2, n];
  let total = 0;
  for (const [i, a] of xs.entries()) {
    for (const [j, b] of xs.entries()) {
      total += (i - j) * (a + b);
    }
  }
  return total;
}

/** The control that separates the two readings of `[a, b]`: over an array of
 *  **tuples** the brackets destructure one element, and the source looks the
 *  same as the arms above. */
export function pairsAreStillDestructured(n: number): number {
  const pairs: [number, number][] = [[1, 2], [3, n]];
  let total = 0;
  for (const [a, b] of pairs) {
    total += a * b;
  }
  return total;
}

/** The control one container over: the same idiom on a `Map`, which worked
 *  before this and must still. */
export function overAMap(n: number): number {
  const m = new Map<string, number>();
  m.set("a", 1);
  m.set("bb", n);
  let total = 0;
  for (const [k, v] of m.entries()) {
    total += k.length * v;
  }
  return total;
}

/** The plain walk, unchanged by any of this. */
export function plainWalk(n: number): number {
  const xs = [1, 2, n];
  let total = 0;
  for (const v of xs) {
    total += v;
  }
  return total;
}

/** The fold has three call sites, not one: `for...of`, `yield*` and
 *  `Array.from`. This is the second, and it is here because a fold verified
 *  only through the site that motivated it says nothing about the other two. */
function* positions(xs: number[]): Generator<number> {
  yield* xs.keys();
}

export function sumOfYieldedKeys(n: number): number {
  let total = 0;
  for (const i of positions([10, 20, n])) {
    total += i;
  }
  return total;
}

/** The third call site. */
export function countOfKeys(n: number): number {
  const xs = [1, 2, n];
  return Array.from(xs.keys()).length + Array.from(xs.values()).length;
}
