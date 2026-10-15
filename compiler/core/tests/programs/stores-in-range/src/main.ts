// Every index store names a slot the allocation made: `i < n` guards each one
// and `n` is the length `new Array(n)` allocated. See
// `bounds::prove_stores_cannot_grow`.
export function filled(seed: number): number {
  const n = 64;
  const xs = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    xs[i] = i + (seed | 0);
  }
  for (let i = 1; i < n; i++) {
    xs[i] = xs[i]! * 0.5 + xs[i - 1]! * 0.25;
  }
  let total = 0;
  for (let i = 0; i < n; i++) {
    total = total + xs[i]!;
  }
  return total;
}
