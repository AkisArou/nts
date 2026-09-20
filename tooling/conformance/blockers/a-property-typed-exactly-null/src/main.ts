// expect: NTS1001 `null` or `undefined` where what it stands in for is not a reference
//
// **The property is fixed; the comparison is not.** A property whose type is
// exactly `null` lowered from 2026-09-20 -- `fields_of` gives it an `Erased`
// slot and `declared_field_type` hands the literal the same answer -- and what
// still refuses is `o.value === undefined` where the declared type is
// `null | undefined`.
//
// # Why `undefined` was answered and `null` was not
//
// `representation_of` maps `Void | Undefined` to `HirType::Void` and has no arm
// for `TypeKind::Null`. Each name has a second job and only one forced an
// answer: `undefined` doubles as the result of a function returning nothing, so
// returns demanded it; `null` doubles as nothing, so no position did.
//
// # It was a root, and its count understated it
//
// `refusal-census.mjs --top=204` read it at **9 things, 11 sites, 9 modules**.
// What sat behind it did not appear under it: an arm of a discriminated union
// carrying `value: null` has no layout, so reading the *discriminant* -- which
// every arm has -- refused too. That is `util/src/deep-equal.ts`'s
// `loosePrimitiveProbe`, and its `value: null` half is now answered.
//
// # Two repairs reverted, and what separates them from the one that landed
//
// **1. `TypeKind::Null => HirType::Erased` in `representation_of`** (2026-09-13).
// Three characters, agreed with node on every example, red on narrowing: after
// `b.f = null` the checker narrows a `string | null` *field read* to `null`, and
// a blanket answer sends the conversion down the tagged path while the storage
// is still a pointer.
//
// **2. Letting the comparison fall back to erased** (2026-09-20). The gate here
// is `type_of(value) == Erased`, and a field declared `null | undefined` has no
// type of its own while its slot is plainly erased -- so reading the *checker's*
// type and asking whether every member is an absence looks like the same
// question. It is not: **`void` is an absence too**, and an optional call's
// result is `void` with no width rather than an erased tag. Four examples went
// from agreeing with node to disagreeing --
// `an-optional-call-that-returns-void`, `an-optional-method-called-optionally`,
// `void-and-comma`, `an-absence-in-parentheses` -- which the gate caught and a
// probe of this shape alone would not have.
//
// What landed answers only where a value needs a **width** and narrowing cannot
// reach: a declared field's type, and a merge's parameter.
// `examples/a-slot-that-can-only-be-null` holds both, with the narrowing
// reduction as a control.
//
// # What this needs
//
// The comparison has to ask what the *slot* holds rather than what the node's
// type is, and to tell a slot-backed erased value from a widthless `void`. The
// first is what `declared_field_type` now does for the literal; the second is
// the part neither has.
//
// # The control that was false
//
// This file offered `value?: null` as "optional, which routes through `Erased`
// and compiles", the pair that made the required form surprising. It does not
// compile, and did not on 23666c14 either -- it was never reached, because the
// required form refused first. A fixture's prose is not executed, so a sentence
// behind a refusal is never tested. It is the one under test now.

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
