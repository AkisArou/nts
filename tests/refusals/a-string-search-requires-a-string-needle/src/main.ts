// expect: a string search needle without a known non-null string representation is not supported by this lowering yet
export function work(n: number): number {
  const needle = n;
  return "a1a".indexOf(needle as any, n);
}
