// `Object.is(a, b)` — SameValue, refused until 2026-09-12 as a global member
// with no definition here.
//
// # It is `===` with two corrections
//
// `===` says `NaN !== NaN` and `0 === -0`. SameValue says the opposite of both
// and agrees with `===` about everything else, which is why this is a
// comparison plus two tests rather than a comparison of its own. The
// specification's phrasing is the implementation:
//
//     if (x === y) return x !== 0 || 1/x === 1/y;
//     return x !== x && y !== y;
//
// `1/x === 1/y` tells the two zeroes apart without a sign test — `1/0` is
// `Infinity` and `1/-0` is `-Infinity` — and `x !== x` is true of `NaN` and
// nothing else. Both are ordinary arithmetic, so this needed no runtime helper
// and no new operation: it is the existing `Eq`, `Ne` and `Div` arranged the
// way the specification arranges them.
//
// # Only where both sides are numbers
//
// A string, a boolean and a reference have neither a `NaN` nor a signed zero,
// so SameValue *is* `===` for them. The extra tests are not merely redundant
// there: every arm of the branch is a value rather than an expression, so all of
// them are evaluated, and emitting the numeric dance for a string would be
// emitting `1 / "a"`.
//
// # What it does not cover
//
// `SameValueZero` — the one `includes` and a `Map` key use, which differs from
// this in treating the two zeroes as equal. It shares the `NaN` half and not the
// zero half, and the row for it is separate because the two are genuinely two.

/** Under test: the ordinary case, where SameValue and `===` agree. */
export function sameNumbers(n: number): number {
  const a = n & 7;
  return Object.is(a, a) ? 1 : 0;
}

export function differentNumbers(n: number): number {
  return Object.is(n & 7, (n & 7) + 1) ? 1 : 0;
}

/** Under test: the first correction — `===` says false, SameValue says true. */
export function nanIsNan(n: number): number {
  return Object.is(NaN, NaN) ? (n & 7) : 0;
}

export function nanVsNumber(n: number): number {
  return Object.is(NaN, n & 7) ? 1 : (n & 7);
}

/** Under test: the second — `===` says true, SameValue says false. */
export function zeroesDiffer(n: number): number {
  return Object.is(0, -0) ? 1 : (n & 7);
}

/** Both zeroes against themselves, so the correction is not a blanket "no". */
export function zeroIsZero(n: number): number {
  return Object.is(0, 0) ? (n & 7) : 1;
}

export function negZeroIsNegZero(n: number): number {
  return Object.is(-0, -0) ? (n & 7) : 1;
}

/**
 * Under test: the infinities, which `1/x` produces and which must still compare
 * as themselves. A zero test written as a sign check rather than as a
 * reciprocal would pass every case above and fail here.
 */
export function infinities(n: number): number {
  return (
    (Object.is(Infinity, Infinity) ? 1 : 0) +
    (Object.is(Infinity, -Infinity) ? 10 : 0) +
    (n & 3)
  );
}

/** Under test: a string, which takes the plain identity path. */
export function strings(n: number): number {
  return Object.is("a", "a") ? (n & 7) : 0;
}

export function stringsDiffer(n: number): number {
  return Object.is("a", "b") ? 1 : (n & 7);
}
