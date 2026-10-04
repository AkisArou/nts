import type { TimeZoneRules } from "../../../../../runtime/ecmascript/src/time/provider.ts";
import { FixedTimeZone, UTC } from "../../../../../runtime/ecmascript/src/time/provider.ts";
import { epochDays } from "../../../../../runtime/ecmascript/src/date/calendar.ts";
import {
  formatInstant,
  parseInstant,
} from "../../../../../runtime/ecmascript/src/temporal/instant.ts";
import {
  formatOffsetNanoseconds,
  formatRoundedOffset,
  offsetNanoseconds,
  resolveLocalDateTime,
  startOfDay,
  timeZoneTransitionMilliseconds,
} from "../../../../../runtime/ecmascript/src/temporal/zoned-time.ts";
import { timeZoneIdentifier } from "../../../../../runtime/ecmascript/src/temporal/zone-id.ts";
import { NS_PER_DAY, NS_PER_HOUR } from "../../../../../runtime/ecmascript/src/temporal/exact.ts";
import {
  addISOZonedDateTime,
  roundISOZonedDateTime,
} from "../../../../../runtime/ecmascript/src/temporal/zoned-iso.ts";
import { ISOParser } from "../../../../../runtime/ecmascript/src/temporal/iso-parser.ts";

function localDigest(zone: TimeZoneRules, text: string): string {
  const parsed = new ISOParser(text);
  const day = epochDays(parsed.year, parsed.month - 1, parsed.day);
  const time = parsed.timeNanoseconds();
  return (
    formatInstant(resolveLocalDateTime(day, time, zone, "compatible")) +
    ":" +
    formatInstant(resolveLocalDateTime(day, time, zone, "earlier")) +
    ":" +
    formatInstant(resolveLocalDateTime(day, time, zone, "later"))
  );
}

