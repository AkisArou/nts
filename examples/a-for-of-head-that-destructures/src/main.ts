// A `for...of` head whose brackets are a destructuring, not two positions.
//
// `[a, b]` has two readings and the sequence decides which. Over a `Map` the
// names are a key and a value — two values per step, no pair object. Over an
// array the walk produces one value and the brackets take it apart, exactly as
// `const [a, b] = pair` does.
//
// The head was read before the sequence, so anything a *positional* head could
// not be — a rest, a nested pattern — was refused there and never reached the
// second reading. `const [head, ...tail] = row` worked in a declaration and
// `for (const [head, ...tail] of rows)` did not, which is one pattern, two
// positions, and a refusal that was a true sentence about the reading it was
// not.
//
// An element that is more than a name *is* the answer: a walk's positional
// values cannot carry a rest or a nested pattern — a `Map` hands over a key
// and a value and there is nothing to gather — so the brackets must be a
// destructuring, which `bind_pattern` already knows how to do.
//
// The controls are the readings that must not move: two plain names over a
// `Map`, an elision over a `Map`, two names over an array of tuples, and
// `entries()`. Each is a different route through the same head.

/** The shape that refused: a rest element in the head. */
export function headAndTailLengths(n: number): number {
  const rows: number[][] = [[1, 2, n], [4, 5], [6]];
  let total = 0;
  for (const [head, ...tail] of rows) {
    total += head * 10 + tail.length;
  }
  return total;
}

/** The rest gathers the elements themselves, not just their count. */
export function sumOfTails(n: number): number {
  const rows: number[][] = [[1, 2, n], [4, 5]];
  let total = 0;
  for (const [, ...tail] of rows) {
    for (const v of tail) {
      total += v;
    }
  }
  return total;
}

/** A nested pattern, which the head also refused. */
export function nestedPairs(n: number): number {
  const rows: [number, [number, number]][] = [[1, [2, n]], [3, [4, 5]]];
  let total = 0;
  for (const [a, [b, c]] of rows) {
    total += a * 100 + b * 10 + c;
  }
  return total;
}

// **A default in the head is not claimed here, and the reason is worth the
// paragraph.** `for (const [a, b = 9] of rows)` compiles — it takes the same
// route as the arms above — but nothing in this file can make the default
// *fire*, so an arm for it would assert that a branch which never runs
// produces the right answer.
//
// Two ways to reach it and both are closed. Over `number[][]` the checker
// types every index `number`, so `b` is only ever `undefined` by reading past
// the end of a ragged row: node answers `undefined` and this compiler declines
// the case, which is 17 cases the differential could not compare when this was
// written that way. Over `{ a: number; b?: number }[]` the array literal is
// refused — `an array of Erased where an array of Managed(Object(…)) is
// wanted` — which is the optional-property representation and not this
// feature.
//
// So the default is left unclaimed rather than asserted by a passing arm that
// could not have failed.

/** A renamed object pattern in the head, which went through the other branch
 *  already and is here so the two are asserted together. */
export function renamedFields(n: number): number {
  const points: { x: number; y: number }[] = [{ x: 1, y: n }, { x: 2, y: 3 }];
  let total = 0;
  for (const { x: across, y: down } of points) {
    total += across * 10 + down;
  }
  return total;
}

/** Control: two plain names over an array of tuples — the destructuring
 *  reading, which worked before this and must still. */
export function pairsOverAnArray(n: number): number {
  const rows: [number, number][] = [[1, 2], [3, n]];
  let total = 0;
  for (const [a, b] of rows) {
    total += a * b;
  }
  return total;
}

/** Control: two plain names over a `Map` — the *positional* reading, which is
 *  the one a change routing everything to `bind_pattern` would break. */
export function pairsOverAMap(n: number): number {
  const m = new Map<string, number>();
  m.set("a", 1);
  m.set("bb", n);
  let total = 0;
  for (const [k, v] of m) {
    total += k.length * v;
  }
  return total;
}

/** Control: an elision over a `Map`, which binds nothing and still occupies a
 *  position — the arm that says the count is what makes `v` the second. */
export function valuesOfAMap(n: number): number {
  const m = new Map<string, number>();
  m.set("a", 1);
  m.set("b", n);
  let total = 0;
  for (const [, v] of m) {
    total += v;
  }
  return total;
}

/** Control: `entries()` over an array, the third reading of `[a, b]`. */
export function indexedEntries(n: number): number {
  const xs = [1, 2, n];
  let total = 0;
  for (const [i, v] of xs.entries()) {
    total += i * v;
  }
  return total;
}
