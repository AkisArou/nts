// `| 0` is how integer intent is written in JavaScript. It is a proof: whatever
// `x` was, the result is a whole number inside int32.
export function toInt(x: number): number {
  return x | 0;
}

// A mask bounds the result to [0, 1023] regardless of the input.
export function bucket(hash: number): number {
  return hash & 1023;
}

export function mix(a: number, b: number): number {
  return ((a ^ b) << 3) >>> 1;
}

export function isEven(n: number): boolean {
  return (n & 1) === 0;
}

// `(a + b) | 0` **wraps**, and C signed overflow does not.
//
// Specialization narrows an accumulator to `int32_t` wherever the values are
// whole, which is not the same as proving the sum fits. The emitted C then said
// `total = total + step;` on two `int32_t`s -- and signed overflow is undefined
// in C, so clang was free to assume it never happened.
//
// It happened. A walk long enough to pass INT32_MAX answered 3221225471 where
// node answers -1073741825: the same thirty-two bits read as unsigned, because
// the optimizer had been given a promise the program does not keep. Found by
// writing a benchmark, not by a test -- every example that exercised `| 0`
// stayed inside the range.
//
// The LLVM backend was always right here: its `add` carries no `nsw`, so it
// wraps by definition. This is a C-backend rule.
//
// These three do **not** hold that rule and cannot. Written to catch it, they
// agreed with node even with the fix reverted -- clang chose to wrap anyway at
// these shapes. A differential cannot pin a rule about undefined behaviour; it
// can only notice the days the optimizer took the other branch, which is the
// whole reason the defect survived. What holds it is a test that reads the
// emitted text: `integer_arithmetic_is_emitted_wrapping` in the C backend.
//
// They stay because they exercise int32 accumulation across a call and a loop,
// which is coverage worth having, and because a reader arriving at the bug from
// here should be told immediately that this is not where it is caught.

export function addWrapsAtInt32(n: number): number {
  let total = 2147483000;
  for (let i = 0; i < 8; i++) {
    total = (total + (n | 0)) | 0;
  }
  return total;
}

export function subtractWrapsAtInt32(n: number): number {
  let total = -2147483000;
  for (let i = 0; i < 8; i++) {
    total = (total - (n | 0)) | 0;
  }
  return total;
}

export function multiplyWrapsAtInt32(n: number): number {
  let product = (n | 0) + 3;
  for (let i = 0; i < 6; i++) {
    product = (product * 31) | 0;
  }
  return product;
}
