// expect: NTS1001 a parameter of unrepresentable type (a union of `ArrayLike` | number | string) is not supported by this lowering yet
//
// `{ size }` reaches `size` as declared, beside calls that take its copies, so the
// declaration is lowered and its refusal is the root of what reaches it through
// the shorthand, rather than `size` going unemitted and its dependents naming a
// function nothing defines. (A call through the shorthand's closure, whose
// function is refused, crashes on main and here alike: recorded apart.)
function size(value: number): number;
function size(value: string): number;
function size(value: number | string | ArrayLike<number>): number;
function size(value: number | string | ArrayLike<number>): number {
  if (typeof value === "number") return value;
  return value.length;
}
const api = { size };
export function direct(n: number): number {
  return size(n);
}
export function throughShorthand(n: number): number {
  return api.size(n);
}
