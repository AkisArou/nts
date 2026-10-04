// Temporal timestamps require ~73 bits at the range endpoints. They are never
// converted through Number. NTS currently represents BigInt in 128 bits, which
// covers these values; arbitrary-size user inputs remain a compiler boundary.
export const NS_PER_MICROSECOND = 1000n;
export const NS_PER_MILLISECOND = 1000000n;
export const NS_PER_SECOND = 1000000000n;
export const NS_PER_MINUTE = 60000000000n;
export const NS_PER_HOUR = 3600000000000n;
export const NS_PER_DAY = 86400000000000n;
export const INSTANT_LIMIT = 8640000000000000000000n;
const TIME_DURATION_LIMIT = 9007199254740992n * NS_PER_SECOND;

export function unitNanoseconds(index: number): bigint {
  if (index === 3) return NS_PER_DAY;
  if (index === 4) return NS_PER_HOUR;
  if (index === 5) return NS_PER_MINUTE;
  if (index === 6) return NS_PER_SECOND;
  if (index === 7) return NS_PER_MILLISECOND;
  if (index === 8) return NS_PER_MICROSECOND;
  if (index === 9) return 1n;
  throw new RangeError("Calendar unit requires relative date");
}

export function checkTimeDuration(value: bigint): bigint {
  if (value <= -TIME_DURATION_LIMIT || value >= TIME_DURATION_LIMIT)
    throw new RangeError("Time duration outside supported range");
  return value;
}

// One rounding to binary64, even when the numerator exceeds Number's integer
// precision. The supported Temporal quotients fit in the 128-bit domain.
export function divideExact(nanoseconds: bigint, divisor: bigint): number {
  const negative = nanoseconds < 0n;
  const magnitude = negative ? -nanoseconds : nanoseconds;
  if (magnitude === 0n) return 0;
  if (magnitude <= 9007199254740991n && divisor <= 9007199254740991n)
    return Number(nanoseconds) / Number(divisor);
  let exponent = 0;
  if (magnitude >= divisor) {
    let scaled = divisor;
    while (scaled * 2n <= magnitude) {
      scaled *= 2n;
      exponent++;
    }
  } else {
    let scaled = magnitude;
    while (scaled < divisor) {
      scaled *= 2n;
      exponent--;
    }
  }
  const shift = 52 - exponent;
  const numerator = shift >= 0 ? magnitude << BigInt(shift) : magnitude;
  const denominator = shift >= 0 ? divisor : divisor << BigInt(-shift);
  let significand = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n > denominator || (remainder * 2n === denominator && significand % 2n !== 0n))
    significand++;
  const result = Number(significand) * 2 ** (exponent - 52);
  return negative ? -result : result;
}

export type RoundingMode = NonNullable<Temporal.RoundingOptions<Temporal.TimeUnit>["roundingMode"]>;

export function negateRoundingMode(mode: RoundingMode): RoundingMode {
  if (mode === "ceil") return "floor";
  if (mode === "floor") return "ceil";
  if (mode === "halfCeil") return "halfFloor";
  if (mode === "halfFloor") return "halfCeil";
  return mode;
}

export function floorDivide(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor;
  return value % divisor < 0n ? quotient - 1n : quotient;
}

export function epochMilliseconds(value: bigint): number {
  return Number(floorDivide(value, NS_PER_MILLISECOND));
}

export function checkInstant(value: bigint): bigint {
  if (value < -INSTANT_LIMIT || value > INSTANT_LIMIT)
    throw new RangeError("Instant outside supported range");
  return value;
}

export function roundNanoseconds(value: bigint, increment: bigint, mode: RoundingMode): bigint {
  if (increment <= 0n) throw new RangeError("Rounding increment must be positive");
  const quotient = value / increment;
  const remainder = value % increment;
  if (remainder === 0n) return value;
  const direction = remainder < 0n ? -1n : 1n;
  const magnitude = remainder < 0n ? -remainder : remainder;
  let away = false;
  if (mode === "expand") away = true;
  else if (mode === "ceil") away = direction > 0n;
  else if (mode === "floor") away = direction < 0n;
  else if (mode !== "trunc") {
    const twice = magnitude * 2n;
    away = twice > increment;
    if (twice === increment) {
      if (mode === "halfExpand") away = true;
      else if (mode === "halfCeil") away = direction > 0n;
      else if (mode === "halfFloor") away = direction < 0n;
      else if (mode === "halfEven") away = quotient % 2n !== 0n;
    }
  }
  return (quotient + (away ? direction : 0n)) * increment;
}
