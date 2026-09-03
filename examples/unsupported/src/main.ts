// Typechecks fine; the HIR lowering does not handle it yet. It must be REFUSED,
// not silently skipped: a lowering that emits nothing for a statement it did not
// understand produces a program that runs and is wrong.
//
// Keep this file to constructs the lowering genuinely does not accept. When one
// of them lands, move it out rather than deleting the fixture. `while` went
// this way, then `for`, then the ternary, then `switch` and `do`, and then a
// labelled `break` -- each time, the fixture starting to work was what the
// failing test was telling us.

export function supported(a: number, b: number): number {
  return a + b;
}

export function hasForIn(xs: number[]): number {
  let count = 0;
  for (const _key in xs) {
    count += 1;
  }
  return count;
}

// A default is filled in at the call, which is where JavaScript evaluates it.
// This one reads `a`, which at the call site is the caller's argument
// expression rather than the callee's binding -- so filling it would evaluate
// `a` twice, and twice is a different program whenever it has an effect.
export function hasADefaultReadingAParameter(a: number, b: number = a * 2): number {
  return a + b;
}

// Declares a field and assigns it, which is a class feature wearing a
// parameter's syntax. Counted as a default until the two were told apart.
export class HasAParameterProperty {
  constructor(private readonly seed: number) {}
}

// `Error` here is a message and a name (`hir::builtin`). `stack` is a record of
// frames a compiled binary does not keep and `toString` is a method no class in
// the hierarchy declares -- both refuse, and each says which it is rather than
// "a property the type does not declare".
class Coded extends Error {}

export function readsAStack(): number {
  return new Coded("x").stack!.length;
}

export function callsErrorToString(): number {
  return new Coded("x").toString().length;
}

// A typed array here is an array of a known width, not a view onto storage
// something else can also see -- so it has a `length` and nothing else, and the
// runtime's array helpers are compiled for `double` and must not be handed one.
export function readsATypedArrayBuffer(): number {
  return new Uint8Array(4).buffer.byteLength;
}

export function callsAMethodOnATypedArray(): number {
  return new Uint8Array(4).indexOf(7);
}
