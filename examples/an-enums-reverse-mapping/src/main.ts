// `Colour[1]`, which is a numeric enum's **reverse mapping**.
//
// A numeric enum emits a table alongside its members mapping each value back to
// the member's name, so `Colour[1]` is `"Green"`. A *string* enum emits none —
// the specification says so, and it is why the lowering tests each member's
// folded value rather than the enum's declaration.
//
// # The constant index only, and `undefined` is the reason
//
// At a constant index this is a string the compiler already knows and folding
// it is exact. At a **computed** one it is not: `Colour[n]` for an `n` no member
// has answers `undefined` in JavaScript, and TypeScript types the expression
// `string` regardless — so a lookup answering the declared type would be wrong
// precisely where the program is asking the question. That half refuses by its
// own name, in `examples/enum-reverse-map-unsupported` beside the constant index
// that does lower.
//
// The `string` in that sentence is this project's settings rather than
// TypeScript's only answer: under `noUncheckedIndexedAccess` the checker types
// it `string | undefined` and the program has to test it. `tsconfig.fixtures`
// does not set that, so the declared type is `string` and the refusal is about
// what a value would have to carry.
//
// The same split as `Object.hasOwn` against `Object.keys`, and `Array.from`
// over an iterable against over an array-like: **the form that names its key is
// answerable and the form that computes one is a different feature.**
//
// # The numbering is TypeScript's, not the position
//
// A member with an initializer takes it; one without takes the previous value
// plus one, starting at zero. `enum E { A, B = 5, C }` is 0, 5, 6 — so the
// lowering carries a running total rather than reading an index. `withAGap`
// below is that program, and it is the arm that fails if the rule is "position".
//
// # Zero corpus demand, measured
//
// `runtime/node` declares **no enums at all** — 0 across every module, against a
// control that matches 2. So this closes a specification row and moves no axis,
// which is worth stating rather than discovering later.

enum Colour {
  Red = 0,
  Green = 1,
  Blue = 2,
}

/** Control: the forward direction, which always worked. */
export function forward(n: number): number {
  return Colour.Green + (n & 1);
}

/** Under test: the reverse map at a constant index. */
export function reverseAtAConstant(n: number): number {
  const name = Colour[1];
  return name.length * 10 + (n & 1);
}

/** Under test: every member, so a wrong table shows as a wrong length. */
export function everyMember(n: number): number {
  return Colour[0].length * 100 + Colour[1].length * 10 + Colour[2].length + (n & 0);
}

enum Gapped {
  A,
  B = 5,
  C,
}

/**
 * Under test: implicit numbering with a gap.
 *
 * `A` is 0, `B` is 5, `C` is **6** — not 2. This is the arm that fails if the
 * value is read as the member's position, and it is the only one that can tell
 * the two rules apart.
 */
export function withAGap(n: number): number {
  return Gapped[0].length * 100 + Gapped[5].length * 10 + Gapped[6].length + (n & 0);
}

enum Tag {
  Alpha = "a",
  Beta = "bb",
}

/** Control: a string enum has no reverse map, and its forward direction works. */
export function stringEnumForward(n: number): number {
  return Tag.Beta.length + (n & 1);
}
