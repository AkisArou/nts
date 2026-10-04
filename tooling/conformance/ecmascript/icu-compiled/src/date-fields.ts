import type {
  DateTimeFormatterPrimitive,
  DateTimePatternData,
} from "../../../../../runtime/ecmascript/src/intl/date-time-data.ts";

// Supplementary ABI/lifetime witness. Original Test262 owns date semantics;
// this checks that both compiled adapters preserve supplied fields and spans.
export function preparedDateFields<
  P extends DateTimeFormatterPrimitive,
  G extends DateTimePatternData,
>(open: (locale: string, pattern: string, zone: string) => P, patterns: G): string {
  const instant = 1898726400000;
  const formatter = open("en-u-ca-chinese", "r|M|d|EEEE|HH:mm:ss.SSS", "UTC");
  formatter.setCalendarFields(2030, 47, 1, false, 29, 58);
  const first = formatter.format(instant, true);
  let mask = 0;
  for (let index = 0; index < formatter.fieldCount(); index++) {
    if (formatter.start(index) < 0 || formatter.end(index) > first.length)
      throw new Error("Prepared date field span outside text");
    mask |= 1 << formatter.field(index);
  }
  let result =
    formatter.offsetMilliseconds(instant) + ":" + first + ":" + formatter.fieldCount() + ":" + mask;
  for (let index = 0; index < 2000; index++) {
    const day = 29 + (index % 2);
    formatter.setCalendarFields(2030, 47, 1, false, day, 58 + (index % 2));
    const text = formatter.format(instant, false);
    const expected = "2030|2|" + day + "|Sunday|00:00:00.000";
    if (text !== expected) throw new Error("Prepared fields remained cached at the same instant");
  }
  result += "\nsame-instant:2000";
  const wide = open("en-u-ca-chinese-nu-mathbold", "r|M|d", "UTC");
  wide.setCalendarFields(2030, 47, 0, false, 29, 58);
  const wideText = wide.format(instant, true);
  result += "\nutf16:" + wideText + ":" + wideText.length;
  for (let index = 0; index < wide.fieldCount(); index++)
    result += ";" + wide.field(index) + "=" + wide.start(index) + ":" + wide.end(index);
  const offset = open("en", "HH:mm", "America/New_York");
  result += "\noffset:" + offset.offsetMilliseconds(1710055800000);
  const interval = patterns.intervalPattern("yMMMd", 3);
  if (!(interval.startsWith("earliestFirst:") || interval.startsWith("latestFirst:")))
    throw new Error("Interval pattern has no endpoint order");
  if (!interval.includes("M") || !interval.includes("d"))
    throw new Error("Interval pattern lost selected fields");
  if (patterns.intervalPattern("yMMMd", 6) !== "")
    throw new Error("Date-only interval data unexpectedly includes minutes");
  const fallback = patterns.intervalFallback();
  const connector = patterns.dateTimeConnector(3);
  if (
    !(
      fallback.includes("{0}") &&
      fallback.includes("{1}") &&
      connector.includes("{0}") &&
      connector.includes("{1}")
    )
  )
    throw new Error("Interval fallback or date/time connector lost an argument");
  return result + "\ninterval-data:order:fields:fallback:connector";
}
