// The enum reverse-mapping forms this compiler refuses, which are the ones that
// do not name a value.

enum Colour {
  Red = 0,
  Green = 1,
  Blue = 2,
}

// A **computed** index. The obstacle is `undefined`, not the lookup: the table
// is one the compiler already holds and building a run-time one is easy, but
// `Colour[n]` for an `n` no member has answers `undefined` in JavaScript, while
// TypeScript — under this project's settings — types the whole expression
// `string`. So a lookup producing the declared type would be wrong exactly
// where the program is asking a question it cannot answer statically.
//
// Closing it needs the answer to carry absence, which is the `string |
// undefined` representation the optional-property work settled for *fields* and
// which nothing has settled for this.
export function atAComputedIndex(n: number): number {
  const name = Colour[n & 1];
  return name.length + (n & 1);
}

// A constant index **no member has**. The value is known and the answer is
// `undefined`, which this expression's type says is a `string`. Refused as
// itself rather than folded to the nearest member.
export function atAValueNoMemberHas(n: number): number {
  const name = Colour[7];
  return name.length + (n & 1);
}
