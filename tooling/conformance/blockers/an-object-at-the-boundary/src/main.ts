// expect: emit-c --napi -> calls (typeof exports.takesAUnion === "undefined" && typeof exports.takesANumber === "function")
//
// **The expectation is about the published surface, not the emitted C**, and
// the first draft got that wrong in a way worth keeping. `lacks-c takesAUnion`
// failed, because the function *does* compile -- the symbol is in `program.c`.
// What is missing is the **wrapper**: the module cannot publish a name whose
// signature the boundary cannot build. Two different absences, and only the
// second is the defect.
//
// `takesANumber` is inside the same assertion on purpose. Without it, an addon
// that failed to build at all would satisfy "takesAUnion is undefined" and the
// fixture would pass while testing nothing.
//
// **One mechanism, seen at a parameter and at a return, behind two whole
// namespaces.** The Node lane diagnosed these hours apart as unrelated and they
// are the same thing: an erasing union the boundary cannot build.
//
//     dns.promises      the return half   -- and with it every `promises` namespace
//     tty compiled      the parameter half -- `isatty({})`, which node answers false
//
// # The two shapes, which fail differently
//
// A parameter or return of `number | object` **declines outright**: no wrapper
// is written, and the module publishes nothing of that name. That is
// `opaque_slot` in the napi backend, and it is deliberate -- a wrapper that
// accepts everything and throws for everything is worse than absence, because a
// presence check that used to fail now passes and only a call finds out.
// `buffer.isUtf8` was exactly that.
//
// A parameter of `unknown` **publishes and throws**. The wrapper exists,
// `nts_from_napi_value` handles `undefined`, `null`, booleans, numbers and
// strings, and its `default:` arm throws:
//
//     an argument of this type has no representation in the compiled runtime
//
// So `isatty(0)` answers and `isatty({})` throws, where node answers `false` for
// anything and never throws. Two assertions out of nine in a seventeen-line
// test file.
//
// # What it would take, and the part that is a decision rather than work
//
// An object crossing inward needs a **payload a compiled function can hold**.
// The tag is not the problem -- an erased value's tags are spelled as `typeof`'s
// answers and `"object"` is already one of them. The payload is: a JavaScript
// object is a `napi_value`, which is only valid for the duration of the call,
// so holding one past it needs a `napi_ref` and something to free it.
//
// That is a **lifetime** question in the runtime's reference counting rather
// than a marshalling question in the wrapper, and it is the reason this is
// filed rather than done.
//
// The tempting shortcut is a tagged `"object"` with a null payload: `typeof x`
// then answers correctly and `isatty` returns `false`, which is the whole of
// what this test file needs. It is wrong, and specifically wrong in the way this
// compiler keeps being caught by -- it answers the case that was measured and
// reads whatever is at address zero for the next one. `typeof x === "object" &&
// x !== null` followed by a field read is ordinary TypeScript and is exactly
// what a null payload cannot survive.
//
// # What is *not* the question
//
// Whether node's contract for `isatty` is "false for anything": it is, checked
// against node's own source rather than inferred from the test. So the target
// behaviour is not in doubt, only the representation that reaches it.

/** Control: a scalar parameter, which crosses and answers. */
export function takesANumber(n: number): number {
  return n + 1;
}

/** Control: `unknown` crossing, which publishes. It throws for an object. */
export function takesUnknown(value: unknown): number {
  return typeof value === "number" ? value | 0 : -1;
}

/** Under test: a union that erases. No wrapper is written at all. */
export function takesAUnion(value: number | { at: number }): number {
  return typeof value === "number" ? value | 0 : -1;
}

/** Under test: the same at the return, which is `dns.promises`'s half. */
export function returnsAUnion(n: number): number | { at: number } {
  return n > 0 ? n : { at: n };
}
