// `Array.from` over the two shapes that answer different questions.
//
// An **array** source is the one that had a fast path: a `slice`, which is a
// memcpy. The walk-and-append that replaced it is the general answer, and this
// row is what says whether generality cost anything.
//
// A **set** source is what the fast path could not do at all, so its number is
// against the C++ reference alone.

export function work(seed: number): number {
  const xs: number[] = [];
  for (let i = 0; i < 256; i++) {
    xs.push(i + seed);
  }
  const marks = new Set<number>();
  for (let i = 0; i < 256; i++) {
    marks.add(i * 3 + seed);
  }

  let total = 0;
  for (let round = 0; round < 2000; round++) {
    const copied = Array.from(xs);
    total = total + copied[round % 256];
    const listed = Array.from(marks);
    // The *length*, not an element: a `Set`'s order is insertion order here and
    // a hash table's is not, so indexing one would compare two orders rather
    // than two copies. The walk still runs to the end either way.
    total = total + listed.length;
  }
  return total;
}

/**
 * The input the harness calls `work` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 5;
