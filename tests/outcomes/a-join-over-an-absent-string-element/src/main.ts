// run: check
//
// `join` over a `(string | undefined)[]` or a `(string | null)[]` that holds
// an absent element crashes the compiled program on C and LLVM, killed by
// SIGSEGV with nothing refused, where node joins the absent element as the
// empty string. The JVM agrees.
// The element storage is a string reference and the absent slot a null one,
// and `nts_array_join_str` reads every slot's length without testing it.
//
// The control differs in one thing: the same join with every element present.
//
// Found writing `join` for the Wasm lane, which joins a null slot as "".
// Fixed in the C runtime, which LLVM links: a null slot joins as nothing, and
// the record now pins the agreement beside the control.
export function absentLength(n: number): number {
  const xs: (string | undefined)[] = ["a".repeat(n & 3), undefined];
  return xs.join(",").length;
}
export function nullLength(n: number): number {
  const xs: (string | null)[] = [null, "b".repeat(n & 3)];
  return xs.join("-").length;
}
export function presentLength(n: number): number {
  const xs: (string | undefined)[] = ["a".repeat(n & 3), "c"];
  return xs.join(",").length;
}
