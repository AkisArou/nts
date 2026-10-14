// expect: emit-c --napi -> calls (() => { try { exports.unknownReference(); return false; } catch (e) { return /no JavaScript representation/.test(String(e.message)); } })()
// control: exports.unknownScalar() === 7 && exports.unknownString() === "s" && exports.shapedReference().a === 7
//
// An erased value carrying a reference cannot cross outward, and the
// declaration makes no difference.
//
// # This fixture exists because the first reading of it was wrong
//
// It was recorded as "the narrower type is the one that cannot come back",
// from three functions:
//
//     returnsUnknown(): unknown       -> 7          crosses
//     returnsShaped(): { a: number }  -> {"a":7}    crosses
//     returnsObject(): object         -> THREW
//
// Two things move across those rows -- the declared type *and* what the body
// returns -- so the conclusion could have attached to either, and it attached
// to the wrong one. The compiler lane emitted the missing function rather than
// accepting the reading:
//
//     unknownScalar(): unknown        -> 7          crosses
//     unknownString(): unknown        -> "s"        crosses
//     unknownReference(): unknown     -> THREW      <- the cell nobody ran
//     objectReference(): object       -> THREW
//     shapedReference(): { a: number} -> {"a":7}    crosses
//
// `unknown` and `object` lower to the same `erased` type and get a
// **byte-identical wrapper**; `nts_to_napi_value` switches on the tag,
// converting UNDEFINED, NULL, BOOLEAN, NUMBER and STRING and throwing on the
// rest. A string is the one reference that converts, which is what made a
// value-shaped boundary look type-shaped.
//
// The control asserts all three crossings, so the throw below is about the
// reference and not about the boundary being broken generally. `unknownString`
// is in it deliberately: without it, "erased values cannot cross" would be a
// consistent and wrong reading of the same rows.
//
// # What it costs
//
// `async_hooks.executionAsyncResource` is declared `(): object` at
// `internal/async-hooks.ts:236`. It publishes, it is called, and it throws --
// the one unusable name in its module, and behind this wall rather than behind
// its declaration.
//
// The fix the compiler lane named is a tag-dispatched outward conversion: the
// header's descriptor already knows whether a reference is an object, an array
// or a map, and `object_helper`, `elements_helper` and `nts_to_napi_entries`
// all exist. What is missing is choosing among them at run time from the
// descriptor instead of at emit time from the type.

const held: { a: number } = { a: 7 };

// Controls: a scalar and a string through `unknown`, and a shaped object.
export function unknownScalar(): unknown {
  return 7;
}

export function unknownString(): unknown {
  return "s";
}

export function shapedReference(): { a: number } {
  return held;
}

// Under test: the same erased return type, carrying a reference.
export function unknownReference(): unknown {
  return held;
}

// The same value under the narrower declaration, which behaves identically.
export function objectReference(): object {
  return held;
}
