// The other half of the pair. Identical to `growth-fixed` except that the array
// is built by `push`, which sets `hir::arrays_can_grow` for the whole program
// and therefore changes the representation of the array the hot loop reads.
//
// Everything below the construction is character-for-character what its twin
// runs. That is the point: a ratio between two programs that differ in the
// kernel would be measuring the kernel.

export function scan(seed: number): number {
  const n = 2048;
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    xs.push(i * 7 + (seed | 0));
  }
  for (let round = 0; round < 64; round++) {
    for (let i = 1; i < n; i++) {
      xs[i] = xs[i]! * 0.75 + xs[i - 1]! * 0.25;
    }
  }
  let total = 0;
  for (let i = 0; i < n; i++) {
    total = total + xs[i]!;
  }
  return total;
}
