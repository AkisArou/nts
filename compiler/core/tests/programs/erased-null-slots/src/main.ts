// An erased array says what its null slots mean. See `OpKind::Erase`'s `slots`.
function second(a: unknown): unknown {
  return Array.isArray(a) ? a[1] : 0;
}
export function nulls(n: number): string {
  const xs: (string | null)[] = ["a".repeat((n & 1) + 1), null];
  return second(xs) === null ? "N" : "U";
}
export function undefineds(n: number): string {
  const xs: (string | undefined)[] = ["a".repeat((n & 1) + 1), undefined];
  return second(xs) === undefined ? "U" : "N";
}
