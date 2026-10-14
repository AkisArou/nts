// bigint kernels: each export takes an iteration count and answers a number,
// one bigint operation (or a short chain) per iteration. Values stay within
// 128 bits, so Wasm's v128 path and node's BigInt compute the same thing.

export function adds(n: number): number {
  let total = 0n;
  const step = 1234567891234567n;
  for (let i = 0; i < n; i++) total += step;
  return Number(total % 1000000007n);
}

export function mulMod(n: number): number {
  let x = 7n;
  const m = 1000000007n;
  for (let i = 0; i < n; i++) x = (x * 48271n) % m;
  return Number(x);
}

export function wideDivision(n: number): number {
  let x = (1n << 100n) + 12345n;
  let total = 0n;
  for (let i = 0; i < n; i++) {
    total += x / 1000003n;
    x += 1n;
  }
  return Number(total % 1000000007n);
}
