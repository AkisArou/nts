// **A tuple whose elements differ in kind.** `[Map<string, number>, Counts]`
// is two references of different types. It was an array of its *first*
// element's type, so the second was coerced to the first's -- "a `Counts`
// where a table is wanted" -- and the pair written the other way round refused
// on its other arm: what decided it was position. Since 2026-10-21 such a tuple
// is an array of erased values, each slot holding what it holds, and both
// orders build and agree. `readTheFirst` is the other order.
//
// The GTK lane had probed the neighbouring shape first: `[boolean, number]`,
// mixed storage, which was always a struct and always agreed.

interface Counts {
  readonly a: number;
  readonly b: number;
}

const table = new Map<string, number>([["x", 1]]);
const counts: Counts = { a: 2, b: 3 };

function mapThenCounts(): [Map<string, number>, Counts] {
  return [table, counts];
}

export function readTheSecond(n: number): number {
  const [m, c] = mapThenCounts();
  return (m.get("x") ?? 0) * 100 + c.a * 10 + c.b + n;
}

/** **Control.** The same two types in the other order. */
function countsThenMap(): [Counts, Map<string, number>] {
  return [counts, table];
}

export function readTheFirst(n: number): number {
  const [c, m] = countsThenMap();
  return (m.get("x") ?? 0) * 100 + c.a * 10 + c.b + n;
}
