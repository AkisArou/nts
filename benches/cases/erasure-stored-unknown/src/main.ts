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
