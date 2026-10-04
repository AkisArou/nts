// Formatting fractions are exact decimal values. The validated duration domain
// needs fewer than 128 bits even for a seconds+nanos aggregate.
export function fractionalDurationValue(fields: Float64Array, first: number): bigint {
  const parent = first - 1;
  let value = BigInt(fields[parent]!);
  for (let index = first; index < 10; index++) value = value * 1000n + BigInt(fields[index]!);
  return value;
}

export function durationDecimal(value: bigint, digits: number): string {
  const negative = value < 0n;
  const text = String(negative ? -value : value);
  if (digits === 0) return (negative ? "-" : "") + text;
  const padded = "0".repeat(Math.max(0, digits + 1 - text.length)) + text;
  const point = padded.length - digits;
  return (negative ? "-" : "") + padded.slice(0, point) + "." + padded.slice(point);
}
