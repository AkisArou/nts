// JavaScript's shifts take their count modulo 32, and their left operand as
// 32 bits, whatever holds them.
//
// The LLVM backend emitted the bare instruction at the operand's width, and
// LLVM's shift by the width or more is poison: `x << 32` is `x` in node, and
// `4294967295 >>> -32` -- an i64 shift on LLVM, since the constant does not fit
// an i32 -- is 4294967295. Every count from -70 to 70 is tried, so no input
// choice can miss one. `inRange` is the control: counts 0 to 31 only, which the
// bare instruction already got right.
export function anyCount(seed: number): number {
  const x = (seed * 2654435761) | 0;
  let acc = 0;
  for (let n = -70; n <= 70; n++) {
    acc = (acc * 31 + ((x << n) ^ (x >> n) ^ (x >>> n))) | 0;
  }
  return acc;
}
export function wideAnyCount(seed: number): number {
  const big = 4294967295 - (seed & 7);
  let acc = 0;
  for (let n = -70; n <= 70; n++) {
    acc = (acc + (big >>> n)) % 1000000007;
  }
  return acc;
}
export function inRange(seed: number): number {
  const x = (seed * 2654435761) | 0;
  let acc = 0;
  for (let n = 0; n <= 31; n++) {
    acc = (acc * 31 + ((x << n) ^ (x >> n) ^ (x >>> n))) | 0;
  }
  return acc;
}
