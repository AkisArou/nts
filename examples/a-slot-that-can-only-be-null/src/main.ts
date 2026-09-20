// `{ attr: null }` and `c ? null : null` — a value whose type is `null` and
// nothing else.
//
// **`null` alone has no representation and `undefined` alone does.**
// `representation_of` maps `Void | Undefined` to `HirType::Void` and has no arm
// for `TypeKind::Null` at all, so each of these compiled in its `undefined`
// spelling and was refused in its `null` one:
//
//     { attr: undefined }        compiles     { attr: null }        refused
//     c ? undefined : undefined  compiles     c ? null : null       refused
//     false || undefined         compiles     false || null         refused
//
// Two answers for one shape, and one of them was not an answer. It is the same
// asymmetry that made `(null) !== null` refuse beside `(undefined) !== undefined`
// — `null` keeps being the spelling that falls through a test written for the
// other one.
//
// # Answered where a value needs a width, and nowhere else
//
// `Erased` is the one representation carrying a null tag, so it is what a slot
// that can only hold `null` takes. Asked at three places: an object's **field**,
// which needs a member or every offset after it lands where the layout does not
// say; a **merge's parameter**, where both arms of a picking operator have to
// arrive at one width; and an **array's element**, which `in_a_slot` already
// names as a slot and could never reach, because a type with no representation
// never got that far.
//
// **A tuple's position is a slot too and is deliberately left out.** Giving
// `[null, number]` a representation of its own means the literal `[null, 5]`
// builds *that* layout and then needs a pointer cast to the annotated tuple's —
// two anonymous structs that do not agree about where their shared fields are.
// `aNullableTupleStillWorks` below agreed with node before that change and
// refused after; it is the arm that caught it. An array has no such pair,
// because an array of one representation is one layout. The difference is not
// the slot — it is that a tuple literal has a layout of its own to prefer.
//
// Deliberately *not* answered in `representation_of` itself. `null` alone as a
// parameter or a result is a different question — nothing reads those back — and
// a representation there would change what a function returning `null` hands
// over, which is a far larger claim than a slot needing a width. The same line
// `in_a_slot` draws for `Void`.
//
// # One derivation for an operator that picks a side
//
// `a || b`, `a ?? b`, `a && b` and `c ? a : b` choose no type of their own: the
// result is one operand or the other. `contextual_type` had that written twice,
// once for the logical operators and once for the conditional, and the `null`
// step would have had to go in both. It is `what_the_whole_expression_is` now.
//
// 3 files of the slice-1 `test/language` population. The four neighbours that
// remain are `for…in` over a `Function("…")` result, which is a declared
// non-goal.

const nulled = { attr: null };
const both: { left: null; right: undefined } = { left: null, right: undefined };

/** A field whose type is `null`, which needs a member all the same. */
export function aFieldThatCanOnlyBeNull(n: number): number {
  return (nulled.attr === null ? 1 : 0) + n * 0;
}

/** And it is an own key, which is what `for…in` walks. */
export function itIsStillAKey(n: number): number {
  let count = 0;
  let seen = 0;
  for (const key in nulled) {
    count += 1;
    seen = key === "attr" ? 1 : 0;
  }
  return count * 10 + seen + n * 0;
}

/** The `undefined` spelling beside it, which always worked. */
export function bothSpellingsInOneObject(n: number): number {
  return (both.left === null ? 1 : 0) * 10 + (both.right === undefined ? 1 : 0) + n * 0;
}

/** A merge whose two arms are both `null`. */
export function aConditionalThatCanOnlyBeNull(n: number): number {
  const picked = n > 0 ? null : null;
  return (picked === null ? 1 : 0) + n * 0;
}

/** The same through `||`, which picks a side the same way. */
export function aLogicalOrThatCanOnlyBeNull(n: number): number {
  const falsy = n > 0 && n < 0;
  const picked = falsy || null;
  return (picked === null ? 1 : 0) + n * 0;
}

/** And through `&&`, whose left side decides. */
export function aLogicalAndThatCanOnlyBeNull(n: number): number {
  const truthy = n >= 0 || n < 0;
  const picked = truthy && null;
  return (picked === null ? 1 : 0) + n * 0;
}

/** An array whose elements can only be `null`. */
export function anArrayOfNothingButNull(n: number): number {
  const xs = [null, null];
  return xs.length * 10 + (xs[0] === null ? 1 : 0) + n * 0;
}

/** The `undefined` spelling beside it, which always worked. */
export function anArrayOfNothingButUndefined(n: number): number {
  const xs = [undefined, undefined];
  return xs.length * 10 + (xs[0] === undefined ? 1 : 0) + n * 0;
}

/**
 * The control a tuple position failed: an annotated nullable element.
 *
 * `[null, 5]` must take the annotation's layout rather than build one of its
 * own. This agreed with node, refused when the tuple position was given the same
 * answer as the array's, and agrees again.
 */
export function aNullableTupleStillWorks(n: number): number {
  const t: [string | null, number] = [null, 5];
  return (t[0] === null ? 1 : 0) * 10 + t[1] + n * 0;
}

/** The control for an array that is *not* all absences. */
export function aNullableArrayIsNotThis(n: number): number {
  const xs: (string | null)[] = ["ab", null];
  return (xs[0] === null ? 0 : xs[0].length) * 10 + (xs[1] === null ? 1 : 0) + n * 0;
}

/**
 * The control: a merge that is *not* only `null` keeps its own representation.
 *
 * `string | null` is a nullable pointer, not an erased tag. A fix that reached
 * every `null` rather than only a type that is exactly `null` would widen this
 * one and pay a tag for it.
 */
export function aNullableIsNotThis(n: number): number {
  const picked: string | null = n > 0 ? "ab" : null;
  return (picked === null ? 0 : picked.length) + n * 0;
}
