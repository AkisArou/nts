// `n | 0` keeps the bound a guard proved for `n`.
//
// `ToInt32` truncates toward zero and wraps modulo 2^32, so in general its
// result is anywhere in int32. But a finite number that truncates into int32
// is not wrapped at all: there the coercion is truncation, and the bound the
// guard proved survives it. Without that, `n | 0` under `0 <= n < 1000` was
// any int32, so `(n | 0) * 2` could pass 2^31 and was computed in 64 bits and
// returned as a double, where `Math.floor(n) * 2` kept its bound.
//
// The control, `pastInt32`, admits numbers that do wrap -- `3e9 | 0` is
// `-1294967296` -- so its coercion is any int32 and its doubling needs 64
// bits. `>>> 0` is the same with `[0, 2^32)` for its range.
//
// expect-ir: all: twiceTheIndex returns i32
// expect-ir: all: theIndexUnsigned returns i32
// expect-ir: all: orNaN returns i32
// expect-ir: all: pastInt32 returns i64

function twiceTheIndex(n: number): number {
  if (n >= 0 && n < 1000) {
    return (n | 0) * 2;
  }
  return -1;
}

function theIndexUnsigned(n: number): number {
  if (n >= 0 && n < 1000) {
    return (n >>> 0) + 1;
  }
  return -1;
}

/// A NaN passes `!(n < 0) && !(n >= 1000)`, and `NaN | 0` is `0`.
function orNaN(n: number): number {
  if (!(n < 0) && !(n >= 1000)) {
    return (n | 0) * 2;
  }
  return -1;
}

function pastInt32(n: number): number {
  if (n >= 0 && n < 4e9) {
    return (n | 0) * 2;
  }
  return -1;
}

// The facts are the inner functions'; an export keeps a double at its boundary.
export function twice(n: number): number {
  return twiceTheIndex(n);
}

export function unsigned(n: number): number {
  return theIndexUnsigned(n);
}

export function nanAdmitted(n: number): number {
  return orNaN(n);
}

export function wrapped(n: number): number {
  return pastInt32(n);
}
