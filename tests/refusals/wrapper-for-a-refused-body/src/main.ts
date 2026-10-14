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
// `describe` calls a binding returning `[string, number]`, and the C backend
// answers `NTS2010`: a heterogeneous tuple's layout is numbered per program, so
// no C definition can name the type the call expects. The *lowering* accepts the
// function, which is what makes it the right subject -- a body refused by the
// lowering never reaches `program.funcs` at all, and the wrapper pass would
// decline it for a different reason entirely.
//
// `passthrough` is the control and publishes.
//
// # Why this is the second body
//
// It was `describe` doing a chain of `typeof` narrowings, which drew `NTS2006 an
// object type with no layout` because the join of those branches was `{}` -- and
// `{}` had an object layout it could never have. That representation changed:
// `{}` is TypeScript's "every value except null and undefined", a number is
// assignable to it, and it erases now. So the old body compiles, and the fixture
// reported REGRESSED for a mechanism that had not moved.
//
// **A fixture can stop reproducing because the compiler improved somewhere
// else**, and the verdict for that reads identically to a real regression. The
// only thing that told them apart was reading why the old body was refused --
// which the header above recorded, and which is the entire reason it was worth
// writing down at the time.

export function passthrough(value: unknown): unknown {
  return value;
}

declare function nts_mixed_pair(): [string, number];

export function describe(value: unknown): string {
  const pair = nts_mixed_pair();
  return pair[0] + String(pair[1]) + String(value === undefined);
}
