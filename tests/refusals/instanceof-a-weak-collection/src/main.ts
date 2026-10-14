// expect: nothing refused -- FIXED, kept as a guard
//
// `instanceof WeakMap` and `instanceof WeakSet` answer **false**, and that is an
// answer rather than a guess.
//
// A weak collection has no representation: `representation_within` gives `Map`
// and `Set` a `ManagedType` and gives these two none, no constructor can
// produce one, and the Node-API boundary lets four types inward of which none
// is a collection. So nothing a compiled program can hold is a `WeakMap`, and
// a constant `false` is the correct answer to a question that is answerable.
//
// **Guarded on the fact rather than asserting it.** The lowering asks whether
// `WeakMap` represents and folds only when it does not, so the day it gains a
// representation this falls back to the refusal it has today rather than
// becoming a wrong answer. That is the failure the JVM lane caught two hours
// ago on `Map` and `Set` -- one predicate answering true for the other, behind
// a green gate, with no example exercising it -- and it is not worth risking
// twice.
//
// Verified by running it, with arithmetic that cannot half-pass: a program
// answering `describe(map) * 100 + describe(set) * 10 + describe("x")` gives
// **340** exactly when the weak tests say false and the real ones say true. A
// `WeakMap` test answering true for a `Map` would give 140.
//
// **Every subject is in its own function, and that is the design.** This
// fixture exists because `internal/errors.ts`'s `staticObjectName` tests ten
// classes and the lowering reports **one refusal per function** -- so it named
// `DataView` for as long as `DataView` was refused, then named `WeakMap`, and
// nothing in the output ever said four had been cleared or that two remained.
// A single function testing all ten would conceal the next one the same way.
//
// The mirror of the aggregate that moves uniformly: a line that can only name
// one class at a time cannot see a fix generalising either. Both are a number
// that can report one thing reporting one thing.

export function mapControl(value: object): boolean {
  return value instanceof Map;
}

export function setControl(value: object): boolean {
  return value instanceof Set;
}

export function weakMapSubject(value: object): boolean {
  return value instanceof WeakMap;
}

export function weakSetSubject(value: object): boolean {
  return value instanceof WeakSet;
}

// `WeakRef` is not a collection and is here anyway, because it is the same
// case: unrepresentable, so uninhabited, so `false`. Raised by the JVM lane
// after this fixture was written -- `util/src/inspect.ts:870` asks it of a real
// value and `diagnostics_channel/src/main.ts:209` constructs one, so it is a
// live site rather than a completeness exercise.
//
// Named in the lowering beside the two collections rather than folded by a
// general rule. "Any unrepresentable type answers false" is true today and is a
// much larger claim than the evidence: it would quietly fold a class this
// compiler has simply not learned yet, where a refusal is the honest answer.
export function weakRefSubject(value: object): boolean {
  return value instanceof WeakRef;
}
