// `join` over string and number arrays, against node: any separator, empty
// and lone-surrogate text, absent elements, and each number's own text.
export function strings(a: string, b: string, sep: string): string {
  return [a, b, a].join(sep);
}
export function one(a: string, sep: string): string {
  return [a].join(sep);
}
export function none(sep: string): string {
  const xs: string[] = [];
  return xs.join(sep);
}
export function defaultSeparator(a: string, b: string): string {
  return [a, b].join();
}
// `undefined` and `null` both join as the empty string.
export function absent(a: string, sep: string): string {
  const xs: (string | undefined)[] = [a, undefined, a];
  return xs.join(sep);
}
export function nulls(a: string, sep: string): string {
  const xs: (string | null)[] = [null, a, null];
  return xs.join(sep);
}
export function numbers(x: number, y: number, sep: string): string {
  return [x, y, x].join(sep);
}
