export function work(n: number): number {
  const needle = String(n);
  return "a1a".indexOf(needle as any, n);
}
