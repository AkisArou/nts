// Index stores that are all in range, so no array in the program can grow
// (`bounds::prove_stores_cannot_grow`) and every check here is gone: the
// answers must still be node's. `growth-fixed`'s kernel, small.
export function weighted(seed: number): number {
  const n = 256;
  const xs = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    xs[i] = i * 7 + (seed | 0);
  }
  for (let round = 0; round < 8; round++) {
    for (let i = 1; i < n; i++) {
      xs[i] = xs[i]! * 0.75 + xs[i - 1]! * 0.25;
    }
  }
  let total = 0;
  for (let i = 0; i < n; i++) {
    total = total + xs[i]!;
  }
  return total + xs.length;
}
export function lastWritten(seed: number): number {
  const xs = new Array<number>(16);
  for (let i = 0; i < 16; i++) {
    xs[i] = (seed * (i + 1)) % 97;
  }
  return xs[15]! + xs[0]! + xs.length;
}
