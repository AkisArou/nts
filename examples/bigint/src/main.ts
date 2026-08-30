// `bigint`, as an exact 128-bit integer.
//
// # The boundary, stated
//
// A `bigint` is arbitrary precision in the specification and 128 bits here.
// That is a real difference, so it is drawn where it can be seen: a literal too
// large is refused at the place it is written, with its own digits in the
// message.
//
// The trade was measured. Every `bigint` in the node profile is a 64-bit
// quantity — `readBigUInt64BE`, an hrtime timestamp, `0xffffffffffffffffn` —
// and the comment above the first says why: "`bigint` rather than `number`,
// because a `double` holds only 53 bits". A true bignum puts a heap allocation
// in each of those, which is the opposite of what they are reaching for.
//
// # Why it is its own type
//
// It was `Int { bits: 128 }` for an afternoon and the differential took it
// apart. A `bigint` is not a number that happens to be integral: `1n << 40n` is
// 2^40 where `1 << 40` is 256, because a *number*'s shift masks its count to
// five bits and truncates its operands to int32. Constant folding, `**` and the
// specializer all know the number rules and every one applied itself, silently
// and correctly by its own lights. A type of its own turns each of those into a
// compile error at the match that has to decide.

export function literals(n: number): number {
  const dec = 123n;
  const hex = 0xffn;
  const oct = 0o17n;
  const bin = 0b1011n;
  return Number(dec + hex + oct + bin) + n * 0;
}

// The value that motivated the width: 2^64 - 1, which is not an `i64` and not a
// `double` either.
export function sixtyFourBits(n: number): number {
  const max: bigint = 0xffffffffffffffffn;
  const half: bigint = 2n ** 63n;
  return (max > half ? 1 : 0) + (max - half === half - 1n ? 10 : 0) + n * 0;
}

export function arithmetic(n: number): number {
  const a: bigint = 1000000007n;
  const b: bigint = 97n;
  return (a + b === 1000000104n ? 1 : 0) +
    (a - b === 999999910n ? 10 : 0) +
    (a * b === 97000000679n ? 100 : 0) +
    n * 0;
}

// Truncating division, which is what `bigint` does and what C does — including
// for a negative dividend, where the two could easily have disagreed.
export function division(n: number): number {
  const a: bigint = 1000000007n;
  const b: bigint = 97n;
  return (a / b === 10309278n ? 1 : 0) +
    (a % b === 41n ? 10 : 0) +
    (-a / b === -10309278n ? 100 : 0) +
    (-a % b === -41n ? 1000 : 0) +
    n * 0;
}

export function exponent(n: number): number {
  return (3n ** 5n === 243n ? 1 : 0) +
    (7n ** 11n === 1977326743n ? 10 : 0) +
    (2n ** 0n === 1n ? 100 : 0) +
    n * 0;
}

// The case that was wrong before `bigint` had its own type: no masking of the
// shift count, no truncation of the operands.
export function shifting(n: number): number {
  let x = 1n;
  x <<= 40n;
  x |= 0xffn;
  return (x === (1n << 40n) + 255n ? 1 : 0) +
    ((x >> 8n) === 1n << 32n ? 10 : 0) +
    ((1n << 100n) > (1n << 99n) ? 100 : 0) +
    n * 0;
}

export function bitwise(n: number): number {
  const a: bigint = 0b1011n;
  const b: bigint = 0b0110n;
  return Number(a & b) + Number(a | b) * 10 + Number(a ^ b) * 100 + n * 0;
}

export function negatives(n: number): number {
  const a = -(2n ** 63n);
  return (a < 0n ? 1 : 0) +
    (a + 2n ** 63n === 0n ? 10 : 0) +
    (-a === 2n ** 63n ? 100 : 0) +
    n * 0;
}

// `Number(aBigInt)` rounds to the nearest double, which is lossy above 2^53 in
// node and here alike — deliberately, because that is what asking for a
// `number` means.
export function toNumber(n: number): number {
  const small = 0xffn;
  const big = 2n ** 60n + 1n;
  return Number(small) + (Number(big) === 2 ** 60 ? 1000 : 0) + n * 0;
}

// Carried through a call and a local, so it is a machine value rather than a
// folded constant.
function twice(x: bigint): bigint {
  return x * 2n;
}

export function acrossACall(n: number): number {
  const seed = 2n ** 40n;
  return (twice(seed) === 2n ** 41n ? 1 : 0) + n * 0;
}

export function comparisons(n: number): number {
  const a: bigint = 5n;
  const b: bigint = 7n;
  return (a < b ? 1 : 0) + (a <= b ? 10 : 0) + (b > a ? 100 : 0) +
    (a === 5n ? 1000 : 0) + (a !== b ? 10000 : 0) + n * 0;
}

// The bitwise operators on a bigint, through parameters so nothing folds.
//
// Every one of these was emitted wrongly at first, and the C compiled without
// a word of complaint: both operands were narrowed to `int32_t`, the result was
// returned through a `double`, and the two shifts crashed the emitter outright.
// A 128-bit `&` narrowed to 32 bits still answers correctly for small inputs,
// which is why the constants below are wider than an int32.
function bitAnd(a: bigint, b: bigint): bigint {
  return a & b;
}

function bitOr(a: bigint, b: bigint): bigint {
  return a | b;
}

function bitXor(a: bigint, b: bigint): bigint {
  return a ^ b;
}

export function wideBitwise(n: number): number {
  const mask = 0xffffffffffn; // forty bits: an int32 cannot hold it
  const low = 0xffn;
  return (
    Number(bitAnd(mask, low)) +
    Number(bitOr(0x100000000n, 1n) === 0x100000001n ? 1000 : 0) +
    Number(bitXor(0xf00000000n, 0xf00000000n) === 0n ? 10000 : 0) +
    n * 0
  );
}

// Shifting, where JavaScript's rules and C's undefined behaviour differ: a
// negative count shifts the other way, and a count past the width saturates
// rather than doing whatever the hardware happens to do.
function shl(a: bigint, b: bigint): bigint {
  return a << b;
}

function shr(a: bigint, b: bigint): bigint {
  return a >> b;
}

export function shiftsByAValue(n: number): number {
  return (
    (shl(1n, 40n) === 1099511627776n ? 1 : 0) +
    (shl(1n, -1n) === 0n ? 10 : 0) +
    (shr(4n, -1n) === 8n ? 100 : 0) +
    (shr(-8n, 1n) === -4n ? 1000 : 0) +
    (shr(-1n, 300n) === -1n ? 10000 : 0) +
    (shr(5n, 300n) === 0n ? 100000 : 0) +
    n * 0
  );
}
