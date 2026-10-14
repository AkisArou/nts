// Adler-32 over a byte buffer: the shape of every checksum, hash and protocol
// parser, and the one a `number[]` cannot express at all.
//
// A `Uint8Array` is eight times denser than the `double[]` a `number[]` is, so
// 4096 bytes fit in L1 where 4096 doubles do not -- and the byte that comes out
// of it is already an integer, so the arithmetic after it stays integer without
// anything having to prove it.
//
// It depends on `seed`, so none of it folds away at compile time.
export function run(seed: number): number {
  const length = 4096;
  const data = new Uint8Array(length);

  // The same LCG the other cases use: it stays inside 2^16, so every
  // implementation computes it exactly and the checksums can be compared.
  let state = seed | 0;
  for (let i = 0; i < length; i++) {
    state = (state * 1309 + 13849) & 65535;
    data[i] = state & 255;
  }

  let total = 0;
  for (let pass = 0; pass < 64; pass++) {
    let a = 1;
    let b = 0;
    for (let i = 0; i < length; i++) {
      a = (a + data[i]!) % 65521;
      b = (b + a) % 65521;
    }
    total = (total + ((b << 16) | a)) | 0;
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
export const seed = 7;
