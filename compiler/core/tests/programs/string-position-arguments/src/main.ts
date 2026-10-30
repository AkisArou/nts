export function plain(s: string, needle: string): number {
  return s.indexOf(needle) + s.lastIndexOf(needle) + (s.includes(needle) ? 1 : 0)
    + (s.startsWith(needle) ? 2 : 0) + (s.endsWith(needle) ? 4 : 0);
}
export function positioned(s: string, needle: string, n: number): number {
  return s.indexOf(needle, n) + s.lastIndexOf(needle, n) + (s.includes(needle, n) ? 1 : 0)
    + (s.startsWith(needle, n) ? 2 : 0) + (s.endsWith(needle, n) ? 4 : 0);
}
export function checked(s: string | undefined, n: number): number {
  return "ababa".indexOf((s as unknown as string), n);
}
export function explicitUndefined(s: string): string | undefined {
  // @ts-expect-error The runtime converts undefined to the default numeric index.
  return s.at(undefined);
}
export function explicitNull(s: string): string | undefined {
  // @ts-expect-error The runtime converts null to the numeric index zero.
  return s.at(null);
}
export function shadowedUndefined(undefined: number): string | undefined {
  return "abc".at(undefined);
}
export function surplusAbsent(n: number): number {
  let count = 0;
  function mark(): void { count++; }
  // @ts-expect-error Surplus arguments evaluate but are not converted.
  "abc".at(n, void mark());
  return count;
}
