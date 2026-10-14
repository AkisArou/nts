// expect: emit-c --napi -> calls (() => { try { exports.classifyInbound(new Map()); return false; } catch (e) { return /no representation in the compiled runtime/.test(String(e.message)); } })()
// control: exports.classifyInternal() === true && exports.classifyScalar("x") === true && exports.classifyScalar(1) === false
//
// Nothing object-shaped crosses the wrapper inward.
//
// `classifyInbound` publishes. It answers for every scalar and throws
// `an argument of this type has no representation in the compiled runtime` for
// every reference -- an array, a plain object, a `Map`, a `Date`, a `RegExp`,
// an `Error`, a typed array, a function.
//
// # The controls are the diagnosis, not decoration
//
// Two things had to be true before the throw meant "inbound", and both are in
// the control line:
//
//     classifyInternal()      a Map built in the program, held in an `unknown`,
//                             brand-checked there -- so `unknown` *can* hold a
//                             reference and the representation exists
//     classifyScalar("x")     the same parameter shape, given a scalar -- so the
//                             `unknown` parameter itself works
//
// With both holding, what is missing is one direction of one conversion:
// `nts_from_napi_value` has no case for an object. `nts_is_map` and
// `nts_is_date` are already emitted, so the brand check on the other side is
// there waiting.
//
// # It is not `unknown`, and it is not erasure
//
// The mirror was measured rather than assumed. A **statically shaped** object
// crosses outward -- `returnsShaped(): { a: number }` answers `{"a":7}` -- and
// inward the same shape is not published at all:
//
//     no wrapper for shapedInbound: takes an object, which crosses outward only
//
// Nor is a declared class, nor an array of them. So this is the whole
// direction, not a hole in one type, and outward has a separate and different
// story: there an *erased* value carrying a reference is what cannot cross,
// whatever its declaration says.
//
// # What it costs
//
// `util.types` publishes **31 predicates and not one can be asked about a
// reference**, which is the only argument they take -- `isDate(new Date())`
// throws where node answers `true`. Across all 42 predicates in
// `util/src/types.ts` there is not one `value.`, `value[` or `value(`: they
// classify and never dereference. `buffer.isUtf8`, `buffer.isAscii` and
// `url.isURL` are the same wall.
//
// `tooling/conformance/reference-boundary.sh` is the standing version of this,
// with the outward direction beside it and a guard that stops the run if
// `unknown` and `object` ever disagree.

// Control: a Map built here, held erased, and brand-checked here.
export function classifyInternal(): boolean {
  const m: unknown = new Map<string, number>();
  return m instanceof Map;
}

// Under test: the same check, on a reference that had to cross inward.
export function classifyInbound(value: unknown): boolean {
  return value instanceof Map;
}

// Control: the same parameter, given a scalar.
export function classifyScalar(value: unknown): boolean {
  return typeof value === "string";
}
