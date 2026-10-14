// The control: the same scan over an array that needs no tag, because the
// element type says what is in it.
export function erasureStoredTyped(seed: number): number {
  const values: number[] = new Array(2000);
  for (let i = 0; i < 2000; i++) {
    values[i] = seed + i;
  }
  let total = 0;
  for (let round = 0; round < 100; round++) {
    for (let i = 0; i < 2000; i++) {
      total = total + values[i];
    }
  }
  return total;
}

/**
 * The input the harness calls `erasureStoredTyped` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 12345;
