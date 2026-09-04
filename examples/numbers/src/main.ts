// `Number`'s statics and the two global numeric predicates.
//
// Unlike most of `Math`, every one of these is *exactly* specified: there is
// one right answer for each input and the compiler has to produce it, so these
// are compared against node bit for bit with no tolerance at all.

// `isNaN` and `Number.isNaN` differ only in what they do to a value that is not
// a number -- the global coerces, the static does not -- and a `number` cannot
// be one. So over this type they are the same function, and both lower to
// `x != x` rather than to a call: it is free, and it folds to a constant
// `false` wherever the specializer has narrowed the value to an integer.
export function notANumber(x: number): number {
  return (isNaN(x) ? 1 : 0) + (Number.isNaN(x) ? 2 : 0);
}

export function finite(x: number): number {
  return (isFinite(x) ? 1 : 0) + (Number.isFinite(x) ? 2 : 0);
}

// Whole and finite. Infinity has no fractional part and is still not an
// integer, which is the case a `floor(x) === x` test written by hand gets
// wrong.
export function whole(x: number): number {
  return Number.isInteger(x) ? 1 : 0;
}

// Whole, and small enough that the `double` stands for itself: above 2^53 - 1
// the spacing between representable values exceeds 1, so an integer there is
// one of several the same bits could mean.
// `x + 1` is here because the boundary is the whole question and the pool stops
// one short of it: it holds 2^53 - 1 but not 2^53, so an `isSafeInteger` that
// accepted one too many agreed on every case. Adding one to the pool's largest
// lands exactly on 2^53, which is representable and is not safe.
export function safe(x: number): number {
  return (Number.isSafeInteger(x) ? 1 : 0) + (Number.isSafeInteger(x + 1) ? 2 : 0);
}

// The predicates applied to a value that *overflowed*, which is how an infinity
// arrives in a program that never writes one. Without this the driver's pool
// never feeds an infinity, so `isFinite` is only ever asked about finite values
// -- and the case it exists for goes untested. The same gap hid `Math.pow`'s
// infinite-exponent rule, and it was found by deleting the rule and watching
// nothing fail.
export function overflowed(x: number): number {
  const huge = x * 1e308;
  return (
    (isFinite(huge) ? 1 : 0) +
    (Number.isInteger(huge) ? 2 : 0) +
    (Number.isSafeInteger(huge) ? 4 : 0)
  );
}

// The named constants. `MIN_VALUE` is the smallest *subnormal*, 2^-1074 --
// four orders of magnitude in the exponent below the smallest normal, which is
// what a `DBL_MIN` spelling would have given.
export function bounds(x: number): number {
  return (
    (x > Number.MAX_SAFE_INTEGER ? 1 : 0) +
    (x < Number.MIN_SAFE_INTEGER ? 2 : 0) +
    (x === Number.MAX_VALUE ? 4 : 0) +
    (x === Number.MIN_VALUE ? 8 : 0)
  );
}

// Each constant scaled to where it can be seen. Summing them raw would lose
// every small one in `MAX_VALUE`, and comparing against them -- `x ===
// Number.MIN_VALUE` -- would pass for any wrong value too, since no pool value
// equals either. Scaling makes a wrong constant a wrong answer: `MIN_VALUE`
// spelled as the smallest *normal* rather than the smallest subnormal lands
// here as 2.2 instead of 4.9e-16.
export function scaled(x: number): number {
  const big = Number.MAX_VALUE / 1e308;
  const small = Number.MIN_VALUE * 1e308;
  const eps = Number.EPSILON * 1e16;
  const safe = Number.MAX_SAFE_INTEGER / 1e15 + Number.MIN_SAFE_INTEGER / 1e16;
  return x + big + small + eps + safe;
}

export function infinities(x: number): number {
  if (x > 0) {
    return Number.POSITIVE_INFINITY;
  }
  if (x < 0) {
    return Number.NEGATIVE_INFINITY;
  }
  return Number.NaN;
}

// `Number(x)` is the identity on a number and `ToNumber` on a boolean, which
// the specification gives as 1 and 0. On a string it is a parse, and that is
// refused rather than approximated.
export function coerce(x: number): number {
  return Number(x) + Number(x > 0) * 100;
}
