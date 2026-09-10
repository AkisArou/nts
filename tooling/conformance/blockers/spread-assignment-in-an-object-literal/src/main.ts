// expect: lowers
//
// Kept as a guard. `{ ...base, b }` in an object literal.
//
// It is a field-by-field copy, emitted **where the spread is written**, so that
// what comes later overwrites what came before. The whole of the semantics is
// source order, and nothing else had to be decided.
//
// `control` returns the same shape by naming its properties, and lowered all
// along — which is what said this was the spread and not the literal.
//
//     { a, b }        -> lowered then, lowers now
//     { ...base, b }  -> refused then, lowers now
//
// **23 distinct sites when this was filed; 25 when it was fixed** — web-platform
// 8, fs 5, http 4, util 3, stream 3, and 158 refused functions summed over the
// module cones. This is how upstream writes "the same options with one field
// changed", so the sites are option-threading rather than anything exotic, which
// is also why rewriting them away would have been rewriting correct source to
// hide a refusal.
//
// # What this certifies and what it does not
//
// That both functions lower. It does not certify the copy: a spread that copied
// nothing lowers just as cleanly, and `{ ...base, b }` with `a` left at zero is
// exactly the shape a wrong one takes. `examples/spread-in-an-object-literal` is
// what asks node — eight cases including two spreads in a row, a class instance
// as the source, a narrower source, a narrower target, and the source read back
// afterwards to show it was not disturbed.
//
// # Its two smaller relatives, which are not fixed
//
// `a `get accessor` in an object literal` (1 site, web-platform) and `a `method
// declaration` in an object literal` (1 site, process). All three say "in an
// object literal" and each names a different member form; this one is a copy of
// fields and those two are a function per member, so the fix did not carry.
// Still deliberately unfiled at one site each — a fixture per site would
// outnumber the defect.

export function control(a: number, b: number): { a: number; b: number } {
  return { a, b };
}

export function subject(base: { a: number }, b: number): { a: number; b: number } {
  return { ...base, b };
}
