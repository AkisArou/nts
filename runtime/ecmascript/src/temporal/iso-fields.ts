import { integerWithTruncation } from "./options.ts";
import { yearFromDays, monthFromTime, dateFromTime, MS_PER_DAY } from "../date/calendar.ts";
import { regulateISODate } from "./iso-date.ts";

export function positiveDateField(value: number): number {
  const result = integerWithTruncation(value);
  if (result < 1) throw new RangeError("Date field must be positive");
  return result;
}
// Syntactic parsing precedes calendar suitability checks. The leap flag is
// encoded in this internal scalar, keeping prepared fields out of allocations.
export function isoMonthCode(value: string): number {
  if (typeof value !== "string" && (typeof value !== "object" || value === null)) throw new TypeError("Month code must be a string");
  const code = String(value);
  if ((code.length !== 3 && !(code.length === 4 && code.charAt(3) === "L")) || code.charAt(0) !== "M" ||
    code.charCodeAt(1) < 48 || code.charCodeAt(1) > 57 || code.charCodeAt(2) < 48 || code.charCodeAt(2) > 57)
    throw new RangeError("Invalid month code syntax");
  return Number(code.slice(1, 3)) + (code.length === 4 ? 100 : 0);
}
export function resolveISOFields(year: number | undefined, month: number | undefined, code: number | undefined, day: number | undefined,
  overflow: NonNullable<Temporal.OverflowOptions["overflow"]>, previous?: number): number {
  if (previous !== undefined) {
    if (year === undefined) year = yearFromDays(previous);
    if (day === undefined) day = dateFromTime(previous * MS_PER_DAY);
    if (month === undefined && code === undefined) month = monthFromTime(previous * MS_PER_DAY) + 1;
  }
  if (year === undefined || (month === undefined && code === undefined) || day === undefined) throw new TypeError("Date requires year, month and day");
  if (code !== undefined) {
    if (code < 1 || code > 12 || (month !== undefined && month !== code)) throw new RangeError("Month and monthCode disagree");
    month = code;
  }
  return regulateISODate(year, month!, day, overflow);
}

export function regulateTimeField(value: number, maximum: number, overflow: NonNullable<Temporal.OverflowOptions["overflow"]>): number {
  if (overflow === "constrain") return Math.max(0, Math.min(maximum, value));
  if (value < 0 || value > maximum) throw new RangeError("Temporal time field outside range");
  return value;
}
