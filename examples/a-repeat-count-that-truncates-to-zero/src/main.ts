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

/** The driven arm: the harness's own pool covers the fractions that mattered. */
export function repeatLength(n: number): number {
  const got = attempt(n);
  return got === "threw" ? -1 : got.length;
}

/** `(-1, 0]` truncates to zero and is legal -- three spellings of it. */
export function justUnderZero(): number {
  return attempt(-0.5).length + attempt(-0.999).length + attempt(-0).length;
}

/** `<= -1` throws, and `-1` exactly is the boundary. */
export function atAndBelowMinusOne(): number {
  return (attempt(-1) === "threw" ? 1 : 0) + (attempt(-1.5) === "threw" ? 10 : 0);
}

/** `NaN` is `ToIntegerOrInfinity` 0, so it does not throw. */
export function notANumber(): number {
  return attempt(NaN) === "threw" ? -1 : attempt(NaN).length;
}

/** `-Infinity` is negative after truncation; `+Infinity` throws by the other half. */
export function infinities(): number {
  return (
    (attempt(-Infinity) === "threw" ? 1 : 0) + (attempt(Infinity) === "threw" ? 10 : 0)
  );
}

/** **Control.** An ordinary count still repeats. */
export function ordinary(n: number): number {
  return attempt(Math.abs(n) % 5).length;
}
