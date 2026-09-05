// Half of a pair. Its twin, `growth-grown`, is the same program with the array
// built by `push` instead of by index.
//
// `hir::arrays_can_grow` is a **whole-program** predicate: one `push` anywhere
// puts every array in the program behind a pointer, because an array that grows
// cannot keep its elements inline after its own header without moving. So the
// two halves differ by one call in *setup* and get different representations in
// the hot loop, which is the thing being priced.
//
// Nothing measured this before. `array-mutations` grows an array but is *about*
// growing one; `array-predicates` and `case-convert` each have a stray `push` in
// setup and sit on the far side of the cliff without saying so. And
// `examples/growable` states outright that "the `arrays` benchmark measured the
// difference at nothing" -- which `arrays` cannot have done, because it contains
// no `push` and is therefore on one side only.
//
// **Each round reads what the round before it wrote.** An earlier draft summed a
// read-only array, which is an invariant inner loop that a compiler may hoist
// out of the outer one and multiply by the round count -- the same shape that
// made a sibling case read 1.3 ns per call by being solvable in closed form.
// A weighted average in place cannot be hoisted, cannot be reassociated in
// floating point, and keeps its values bounded.

export function scan(seed: number): number {
  const n = 2048;
  const xs = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    xs[i] = i * 7 + (seed | 0);
  }
  for (let round = 0; round < 64; round++) {
    for (let i = 1; i < n; i++) {
      xs[i] = xs[i]! * 0.75 + xs[i - 1]! * 0.25;
    }
  }
  let total = 0;
  for (let i = 0; i < n; i++) {
    total = total + xs[i]!;
  }
  return total;
}

/**
 * The input the harness calls `scan` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 3;
