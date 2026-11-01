// expect: NTS1001 a parameter of unrepresentable type (a union of `ArrayLike` | number | string) is not supported by this lowering yet
//
// `export { size, Sized }` exports both by name, not by a modifier on their
// declarations, so each is lowered as declared beside its copies, and its
// refusal is recorded.
function size(value: number): number;
function size(value: string): number;
function size(value: number | string | ArrayLike<number>): number;
function size(value: number | string | ArrayLike<number>): number {
  if (typeof value === "number") return value;
  return value.length;
}
class Sized {
  readonly size: number;
  constructor(value: number | string | ArrayLike<number>) {
    this.size = typeof value === "number" ? value : value.length;
  }
}
export { size, Sized };
export function direct(n: number): number {
  return size(n) + new Sized(n).size;
}
