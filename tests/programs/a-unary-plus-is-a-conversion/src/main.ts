// `+x` is `ToNumber(x)`, the same operation `Number(x)` is.
//
// It used to be *dropped*. That is correct on something already typed `number`,
// where it is the identity including on `-0` — which is why it was written that
// way, and the reasoning holds for exactly one type. On everything else the
// operand came through untouched: `+s` on a string produced the string, and the
// C backend then emitted `(double)v1` on a pointer.
//
// **A conversion that is the identity for one type is not the identity.** The
// arms below are the same arms `Number()` has, because they are now the same
// function; written separately they were present in one spelling and missing in
// the other, and nothing compared the two.
//
// One place the spellings genuinely differ: `Number(1n)` is 1 and `+1n` is a
// `TypeError`. TypeScript rejects the second as TS2736 before this compiler
// sees it, so there is no arm here for it and no arm is needed.

const STRINGS: string[] = ["42", "-42", "0.1", ".5", "5.", "", "  ", "1abc", "0x10", "1e3", "-0"];

// The pool the harness draws from holds negatives, fractions, NaN and both
// infinities, and every one of them makes `n % length` something that is not an
// index. That is a case the compiled program *declines* rather than a
// disagreement with node, so it says nothing about the conversion under test --
// the index is made total here so that all 203 cases are about `+`.
function pick(n: number): string {
  const at = n < 0 ? -n : n;
  const bounded = at >= 0 && at < 1e9 ? at : 0;
  return STRINGS[(bounded | 0) % STRINGS.length] as string;
}

// A string, which is a parse rather than a conversion. `Number("1abc")` is NaN
// where `parseFloat("1abc")` is 1, and there is no prefix parse here.
export function plusOnAString(n: number): number {
  return +pick(n);
}

// And the other spelling of the same thing, so a divergence between them is a
// failing case rather than an unasked question.
export function numberOfTheSameString(n: number): number {
  return Number(pick(n));
}

// A boolean, which the specification gives as 1 and 0.
export function plusOnABoolean(n: number): number {
  return +(n > 3);
}

export function numberOfTheSameBoolean(n: number): number {
  return Number(n > 3);
}

// A number, where it *is* the identity — including on `-0`, which is the case
// the original treatment was written for and the one it got right.
export function plusOnANumber(n: number): number {
  const v = n === 0 ? -0 : n;
  return +v;
}

// `-0` survives, and `Object.is` is what can tell. `1 / -0` is -Infinity where
// `1 / 0` is Infinity, so the answer is observable without it too.
export function signOfZeroSurvives(n: number): number {
  const v = n === 0 ? -0 : n;
  return 1 / +v;
}

// An erased value whose type admits no object: the tag decides, and the string
// arm is reached through the same runtime entry rather than a second copy of
// the grammar.
export function plusOnAUnionOfPrimitives(n: number): number {
  const v: string | boolean = n > 3 ? "17" : n > 1;
  return +v;
}
