// Control for tests/refusals/a-union-argument-that-may-be-undefined-is-not-one-member: a `string` argument is one member, so `size` is copied over it.
function size(value?: number | string | ArrayLike<number>): number {
  if (typeof value === "string") return value.length;
  if (typeof value === "number") return value;
  return value === undefined ? -1 : value.length * 100;
}
export function probe(n: number): number {
  const text: string = n > 1 ? "abc" : "";
  return size(text);
}
