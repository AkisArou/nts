// `??`, which asks a different question from `||`.
//
// `||` tests truthiness, so `0 || 1` is `1`. `??` tests *absence* — `null` or
// `undefined` — so `0 ?? 1` is `0`. Telling those apart is the whole reason the
// operator exists, and it is why this is its own lowering rather than a
// desugaring: a program that reaches for `??` is usually one where a falsy
// value is a legitimate answer.
//
// The test is a tag read on an erased value and an address comparison on a
// reference, which is the same absence `lower_absent` writes. The left operand
// is lowered once, before the branch, so it is evaluated once however the test
// goes — and the right operand is inside the branch, so it is not evaluated at
// all when the left is present.

export function erasedFallback(n: number): number {
  const limit: number | undefined = n > 2 ? n : undefined;
  return limit ?? -1;
}

// The case `||` gets wrong. Zero is present, so `??` keeps it.
export function zeroIsNotAbsent(n: number): number {
  const limit: number | undefined = n > 2 ? 0 : undefined;
  return limit ?? 7;
}

// An empty string is present too, and falsy.
export function emptyStringIsNotAbsent(n: number): number {
  const s: string | undefined = n > 2 ? "" : undefined;
  return (s ?? "xyz").length + n;
}

export function referenceFallback(n: number): number {
  const s: string | null = n > 2 ? "abcd" : null;
  return (s ?? "x").length + n;
}

// A left operand with no room for an absence: the right one is dead, and the
// specification says it is never evaluated rather than that it need not be.
export function neverAbsent(n: number): number {
  return n ?? 5;
}

export function chained(n: number): number {
  const a: number | undefined = n > 5 ? n : undefined;
  const b: number | undefined = n > 2 ? n * 2 : undefined;
  return a ?? b ?? -1;
}

// `||` over a union with an absence in it, which has to narrow on the arm it
// keeps: truthy excludes both absences, so the payload is readable there.
export function orNarrows(n: number): number {
  const limit: number | undefined = n > 2 ? n : undefined;
  const chosen: number = limit || 1;
  return chosen;
}
