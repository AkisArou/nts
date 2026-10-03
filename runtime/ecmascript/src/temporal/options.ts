import type { RoundingMode } from "./exact.ts";

// The numeric precision belongs to the scalar formatter ABI. Public options
// name automatic precision explicitly rather than exposing its sentinel.
export const AUTO_PRECISION = -1;
export function fractionalSecondDigits(
  value: NonNullable<Temporal.InstantToStringOptions["fractionalSecondDigits"]> = "auto",
): number {
  if (value === "auto") return AUTO_PRECISION;
  if (!Number.isInteger(value) || value < 0 || value > 9)
    throw new RangeError("Invalid fractionalSecondDigits");
  return value;
}
export function roundingIncrement(value = 1): number {
  const increment = Math.trunc(value);
  if (!Number.isFinite(increment) || increment < 1 || increment > 1e9)
    throw new RangeError("Invalid rounding increment");
  return increment;
}
export function roundingMode(value: RoundingMode = "trunc"): RoundingMode {
  if (
    value === "ceil" ||
    value === "floor" ||
    value === "expand" ||
    value === "trunc" ||
    value === "halfCeil" ||
    value === "halfFloor" ||
    value === "halfExpand" ||
    value === "halfTrunc" ||
    value === "halfEven"
  )
    return value;
  throw new RangeError("Invalid rounding mode");
}
export function validateIncrement(unit: number, increment: number): void {
  if (unit === 3) return;
  const maximum = unit === 4 ? 24 : unit <= 6 ? 60 : 1000;
  if (increment >= maximum || maximum % increment !== 0)
    throw new RangeError("Invalid rounding increment for unit");
}
