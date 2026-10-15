// `stores-in-range` with one store more, `xs[n]`, which appends: the program's
// arrays can grow, and nothing may be unchecked on the assumption they cannot.
export function filled(seed: number): number {
  const n = 64;
  const xs = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    xs[i] = i + (seed | 0);
  }
  for (let i = 1; i < n; i++) {
    xs[i] = xs[i]! * 0.5 + xs[i - 1]! * 0.25;
  }
  xs[n] = seed;
  let total = 0;
  for (let i = 0; i < xs.length; i++) {
    total = total + xs[i]!;
  }
  return total;
}
