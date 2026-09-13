// expect: a property `value` of unrepresentable type (null)
//
// A property whose type is exactly `null` — one value, carrying nothing.
//
// # It is a root, and its count understates it
//
// `refusal-census.mjs --top=204` reads this at **9 things, 11 sites, 9
// modules**. What sits behind it does not appear under it: an arm of a
// discriminated union carrying `value: null` has no layout, so reading the
// *discriminant* — which every arm has — refuses too.
//
//     a property typed exactly `null` has no representation
//       -> that arm of the union has no layout
//          -> `kind` on a union one of whose members has no layout
//
// That is `util/src/deep-equal.ts`'s `loosePrimitiveProbe`: four arms, two
// carrying `value: null` and `value: undefined`, two carrying nothing, and the
// other three lower perfectly well.
//
// # Why `undefined` is answered and `null` is not
//
// `representation_of` has had an arm for `undefined` for as long as it has
// existed and has none for `null`. Each name has a *second* job, and only one
// of them forced an answer: `undefined` doubles as the return type of a
// function that returns nothing, so returns demanded it; `null` doubles as
// nothing, so no position did.
//
// # Two repairs attempted on 2026-09-13, both measured, both reverted
//
// **1. `TypeKind::Null => HirType::Erased` in `representation_of`.** Three
// characters. Every example agreed on all three backends, refusals fell by 15
// to 19 in each of four modules — and `tooling/sweep` went red:
//
//     error: passing 'NtsString *' to parameter of incompatible type 'NtsValue'
//       v26 = nts_value_tag(v18);           in field_s_null
//
// Reduced to twelve lines:
//
//     class Held { f: string | null; constructor(v: string | null) { this.f = v } }
//     const b = new Held(n > 0 ? "a" : null);
//     const before = String(b.f) + String(b.f === null);
//     b.f = null;
//     return before + "|" + String(b.f) + String(b.f === null);
//
// After `b.f = null` the checker **narrows** `b.f` to type `null`. A blanket
// `Erased` then sends the conversion down the tagged path while the storage is
// still a pointer. So `null`'s representation genuinely depends on what it is
// standing in for, and the missing arm is not an oversight — it is the absence
// of a single right answer.
//
// **2. Reading a `Void` contextual type as erased**, which fixes the twin case
// (`value: undefined`, and `return undefined` from a `void` function, both of
// which refuse today). Also three characters. Examples: 201 of 201 on all three
// backends. Addons: **12 of 24 regressed**, `refusing to emit code from invalid
// HIR`, `NotDominated` inside a generator resume.
//
// It does not introduce that. The refusal stood in front of a generator-resume
// path where a value crosses a `yield` without being placed in the frame, and
// removing it was the first thing ever to compile that path. The second
// load-bearing over-refusal found this week — the other was `for (var i = …)`.
//
// # What it actually needs
//
// The contextual type at the literal should come from the **layout** the field
// path already decided, rather than from the checker's type a second time. The
// field path maps `Void | Never` to `Erased` and nothing tells the literal; two
// derivations of one fact, disagreeing in the gap between them. That is the fix
// for both halves and it is not three characters.
//
// # Three controls
//
//     `value?: null`      optional, which routes through `Erased` and compiles
//     `value: string`     an ordinary payload
//     a no-payload arm    `{ kind: "none" }`, which always worked
//
// The first is the pair that makes this surprising: optionality already has the
// representation the required form is refused for.

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
