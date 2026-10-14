// Erasure where it cannot be inlined away: values that live in memory.
//
// `erasure-unknown` measures erased values passing through small functions,
// where LTO folds the representation out entirely and the cost is nil. This is
// the other half -- an array of them, so each element really is sixteen bytes
// with a tag, and the scan really reads one per element.
//
// Every element is a number, so this does exactly the work
// `erasure-stored-typed` does and the two are a clean A/B: same loop, same
// arithmetic, one representation apart.
//
// That also means specialization should eventually collapse this to the typed
// case, since nothing but numbers ever reaches the array. When that lands,
// this benchmark closing the gap is the evidence -- which is a better test of
// the optimisation than any assertion about it.
//
// # It landed, and this case has stopped measuring what it was built to measure
//
// Measured on the JVM lane, 2026-09-08:
//
//     bytes/op   erasure-stored-unknown  16016.00   NtsValue in bytecode: 0
//     bytes/op   erasure-stored-typed    16016.00   NtsValue in bytecode: 0
//     jvm/Java   erasure-stored-unknown  0.96x      68.29 us against 71.07 us
//
// The gap has closed, and the two halves of the evidence agree. Identical
// allocation -- 16016 bytes is one 2000-element `double[]`, header included,
// and *nothing else* -- and **no `NtsValue` reference in the emitted class file
// at all**. So the sixteen-byte tagged element this file describes is not what
// runs; specialization proved nothing but numbers reach the array and gave it
// a `double[]`.
//
// Which means this row is now a measurement of an array allocation that both
// halves make equally, and says nothing about erasure. Left in place because a
// case that has closed is still the ratchet that would notice it reopening --
// but read as "erasure in memory is free" it would be quietly wrong, because
// there is no erasure in it. `erasure-unknown` is the pair that still carries
// `NtsValue` into bytecode, and it is the one to read for what erasure costs.
//
// Written with index assignment because `push` on an `unknown[]` is refused,
// and it is `unknown[]` rather than a ternary because a conditional whose arms
// have different types takes the *union* as its own type before anything
// erases it. Both are gaps in erasure's reach, written down in record 0019.
export function erasureStoredUnknown(seed: number): number {
  const values: unknown[] = new Array(2000);
  for (let i = 0; i < 2000; i++) {
    values[i] = seed + i;
  }
  let total = 0;
  for (let round = 0; round < 100; round++) {
    for (let i = 0; i < 2000; i++) {
      const held = values[i];
      if (typeof held === "number") {
        total = total + held;
      }
    }
  }
  return total;
}

/**
 * The input the harness calls `erasureStoredUnknown` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 12345;
