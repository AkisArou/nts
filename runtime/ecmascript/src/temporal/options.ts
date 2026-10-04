import type { RoundingMode } from "./exact.ts";

// The numeric precision belongs to the scalar formatter ABI. Public options
// name automatic precision explicitly rather than exposing its sentinel.
export const AUTO_PRECISION = -1;

// Month codes and offsets require a string primitive, rather than accepting
// String's conversion of numbers or booleans. Ordinary object conversions use
// the string hint and reject a non-string primitive immediately.
export function requiredString(value: string | object): string {
  if (value !== null && (typeof value === "object" || typeof value === "function")) {
    const first = value.toString();
    if (typeof first === "string") return first;
    if (first === null || (typeof first !== "object" && typeof first !== "function"))
      throw new TypeError("Temporal field requires a string primitive");
    const second = value.valueOf();
    if (typeof second === "string") return second;
    throw new TypeError("Temporal field requires a string primitive");
  }
  if (typeof value !== "string") throw new TypeError("Temporal field requires a string");
  return value;
}

// Read and convert a unit before validating its permitted group. Temporal's
// ordered options read can precede a later algorithmic rejection of that unit.
export function temporalUnit(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "symbol") throw new TypeError("Temporal string options reject Symbols");
  const text = String(value);
  const unit = text.endsWith("s") ? text.slice(0, -1) : text;
  if (
    unit === "year" ||
    unit === "month" ||
    unit === "week" ||
    unit === "day" ||
    unit === "hour" ||
    unit === "minute" ||
    unit === "second" ||
    unit === "millisecond" ||
    unit === "microsecond" ||
    unit === "nanosecond"
  )
    return unit;
  throw new RangeError("Invalid Temporal unit");
}

// -2 is minute precision; -1 is automatic fractional precision; 0..9 are
// decimal digits. A scalar keeps the common seconds-string precision record
// out of formatting allocations.
export function secondsStringPrecision(smallestUnit: string | undefined, digits: number): number {
  smallestUnit = temporalUnit(smallestUnit);
  if (smallestUnit === undefined) return digits;
  if (smallestUnit === "minute") return -2;
  if (smallestUnit === "second") return 0;
  if (smallestUnit === "millisecond") return 3;
  if (smallestUnit === "microsecond") return 6;
  if (smallestUnit === "nanosecond") return 9;
  throw new RangeError("Invalid seconds-string unit");
}

export function integerWithTruncation(value: number): number {
  if (typeof value === "bigint" || typeof value === "symbol")
    throw new TypeError("Temporal numeric fields reject BigInts and Symbols");
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RangeError("Temporal numeric fields must be finite");
  return Math.trunc(number) || 0;
}

export function overflowOption(
  options?: Readonly<Temporal.OverflowOptions>,
): NonNullable<Temporal.OverflowOptions["overflow"]> {
  if (options !== undefined) requireOptions(options);
  const value = options?.overflow;
  if (value === undefined) return "constrain";
  if (typeof value === "symbol") throw new TypeError("Temporal string options reject Symbols");
  const text = String(value);
  if (text === "constrain" || text === "reject") return text;
  throw new RangeError("Invalid Temporal overflow option");
}

export function requireOptions(options: object): void {
  if (options === null || (typeof options !== "object" && typeof options !== "function"))
    throw new TypeError("Temporal options must be an object");
}

export function disambiguationOption(
  value: Temporal.DisambiguationOptions["disambiguation"],
): NonNullable<Temporal.DisambiguationOptions["disambiguation"]> {
  if (value === undefined) return "compatible";
  if (typeof value === "symbol") throw new TypeError("Temporal string options reject Symbols");
  const text = String(value);
  if (text === "compatible" || text === "earlier" || text === "later" || text === "reject")
    return text;
  throw new RangeError("Invalid Temporal disambiguation option");
}

export function offsetOption(
  value: Temporal.ZonedDateTimeFromOptions["offset"],
  fallback: NonNullable<Temporal.ZonedDateTimeFromOptions["offset"]>,
): NonNullable<Temporal.ZonedDateTimeFromOptions["offset"]> {
  if (value === undefined) return fallback;
  if (typeof value === "symbol") throw new TypeError("Temporal string options reject Symbols");
  const text = String(value);
  if (text === "use" || text === "ignore" || text === "prefer" || text === "reject") return text;
  throw new RangeError("Invalid Temporal offset option");
}
export function fractionalSecondDigits(
  value: NonNullable<Temporal.InstantToStringOptions["fractionalSecondDigits"]> = "auto",
): number {
  if (typeof value !== "number") {
    if (typeof value === "symbol") throw new TypeError("Temporal string options reject Symbols");
    if (String(value) === "auto") return AUTO_PRECISION;
    throw new RangeError("Invalid fractionalSecondDigits");
  }
  const digits = Math.floor(value);
  if (!Number.isFinite(value) || digits < 0 || digits > 9)
    throw new RangeError("Invalid fractionalSecondDigits");
  return digits;
}
export function roundingIncrement(value = 1): number {
  if (typeof value === "bigint" || typeof value === "symbol")
    throw new TypeError("Temporal numeric options reject BigInts and Symbols");
  const increment = Math.trunc(Number(value));
  if (!Number.isFinite(increment) || increment < 1 || increment > 1e9)
    throw new RangeError("Invalid rounding increment");
  return increment;
}
export function roundingMode(value: RoundingMode = "trunc"): RoundingMode {
  if (typeof value === "symbol") throw new TypeError("Temporal string options reject Symbols");
  const text = String(value);
  if (
    text === "ceil" ||
    text === "floor" ||
    text === "expand" ||
    text === "trunc" ||
    text === "halfCeil" ||
    text === "halfFloor" ||
    text === "halfExpand" ||
    text === "halfTrunc" ||
    text === "halfEven"
  )
    return text;
  throw new RangeError("Invalid rounding mode");
}
export function validateIncrement(unit: number, increment: number): void {
  if (unit === 3) return;
  const maximum = unit === 4 ? 24 : unit <= 6 ? 60 : 1000;
  if (increment >= maximum || maximum % increment !== 0)
    throw new RangeError("Invalid rounding increment for unit");
}
