// An implementation parameter whose union has no representation of its own
// (`ArrayLike<number>` beside a number and a string) is copied over the member
// each call passes, with the `typeof` tests that member decides folded. The
// function was refused whole, and every caller with it.
// The control writes `number[]` for `ArrayLike<number>`, a union that has a
// representation, so the function compiles as one.
function size(value: number): number;
function size(value: string): number;
function size(value: ArrayLike<number>): number;
function size(value: number | string | ArrayLike<number>): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return value.length * 10;
  return value.length * 100;
}
export function fromNumber(n: number): number {
  return size(n);
}
export function fromString(n: number): number {
  return size("ab".repeat((n & 3) + 1));
}
export function fromArray(n: number): number {
  return size([n, n + 1, n + 2]);
}
