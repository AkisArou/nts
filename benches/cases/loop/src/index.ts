export function accumulate(n: number): number {
  let total = 0;
  let i = 0;
  while (i < n) {
    total = total + i * i - i / 2;
    i = i + 1;
  }
  return total;
}