export function zonedTimeDigest(
  ny: TimeZoneRules,
  lordHowe: TimeZoneRules,
  apia: TimeZoneRules,
  havana: TimeZoneRules,
  monrovia: TimeZoneRules,
): string {
  let result = "temporal-gap:" + localDigest(ny, "2024-03-10T02:30:00.123456789Z");
  result += "\ntemporal-fold:" + localDigest(ny, "2024-11-03T01:30:00.123456789Z");
  result += "\ntemporal-half-gap:" + localDigest(lordHowe, "2024-10-06T02:15Z");
  result += "\ntemporal-half-fold:" + localDigest(lordHowe, "2024-04-07T01:45Z");
  result += "\ntemporal-skipped-date:" + localDigest(apia, "2011-12-30T12:00Z");
  const spring = epochDays(2024, 2, 10);
  const fall = epochDays(2024, 10, 3);
  const historic = epochDays(1972, 0, 7);
  result +=
    "\ntemporal-start:" +
    formatInstant(startOfDay(spring, havana)) +
    ":" +
    (startOfDay(spring + 1, havana) - startOfDay(spring, havana)) / NS_PER_HOUR +
    ":" +
    formatInstant(startOfDay(fall, havana)) +
    ":" +
    (startOfDay(fall + 1, havana) - startOfDay(fall, havana)) / NS_PER_HOUR +
    ":" +
    formatInstant(startOfDay(historic, monrovia)) +
    ":" +
    formatInstant(startOfDay(epochDays(2011, 11, 30), apia));
  const transition = parseInstant("2024-03-10T07:00Z");
  result +=
    "\ntemporal-transition:" +
    timeZoneTransitionMilliseconds(transition - 1n, ny, true) +
    ":" +
    timeZoneTransitionMilliseconds(transition + 1n, ny, false) +
    ":" +
    timeZoneTransitionMilliseconds(transition, ny, false) +
    ":" +
    timeZoneTransitionMilliseconds(transition, ny, true) +
    ":" +
    timeZoneTransitionMilliseconds(-1n, UTC, true);
  const negativeTransition = parseInstant("1883-11-18T17:00Z");
  result +=
    "\ntemporal-negative-transition:" +
    timeZoneTransitionMilliseconds(negativeTransition - 1n, ny, true) +
    ":" +
    timeZoneTransitionMilliseconds(negativeTransition + 1n, ny, false);
  result +=
    "\ntemporal-endpoints:" +
    formatInstant(8640000000000000000000n, -1, new FixedTimeZone("+23:59", 86340000)) +
    ":" +
    formatInstant(-8640000000000000000000n, -1, new FixedTimeZone("-23:59", -86340000));
  const old = parseInstant("1972-01-06T23:00Z");
  result +=
    "\ntemporal-offset:" +
    formatInstant(old, -1, monrovia) +
    ":" +
    formatOffsetNanoseconds(offsetNanoseconds(old, monrovia)) +
    ":" +
    formatOffsetNanoseconds(-1n) +
    ":" +
    formatRoundedOffset(-29999999999n) +
    ":" +
    formatInstant(-1n, -1, new FixedTimeZone("+05:30", 19800000));
  const fold = epochDays(2024, 10, 3);
  result +=
    "\ntemporal-offset-selection:" +
    formatInstant(
      resolveLocalDateTime(fold, 5400000000000, ny, "reject", "reject", -5n * NS_PER_HOUR),
    ) +
    ":" +
    formatInstant(
      resolveLocalDateTime(fold, 5400000000000, ny, "later", "prefer", -3n * NS_PER_HOUR),
    ) +
    ":" +
    formatInstant(
      resolveLocalDateTime(fold, 5400000000000, ny, "earlier", "use", -3n * NS_PER_HOUR),
    );
  const localOld = epochDays(1880, 0, 1);
  result +=
    "\ntemporal-rounded-match:" +
    formatInstant(
      resolveLocalDateTime(localOld, 0, ny, "reject", "reject", -17760000000000n, true),
    );
  result +=
    "\ntemporal-zone-like:" +
    timeZoneIdentifier("2021-08-19T17:30-07:00") +
    ":" +
    timeZoneIdentifier("2021-08-19T17:30-07:00:01[UTC]") +
    ":" +
    timeZoneIdentifier("12:30Z") +
    ":" +
    timeZoneIdentifier("2021-08[UTC]") +
    ":" +
    timeZoneIdentifier("12-25[+05:30]");
  const springNoon = parseInstant("2024-03-09T17:00Z");
  const fallNoon = parseInstant("2024-11-02T16:00Z");
  result +=
    "\ntemporal-calendar-add:" +
    formatInstant(addISOZonedDateTime(springNoon, ny, 0, 0, 0, 1, 0n, "constrain")) +
    ":" +
    formatInstant(addISOZonedDateTime(springNoon, ny, 0, 0, 0, 0, NS_PER_DAY, "constrain")) +
    ":" +
    formatInstant(addISOZonedDateTime(fallNoon, ny, 0, 0, 0, 1, 0n, "constrain")) +
    ":" +
    formatInstant(addISOZonedDateTime(fallNoon, ny, 0, 0, 0, 0, NS_PER_DAY, "constrain"));
  result +=
    "\ntemporal-calendar-special:" +
    formatInstant(
      addISOZonedDateTime(parseInstant("2024-01-31T17:00Z"), ny, 0, 1, 0, 0, 0n, "constrain"),
    ) +
    ":" +
    formatInstant(
      addISOZonedDateTime(parseInstant("2011-12-29T22:00Z"), apia, 0, 0, 0, 1, 0n, "constrain"),
    ) +
    ":" +
    formatInstant(
      addISOZonedDateTime(parseInstant("2024-11-03T06:30Z"), ny, 0, 0, 0, 0, 0n, "constrain"),
    );
  result +=
    "\ntemporal-round-day:" +
    formatInstant(
      roundISOZonedDateTime(parseInstant("2024-03-10T16:00Z"), ny, 3, 1, "halfExpand"),
    ) +
    ":" +
    formatInstant(
      roundISOZonedDateTime(parseInstant("2024-03-10T16:30Z"), ny, 3, 1, "halfExpand"),
    ) +
    ":" +
    formatInstant(
      roundISOZonedDateTime(parseInstant("2024-11-03T16:30Z"), ny, 3, 1, "halfExpand"),
    ) +
    ":" +
    formatInstant(roundISOZonedDateTime(parseInstant("2024-11-03T16:30Z"), ny, 3, 1, "halfEven"));
  result +=
    "\ntemporal-round-fold:" +
    formatInstant(
      roundISOZonedDateTime(parseInstant("2024-11-03T05:10Z"), ny, 4, 1, "halfExpand"),
    ) +
    ":" +
    formatInstant(
      roundISOZonedDateTime(parseInstant("2024-11-03T06:10Z"), ny, 4, 1, "halfExpand"),
    ) +
    ":" +
    formatInstant(
      roundISOZonedDateTime(parseInstant("2024-03-10T06:40Z"), ny, 4, 1, "halfExpand"),
    ) +
    ":" +
    formatInstant(
      roundISOZonedDateTime(parseInstant("2024-10-05T15:15Z"), lordHowe, 4, 1, "halfExpand"),
    );
  return result;
}

export function zonedTimeBenchmark(
  zone: TimeZoneRules,
  iterations: number,
  ambiguous: boolean,
  advancing: boolean,
): number {
  const parsed = new ISOParser(
    ambiguous ? "2024-11-03T01:30:00.123456789Z" : "2024-11-04T12:30:00.123456789Z",
  );
  const day = epochDays(parsed.year, parsed.month - 1, parsed.day);
  const time = parsed.timeNanoseconds();
  const expected = parseInstant(
    ambiguous ? "2024-11-03T05:30:00.123456789Z" : "2024-11-04T17:30:00.123456789Z",
  );
  let checksum = 0;
  for (let index = 0; index < iterations; index++) {
    const delta = advancing ? (index % 1000) * 1000000 : 0;
    if (resolveLocalDateTime(day, time + delta, zone, "compatible") !== expected + BigInt(delta))
      throw new Error("Time-zone benchmark result changed");
    checksum++;
  }
  return checksum;
}
