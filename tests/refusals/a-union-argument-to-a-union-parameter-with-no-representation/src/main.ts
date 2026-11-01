// expect: NTS1003 `fromEither` cannot be compiled because it calls `size`, and a parameter of unrepresentable type (a union of `ArrayLike` | number | string) is not supported by this lowering yet
//
// A parameter whose union has no representation is copied over the member a
// call passes. An argument that is itself a union is no one member, so its
// call names the function as declared and keeps that function's refusal.
// `fromNumber` beside it passes one member and compiles.
function size(value: number): number;
function size(value: string): number;
function size(value: number | string | ArrayLike<number>): number;
function size(value: number | string | ArrayLike<number>): number {
  if (typeof value === "number") return value;
  return value.length;
}
export function fromEither(n: number): number {
  const either: number | string = (n & 1) === 0 ? n : "ab";
  return size(either);
}
export function fromNumber(n: number): number {
  return size(n);
}
