// `ToInt32` of a double: in line where it sits in a loop -- below 2^63 in
// magnitude a 64-bit truncation whose low 32 bits are the answer, the helper
// beyond -- and a call outside every loop. Each export converts the pool's
// numbers (NaN, both zeroes, the infinities, the int32 and uint32 edges) and
// their negations in a loop, carried across that boundary, so both paths and
// the edge between them answer as node does.

/** The pool's own numbers. */
export function wrapped(x: number): number {
  let total = 0;
  for (let k = 0; k < 2; k++) {
    const v = k === 0 ? x : -x;
    total = total * 3 + (v | 0);
  }
  return total;
}

/** Past the uint32 range by a little: the low bits survive the wrap. */
export function past32(x: number): number {
  let total = 0;
  for (let k = 0; k < 2; k++) {
    const v = k === 0 ? x : -x;
    total = total * 3 + ((v * 4294967296 + 5) | 0);
  }
  return total;
}

/** A product of two int32s, which `| 0` after a multiplication usually is. */
export function product(x: number): number {
  let total = 0;
  for (let k = 0; k < 2; k++) {
    const v = k === 0 ? x : -x;
    total = total * 3 + ((v * 2147483647) | 0);
  }
  return total;
}

/** The largest double below 2^63, then 2^63 itself: the two sides of the test. */
export function edge(x: number): number {
  let total = 0;
  for (let k = 0; k < 2; k++) {
    const v = k === 0 ? x : -x;
    total = total * 9 + ((v * 9223372036854774784) | 0) * 3 + ((v * 9223372036854775808) | 0);
  }
  return total;
}

/** Well past 2^63, where only the helper is exact. */
export function huge(x: number): number {
  let total = 0;
  for (let k = 0; k < 2; k++) {
    const v = k === 0 ? x : -x;
    total = total * 3 + ((v * 1e300) | 0) + ((v * 18446744073709551616 + v) | 0);
  }
  return total;
}

/** `>>> 0` takes the same conversion, read unsigned. */
export function unsigned(x: number): number {
  let total = 0;
  for (let k = 0; k < 2; k++) {
    const v = k === 0 ? x : -x;
    total = total * 3 + ((v * 4294967295.5) >>> 0);
  }
  return total;
}

/** A single-precision read, promoted before the conversion. */
export function single(x: number): number {
  const cell = new Float32Array(1);
  let total = 0;
  for (let k = 0; k < 2; k++) {
    cell[0] = (k === 0 ? x : -x) * 1e10;
    total = total * 3 + (cell[0] | 0);
  }
  return total;
}

/** Outside every loop: the conversion stays a call to the helper. */
export function outside(x: number): number {
  return (x * 2147483647) | 0;
}

function lowBits(v: number): number {
  return (v * 2147483647) | 0;
}

/** A callee's conversion, brought into the loop when the callee is inlined. */
export function viaCallee(x: number): number {
  let total = 0;
  for (let k = 0; k < 2; k++) total = total * 3 + lowBits(k === 0 ? x : -x);
  return total;
}
