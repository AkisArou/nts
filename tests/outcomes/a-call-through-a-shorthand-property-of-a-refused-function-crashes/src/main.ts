// run: check
//
// `size` as declared is refused (its `ArrayLike<number>` overload has no
// representation here). `direct` passes a number, so it calls the copy of
// `size` made over that member and agrees. `api.size(n)` reaches `size`
// through the shorthand property `{ size }`, which records only the
// property's own symbol, not the function its value names. So nothing makes
// `throughShorthand` depend on the refused declaration, it is not refused with
// it, the program builds, and the call crashes (signal 11, 29 of 29). The
// control is the same program with that overload removed, where `size`
// compiles and both exports agree.
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
