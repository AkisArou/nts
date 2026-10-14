// An index argument that is `undefined` means what the method says it means,
// which is not one thing. `slice(1, undefined)` runs to the end, as `slice(1)`
// does: the specification asks whether the *value* is undefined. But
// `splice(1, undefined)` removes nothing where `splice(1)` removes the rest:
// there it asks whether the argument is *present*, and an explicit undefined
// is `ToIntegerOrInfinity(undefined)`, 0. Lowered as it was, the erased value
// met the helper's double through an unerase nothing had tested, and C, LLVM,
// the JVM and RC all read an undefined end as 0 -- an empty slice -- agreeing
// with node only where 0 was the answer, as `splice`'s count is. Found from
// the Wasm lane's refusal of `splice(n, undefined)`, which named the unerase.
const at = (n: number): number => n % 5;

export function sliceEnd(n: number): string {
  return [1, 2, 3, 4, 5].slice(at(n), undefined).join(",");
}
export function sliceStringEnd(n: number): string {
  return "abcde".slice(at(n), undefined);
}
export function substringEnd(n: number): string {
  return "abcde".substring(at(n), undefined);
}
export function spliceCount(n: number): string {
  const xs = [1, 2, 3, 4, 5];
  xs.splice(at(n), undefined);
  return xs.join(",");
}
// Through an optional parameter, where the value is decided at run time.
function sliceWith(xs: number[], start: number, end?: number): string {
  return xs.slice(start, end).join(",");
}
export function sliceOptional(n: number): string {
  return sliceWith([1, 2, 3, 4, 5], at(n)) + "|" + sliceWith([1, 2, 3, 4, 5], 0, at(n));
}
// The control: the same calls given a number.
export function sliceGiven(n: number): string {
  return [1, 2, 3, 4, 5].slice(at(n), 4).join(",") + "|" + "abcde".substring(at(n), 4);
}
