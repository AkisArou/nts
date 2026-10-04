import { PlainDate } from "../../../../../runtime/ecmascript/src/temporal/plain-date.ts";
import { PlainMonthDay } from "../../../../../runtime/ecmascript/src/temporal/plain-month-day.ts";
import { Duration } from "../../../../../runtime/ecmascript/src/temporal/duration.ts";
import { ZonedDateTime } from "../../../../../runtime/ecmascript/src/temporal/zoned-date-time.ts";
import { UTC } from "../../../../../runtime/ecmascript/src/time/provider.ts";

// Actual value/context/private-slot transport, independent of ICU linking.
// Original Test262 remains the semantic corpus; these roots expose compilation
// and ownership failures in the same production classes and calendar kernels.
export function main(): string {
  const date = new PlainDate(1987, 7, 26, "chinese");
  return (
    date.monthCode +
    ":" +
    date.toPlainYearMonth().toString() +
    ":" +
    date.toPlainMonthDay().toString() +
    ":" +
    date.toPlainDateTime().toPlainDate().calendarId
  );
}

export function monthDay(): string {
  return PlainMonthDay.from({ calendar: "hebrew", monthCode: "M05L", day: 30 }).toString();
}

export function relative(): number {
  return new Duration(1).total({
    unit: "day",
    relativeTo: { calendar: "hebrew", year: 5784, month: 1, day: 1 },
  });
}

export function zoned(): string {
  const value = new ZonedDateTime(0n, UTC, "hebrew");
  const target = value.add({ months: 1 });
  return (
    target.toPlainDate().monthCode + ":" + value.until(target, { largestUnit: "month" }).toString()
  );
}
