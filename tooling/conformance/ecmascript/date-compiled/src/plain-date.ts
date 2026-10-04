import { PlainDate } from "../../../../../runtime/ecmascript/src/temporal/plain-date.ts";

// Public representation witness; original Test262 owns calendar semantics.
export function main(): string {
  const leap = new PlainDate(2000, 2, 29);
  const next = leap.add({ years: 1 });
  const rounded = leap.until(next, { smallestUnit: "month", roundingMode: "halfExpand" });
  return leap.dayOfWeek + ":" + leap.weekOfYear + ":" + next.toString() + ":" + rounded.months;
}
