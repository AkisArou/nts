export function accumulate(n: number): number {
  let total = 0;
  let i = 0;
  while (i < n) {
    total = total + i * i - i / 2;
    i = i + 1;
  }
  return total;
}

/**
 * The input the harness calls `accumulate` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 1000;
