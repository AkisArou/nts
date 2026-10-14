// The array operations that *move* elements, and the ones that copy them.
//
// `array-methods` measures the ones that take a value and `array-predicates`
// the ones that take a function. These are the third group: `shift` and
// `unshift`, which slide the elements of an array they already have, and
// `splice`, `concat`, spread and `Array.from`, which hand back a new one.
//
// The shape is a queue with a window, which is what uses them: something is
// appended at the back and taken from the front, something is put in at the
// front and cut back out of the middle, and the state is copied twice.
//
// `shift` is O(n) and that is the operation rather than a shortcoming -- an
// array's elements are contiguous, so taking the first means moving the rest,
// and `std::vector::erase(begin())` and V8's backing store both pay it.
//
// **Everything depends on `seed`.** With a constant array the whole round is
// loop-invariant, V8 hoists it, and node reports a time for work it did once.
export function mutations(seed: number): number {
  const n = 128 + (seed | 0);
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    xs.push(i * 3 + seed);
  }

  let total = 0;
  for (let round = 0; round < 8; round++) {
    xs.push(round + seed);
    total = (total + (xs.shift() ?? 0)) | 0;

    xs.unshift(round * 2 + seed);
    const gone = xs.splice(1, 2);
    total = (total + gone.length + gone[0]!) | 0;

    const copy = [...xs];
    total = (total + copy.length + copy[0]!) | 0;

    const both = copy.concat(gone);
    total = (total + both.length) | 0;
  }
  return total;
}

/**
 * The input the harness calls `mutations` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 3;
