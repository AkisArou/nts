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

export type RoundingMode = NonNullable<Temporal.RoundingOptions<Temporal.TimeUnit>["roundingMode"]>;

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
