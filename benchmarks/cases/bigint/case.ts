// `bigint` arithmetic, which is where the 128-bit representation is supposed to
// pay for the precision it gives up.
//
// `typescript.md` argues the width: every `bigint` in the node profile is a
// 64-bit quantity -- `readBigUInt64BE`, an hrtime timestamp,
// `0xffffffffffffffffn` -- and a true bignum puts a heap allocation into each
// of them. This row is what that argument buys. Node's `BigInt` is arbitrary
// precision and allocates; ours is two machine words.
//
// The *loop bound* carries the seed rather than the arithmetic, because
// `BigInt(n)` is refused -- this compiler provides no number-to-bigint
// conversion, which is a named gap in `typescript.md` §7. An unknown trip count
// is enough that nothing here folds.
export function mix(seed: number): number {
  const modulus = 1000000007n;
  let a = 1n;
  let b = 998244353n;
  const rounds = 61 + (seed | 0);
  for (let round = 0; round < rounds; round++) {
    a = (a * b + 12345n) % modulus;
    b = (b ^ (a << 3n)) & 0xffffffffffffn;
    a = a + (b >> 5n);
  }
  return Number((a ^ b) & 0xffffn);
}

/**
 * The input the harness calls `mix` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 3;
