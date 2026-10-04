import type { TimeLocaleSource } from "../../../../../runtime/ecmascript/src/time/locale-source.ts";
import { NtsDate } from "../../../../../runtime/ecmascript/src/date/builtins.ts";
import {
  Instant,
  Duration,
  PlainTime,
  PlainDate,
  PlainDateTime,
  PlainYearMonth,
  PlainMonthDay,
  ZonedDateTime,
} from "../../../../../runtime/ecmascript/src/temporal/builtins.ts";
import { FixedTimeZone } from "../../../../../runtime/ecmascript/src/time/provider.ts";

// Actual value/formatter boundary witness. Original Test262 owns semantics;
// this entry must also compile and execute with each production ICU provider.
export function timeLocalePublic(source: TimeLocaleSource): string {
  const dateOptions: Readonly<Intl.DateTimeFormatOptions> = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  };
  const timeOptions: Readonly<Intl.DateTimeFormatOptions> = {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  };
  const date = new NtsDate(0);
  return [
    new Instant(0n).toLocaleString("en-GB", dateOptions, source),
    new PlainDate(1970, 1, 2).toLocaleString("en-GB", dateOptions, source),
    new PlainDateTime(1970, 1, 2, 3, 4, 5).toLocaleString("en-GB", timeOptions, source),
    new PlainTime(3, 4, 5).toLocaleString("en-GB", timeOptions, source),
    new PlainYearMonth(1970, 1).toLocaleString(
      "en-GB-u-ca-iso8601",
      { year: "numeric", month: "long" },
      source,
    ),
    new PlainMonthDay(1, 2).toLocaleString(
      "en-GB-u-ca-iso8601",
      { month: "long", day: "numeric" },
      source,
    ),
    new ZonedDateTime(0n, new FixedTimeZone("+05:30", 19_800_000)).toLocaleString(
      "en-GB",
      { timeStyle: "medium" },
      source,
    ),
    new Duration(0, 0, 0, 0, 2, 3, 4).toLocaleString("en-GB", { style: "digital" }, source),
    date.toLocaleString("en-GB", dateOptions, source),
    date.toLocaleDateString("en-GB", dateOptions, source),
    date.toLocaleTimeString("en-GB", timeOptions, source),
  ].join("\n");
}
