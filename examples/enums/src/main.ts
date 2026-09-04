// `enum`, which is a set of named constants and nothing at run time.
//
// The checker has already done the arithmetic: it gives `Colour.Red` a
// *literal* type carrying the value, so a member access is an immediate and
// there is no object to look it up in. That is why this was refused as "used
// as a value rather than as a type" -- the enum is not being used as a value,
// the member is, and the member is a number the compiler knows.
//
// A `const enum` needs nothing extra. TypeScript's own erasure of one is
// exactly this substitution; a plain `enum` differs only in also emitting a
// reverse-mapping object, which nothing here reads.
//
// Node **cannot run this in strip-only mode**: an `enum` is not erasable, so
// the oracle answers `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` and refuses the
// program rather than disagreeing with it. The differential passes
// `--experimental-transform-types`, which is what `tsc` does. Without that,
// this feature is unverifiable rather than unimplemented.

enum Colour {
  Red = 1,
  Green = 2,
  Blue = 4,
}

// Implicit values count from zero, and a member after an explicit one counts
// on from it -- `Fourth` is 11, not 3.
enum Step {
  First,
  Second,
  Third,
  Fourth = 10,
  Fifth,
}

const enum Fast {
  On = 100,
  Off = 200,
}

// Negative and fractional members, because the pool is hostile and these are
// what a compiler that folded the arithmetic itself would get wrong.
enum Offset {
  Back = -5,
  None = 0,
  Half = 1,
}

export function explicitMembers(n: number): number {
  return Colour.Red + Colour.Green + Colour.Blue + n;
}

export function implicitMembers(n: number): number {
  return Step.First + Step.Second + Step.Third + Step.Fourth + Step.Fifth + n;
}

// A `const enum` is erased entirely by `tsc`, and the same substitution here.
export function constMembers(n: number): number {
  return Fast.On + Fast.Off + n;
}

export function negativeMembers(n: number): number {
  return Offset.Back + Offset.None + Offset.Half + n;
}

// The enum as a *type*: a union of its member literals, which is a number.
function pick(c: Colour): number {
  return c === Colour.Red ? 10 : 20;
}

export function throughAParameter(n: number): number {
  return pick(n > 2 ? Colour.Red : Colour.Green) + n * 0;
}

// Compared in a `switch`, where each case is a constant.
export function inASwitch(n: number): number {
  // Written so the checker cannot narrow away a case: all three are reachable,
  // which is what makes the `switch` test three constants rather than two.
  let c: Colour = Colour.Blue;
  if (n > 2) {
    c = Colour.Red;
  } else if (n < 0) {
    c = Colour.Green;
  }
  switch (c) {
    case Colour.Red:
      return 1;
    case Colour.Green:
      return 2;
    default:
      return 4;
  }
}

// Carried in a local and mutated, so the value is not folded at every use.
export function accumulated(n: number): number {
  let total = 0;
  for (let i = 0; i < 4; i++) {
    total = total + (i % 2 === 0 ? Colour.Red : Colour.Green);
  }
  return total + n;
}
