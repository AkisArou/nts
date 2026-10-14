// Integer work, written the way JavaScript writes it. Every value here is
// provably a whole number: `| 0` and the shifts are proofs by ToInt32, and the
// loop counter is bounded by a constant. There is no floating-point arithmetic
// in the algorithm at all -- only in the representation, unless something
// proves otherwise.
export function checksum(seed: number): number {
  let h = seed | 0;
  for (let i = 0; i < 4096; i++) {
    h = (h * 31 + i) | 0;
    h ^= h >>> 7;
    h = ((h << 5) - h) | 0;
  }
  return h;
}

/**
 * The input the harness calls `checksum` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 12345;
