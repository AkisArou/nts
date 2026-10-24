// run: check
// The assertion changes no value. The typed Record control asks the same key.
function record(n: number): Record<string, number> {
  const value: Record<string, number> = {};
  if ((n & 1) === 0) value.key = n;
  return value;
}
export function asserted(n: number): boolean {
  return "key" in (record(n) as unknown as { key: number });
}
export function control(n: number): boolean {
  return "key" in record(n);
}
