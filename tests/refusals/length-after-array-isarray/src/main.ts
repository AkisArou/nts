// expect: nothing refused -- FIXED, kept as a guard
//
// `Array.isArray` narrows an `unknown` to `any[]`, and `any[]` has no layout,
// so the `.length` that the narrowing was performed in order to reach is
// refused. The narrowing itself is not refused -- only what it produces.
//
//     items.length                     -> lowers, for `items: string[]`
//     if (Array.isArray(v)) v.length    -> REFUSED, for `v: unknown`
//
// `control` must stay clean, or the diagnostic reads as "arrays have no
// `length`", which is false and would point at arrays rather than at what this
// one narrowing yields.
//
// This is the root under `string_decoder`, which is the nearest module to the
// compiled axis and owns no refusal of its own. The chain is four deep and
// every link is a cascade:
//
//   StringDecoder#constructor
//     <- ERR_UNKNOWN_ENCODING#constructor   internal/errors.ts:627
//       <- inspectValue                     internal/errors.ts:559
//         <- inspectValueWithin             internal/errors.ts:518  THIS
//
// It is the reason the module has no wrapper at all rather than a partial one:
// `emit-c --napi` reports "no wrapper for StringDecoder: is a class whose
// constructor was not compiled", so the addon publishes zero exports and every
// one of node's `string_decoder` tests fails on an absent class.
//
// Filed after a wrong first answer. The cascade line for `inspectValue` is
// truncated in a terminal at "calls `inspectValu...", and the next NTS1001
// after `inspectValue`'s own line 558 is at 640 -- which is inside a *different*
// class further down the file. Reading the chain one link at a time instead of
// pattern-matching the nearest line number gave `length`, not the `map` on a
// typed array that 640 reports.

export function control(items: string[]): number {
  return items.length;
}

export function subject(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  return 0;
}

// **Fixed, and it cleared one root of string_decoder's 74 without greening the
// module.** A length needs no element type: it is in the header every reference
// carries, so reading it through the tag is sound for exactly the value
// `Array.isArray` proved. `any` still has no representation and this does not
// give it one -- what it gives a representation to is the *result of a runtime
// array test*, which is a different claim and the honest one.
//
// **Elements stay refused, and two lines later that is what stops the chain.**
// `internal/errors.ts:518` was the `.length` and `:520` indexes the same
// narrowed value, so clearing the first revealed the second -- the Node lane's
// "five cleared and five revealed" arriving immediately. An element read needs
// the storage *width*, which the type does not say, and guessing it would be a
// claim about memory rather than about type. That is the line `AnyView` draws
// for views and it is drawn here for the same reason.
//
// Reading elements dynamically *is* possible -- an `NtsArray` carries its
// descriptor and the descriptor knows the width -- and that is the array
// analogue of `AnyView`, a feature rather than a fix. Named here so the next
// reader meets it as the next step rather than as a surprise.
