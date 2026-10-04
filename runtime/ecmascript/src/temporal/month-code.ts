import { requiredString } from "./options.ts";
import { decodeMonthCode } from "./calendar-month-code.ts";

// Calendar-independent syntax. Keep the prepared month number/leap flag in one
// scalar; calendar suitability and year-dependent leap-month rules follow later.
export function parseMonthCode(value: string): number {
  const code = decodeMonthCode(requiredString(value));
  if (Number.isNaN(code)) throw new RangeError("Invalid month code syntax");
  return code;
}
