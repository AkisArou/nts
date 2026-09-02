// What a table costs, which is one allocation and not one per entry.
//
// A `Map` is a hash table -- open addressing over a power-of-two slot array,
// with the keys and values kept in insertion order beside it. So the question
// this case exists to answer is *growth*: a table that reallocated per insert
// would show sixteen allocations here instead of a handful, and a table that
// boxed each entry would show one per `set`.

export function work(n: number): number {
  const seen = new Map<number, number>();
  const marks = new Set<number>();
  let total = 0;
  for (let i = 0; i < 16 + n; i = i + 1) {
    seen.set(i, i * 3);
    marks.add(i * 2);
  }
  for (let i = 0; i < 16 + n; i = i + 1) {
    total = total + (seen.get(i) ?? 0) + (marks.has(i * 2) ? 1 : 0);
  }
  // Overwriting an existing key must not grow anything: the slot is already
  // there and the value is replaced in place.
  for (let i = 0; i < 16 + n; i = i + 1) {
    seen.set(i, i);
  }
  return total + seen.size + marks.size;
}
