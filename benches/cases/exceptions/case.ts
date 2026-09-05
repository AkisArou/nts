// `throw` and `catch` in a hot loop.
//
// One iteration in eight throws, which is often enough that the handler is not
// a cold path and rare enough that it is still an exception. The thrown `Error`
// never leaves the function, so nothing here should allocate.
export function run(rounds: number): number {
  let total = 0;
  for (let i = 0; i < rounds; i = i + 1) {
    try {
      if ((i & 7) === 0) {
        throw new Error("boom");
      }
      total = total + 1;
    } catch (e) {
      total = total + 2;
    }
  }
  return total;
}

/**
 * The input the harness calls `run` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 100000;
