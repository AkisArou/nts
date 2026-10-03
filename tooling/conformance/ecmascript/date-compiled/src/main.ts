import {
  dateFromTime,
  epochDays,
  makeDay,
  monthFromTime,
  timeClip,
  yearFromTime,
} from "../../../../../runtime/ecmascript/src/date/calendar.ts";
import { formatISO } from "../../../../../runtime/ecmascript/src/date/format.ts";
import { parseDate } from "../../../../../runtime/ecmascript/src/date/parse.ts";
import { setComponent } from "../../../../../runtime/ecmascript/src/date/operations.ts";
import { UTC } from "../../../../../runtime/ecmascript/src/time/provider.ts";
import {
  checkInstant,
  epochMilliseconds,
  roundNanoseconds,
} from "../../../../../runtime/ecmascript/src/temporal/exact.ts";
import {
  formatInstant,
  parseInstant,
} from "../../../../../runtime/ecmascript/src/temporal/instant.ts";
import {
  balanceDuration,
  durationTotal,
  Duration,
  formatDuration,
  parseDuration,
} from "../../../../../runtime/ecmascript/src/temporal/duration.ts";
import { Instant } from "../../../../../runtime/ecmascript/src/temporal/builtins.ts";
import { NtsDate, dateNow } from "../../../../../runtime/ecmascript/src/date/builtins.ts";
import type { TimeHost } from "../../../../../runtime/ecmascript/src/time/provider.ts";

// Supplementary compiler/ABI probes; Test262 remains the conformance corpus.
export function calendarRoundTrip(year: number): number {
  const bounded = Math.trunc(year) % 200000;
  const time = epochDays(bounded, 1, 28) * 86400000;
  return yearFromTime(time) * 10000 + monthFromTime(time) * 100 + dateFromTime(time);
}
export function clipped(time: number): number {
  return timeClip(time);
}
export function balanced(year: number, month: number): number {
  return makeDay(year, month, 1);
}
export function dateProbe(caseId: number): string {
  const text =
    caseId < 0
      ? "-000001-01-01T00:00:00.000Z"
      : caseId < 3
        ? "2000-02-29T12:34:56.789+05:45"
        : "+275760-09-13T00:00:00.000Z";
  return formatISO(parseDate(text, UTC));
}
export function setterProbe(caseId: number): number {
  const current = caseId < 0 ? NaN : 951825600000;
  return setComponent(current, "year", 2024, 1, 29, 0, 3, false, UTC);
}
export function exactProbe(caseId: number): number {
  const value = caseId < 0 ? -8640000000000000000000n : caseId < 3 ? -1n : 8640000000000000000000n;
  return epochMilliseconds(checkInstant(value));
}
export function roundingProbe(caseId: number): number {
  const value = caseId < 0 ? -15n : caseId < 3 ? 15n : 25n;
  return Number(roundNanoseconds(value, 10n, "halfEven"));
}
export function instantProbe(caseId: number): string {
  const text =
    caseId < 0
      ? "1969-12-31T23:59:59.999999999Z"
      : caseId < 3
        ? "2000-02-29T12:34:56.123456789+05:45"
        : "+275760-09-13T00:00:00Z";
  return formatInstant(parseInstant(text));
}
export function durationProbe(caseId: number): string {
  const text =
    caseId < 0
      ? "-PT24.56789H"
      : caseId < 3
        ? "P11Y22M33W44DT55H66M77.987654321S"
        : "PT46H66M71.50040904S";
  return formatDuration(parseDuration(text));
}
export function durationBalanceProbe(caseId: number): string {
  const value =
    caseId < 0
      ? -18446744073709551616n
      : caseId < 3
        ? 18446744073709551616n
        : 17280000000000000000000n;
  return formatDuration(balanceDuration(value, 8));
}
export function durationTotalProbe(caseId: number): number {
  const record =
    caseId < 0
      ? new Duration(0, 0, 0, 0, -816, 0, 0, 0, 0, -2049187497660)
      : caseId < 3
        ? new Duration(0, 0, 0, 0, 816, 0, 0, 0, 0, 2049187497660)
        : new Duration(0, 0, 0, 0, 0, 0, 0, 9007199254740992, 1999, 0);
  return durationTotal(record.timeNanoseconds(), caseId < 3 ? 4 : 7);
}

// Exercise the production classes and library-derived option layouts, rather
// than validating only the scalar helpers behind them.
export function instantPublic(caseId: number): string {
  const value = new Instant(caseId < 0 ? -1n : 951825600123456789n);
  return value
    .add({ seconds: 1 })
    .round({ smallestUnit: "microsecond", roundingMode: "halfEven" })
    .toString();
}
export function durationPublic(caseId: number): string {
  const value = Duration.from(caseId < 0 ? "-PT24.56789H" : "PT25H1.123456789S");
  return value.abs().with({ nanoseconds: 1 }).round({ smallestUnit: "microsecond" }).toString();
}
export function datePublic(caseId: number): string {
  const date = new NtsDate(caseId < 0 ? NaN : 951825600000);
  date.setUTCFullYear(2024, 1, 29);
  return date.toISOString();
}
class Clock implements TimeHost {
  nowMilliseconds(): number {
    return 1234;
  }
  defaultTimeZone() {
    return UTC;
  }
}
export function clockPublic(): number {
  return dateNow(new Clock());
}
