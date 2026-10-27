# V8's Math.random, modelled

A TypeScript model of V8's `Math.random` (xorshift128+, MurmurHash3 seeding of the seed and its complement, a 64-value cache read from the end, each value `(s0 >> 11) / 2^53`). Checked against node 24.20.0 on 2026-10-27: `node --random-seed=N` gives the same 1,000 values at seeds 42, 1, -7 and 2147483647; seed 0 means unseeded. Used by [builtins](../../../foundations/builtins.md#the-clock-and-randomness).

```ts
// V8's Math.random (src/numbers/math-random.cc, base/utils/random-number-generator.h):
// xorshift128+ taking 53 bits of the state, seeded through MurmurHash3's finalizer, refilled 64 values at a
// time and read from the end of the cache.
const MASK = (1n << 64n) - 1n;

function murmur3(h: bigint): bigint {
  h ^= h >> 33n;
  h = (h * 0xff51afd7ed558ccdn) & MASK;
  h ^= h >> 33n;
  h = (h * 0xc4ceb9fe1a85ec53n) & MASK;
  h ^= h >> 33n;
  return h;
}

export function v8Random(seed: number, count: number): number[] {
  const s = BigInt.asUintN(64, BigInt(seed));
  let s0 = murmur3(s);
  let s1 = murmur3(~s & MASK);
  const out: number[] = [];
  while (out.length < count) {
    const cache: number[] = [];
    for (let i = 0; i < 64; i++) {
      let x = s0;
      const y = s1;
      s0 = y;
      x ^= (x << 23n) & MASK;
      x ^= x >> 17n;
      x ^= y;
      x ^= y >> 26n;
      s1 = x;
      cache.push(Number(s0 >> 11n) / 2 ** 53);
    }
    for (let i = 63; i >= 0 && out.length < count; i--) out.push(cache[i]);
  }
  return out;
}

const seed = Number(process.argv[2]);
console.log(v8Random(seed, 1000).join("\n"));
```
