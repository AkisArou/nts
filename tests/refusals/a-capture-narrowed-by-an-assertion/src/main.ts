// expect: NTS1001 `callback`, a `an anonymous type` captured by a closure that reads it as a `an anonymous type`

// A parameter narrowed by an **assertion signature**, then captured by a
// closure. The value stored in the closure's field has the narrowed type and
// the body reads the declared one, so `stored_capture` refuses rather than
// writing a pointer between two unrelated function types.
//
// # This is the head of the export queue
//
// `docs/conformance/nodejs.md` measures the missing wrappers by cascade
// depth: 143 of the 181 blocked exports are one refusal away, and the single
// largest head is `fs`'s `asRequest`, which sixteen exports call.
// `asRequest` is this shape exactly --
//
//     export function asRequest<Arguments extends unknown[]>(
//       callback: ((...args: Arguments) => void) | undefined, …
//     ): (...args: Arguments) => void {
//       validateFunction(callback, callbackName);      // asserts value is …
//       …
//       return (...args: Arguments) => { … callback(...args) … };
//     }
//
// -- where `validateFunction`'s second overload is `asserts value is
// (...args: unknown[]) => unknown`. So `callback` is stored at the asserted
// type and read at the declared one, and the two are different anonymous
// function types.
//
// # The message names the wrong mechanism, and that is worth knowing
//
// It ends "a parameter this copy re-typed, in a closure the copy does not",
// which is the *structural* specialisation story: a copy taking a `Thing`
// where the declaration says `Named`, whose closures are varied by
// `closure_variants`. Nothing here is re-typed by a copy. The closure does
// have its copy's substitution as of 2026-09-22 -- a generic function's
// closures are lowered under it now, the same as a generic class's -- and
// the two types still differ, because what separates them is the
// **assertion**, not the instantiation.
//
// So the fix is not another variant. `captured_as` answers
// `type_of(capture.at)` and the stored value is whatever `bindings` holds,
// and those are two derivations of one fact: what this closure's field
// holds. One of them has to win and be recorded on the `ClosureInfo`, the
// way `retyped_captures` already records the structural answer, so that the
// body reads exactly what the construction site wrote.
//
// # The obvious fix was tried and produces a *decline*, 2026-09-23
//
// The guard above sits in front of a `coerce` that the `this` capture three
// lines earlier already uses -- "the type the body will read it at, not the
// type in hand" -- so the first thing to try is letting `coerce` answer here
// too. It must not answer for *classes*: the guard is deliberately stricter
// than `coerce` there, because a prefix-compatible cast between two class
// layouts passes on C and LLVM by luck and is declined by the JVM, which is
// why the guard was written. But neither of these is a class. Both are
// **signature** types, and a slot typed `(x: number) => void` is what every
// closure-typed field in the program already is: the object behind it is a
// closure whose own class carries the `call`.
//
// So: skip the guard when both sides are `TypeKind::Function`. The capture
// refusal goes, and this file then reports
//
//     NTS1001 a spread of an array whose elements are not the parameter's
//     NTS2006 an object type with no layout: type 24
//
// The second is a **decline** -- the C emitter failing rather than a
// construct being named -- and trading a refusal for one of those is the
// wrong direction however many sites it clears. Type 24 is another signature
// type, and materialising the *capture's* type at the coercion does not
// close it: the one with no layout is reached elsewhere, at the call that
// takes `instrument`'s result. So whatever lays signature layouts out is not
// reached on this path at all, and that is the thing to find before the
// guard is touched again.
//
// Reverted rather than landed. `write-the-library-type-by-hand` records the
// same trap from the other side: a refusal becoming a decline is worse, and
// it has to be bounded rather than assumed.
//
// # The link after it, for whoever gets there
//
// With the capture settled, the next refusal in this file is `a spread of an
// array whose elements are not the parameter's` at the forwarding call --
// `callback(...args)` where `args` is the rest tuple. That one is about
// spreading a fixed-arity tuple into a parameter list and is a separate
// question.

function assertCallable(
  value: unknown,
  name: string,
): asserts value is (...args: unknown[]) => unknown {
  if (typeof value !== "function") {
    throw new TypeError(name);
  }
}

function instrument<A extends unknown[]>(
  callback: ((...args: A) => void) | undefined,
): (...args: A) => void {
  assertCallable(callback, "callback");
  return (...args: A): void => {
    callback(...args);
  };
}

export function two(a: number, b: number): number {
  let total = 0;
  const add = instrument<[number, number]>((x: number, y: number): void => {
    total = x + y;
  });
  add(a, b);
  return total;
}
