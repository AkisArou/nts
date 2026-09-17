// An elision — `const [, second] = pair` — and the `for...of` form of it.
//
// The frontend gives a hole as a **binding element with no children**: no name,
// no property, nothing to write to. Both sites that walk a pattern refused it,
// under two different messages — `a binding of unexpected shape` from the
// declaration path and `a destructuring element that is more than a name` from
// the `for...of` head — for the one cause.
//
// A hole binds nothing and still **occupies a position**, and those two facts
// have to travel together: the count is what says `v` is the second element.
// The declaration path already enumerated, so skipping is enough there; the
// `for...of` head carried a `Vec<NodeId>` that could not express "no name here",
// and carries `Vec<Option<NodeId>>` now.
//
// `for (const [, v] of map)` is how a `Map`'s values are iterated, which is why
// this is worth more than the shape suggests.

/** A tuple with the first element skipped. */
export function tupleHole(n: number): number {
  const pair: [number, number] = [n, 2];
  const [, second] = pair;
  return second;
}

/** Two holes, so the position has to advance by two rather than by one — a
 *  skip that forgot to count would bind `c` to the second element. */
export function twoHoles(n: number): number {
  const xs = [n, 20, 300, 4000];
  const [, , third, fourth] = xs;
  return third + fourth;
}

/** The elements after a hole, spread apart so a miscount shows in the value
 *  rather than by coincidence. */
export function positions(n: number): number {
  const xs = [n, 20, 30];
  const [, b, c] = xs;
  return b * 100 + c;
}

/** A trailing hole, which TypeScript drops. */
export function trailing(n: number): number {
  const xs = [n, 2, 3];
  const [a, ,] = xs;
  return a;
}

/** The idiom: a `Map`'s values, with the key elided. */
export function mapValues(n: number): number {
  const m = new Map<string, number>();
  m.set("a", 1);
  m.set("b", 2);
  let total = 0;
  for (const [, v] of m) {
    total += v;
  }
  return total + (n & 1);
}

/** A hole inside a hole, so the recursion carries it too. */
export function nested(n: number): number {
  const xs: [number, [number, number]] = [n, [7, 9]];
  const [, [, second]] = xs;
  return second;
}

/** No holes at all, which has to keep working. */
export function noHoles(n: number): number {
  const xs = [n, 2, 3];
  const [a, b, c] = xs;
  return a + b + c;
}
