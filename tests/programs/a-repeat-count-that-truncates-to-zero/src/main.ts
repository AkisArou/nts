// `String.prototype.repeat` is `ToIntegerOrInfinity(count)` and *then* a throw
// where that is negative or `+Infinity`. Truncation is toward zero, so a count in
// `(-1, 0]` becomes `0` and is legal: `"ab".repeat(-0.5)` is `""` in node, and only
// `<= -1` throws.
//
// The guard tested the count `< 0` before truncating, so it threw a `RangeError`
// for every fractional count between -1 and 0. Found by the Windows lane, who hit
// it through an `async` function: the synchronous form hides it as a decline, and a
// rejected promise is a difference the differential can see.
//
// The arms are the boundaries rather than a sample, because the whole change is one
// comparison and each boundary is what distinguishes `<= -1` from `< 0`.

function attempt(n: number): string {
  try {
    return "ab".repeat(n);
  } catch {
    return "threw";
  }
}

// **Every count here is written, none comes from the harness's pool**, and that is
// deliberate rather than tidy. An arm driven at the pool's own values reaches a count
// like `1e30`, where node throws a catchable `RangeError` ("Invalid string length")
// and this runtime **aborts** (`nts_str_repeat` refuses a result longer than 2^32-1).
// An abort is a *declined* case, so such an arm makes this example one of the
// "compared only part of their cases" ten, and the gate's ceiling on those is a
// ceiling because the right direction is down. The too-long-string abort is a real gap
// and a separate one; it is not what this fixture is about.
//
// `n` is taken and multiplied by zero so each arm is still *driven* -- a function with
// no scalar argument is compared nothing at all.

/** `(-1, 0]` truncates to zero and is legal -- three spellings of it. */
export function justUnderZero(n: number): number {
  return attempt(-0.5).length + attempt(-0.999).length + attempt(-0).length + n * 0;
}

/** `<= -1` throws, and `-1` exactly is the boundary. */
export function atAndBelowMinusOne(n: number): number {
  return (
    (attempt(-1) === "threw" ? 1 : 0) + (attempt(-1.5) === "threw" ? 10 : 0) + n * 0
  );
}

/** `NaN` is `ToIntegerOrInfinity` 0, so it does not throw. */
export function notANumber(n: number): number {
  return (attempt(NaN) === "threw" ? -1 : attempt(NaN).length) + n * 0;
}

/** `-Infinity` is negative after truncation; `+Infinity` throws by the other half. */
export function infinities(n: number): number {
  return (
    (attempt(-Infinity) === "threw" ? 1 : 0) +
    (attempt(Infinity) === "threw" ? 10 : 0) +
    n * 0
  );
}

/** **Control.** An ordinary count still repeats, and a zero one is `""`. */
export function ordinary(n: number): number {
  return attempt(3).length + attempt(0).length + n * 0;
}
