import { PlainDateTime } from "../../../../../runtime/ecmascript/src/temporal/plain-date-time.ts";

// Public representation witness; original Test262 supplies the semantic cases.
export function main(): string {
  const start = new PlainDateTime(2000, 2, 29, 23, 59, 59, 999, 999, 999);
  const rounded = start.round("second");
  const elapsed = start.until(rounded);
  return rounded.toString() + ":" + elapsed.nanoseconds + ":" + rounded.toPlainDate().dayOfWeek;
}
