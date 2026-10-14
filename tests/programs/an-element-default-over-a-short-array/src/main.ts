// `const [a = 9] = xs` where `xs` is shorter than the pattern.
//
// The default is the answer for exactly that case, and this compiler aborted
// the process before reaching it:
//
//     nts: refused: index 0 is outside [0, 0)
//
// The read was emitted first and the default applied to its result, so the
// read a default exists to avoid ran anyway. `defaulted_array_element` puts
// the read inside the arm where the index is in range, which is the same rule
// `a?.[i]` already follows: the thing the test guards against must not happen
// before the test.
//
// Six files in the test262 corpus are this shape, every one of them named
// `-init-exhausted`. The suite writes the case down separately because it is
// the one an implementation gets wrong, and it is the only member of the
// family that aborted rather than answering.
//
// # What stays refused, and why it is not this
//
// An element with **no** default, read past the end, is still a checked read
// that aborts. That is a different gap — the language says `undefined` there
// and this compiler has no `undefined` to hand back — and it is deliberate.
// `elementWithoutDefault` below would be that case, so it is *not* written
// here: an example whose arms disagree with node is not a fixture, it is a
// known failure, and this one has a row of its own.
//
// # What the control says, which is the point of the ceiling in the gate
//
// On the compiler before this fix, `nts check` over this file prints
//
//     17 case(s) the compiled program declined
//     checked 3 of 145 cases; the rest were not reached
//     agreed on every case
//
// It exits 0 and its last line says agreement. The abort is folded into
// *declined*, declined is folded into *skipped*, and a fixture that compared
// three cases out of a hundred and forty-five reads exactly like one that
// compared them all. That is the failure `backend_examples`' partial ceiling
// exists to catch, and it is why the number above the verdict is the one to
// read. After the fix all 145 are compared.
//
// # Why the arms take a number
//
// The differential drives exported functions from a hostile scalar pool, so a
// function taking `number[]` is never called and the example would compare
// nothing while printing `agreed on every case`. Each arm builds its own array
// from the scalar, which also puts the length behind a value the compiler
// cannot fold: `n > 0 ? [7] : []` has both lengths on the two paths.

/** Absent at 0 when `n <= 0`, present when it is not. */
export function first(n: number): number {
  const xs: number[] = n > 0 ? [7] : [];
  const [a = 9] = xs;
  return a;
}

/** Two elements, so the second is absent for a one-element array as well. */
export function second(n: number): number {
  const xs: number[] = n > 1 ? [7, 8] : n > 0 ? [7] : [];
  const [, b = 8] = xs;
  return b;
}

/** Both at once, summed, so an arm that takes the wrong branch changes it. */
export function both(n: number): number {
  const xs: number[] = n > 1 ? [7, 6] : n > 0 ? [7] : [];
  const [a = 9, b = 8] = xs;
  return a * 100 + b;
}

/** A default that is an expression rather than a literal, evaluated lazily. */
export function computed(n: number): number {
  const xs: number[] = n > 0 ? [7] : [];
  const [a = n * 2 + 1] = xs;
  return a;
}

/** The same shape as a parameter, which is where the corpus meets it. */
function takes([a = 9]: number[]): number {
  return a;
}

export function throughAParameter(n: number): number {
  return takes(n > 0 ? [7] : []);
}

// # An unannotated pattern is the common case, and it needs a second test
//
// `function f([a = 9])` with no annotation is inferred as
// `(number | undefined)[]`, which represents as an **erased** element. So the
// element can be present *and* `undefined` — `f([undefined])` is `9` in every
// engine, exactly as `f([])` is — and a rule that only tested the length would
// answer `undefined` where the default was written.
//
// test262 writes the two as separate files, `-init-exhausted` and
// `-init-undef`, which is how the second half was found: the first version of
// this fix cleared the exhausted family and left `-init-undef` refusing.
//
// The lowering is two branches and the second already existed. The first
// produces the element as an erased value, `undefined` when the array is too
// short — both arms erased, so there is nothing to reconcile. That value is then
// an ordinary read with a possible absence, which is what `defaulted_when` and
// `Branch::Present` were built for.

// The arrays are **built** rather than chosen by a conditional. `n > 0 ? [7] :
// [undefined]` merges a `number[]` with an `undefined[]`, which is a union of
// two array types and has no representation — the example refused two of these
// three arms that way before it compared anything, while still printing
// `agreed on every case` over the six it could reach.
//
// The parameter is **annotated** `(number | undefined)[]` rather than left bare.
// A bare `[a = 9]` is what the corpus writes and is the shape this was found on,
// but TypeScript infers it as the *tuple* `[(number | undefined)?]` — so a
// built array is not assignable to it, and the differential cannot drive a
// tuple. The annotation names the same representation the inference produces,
// an array whose element is erased, which is what the lowering branches on.

function untyped([a = 9]: (number | undefined)[]): number {
  return a;
}

/** Exhausted: no element at all. */
export function untypedExhausted(n: number): number {
  // Each literal gets its own annotated slot before the conditional chooses.
  // `n > 0 ? [7] : []` lowers the `[7]` as a `number[]` — the annotation on the
  // *result* does not reach inside a conditional's arms — and the merge then
  // refused as *an array of Erased where an array of Float is wanted*.
  const full: (number | undefined)[] = [7];
  const empty: (number | undefined)[] = [];
  return untyped(n > 0 ? full : empty);
}

/** Present and `undefined`: the element is there and the default still wins. */
export function untypedUndefined(n: number): number {
  const xs: (number | undefined)[] = [n > 0 ? 7 : undefined];
  return untyped(xs);
}

/** Present and defined, which must not take the default. */
export function untypedPresent(n: number): number {
  // Through a named slot, so the element's type is the union rather than
  // `number`: `[n > 0 ? 7 : 3]` is a `number[]` and would not be the erased
  // element this arm exists to exercise — it refused as *an array of Erased
  // where an array of Float is wanted*, which is the fixture telling you it was
  // about to test the wrong representation.
  const chosen: number | undefined = n > 0 ? 7 : 3;
  const xs: (number | undefined)[] = [chosen];
  return untyped(xs);
}
