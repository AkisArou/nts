// ARES-6 ML Array-return control: replace construction with a plain factory.
function MakeArray(n: number): number[] {
  return [n, n + 1];
}
export function work(n: number): number {
  const values = MakeArray(n);
  return values[0] * 3 + values[1] + values.length;
}
