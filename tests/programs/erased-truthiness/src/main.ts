// `!x` on a value whose type is `unknown`.
//
// `ToBoolean` is a rule rather than a representation change: `""`, `0`, `NaN`,
// `null` and `undefined` are false and everything else is true. `&&`, `||` and
// every `if` already asked for it; `!` did not, and lowered a `bool` operation
// straight onto whatever the operand was.
//
// The passes below then made the types agree the only way they can, by
// inserting a conversion -- and on an erased value that is `(bool)v` over a
// sixteen-byte struct, which the C compiler refuses outright: `operand of type
// 'NtsValue' where arithmetic or pointer type is required`. Eight of those in
// `stream`, eight in `fs`, three each in `events` and `assert`, and it was the
// most common remaining error in the node profile once the layout-name
// collisions stopped hiding it behind clang's twenty-error limit.
//
// So this example is about the *answers*, not about the build: the C not
// compiling was the loud half, and a lane where the cast happens to be legal
// would have taken the low bits of a tagged union as a truth value.

// Every falsy value the language has, and one truthy one of each kind, reached
// through a binding the checker types `unknown`.
export function negate(pick: number): number {
  const at = ((pick | 0) % 8 + 8) % 8;
  let v: unknown;
  if (at === 0) v = 0;
  else if (at === 1) v = -0;
  else if (at === 2) v = "";
  else if (at === 3) v = null;
  else if (at === 4) v = undefined;
  else if (at === 5) v = "0";
  else if (at === 6) v = 1;
  else v = "x";
  return !v ? 1 : 0;
}

// `NaN` on its own, because it is the falsy number that is not zero and the
// one an implementation that tests `payload != 0` gets wrong.
export function negateNaN(n: number): number {
  const v: unknown = n * 0 / 0;
  return !v ? 1 : 0;
}

// Doubled, which must be the identity on the truthiness rather than on the
// value: `!!undefined` is `false` and not `undefined`.
export function twice(pick: number): number {
  const at = ((pick | 0) % 4 + 4) % 4;
  let v: unknown;
  if (at === 0) v = "";
  else if (at === 1) v = 0;
  else if (at === 2) v = "a";
  else v = undefined;
  return !!v ? 1 : 0;
}

// And on a value that is *not* erased, which must keep answering what it
// always did -- the rule is the same rule, and a number is not a bool.
export function negateNumber(n: number): number {
  return !n ? 1 : 0;
}

export function negateString(pick: number): number {
  const s = ((pick | 0) % 2 + 2) % 2 === 0 ? "" : "x";
  return !s ? 1 : 0;
}
