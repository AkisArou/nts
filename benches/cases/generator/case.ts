// A generator walked to the end, many times.
//
// The work per element is deliberately small -- a multiply and an add -- so
// that what is measured is the *step*: one resumption and one load. A body
// heavy enough to dominate would make every lane look alike and say nothing.

function* upTo(limit: number): Generator<number, void, unknown> {
  let i = 0;
  while (i < limit) {
    yield i * 3;
    i = i + 1;
  }
}

export function work(seed: number): number {
  let total = 0;
  for (let round = 0; round < 2000; round++) {
    for (const value of upTo(seed + 200)) {
      total = total + value;
    }
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
