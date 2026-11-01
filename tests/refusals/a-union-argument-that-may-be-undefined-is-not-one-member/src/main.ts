// expect: NTS1003 `probe` cannot be compiled because it calls `size`, and a parameter of unrepresentable type (a union of `ArrayLike` | number | string | undefined) is not supported by this lowering yet
//
// A `string | undefined` argument represents as the string alone, its absence a null
// pointer, but it is still a union: copying `size` over a string folded
// `typeof value === "string"` true and read the length of an absent string,
// where node answers -1. The site keeps the declared parameter's refusal.
// Control: tests/programs/a-union-parameter-copied-over-a-string-that-is-never-absent.
function size(value?: number | string | ArrayLike<number>): number {
  if (typeof value === "string") return value.length;
  if (typeof value === "number") return value;
  return value === undefined ? -1 : value.length * 100;
}
export function probe(n: number): number {
  const text: string | undefined = n > 1 ? "abc" : undefined;
  return size(text);
}
