// `s.split(sep, limit)`.
//
// The runtime splits and the limit truncates, which is exact for a **string**
// separator: the specification stops early, and a truncation of the whole result
// is the same list, because a separator that is not a regular expression cannot
// make the earlier elements depend on how many are wanted.
//
// **The limit goes through `ToUint32` first, and that is the whole subtlety.**
// `split(",", -1)` means *no* limit -- `ToUint32(-1)` is 4294967295 -- while
// slicing to `-1` counts from the end and would drop the last element instead.
// `>>> 0` is the language's own spelling of that conversion, and
// `negativeLimit` is the arm that fails without it.
//
// Before this the call was refused as `a string method with this many
// arguments`, which is true of `nts_str_split` and not of `String.prototype
// .split`.

export function limited(n: number): string {
  return "a,b,c,d".split(",", 2).join("|");
}

/** Zero keeps nothing, which is not the same as no limit. */
export function zeroLimit(n: number): number {
  return "a,b,c".split(",", 0).length + n;
}

/** Negative means *no* limit, and is where a naive truncation differs. */
export function negativeLimit(n: number): number {
  return "a,b,c".split(",", -1).length + n;
}

/** Larger than the result, which clamps. */
export function hugeLimit(n: number): number {
  return "a,b,c".split(",", 99).length + n;
}

/** No limit at all, the arity that always worked. */
export function noLimit(n: number): number {
  return "a,b,c".split(",").length + n;
}

/** A limit the program computes, so nothing is folded at compile time and the
 *  differential's own inputs -- negative, fractional, large -- reach it. */
export function computed(n: number): number {
  return "a,b,c,d,e".split(",", n).length;
}

/** A multi-character separator, so the truncation is not of single letters. */
export function multiCharSeparator(n: number): string {
  return "a::b::c".split("::", 2).join("+");
}
