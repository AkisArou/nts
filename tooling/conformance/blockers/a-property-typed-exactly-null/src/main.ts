// expect: NTS1001 `null` or `undefined` where what it stands in for is not a reference
//
// **The property itself is fixed; what refuses now is the control.** Kept
// because the analysis below was right and the control's claim was not.
//
// A property whose type is exactly `null` lowers as of 2026-09-20: `fields_of`
// gives it an `Erased` slot, which is the one representation carrying a null
// tag, and `declared_field_type` hands the literal the same answer so that the
// two do not disagree. That second half is the fix this file asked for in as
// many words —
//
//     "The contextual type at the literal should come from the layout the field
//      path already decided, rather than from the checker's type a second time.
//      The field path maps `Void | Never` to `Erased` and nothing tells the
//      literal; two derivations of one fact, disagreeing in the gap between
//      them."
//
// — and it is why the change is not the one reverted on 2026-09-13.
// `TypeKind::Null => HirType::Erased` in `representation_of` broke on narrowing:
// after `b.f = null` the checker narrows a `string | null` *field read* to
// `null`, and a blanket answer sends the conversion down the tagged path while
// the storage is still a pointer. A **declared** field's type and a merge's
// parameter are positions narrowing never reaches, and that reduction is a
// control in `examples/a-slot-that-can-only-be-null`.
//
// # The control was wrong, and clearing the refusal in front of it showed that
//
// This file said of `value?: null`: *"optional, which routes through `Erased`
// and compiles"*, and offered it as the pair that made the required form
// surprising. It does not compile, and it did not before: identical on the
// binary built at 23666c14. It was never reached, because the required form
// refused first — so the sentence was never tested, and a fixture's prose is not
// executed.
//
// What refuses is the **comparison**, not the field and not the literal.
// `o.value === undefined` where `value?: null` is `null | undefined`: both sides
// are absences and the read is an erased tag, so the test is between a tag and a
// constant. `erased_absence_test` is where that lives and this shape does not
// reach it. `{ v: null | undefined }` compared against `null` is the same thing
// written without the `?`.
//
// # It is a root, and its count understates it
//
// `refusal-census.mjs --top=204` read the original at **9 things, 11 sites, 9
// modules**. What sits behind it does not appear under it: an arm of a
// discriminated union carrying `value: null` has no layout, so reading the
// *discriminant* — which every arm has — refuses too. That is
// `util/src/deep-equal.ts`'s `loosePrimitiveProbe`, and the `value: null` half
// of it is what has just been answered.
//
// # Why `undefined` was answered and `null` was not
//
// `representation_of` has had an arm for `undefined` for as long as it has
// existed and has none for `null`. Each name has a *second* job and only one of
// them forced an answer: `undefined` doubles as the result of a function that
// returns nothing, so returns demanded it; `null` doubles as nothing, so no
// position did.

type Alternate = { kind: "alternate"; value: null };

/** Under test. */
export function nullField(n: number): number {
  const o: Alternate = { kind: "alternate", value: null };
  return o.value === null ? (n & 7) + 1 : 0;
}

/** Control: optional, which already routes through `Erased`. */
type Maybe = { kind: "maybe"; value?: null };
export function optionalNull(n: number): number {
  const o: Maybe = { kind: "maybe" };
  return o.value === undefined ? (n & 7) + 2 : 0;
}

/** Control: an ordinary payload. */
type Payload = { kind: "payload"; value: string };
export function ordinary(n: number): number {
  const o: Payload = { kind: "payload", value: "ab" };
  return o.value.length + (n & 7);
}

/** Control: an arm with no payload at all. */
type None = { kind: "none" };
export function noPayload(n: number): number {
  const o: None = { kind: "none" };
  return o.kind === "none" ? (n & 7) + 3 : 0;
}
