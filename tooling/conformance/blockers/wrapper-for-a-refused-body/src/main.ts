// expect: emit-c --napi -> lacks-addon nts_napi_describe
//
// FIXED, kept as a guard. A wrapper is not written for a body the backend
// refused.
//
// A refusal in `codegen/c` leaves the function's `Func` in the program, so
// every question the wrapper pass can ask answers yes: the signature crosses,
// it is not a class, it is published. It wrote a wrapper naming a symbol that
// does not exist.
//
// **And the failure that produced is worse than a build error.** The addon
// *links* -- lazy binding does not resolve a symbol until it is used -- so it
// loads, publishes the name, and dies on the first call with
//
//     node: symbol lookup error: …/x.node: undefined symbol: describe
//
// at whatever later moment somebody calls it. Not a JavaScript exception, not
// catchable, and nowhere near the compile that caused it.
//
// # How the pass can now tell
//
// It could not before: `Emitted` carried the diagnostics and not the *names*,
// so "did this body get emitted" had no answer. The C backend records the
// functions it dropped -- both paths, `emit_func` failing and a body that calls
// a binding whose return no C definition can spell -- and the wrapper pass
// declines those by name.
//
// # The two functions
//
// `describe` draws `NTS2006 an object type with no layout` from the backend:
// `value === undefined` on an `unknown` compares against a type nothing lays
// out. `passthrough` is the control and publishes, which is what says the
// decline is about *this* function rather than about `unknown` crossing at all.
//
// Controlled on the previous binary: it publishes `describe`, the addon loads,
// and calling it kills the process with an undefined symbol.

export function passthrough(value: unknown): unknown {
  return value;
}

export function describe(value: unknown): string {
  if (typeof value === "string") return "string:" + String(value.length);
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return "other";
}
